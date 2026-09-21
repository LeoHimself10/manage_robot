import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {resolveWorkbenchSqlitePath} from '../../infra/workbench-db-path';
import {createPlanSessionStore,hashChatKey,type PlanSession} from '../../infra/plan-session-store';

/** Authoritative latest unfinished handoff only; never resurrect published or closed work. */
export function findActiveQualityThread(userId:string,threadId:string,dbPath=resolveWorkbenchSqlitePath()) {
 if(!existsSync(dbPath))return undefined;
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='quality_analysis_handoffs'").get())return undefined;
  return db.prepare(`SELECT h.*, e.title,e.event_no FROM quality_analysis_handoffs h JOIN quality_events e ON e.id=h.event_id
    WHERE h.thread_id=? AND h.primary_manager_user_id=? AND h.status='PENDING_PLANNING' AND e.status='PENDING_ASSIGNMENT'
    AND NOT EXISTS(SELECT 1 FROM quality_analysis_handoffs newer WHERE newer.event_id=h.event_id AND newer.analysis_version>h.analysis_version)
    AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.plan_id=h.plan_id)`).get(threadId,userId) as Record<string,unknown>|undefined;
 }finally{db.close();}
}
export function recoverQualityPlanningThread(userId:string,threadId:string):PlanSession|undefined {
 const h=findActiveQualityThread(userId,threadId);if(!h)return undefined;
 const store=createPlanSessionStore(),chatKeyHash=hashChatKey(`workbench:side:${userId.trim()}:${threadId.trim()}`);
 const existing=store.loadByChatKeyHash(chatKeyHash);if(existing)return existing;
 const pkg=JSON.parse(String(h.task_package_json));
 if(!pkg||pkg.qualityEventId!==h.event_id||!Array.isArray(pkg.requiredDeliverables)||!pkg.requiredDeliverables.length)return undefined;
 const now=new Date().toISOString();
 const description=['质量事件：'+h.event_no+' '+h.title,'问题方向：'+(pkg.problemDirection||''),'初析结论：'+(pkg.preliminaryConclusion||''),'来源事实：'+JSON.stringify(pkg.publicFactSummary||[]),'分析依据：'+JSON.stringify(pkg.analysisBasis||[]),'处理要求：'+JSON.stringify(pkg.handlingRequirements||[]),'必须成果：'+JSON.stringify(pkg.requiredDeliverables)].join('\n');
 const notice='原分配会话已删除，已根据已确认初析恢复任务规划入口。原承接记录保留；删除前的对话和未保存修改未恢复。请生成完整方案，配置负责人、期限和完成标准后直接发放。';
 const session:PlanSession={chatKeyHash,planId:String(h.plan_id),createdAt:now,updatedAt:now,senderStaffId:userId,threadKind:'side',threadId,threadLabel:('质量事件 '+h.event_no).slice(0,40),knownFacts:[],conversationHistory:[{role:'assistant',content:notice,displayContent:notice,at:now}],latestDraft:{title:(h.event_no+' '+h.title).slice(0,200),description,summary:description,qualityTaskPackage:pkg,qualityHandoff:{qualityEventId:h.event_id,analysisVersion:h.analysis_version,integrationKey:h.integration_key,planningRequired:true,requiredDeliverableIds:pkg.requiredDeliverables.filter((d:any)=>d.selected!==false).map((d:any)=>d.deliverableId)},tasks:[{id:'__quality_planning__',title:'待规划执行任务',objective:'依据已确认初析生成完整方案',deliverables:[],completionCriteria:[],timeNode:{dueAt:pkg.suggestedTotalDueAt}}]}};
 store.save(session);
 store.appendEvent({planId:session.planId,chatKeyHash,eventType:'quality_planning_thread_recovered',payload:{managerUserId:userId,handoffId:h.handoff_id,source:'confirmed_analysis'}});
 return store.loadByChatKeyHash(chatKeyHash);
}
