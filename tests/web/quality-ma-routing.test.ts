import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleQualityHttp } from "../../src/web/quality-http";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { attachQualityOaTestFile, ingestQualityOaInstance, listQualityOaAttachments } from "../../src/quality/oa/quality-oa-source";
import { createMaWorkbenchService } from "../../src/quality/ma-workbench/service";

let dir: string; let dbPath: string;
beforeEach(() => {
  dir=mkdtempSync(join(tmpdir(),"ma-routing-")); dbPath=join(dir,"test.sqlite");
  vi.stubEnv("WORKBENCH_SQLITE_PATH",dbPath); vi.stubEnv("WORKBENCH_MANAGER_USER_IDS","ma");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS","ma"); vi.stubEnv("WORKBENCH_ADMIN_USER_IDS","admin");
  vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS","tong"); vi.stubEnv("QUALITY_MA_WORKBENCH_ENABLED","1");
  vi.stubEnv("QUALITY_MA_LOCAL_DATA","1"); createQualityStore(dbPath).close();
});
afterEach(()=>{vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
async function call(path:string,userId="ma",method="GET") {
  let status=0; let body:Buffer=Buffer.alloc(0); let headers:Record<string,unknown>={}; let finish!:()=>void;
  const done=new Promise<void>(r=>finish=r);
  const res={writeHead(code:number,value:Record<string,unknown>){status=code;headers=value;},end(value?:string|Buffer){body=Buffer.from(value??"");finish();}} as ServerResponse;
  const handled=handleQualityHttp({req:{method,headers:{}} as IncomingMessage,res,url:new URL(path,"http://localhost"),session:{userId,role:userId==="admin"?"admin":userId==="tong"?"employee":"manager"}});
  if(handled) await done; return {handled,status,body,headers};
}
describe("Ma production routing and attachment boundary",()=>{
  it("gates new page/API behind feature flag and uses the new workbench for authorized manager",async()=>{
    const page=await call("/workbench/quality");expect(page.status).toBe(200);expect(page.body.toString()).toContain('id="maWorkbench"');
    expect((await call("/workbench/quality/ma","admin")).status).toBe(403);
    expect((await call("/workbench/quality/ma","tong")).status).toBe(403);
    const head=await call("/workbench/quality/ma","ma","HEAD");expect(head.status).toBe(200);expect(head.body.length).toBe(0);
    expect((await call("/workbench/quality/ma","ma","POST")).status).toBe(405);
    vi.stubEnv("QUALITY_MA_WORKBENCH_ENABLED","0");
    expect((await call("/workbench/quality/ma")).status).toBe(404);
    expect((await call("/api/workbench/quality/ma/feedbacks")).status).toBe(404);
    const legacy=await call("/workbench/quality");expect(legacy.status).toBe(200);expect(legacy.body.toString()).not.toContain('id="maWorkbench"');
  });
  it("downloads original attachments through an authorized route with safe content headers",async()=>{
    ingestQualityOaInstance({dbPath,processCode:"local",processInstanceId:"routing",localFixture:true,instance:{formComponentValues:[{name:"WHAT",value:"本地测试附件"},{name:"上传日志",componentType:"DDAttachment",value:JSON.stringify([{fileId:"log",fileName:"日志.txt"}])}]}});
    attachQualityOaTestFile({dbPath,sourceKey:"oa:routing",fileId:"log",body:Buffer.from("本地原始日志")});
    const attachment=listQualityOaAttachments(dbPath,"oa:routing")[0]!;
    const result=await call(attachment.downloadUrl!+"?download=1");expect(result.status).toBe(200);expect(result.body.toString()).toBe("本地原始日志");
    expect(result.headers["Content-Disposition"]).toContain("attachment;");expect(result.headers["Content-Security-Policy"]).toContain("sandbox");
    expect((await call(attachment.downloadUrl!,"employee")).status).toBe(403);
    expect((await call(attachment.downloadUrl!.replace(attachment.id,"missing"))).status).toBe(404);
    const service=createMaWorkbenchService({dbPath});
    try {
      service.admit("oa:routing","ma",{requestId:randomUUID(),expectedSourceVersion:1});
      service.saveAssessment("oa:routing","ma",{requestId:randomUUID(),expectedSourceVersion:1,expectedVersion:0,categoryMode:"STANDARD",primaryCategoryCode:"CATHETER_PRODUCT",secondaryCategoryCode:"CATHETER_BEND_SHAKE",riskLevel:"LOW",conclusion:"本地研判，需核对原始记录",adoptionMode:"MANUAL"});
      const pushed=service.submit("oa:routing","ma",{requestId:randomUUID(),expectedSourceVersion:1,expectedAssessmentVersion:1});
      const deepLink=await call(`/workbench/quality?eventId=${pushed.event!.id}`);
      expect(deepLink.body.toString()).toContain('"initialSourceKey":"oa:routing"');
    } finally {service.close();}
  });
});
