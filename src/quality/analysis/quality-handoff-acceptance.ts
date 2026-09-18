import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolveWorkbenchSqlitePath } from '../../infra/workbench-db-path';

type Row=Record<string,unknown>;
function table(db:DatabaseSync,name:string){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
export function handoffAcceptance(db:DatabaseSync,handoffId:string){
  return table(db,'quality_handoff_acceptances')?db.prepare('SELECT * FROM quality_handoff_acceptances WHERE handoff_id=?').get(handoffId) as Row|undefined:undefined;
}
export function acceptQualityHandoff(input:{eventId:string;handoffId:string;managerUserId:string;actorUserId:string;dbPath?:string}){
  const db=new DatabaseSync(input.dbPath??resolveWorkbenchSqlitePath());
  try{
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const h=db.prepare('SELECT h.*,e.status AS event_status FROM quality_analysis_handoffs h JOIN quality_events e ON e.id=h.event_id WHERE h.event_id=? ORDER BY h.analysis_version DESC,h.created_at DESC LIMIT 1').get(input.eventId) as Row|undefined;
    if(!h||h.handoff_id!==input.handoffId||h.primary_manager_user_id!==input.managerUserId)throw Error('无权承接或初析移交已更新，请刷新后重试');
    const old=handoffAcceptance(db,input.handoffId);
    if(old){db.exec('COMMIT');return old;}
    if(h.status!=='PENDING_PLANNING'||h.event_status!=='PENDING_ASSIGNMENT')throw Error('当前事项不处于待主管承接阶段');
    if(table(db,'tasks')&&db.prepare('SELECT 1 FROM tasks WHERE plan_id=?').get(String(h.plan_id)))throw Error('事项已发放，请从正式任务处理');
    const acceptedAt=new Date().toISOString();
    db.prepare('INSERT INTO quality_handoff_acceptances(handoff_id,manager_user_id,actor_user_id,accepted_at) VALUES(?,?,?,?)').run(input.handoffId,input.managerUserId,input.actorUserId,acceptedAt);
    db.prepare("INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,after_json,request_id,occurred_at) VALUES(?,?,?,'manager','QUALITY_HANDOFF_ACCEPTED',?,?,?)").run(randomUUID(),input.eventId,input.actorUserId,JSON.stringify({handoffId:input.handoffId,managerUserId:input.managerUserId,analysisVersion:h.analysis_version,acceptedAt}),input.handoffId,acceptedAt);
    db.exec('COMMIT');return {handoff_id:input.handoffId,manager_user_id:input.managerUserId,actor_user_id:input.actorUserId,accepted_at:acceptedAt};
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}
/** Guard every mutation of an authoritative quality planning handoff, including agent publication. */
export function assertQualityPlanningAccepted(planId:string,managerUserId?:string,dbPath=resolveWorkbenchSqlitePath()){
  if(!existsSync(dbPath))return;
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    if(!table(db,'quality_analysis_handoffs'))return;
    const h=db.prepare('SELECT * FROM quality_analysis_handoffs WHERE plan_id=?').get(planId) as Row|undefined;
    if(!h||h.status==='PUBLISHED')return;
    if(managerUserId&&h.primary_manager_user_id!==managerUserId)throw Error('仅接收主管可操作此事项');
    const latest=db.prepare('SELECT handoff_id FROM quality_analysis_handoffs WHERE event_id=? ORDER BY analysis_version DESC,created_at DESC LIMIT 1').get(String(h.event_id));
    if(latest?.handoff_id!==h.handoff_id)throw Error('初析已更新，请从最新事项重新进入');
    if(!handoffAcceptance(db,String(h.handoff_id)))throw Error('请先在主管质量工作台承接此事项，再进行任务规划与分配');
  }finally{db.close();}
}
