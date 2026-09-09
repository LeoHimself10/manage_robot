import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createQualityStore } from "../infra/quality-store";
import { getQualityOaConnector, type OaInstance } from "./quality-oa-connector";
export { getQualityOaReadiness } from "./quality-oa-connector";

type Row = Record<string, any>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown) => value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
function parse(value: unknown): any { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return value; } }
function hasTable(db: DatabaseSync, name: string) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }

export function ensureQualityOaSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_oa_instances (
      source_key TEXT PRIMARY KEY REFERENCES quality_source_rows(source_key),
      process_instance_id TEXT NOT NULL UNIQUE, process_code TEXT NOT NULL,
      approval_status TEXT NOT NULL, payload_hash TEXT NOT NULL, updated_at TEXT NOT NULL,
      is_fixture INTEGER NOT NULL DEFAULT 0 CHECK(is_fixture IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS quality_oa_versions (
      source_key TEXT NOT NULL REFERENCES quality_source_rows(source_key), source_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(source_key,source_version)
    );
    CREATE TABLE IF NOT EXISTS quality_oa_approval_history (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL REFERENCES quality_source_rows(source_key),
      approval_status TEXT NOT NULL, records_json TEXT NOT NULL, received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quality_oa_attachments (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL REFERENCES quality_source_rows(source_key),
      source_version INTEGER NOT NULL, process_instance_id TEXT NOT NULL, file_id TEXT NOT NULL,
      name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      category TEXT NOT NULL, storage_key TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quality_oa_attachments_source ON quality_oa_attachments(source_key,source_version);
    CREATE TRIGGER IF NOT EXISTS quality_oa_versions_no_update BEFORE UPDATE ON quality_oa_versions BEGIN SELECT RAISE(ABORT,'OA source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS quality_oa_versions_no_delete BEFORE DELETE ON quality_oa_versions BEGIN SELECT RAISE(ABORT,'OA source versions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS quality_oa_history_no_update BEFORE UPDATE ON quality_oa_approval_history BEGIN SELECT RAISE(ABORT,'OA history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS quality_oa_history_no_delete BEFORE DELETE ON quality_oa_approval_history BEGIN SELECT RAISE(ABORT,'OA history is append-only'); END;
  `);
}

function mime(name: string, type: string): string {
  if (/^[\w.+-]+\/[\w.+-]+$/.test(type)) return type;
  const suffix = (name.split(".").pop() ?? type).toLowerCase();
  return ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",pdf:"application/pdf",mp4:"video/mp4",webm:"video/webm",txt:"text/plain",log:"text/plain",json:"application/json",csv:"text/csv"} as Record<string,string>)[suffix] ?? "application/octet-stream";
}
function attachments(instance: OaInstance): Array<{fileId:string;name:string;mimeType:string;sizeBytes:number;category:string}> {
  const result: Array<{fileId:string;name:string;mimeType:string;sizeBytes:number;category:string}> = [];
  function visit(value: any, label: string, depth = 0) {
    if (depth > 12) return;
    value = parse(value);
    if (Array.isArray(value)) { value.forEach((item) => visit(item,label,depth+1)); return; }
    if (!value || typeof value !== "object") return;
    const fileId = text(value.fileId ?? value.file_id);
    const name = text(value.fileName ?? value.file_name ?? value.name);
    if (fileId && name) {
      result.push({fileId,name,mimeType:mime(name,text(value.mimeType ?? value.fileType)),sizeBytes:Math.max(0,Number(value.fileSize ?? value.size ?? 0)||0),category:label});
      return;
    }
    Object.values(value).forEach((item) => visit(item,label,depth+1));
  }
  for (const field of instance.formComponentValues ?? []) {
    if (/attach|image|video|file/i.test(field.componentType ?? "") || /上传|附件|图片|视频|日志|原始数据/.test(field.name ?? "")) {
      visit(field.value,field.name ?? "OA 附件"); visit(field.extValue,field.name ?? "OA 附件");
    }
  }
  return [...new Map(result.map((item) => [`${item.category}:${item.fileId}`,item])).values()];
}

/** Called by a future verified OA event receiver. No public unauthenticated ingest route. */
export function ingestQualityOaInstance(input: {dbPath:string;processInstanceId:string;processCode:string;instance:OaInstance;receivedAt?:string;isTest?:boolean;localFixture?:boolean;reporterName?:string;oaUrl?:string}) {
  if (!input.processInstanceId.trim() || !input.processCode.trim()) throw new Error("OA 实例和流程编号不能为空");
  if (!Array.isArray(input.instance.formComponentValues)) throw new Error("OA 审批表单字段必须完整获取");
  createQualityStore(input.dbPath).close();
  const db = new DatabaseSync(input.dbPath); db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=8000"); ensureQualityOaSchema(db);
  const now = input.receivedAt ?? new Date().toISOString();
  const sourceKey = `oa:${input.processInstanceId}`;
  const fields: Record<string,string> = Object.create(null);
  for (const field of input.instance.formComponentValues) {
    const label = field.name?.trim() || field.id || "未命名字段";
    fields[label] = fields[label] == null ? text(field.value) : `${fields[label]}\n${text(field.value)}`;
  }
  const pick = (...names: string[]) => names.map((name) => fields[name]).find((value) => value?.trim()) ?? "";
  const oaStatus = input.instance.status === "COMPLETED" ? input.instance.result === "refuse" ? "已拒绝" : input.instance.result === "agree" ? "已通过" : "已结束"
    : input.instance.status === "TERMINATED" || input.instance.status === "CANCELED" ? "已撤销" : "审批中";
  const fileEntries = attachments(input.instance);
  // Workflow status changes do not invalidate a quality assessment of unchanged source facts.
  const hash = digest(JSON.stringify({fields, originator:input.instance.originatorUserId, files:fileEntries}));
  const raw = JSON.stringify(fields);
  const payloadHash = digest(JSON.stringify(input.instance));
  const normalized = {
    sourceKey,rowNumber:1,contentHash:hash,sourceType:"DINGTALK_OA",processInstanceId:input.processInstanceId,processCode:input.processCode,
    feedbackAt:input.instance.createTime ?? "",feedbackNo:input.instance.businessId ?? input.processInstanceId,
    reporter:input.reporterName || pick("提交人","反馈人") || input.instance.originatorUserId || "",
    originatorUserId:input.instance.originatorUserId ?? "",originatorDeptName:input.instance.originatorDeptName ?? "",
    deviceModel:pick("设备型号"),serialNo:pick("设备序列号"),catheterBatch:pick("导管生产批号","报损导管批次"),
    issueDescription:pick("WHAT","问题描述"),clinicianAware:pick("术者是否可以感知"),impact:pick("影响程度","对术者造成的影响"),
    returned:pick("导管是否可以回收寄回"),category:pick("问题归类"),confirmation:"",owner:"",status:"",solutionEngineer:"",solution:"",finalCause:"",customerFollowup:"",
    productType:pick("产品类型选项"),catheterModel:pick("导管型号"),softwareVersion:pick("软件版本"),hospital:pick("WHERE"),occurredAt:pick("WHEN"),reproduction:pick("HOW"),occurrenceCount:pick("HOW MANY"),
    damagedCount:pick("本次报损的导管数量（条）","本次报损的导管数量（条） "),oaStatus,oaUrl:input.oaUrl ?? null,isTest:Boolean(input.isTest),isDemo:Boolean(input.localFixture),
  };
  try {
    db.exec("BEGIN IMMEDIATE");
    const before = db.prepare("SELECT * FROM quality_source_rows WHERE source_key=?").get(sourceKey) as Row|undefined;
    const version = before ? Number(before.source_version) + (before.content_hash === hash ? 0 : 1) : 1;
    db.prepare(`INSERT INTO quality_source_rows(source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,last_seen_at,source_updated_at,synced_at,version)
      VALUES(?,?,?,1,'ACTIVE',1,?,?,?,NULL,?,?,?,?,1)
      ON CONFLICT(source_key) DO UPDATE SET state=CASE WHEN quality_source_rows.content_hash=excluded.content_hash THEN quality_source_rows.state ELSE 'UPDATED' END,
      source_version=?,content_hash=excluded.content_hash,normalized_json=excluded.normalized_json,
      previous_snapshot_json=CASE WHEN quality_source_rows.content_hash=excluded.content_hash THEN quality_source_rows.previous_snapshot_json ELSE quality_source_rows.raw_snapshot_json END,
      raw_snapshot_json=excluded.raw_snapshot_json,last_seen_at=excluded.last_seen_at,source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at,version=quality_source_rows.version+1`)
      .run(sourceKey,input.isTest ? "QUALITY_TEST_ISOLATED" : `DINGTALK_OA:${input.processCode}`,"用服反馈流程 · 钉钉 OA",hash,JSON.stringify(normalized),raw,now,now,now,now,version);
    db.prepare(`INSERT INTO quality_oa_instances(source_key,process_instance_id,process_code,approval_status,payload_hash,updated_at,is_fixture) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(source_key) DO UPDATE SET approval_status=excluded.approval_status,payload_hash=excluded.payload_hash,updated_at=excluded.updated_at`)
      .run(sourceKey,input.processInstanceId,input.processCode,oaStatus,payloadHash,now,input.localFixture?1:0);
    db.prepare("INSERT OR IGNORE INTO quality_oa_versions(source_key,source_version,payload_json,created_at) VALUES(?,?,?,?)").run(sourceKey,version,JSON.stringify(input.instance),now);
    db.prepare("INSERT OR IGNORE INTO quality_oa_approval_history(id,source_key,approval_status,records_json,received_at) VALUES(?,?,?,?,?)")
      .run(digest(`${sourceKey}:${payloadHash}`),sourceKey,oaStatus,JSON.stringify(input.instance.operationRecords ?? []),now);
    for (const file of fileEntries) {
      const id=digest(`${sourceKey}:${version}:${file.category}:${file.fileId}`);
      db.prepare("INSERT OR IGNORE INTO quality_oa_attachments(id,source_key,source_version,process_instance_id,file_id,name,mime_type,size_bytes,category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id,sourceKey,version,input.processInstanceId,file.fileId,file.name,file.mimeType,file.sizeBytes,file.category,now);
    }
    db.exec("COMMIT"); return {sourceKey,sourceVersion:version,changed:!before || before.content_hash!==hash};
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; } finally { db.close(); }
}

export function listQualityOaAttachments(dbPath:string,sourceKey:string,version?:number) {
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    if (!hasTable(db,"quality_oa_attachments")) return [];
    const rows=db.prepare(`SELECT a.* FROM quality_oa_attachments a JOIN quality_source_rows s ON s.source_key=a.source_key WHERE a.source_key=? AND a.source_version=COALESCE(?,s.source_version) ORDER BY a.category,a.name`).all(sourceKey,version??null) as Row[];
    return rows.map((row)=>({id:String(row.id),name:String(row.name),mimeType:String(row.mime_type),sizeBytes:Number(row.size_bytes),category:String(row.category),
      downloadUrl:row.storage_key || getQualityOaConnector() ? `/api/workbench/quality/ma/feedbacks/${encodeURIComponent(sourceKey)}/attachments/${row.id}` : null,
      status:row.storage_key ? "可查看" : getQualityOaConnector() ? "可下载" : "OA 待接入",version:Number(row.source_version)}));
  } finally { db.close(); }
}
export function getQualityOaSourceHistory(dbPath:string,sourceKey:string) {
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    if (!hasTable(db,"quality_oa_versions")) return {versions:[],approvalHistory:[]};
    const versions=(db.prepare("SELECT * FROM quality_oa_versions WHERE source_key=? ORDER BY source_version DESC").all(sourceKey) as Row[]).map((row)=>({version:Number(row.source_version),createdAt:String(row.created_at),fields:(parse(row.payload_json)?.formComponentValues ?? []).map((field:Row)=>({label:text(field.name),value:text(field.value)})),attachments:listQualityOaAttachments(dbPath,sourceKey,Number(row.source_version))}));
    const approvalHistory=(db.prepare("SELECT * FROM quality_oa_approval_history WHERE source_key=? ORDER BY received_at DESC,rowid DESC").all(sourceKey) as Row[]).map((row)=>({id:String(row.id),status:String(row.approval_status),at:String(row.received_at),records:parse(row.records_json)}));
    return {versions,approvalHistory};
  } finally { db.close(); }
}
function storagePath(dbPath:string,key:string) { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("附件存储标识无效"); return join(dirname(dbPath),"quality-oa-files",key); }
export async function downloadQualityOaAttachment(input:{dbPath:string;sourceKey:string;id:string}) {
  const db=new DatabaseSync(input.dbPath,{readOnly:true});
  try {
    if (!hasTable(db,"quality_oa_attachments")) throw new Error("OA 附件不存在");
    const row=db.prepare("SELECT * FROM quality_oa_attachments WHERE id=? AND source_key=?").get(input.id,input.sourceKey) as Row|undefined;
    if (!row) throw new Error("OA 附件不存在");
    let body:Buffer;
    if (row.storage_key && existsSync(storagePath(input.dbPath,row.storage_key))) body=readFileSync(storagePath(input.dbPath,row.storage_key));
    else {
      const connector=getQualityOaConnector();
      if (!connector) throw new Error("钉钉 OA 尚未接入，原始附件暂不可下载");
      body=await connector.downloadAttachment({processInstanceId:row.process_instance_id,fileId:row.file_id});
    }
    return {body,name:String(row.name),mimeType:String(row.mime_type)};
  } finally { db.close(); }
}
/** Test-data helper: only local test OA instances can receive fixture bytes. */
export function attachQualityOaTestFile(input:{dbPath:string;sourceKey:string;fileId:string;body:Buffer}) {
  const db=new DatabaseSync(input.dbPath); try {
    const instance=db.prepare("SELECT is_fixture FROM quality_oa_instances WHERE source_key=?").get(input.sourceKey) as Row|undefined;
    if (!instance?.is_fixture) throw new Error("只允许给本地测试 OA 记录写入演示附件");
    const key=digest(input.body.toString("base64")); const path=storagePath(input.dbPath,key); mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,input.body);
    db.prepare("UPDATE quality_oa_attachments SET storage_key=?,size_bytes=? WHERE source_key=? AND file_id=?").run(key,input.body.length,input.sourceKey,input.fileId);
  } finally { db.close(); }
}
