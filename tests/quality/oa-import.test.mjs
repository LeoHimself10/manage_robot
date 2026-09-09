import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OaStore,OA_SCOPE,eligibleForMa} from '../../src/quality/oa/oa-store.mjs';
import {createOaSync} from '../../src/quality/oa/oa-sync.mjs';
const fixture=()=>({status:'RUNNING',businessId:'approval-1',createTime:'2026-09-09T01:00Z',originatorUserId:'employee',
 formComponentValues:[{id:'what',name:'WHAT（详细描述故障现象）',value:'图像闪烁',componentType:'TextareaField'}],
 tasks:[{userId:OA_SCOPE.reviewerId,status:'RUNNING',activityId:'feedback',taskId:1},{userId:OA_SCOPE.cosignerId,status:'RUNNING',activityId:'feedback',taskId:2}],
 operationRecords:[{userId:'supervisor',showName:'部门主管',result:'AGREE',activityId:'supervisor'}]});
function db(t){const dir=mkdtempSync(join(tmpdir(),'quality-oa-test-'));const store=new OaStore(join(dir,'oa.sqlite'));t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
test('only active Ma/Tong review after supervisor pass is eligible; CC, NEW, rejects and withdrawals are excluded',()=>{
 const r=fixture();assert.equal(eligibleForMa(r),true);
 for(const change of [x=>x.tasks[0].status='NEW',x=>x.tasks=[],x=>x.status='TERMINATED',x=>x.operationRecords[0].result='REFUSE',x=>x.tasks[1].activityId='unrelated']) {const x=structuredClone(r);change(x);assert.equal(eligibleForMa(x),false);}
});
test('duplicates are idempotent, changes append versions, withdrawal retains original facts and unrelated imports',t=>{
 const s=db(t),r=fixture();assert.equal(s.ingest('one',r).inserted,1);assert.equal(s.ingest('one',r).updated,0);
 s.ingest('two',fixture());r.formComponentValues[0].value='新增信息';assert.equal(s.ingest('one',r).updated,1);
 r.status='TERMINATED';s.ingest('one',r);assert.equal(s.list().length,2);assert.equal(s.list().find(x=>x.instanceId==='one').activeForMa,false);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM oa_source_versions').get().n,4);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sqlite_master WHERE name IN (\'tasks\',\'quality_events\')').get().n,0);
});
test('discovery is scoped and paginated, pending supervisor approvals are refreshed next time',async t=>{
 const s=db(t);let approved=false;const calls=[];
 const client={listIds:async(code,start,end,cursor)=>{calls.push([code,cursor]);return cursor===0?{list:['one'],nextToken:1}:{list:['two']};},getInstance:async()=>{const r=fixture();if(!approved)r.tasks[0].status='NEW';return r;}};
 const runtime=createOaSync({client,store:s});await runtime.sync();assert.equal(s.list().length,0);assert.equal(s.pending().length,2);
 approved=true;await runtime.sync();assert.equal(s.list().length,2);assert.ok(calls.every(c=>c[0]===OA_SCOPE.processCode));
});
test('failed reads retain durable retry queue and successful data; foreign events cannot fetch',async t=>{
 const s=db(t);s.ingest('old',fixture());let reads=0,fail=true;
 const client={listIds:async()=>({list:['new']}),getInstance:async()=>{reads++;if(fail)throw Object.assign(new Error('read'),{code:'PermissionDenied'});return fixture();}};
 const runtime=createOaSync({client,store:s});await assert.rejects(runtime.sync());assert.equal(s.list().length,1);assert.ok(s.pending().includes('new'));assert.equal(s.meta('sync').status,'FAILED');
 const before=reads;await runtime.onEvent({corpId:'foreign',processCode:OA_SCOPE.processCode,EventType:'bpms_task_change',processInstanceId:'private'});assert.equal(reads,before);
 fail=false;await runtime.sync();assert.equal(s.list().length,2);
});
