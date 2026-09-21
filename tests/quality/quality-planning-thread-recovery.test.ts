import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {it,expect,vi} from 'vitest';
import {findActiveQualityThread,recoverQualityPlanningThread} from '../../src/quality/analysis/quality-planning-thread-recovery';
import {deleteSideThreadSession,resolveConversationThread} from '../../src/web/conversation-thread-resolver';
import {decideTurnToolChoice} from '../../src/agent/v2/tool-choice-gate';
import {QUALITY_TASK_REPLAN_MESSAGE} from '../../src/web/manager-workbench-pages';
it('recovers only the current authorized unfinished handoff, idempotently, and protects it from deletion',()=>{
 const dir=mkdtempSync(join(tmpdir(),'quality-recovery-'));const path=join(dir,'db.sqlite');
 vi.stubEnv('WORKBENCH_SQLITE_PATH',path);vi.stubEnv('PLAN_SESSION_DIR',join(dir,'sessions'));vi.stubEnv('PLAN_SESSION_EVENTS_PATH',join(dir,'events.jsonl'));
 const db=new DatabaseSync(path);
 try{
 db.exec("CREATE TABLE quality_events(id TEXT,status TEXT,title TEXT,event_no TEXT); CREATE TABLE tasks(plan_id TEXT); CREATE TABLE quality_analysis_handoffs(handoff_id TEXT,event_id TEXT,thread_id TEXT,plan_id TEXT,status TEXT,analysis_version INTEGER,primary_manager_user_id TEXT,task_package_json TEXT,integration_key TEXT)");
 db.prepare('INSERT INTO quality_events VALUES(?,?,?,?)').run('event','PENDING_ASSIGNMENT','检测异常','QE-1');
 const pkg={qualityEventId:'event',analysisVersion:1,requiredDeliverables:[{deliverableId:'d',name:'检测结果'}],suggestedTotalDueAt:'2026-10-01'};
 db.prepare('INSERT INTO quality_analysis_handoffs VALUES(?,?,?,?,?,?,?,?,?)').run('h','event','thread','plan','PENDING_PLANNING',1,'manager',JSON.stringify(pkg),'quality:event');
 expect(recoverQualityPlanningThread('stranger','thread')).toBeUndefined();
 const restored=resolveConversationThread('manager',{threadKind:'side',threadId:'thread'});
 expect(restored?.planId).toBe('plan');expect(restored?.latestDraft?.qualityTaskPackage).toEqual(pkg);
 expect(restored?.conversationHistory).toHaveLength(1);
 expect(recoverQualityPlanningThread('manager','thread')).toEqual(restored);
 expect(deleteSideThreadSession('manager','thread')).toBe(false);
 db.exec("INSERT INTO tasks VALUES('plan')");expect(findActiveQualityThread('manager','thread')).toBeUndefined();
 expect(deleteSideThreadSession('manager','thread')).toBe(true);expect(recoverQualityPlanningThread('manager','thread')).toBeUndefined();
 db.exec("DELETE FROM tasks;INSERT INTO quality_analysis_handoffs SELECT 'new',event_id,'new-thread','new-plan',status,2,primary_manager_user_id,task_package_json,integration_key FROM quality_analysis_handoffs WHERE handoff_id='h'");
 expect(recoverQualityPlanningThread('manager','thread')).toBeUndefined();
 db.exec("UPDATE quality_events SET status='CLOSED'");expect(recoverQualityPlanningThread('manager','thread')).toBeUndefined();
 }finally{db.close();vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
});
it('routes the actual full-plan button to full replacement without calling the row-split classifier',async()=>{
 const gate=await decideTurnToolChoice({userMessage:QUALITY_TASK_REPLAN_MESSAGE,session:{planId:'p',chatKeyHash:'c',latestDraft:{qualityHandoff:{qualityEventId:'e'},tasks:[{id:'task_1'}]}} as any,toolProfile:'manager',trustedActorUserId:'manager',thinkingEnabled:false});
 expect(gate.frontier).toEqual(['replace_draft']);expect(gate.toolChoice).toEqual({type:'function',function:{name:'replace_draft'}});
});
