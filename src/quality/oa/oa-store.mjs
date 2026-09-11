import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Deployment-specific organization/workflow/person identifiers stay outside Git.
const scopeFile=process.env.QUALITY_OA_SCOPE_FILE || fileURLToPath(new URL('../../../.env.oa-scope.local',import.meta.url));
const exampleScope={corpId:'example-org',processCode:'example-feedback-process',clientId:'example-app',
  processName:'用服反馈流程',reviewerId:'example-reviewer',reviewerName:'马荣鑫',cosignerId:'example-cosigner',nodeName:'故障处理反馈'};
const configuredScope=existsSync(scopeFile)?JSON.parse(readFileSync(scopeFile,'utf8')):exampleScope;
for(const key of Object.keys(exampleScope))if(typeof configuredScope[key]!=='string'||!configuredScope[key].trim())throw new Error('OA_SCOPE_CONFIG_INVALID');
export const OA_SCOPE=Object.freeze(configuredScope);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const str = value => String(value ?? '');
export function eligibleForMa(instance, scope = OA_SCOPE) {
  if (instance.status !== 'RUNNING') return false;
  const tasks = instance.tasks || [];
  return tasks.some(t => t.userId === scope.reviewerId && t.status === 'RUNNING' && t.activityId
    && tasks.some(other => other.userId === scope.cosignerId && other.activityId === t.activityId)
    && (instance.operationRecords || []).some(op => op.result === 'AGREE'
      && op.activityId !== t.activityId && ['直接主管','部门主管'].includes(op.showName)));
}
export function projectOaInstance(id, instance, names = {}, scope = OA_SCOPE) {
  const fields = (instance.formComponentValues || []).map(f => ({id:str(f.id), name:str(f.name),value:str(f.value),type:str(f.componentType)}));
  const field = (...labels) => fields.find(f => labels.some(label => f.name.replace(/\s/g,'').startsWith(label.replace(/\s/g,''))))?.value || '';
  const what = field('WHAT','故障详细描述','问题描述');
  const tasks = instance.tasks || [];
  const task = tasks.find(t => t.userId === scope.reviewerId && t.status === 'RUNNING') || tasks.find(t=>t.userId===scope.reviewerId);
  let url = task?.pcUrl || task?.mobileUrl || '';
  try {const parsed = new URL(url.startsWith('//')?'https:'+url:url.startsWith('aflow.')?'https://'+url:url); url = parsed.protocol==='https:' && (parsed.hostname==='dingtalk.com'||parsed.hostname.endsWith('.dingtalk.com')) ? parsed.href : ''; } catch {url='';}
  return {
    id:'oa_'+hash([scope.corpId,scope.processCode,id]).slice(0,32), instanceId:id, no:str(instance.businessId || id),
    title:(what || str(instance.title) || scope.processName).slice(0,160), what, how:field('HOW（','HOW('), where:field('WHERE'),
    date:str(instance.createTime), occurred:field('WHEN','故障发生时间'),
    person:names[instance.originatorUserId] || str(instance.originatorUserId), department:str(instance.originatorDeptName),
    product:field('产品类型'), model:field('设备型号','主机名称'), serial:field('设备序列号'),
    batch:field('导管生产批号','导管批次'), software:field('软件版本'), impact:field('影响程度','临床销售受影响程度'),
    fields, attachments:fields.filter(f=>/Attachment|Image|Video/.test(f.type)),
    tasks:tasks.map(t=>({id:str(t.taskId),activityId:str(t.activityId),person:names[t.userId]||str(t.userId),userId:str(t.userId),status:t.status,result:t.result,createdAt:t.createTime,finishedAt:t.finishTime})),
    operations:(instance.operationRecords || []).map(o=>({person:names[o.userId]||str(o.userId),node:str(o.showName),result:str(o.result),type:str(o.type),at:str(o.date),remark:str(o.remark)})),
    oaStatus:str(instance.status), oaResult:str(instance.result), activeForMa:eligibleForMa(instance,scope), url, dataScope:'DINGTALK_OA',
  };
}
export class OaStore {
  constructor(path, scope = OA_SCOPE) {
    this.scope = scope; mkdirSync(dirname(path),{recursive:true}); this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS oa_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oa_pending (id TEXT PRIMARY KEY,checked_at TEXT);
      CREATE TABLE IF NOT EXISTS oa_sources (id TEXT PRIMARY KEY,instance_id TEXT UNIQUE NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oa_source_versions (id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,raw TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS oa_events (id TEXT PRIMARY KEY,instance_id TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL);
    `);
  }
  meta(key,value) {if(value!==undefined)this.db.prepare('INSERT INTO oa_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return JSON.parse(this.db.prepare('SELECT value FROM oa_meta WHERE key=?').get(key)?.value || 'null');}
  enqueue(ids) {const stmt=this.db.prepare('INSERT OR IGNORE INTO oa_pending(id) VALUES (?)');for(const id of ids)stmt.run(id);}
  pending(limit=200) {return this.db.prepare('SELECT id FROM oa_pending ORDER BY checked_at ASC LIMIT ?').all(limit).map(x=>x.id);}
  ingest(id, instance, names={}, now=new Date().toISOString()) {
    const item=projectOaInstance(id,instance,names,this.scope);
    const old=this.db.prepare('SELECT * FROM oa_sources WHERE instance_id=?').get(id);
    if(!old&&!item.activeForMa) {
      if(instance.status!=='RUNNING')this.db.prepare('DELETE FROM oa_pending WHERE id=?').run(id);
      else this.db.prepare('UPDATE oa_pending SET checked_at=? WHERE id=?').run(now,id);
      return {inserted:0,updated:0,skipped:1};
    }
    const contentHash=hash(item),version=old?old.version+(old.hash===contentHash?0:1):1;
    const payload=JSON.stringify({...item,version,firstSeenAt:old?.first_seen_at||now,lastSeenAt:now});
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO oa_sources VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,hash=excluded.hash,payload=excluded.payload,last_seen_at=excluded.last_seen_at').run(item.id,id,version,contentHash,payload,old?.first_seen_at||now,now);
      this.db.prepare('INSERT OR IGNORE INTO oa_source_versions VALUES (?,?,?,?,?)').run(item.id,version,payload,JSON.stringify(instance),now);
      // Keep running sources in the refresh set so withdrawal and field updates are observed.
      if(instance.status==='RUNNING'){this.enqueue([id]);this.db.prepare('UPDATE oa_pending SET checked_at=? WHERE id=?').run(now,id);}
      else this.db.prepare('DELETE FROM oa_pending WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
    return {inserted:old?0:1,updated:old&&version>old.version?1:0,skipped:0};
  }
  list() {return this.db.prepare('SELECT payload FROM oa_sources ORDER BY first_seen_at DESC').all().map(r=>JSON.parse(r.payload));}
  get(id) {const r=this.db.prepare('SELECT payload FROM oa_sources WHERE id=?').get(id);return r?JSON.parse(r.payload):null;}
  close() {this.db.close();}
}
