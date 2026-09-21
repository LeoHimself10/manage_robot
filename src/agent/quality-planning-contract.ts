import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {clearPublishStagingFieldsOnDraft} from './draft-staging-clear';
type RecordValue=Record<string,any>;
export function qualityStructureHash(draft:RecordValue){
  return createHash('sha256').update(JSON.stringify((draft.tasks||[]).map((t:RecordValue)=>({id:t.id,title:t.title,objective:t.objective,deliverables:t.deliverables,completionCriteria:t.completionCriteria,actions:t.actions,dependencyTaskIds:t.dependencyTaskIds})))).digest('hex');
}
/** Exact outcome names are the explicit planning contract, not semantic proof. */
export function qualityPlanCoverage(draft:RecordValue,mappings?:unknown) {
  const required=(draft.qualityTaskPackage?.requiredDeliverables||[]).filter((d:RecordValue)=>d.selected!==false);
  const tasks=(draft.tasks||[]).filter((t:RecordValue)=>t.id!=='__quality_planning__');
  const normalize=(value:unknown)=>String(value||'').trim().replace(/\s+/g,' ');
  const missing=required.filter((d:RecordValue)=>{
    const mapping=Array.isArray(mappings)?mappings.find((m:RecordValue)=>m.deliverableId===d.deliverableId):null;
    return !tasks.some((t:RecordValue)=>(!Array.isArray(mappings)||t.id===mapping?.finalTaskId)
      && Array.isArray(t.deliverables)&&t.deliverables.some((value:unknown)=>normalize(value)===normalize(d.name))
      && Array.isArray(t.completionCriteria)&&t.completionCriteria.some((value:unknown)=>String(value||'').trim()));
  }).map((d:RecordValue)=>({deliverableId:d.deliverableId,name:d.name}));
  return {complete:required.length>0&&missing.length===0,missing};
}
export function qualityPlanningRequired(draft:RecordValue){return Boolean(draft.qualityHandoff&&(draft.qualityHandoff.planningRequired||process.env.QUALITY_POSTS_DB_PATH));}
export function qualityPlanningConfirmed(draft:RecordValue){
  if(!qualityPlanningRequired(draft))return true;
  const plan=draft.qualityHandoff.planning;
  return Boolean(plan&&plan.hash===qualityStructureHash(draft)&&validMappings(draft,plan.mappings)&&qualityPlanCoverage(draft,plan.mappings).complete);
}
function validMappings(draft:RecordValue,mappings:unknown):boolean {
  const required=(draft.qualityTaskPackage?.requiredDeliverables||[]).filter((d:RecordValue)=>d.selected!==false);
  const tasks=draft.tasks||[],ids=new Set(tasks.map((t:RecordValue)=>t.id));
  if(!tasks.length||ids.size!==tasks.length||ids.has('__quality_planning__')||!required.length||!Array.isArray(mappings)||mappings.length!==required.length)return false;
  return required.every((d:RecordValue)=>{
    const matches=mappings.filter((m:RecordValue)=>m.deliverableId===d.deliverableId);if(matches.length!==1)return false;
    const m=matches[0];return ids.has(m.finalTaskId)&&Array.isArray(m.supportTaskIds)&&m.supportTaskIds.every((id:string)=>ids.has(id)&&id!==m.finalTaskId)&&new Set(m.supportTaskIds).size===m.supportTaskIds.length;
  });
}
export function confirmQualityPlanning(draft:RecordValue,input:{expectedHash:string;mappings:unknown;actorUserId:string;tasks?:unknown}) {
  if(input.expectedHash!==qualityStructureHash(draft))throw Error('草案已发生变化，请刷新后重新核对');
  const next=clearPublishStagingFieldsOnDraft(structuredClone(draft)) as RecordValue;
  if(input.tasks!==undefined){
    if(!Array.isArray(input.tasks)||input.tasks.length<1||input.tasks.length>50)throw Error('请填写 1 至 50 项任务');
    next.tasks=input.tasks.map((t:RecordValue)=>({id:String(t.id||''),title:String(t.title||'').trim(),objective:String(t.objective||'').trim(),deliverables:t.deliverables,completionCriteria:t.completionCriteria,actions:Array.isArray(t.actions)?t.actions:[],dependencyTaskIds:Array.isArray(t.dependencyTaskIds)?t.dependencyTaskIds:[],timeNode:t.timeNode,qualityEventId:next.qualityHandoff.qualityEventId}));
  }

  if(!validMappings(next,input.mappings))throw Error('每项必须成果须指定一个最终交付任务，支撑任务须属于当前方案');
  const mappings=input.mappings as {deliverableId:string;finalTaskId:string;supportTaskIds:string[]}[];
  const coverage=qualityPlanCoverage(next,mappings);
  if(!coverage.complete)throw Error('方案不完整，请先在最终交付任务中写明成果及完成标准：'+coverage.missing.map((d:{name:string})=>d.name).join('、'));
  for(const task of next.tasks)task.qualityDeliverableIds=mappings.filter(m=>m.finalTaskId===task.id).map(m=>m.deliverableId);
  if(!next.tasks.every((t:RecordValue)=>/^[\w-]{1,100}$/.test(t.id)&&t.title&&t.title.length<=200&&t.objective&&Array.isArray(t.deliverables)&&t.deliverables.some((s:unknown)=>typeof s==='string'&&s.trim())&&Array.isArray(t.completionCriteria)&&t.completionCriteria.some((s:unknown)=>typeof s==='string'&&s.trim())))throw Error('每项任务须填写标题、目标、交付物和完成标准');
  next.qualityHandoff={...next.qualityHandoff,planningRequired:true,planning:{hash:qualityStructureHash(next),mappings,confirmedBy:input.actorUserId,confirmedAt:new Date().toISOString()}};
  return next;
}
export function saveQualityExecutionPlan(dbPath:string,planId:string,draft:RecordValue) {
  const db=new DatabaseSync(dbPath);try{
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS quality_execution_plans(id INTEGER PRIMARY KEY,event_id TEXT NOT NULL,plan_id TEXT NOT NULL,structure_hash TEXT NOT NULL,plan_json TEXT NOT NULL,confirmed_by TEXT NOT NULL,confirmed_at TEXT NOT NULL)');
    const plan=draft.qualityHandoff.planning;
    db.prepare('INSERT INTO quality_execution_plans(event_id,plan_id,structure_hash,plan_json,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?)').run(draft.qualityHandoff.qualityEventId,planId,plan.hash,JSON.stringify({tasks:draft.tasks,mappings:plan.mappings}),plan.confirmedBy,plan.confirmedAt);
  }finally{db.close();}
}
