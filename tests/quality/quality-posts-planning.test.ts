import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeQualityPosts,changeQualityPost,qualityPostContext,ownsCustomerHistory,getQualityPosts} from '../../src/security/quality-posts';
import {resolveQualityCapabilities} from '../../src/security/quality-capabilities';
import {confirmQualityPlanning,qualityPlanningConfirmed,qualityStructureHash} from '../../src/agent/quality-planning-contract';
import {validateQualityTaskCoverage} from '../../src/agent/quality-task-coverage';
let dir='';
afterEach(()=>{vi.unstubAllEnvs();if(dir)rmSync(dir,{recursive:true,force:true});dir='';});
it('reassigns a single post, revokes cached/legacy grants, retains history and isolates test configuration',()=>{
 dir=mkdtempSync(join(tmpdir(),'quality-post-'));vi.stubEnv('QUALITY_POSTS_DB_PATH',join(dir,'db.sqlite'));vi.stubEnv('QUALITY_MANAGEMENT_USER_IDS','quality-old');
 initializeQualityPosts({real:{customer:'customer-old',quality:'quality-old'},test:{customer:'test-customer',quality:'test-quality'}});
 expect(resolveQualityCapabilities('quality-old').canAnalyzeQuality).toBe(true);
 changeQualityPost({scope:'real',post:'quality',userId:'quality-new',expectedVersion:1,actorUserId:'admin'});
 expect(resolveQualityCapabilities('quality-old').canAnalyzeQuality).toBe(false);
 expect(resolveQualityCapabilities('quality-new').canAnalyzeQuality).toBe(true);
 expect(resolveQualityCapabilities('quality-new').canReportQuality).toBe(false);
 expect(()=>changeQualityPost({scope:'real',post:'quality',userId:'other',expectedVersion:1,actorUserId:'admin'})).toThrow('已更新');
 changeQualityPost({scope:'real',post:'customer',userId:'customer-new',expectedVersion:1,actorUserId:'admin'});
 expect(ownsCustomerHistory('customer-new','customer-old')).toBe(true);
 expect(resolveQualityCapabilities('customer-old').canReportQuality).toBe(false);
 qualityPostContext.run({scope:'test',actorUserId:'admin'},()=>{
  expect(getQualityPosts()!.find(p=>p.post==='quality')!.userId).toBe('test-quality');
  expect(resolveQualityCapabilities('quality-new').canAnalyzeQuality).toBe(false);
  expect(ownsCustomerHistory('test-customer','customer-old')).toBe(false);
 });
 const db=new DatabaseSync(process.env.QUALITY_POSTS_DB_PATH!);expect(db.prepare('SELECT COUNT(*) AS n FROM quality_post_audit').get()!.n).toBe(6);db.close();
});
const task=(id:string)=>({id,title:id,objective:'调查并验证',deliverables:['本任务记录'],completionCriteria:['记录可复核'],timeNode:{dueAt:'2026-10-01'}});
const draft=()=>({tasks:[task('reproduce'),task('test'),task('report')],qualityTaskPackage:{requiredDeliverables:[{deliverableId:'root',name:'根因报告',acceptanceCriteria:'结论有证据',selected:true},{deliverableId:'verification',name:'验证报告',acceptanceCriteria:'验证达标',selected:true}]},qualityHandoff:{qualityEventId:'event',planningRequired:true,requiredDeliverableIds:['root','verification']}});
it('requires explicit final delivery mappings, supports many-to-many and preserves ordinary flows',()=>{
 const d=draft();d.tasks[2].deliverables.push('根因报告','验证报告');expect(qualityPlanningConfirmed(d)).toBe(false);expect(validateQualityTaskCoverage({latestDraft:d}).ok).toBe(false);
 const mappings=[{deliverableId:'root',finalTaskId:'report',supportTaskIds:['reproduce','test']},{deliverableId:'verification',finalTaskId:'report',supportTaskIds:['test']}];
 const confirmed=confirmQualityPlanning(d,{expectedHash:qualityStructureHash(d),actorUserId:'manager',mappings});
 expect(qualityPlanningConfirmed(confirmed)).toBe(true);expect(validateQualityTaskCoverage({latestDraft:confirmed}).ok).toBe(true);
 expect(confirmed.tasks[0].deliverables).toEqual(['本任务记录']);expect(confirmed.tasks[2].deliverables).toContain('根因报告');expect(confirmed.tasks[2].deliverables).toContain('验证报告');
 confirmed.tasks[0].timeNode.dueAt='2026-10-02';expect(qualityPlanningConfirmed(confirmed)).toBe(true);
 confirmed.tasks[0].title='重新规划';expect(qualityPlanningConfirmed(confirmed)).toBe(false);
 expect(validateQualityTaskCoverage({latestDraft:{tasks:[task('ordinary')]}}).ok).toBe(true);
 expect(()=>confirmQualityPlanning(d,{expectedHash:'stale',actorUserId:'manager',mappings})).toThrow('变化');
 expect(()=>confirmQualityPlanning(d,{expectedHash:qualityStructureHash(d),actorUserId:'manager',mappings:[{deliverableId:'root',finalTaskId:'missing',supportTaskIds:[]}]})).toThrow('最终交付');
});
it('accepts one valid task without forcing a multi-task count',()=>{
 const d=draft();d.tasks=[{...task('single'),deliverables:['根因报告','验证报告']}];
 const confirmed=confirmQualityPlanning(d,{expectedHash:qualityStructureHash(d),actorUserId:'manager',mappings:d.qualityTaskPackage.requiredDeliverables.map(r=>({deliverableId:r.deliverableId,finalTaskId:'single',supportTaskIds:[]}))});
 expect(qualityPlanningConfirmed(confirmed)).toBe(true);
});

it('does not disguise missing work by injecting outcomes during confirmation',()=>{
 const d=draft();const before=structuredClone(d);
 const mappings=d.qualityTaskPackage.requiredDeliverables.map(r=>({deliverableId:r.deliverableId,finalTaskId:'report',supportTaskIds:[]}));
 expect(()=>confirmQualityPlanning(d,{expectedHash:qualityStructureHash(d),actorUserId:'manager',mappings})).toThrow('方案不完整');
 expect(d).toEqual(before);
 d.tasks[2].deliverables=['根因报告','验证报告'];
 const a=confirmQualityPlanning(d,{expectedHash:qualityStructureHash(d),actorUserId:'manager',mappings});
 expect(()=>confirmQualityPlanning(a,{expectedHash:qualityStructureHash(a),actorUserId:'manager',mappings:mappings.map(m=>({...m,finalTaskId:'test'}))})).toThrow('方案不完整');
});
