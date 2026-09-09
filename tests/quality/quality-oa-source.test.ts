import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ingestQualityOaInstance, listQualityOaAttachments, attachQualityOaTestFile, downloadQualityOaAttachment, getQualityOaSourceHistory } from "../../src/quality/oa/quality-oa-source";
import { getQualityOaReadiness, type OaInstance } from "../../src/quality/oa/quality-oa-connector";
import { createQualitySourceSync } from "../../src/quality/source/quality-source-sync";
import { enqueueQualitySourceWriteback } from "../../src/quality/reviews/quality-source-review-service";

let directory:string; let dbPath:string;
const instance = (description="测试设备启动闪烁"):OaInstance=>({businessId:"OA-LOCAL-001",title:"测试反馈",status:"RUNNING",createTime:"2026-09-09T09:00:00Z",originatorUserId:"local-user",formComponentValues:[
  {name:"WHAT",value:description},{name:"设备序列号",value:"000123"},{name:"导管生产批号",value:"001023"},
  {name:"服务日志导出并上传",componentType:"DDAttachment",value:JSON.stringify([{fileId:"file-one",fileName:"本地测试日志.txt",fileSize:6,fileType:"txt"}])},
]});
const ingest=(value=instance(),localFixture=true)=>ingestQualityOaInstance({dbPath,processInstanceId:"local-instance",processCode:"local-process",instance:value,localFixture});
beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),"ma-oa-test-"));dbPath=join(directory,"workbench.sqlite");});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
describe("reserved OA source boundary",()=>{
  it("starts disconnected and preserves submitted facts before OA approval",()=>{
    expect(getQualityOaReadiness().connected).toBe(false);
    const first=ingest(); expect(first.sourceVersion).toBe(1);
    const db=new DatabaseSync(dbPath); const row=db.prepare("SELECT * FROM quality_source_rows").get() as any;
    expect(JSON.parse(row.normalized_json)).toMatchObject({sourceType:"DINGTALK_OA",feedbackNo:"OA-LOCAL-001",serialNo:"000123",catheterBatch:"001023",oaStatus:"审批中"});
    expect(db.prepare("SELECT count(*) n FROM quality_events").get()).toEqual({n:0}); db.close();
  });
  it("deduplicates form versions while approval changes have separate history",()=>{
    ingest(); expect(ingest().changed).toBe(false);
    const approved={...instance(),status:"COMPLETED",result:"refuse"}; expect(ingest(approved).sourceVersion).toBe(1);
    expect(ingest(instance("补充了重现路径")).sourceVersion).toBe(2);
    const history=getQualityOaSourceHistory(dbPath,"oa:local-instance"); expect(history.versions).toHaveLength(2); expect(history.approvalHistory).toHaveLength(3);
    const db=new DatabaseSync(dbPath); expect(()=>db.exec("UPDATE quality_oa_versions SET payload_json='{}'")).toThrow("immutable"); db.close();
  });
  it("keeps attachment metadata and serves exact fixture bytes without a connector",async()=>{
    ingest(); expect(listQualityOaAttachments(dbPath,"oa:local-instance")[0]?.downloadUrl).toBeNull();
    attachQualityOaTestFile({dbPath,sourceKey:"oa:local-instance",fileId:"file-one",body:Buffer.from("完整测试日志")});
    const file=listQualityOaAttachments(dbPath,"oa:local-instance")[0]!;
    expect(file.downloadUrl).toContain("/attachments/");
    const result=await downloadQualityOaAttachment({dbPath,sourceKey:"oa:local-instance",id:file.id}); expect(result.body.toString()).toBe("完整测试日志");
    await expect(downloadQualityOaAttachment({dbPath,sourceKey:"oa:another",id:file.id})).rejects.toThrow("不存在");
  });
  it("cannot insert fixture file bytes into an actual OA source",()=>{
    ingest(instance(),false); expect(()=>attachQualityOaTestFile({dbPath,sourceKey:"oa:local-instance",fileId:"file-one",body:Buffer.from("wrong")})).toThrow("本地测试");
  });
  it("does not delete OA feedback during workbook sync or enqueue workbook writes",async()=>{
    ingest(); const sync=createQualitySourceSync({dbPath,reader:{readFirstSheet:async()=>({sheetId:"sheet",sheetName:"客户端问题反馈记录表",rows:[["反馈时间","反馈单号","问题描述"],["2026-09-09","WB-001","工作簿反馈"]]})}});
    try{await sync.syncNow();}finally{sync.close();}
    const db=new DatabaseSync(dbPath); expect(db.prepare("SELECT state FROM quality_source_rows WHERE source_key='oa:local-instance'").get()).toEqual({state:"ACTIVE"});
    enqueueQualitySourceWriteback(db,{sourceKey:"oa:local-instance",reviewVersion:1,desiredValue:"已进入后续流程",occurredAt:new Date().toISOString()});
    expect(db.prepare("SELECT count(*) n FROM quality_source_writeback_outbox").get()).toEqual({n:0}); db.close();
  });
});
