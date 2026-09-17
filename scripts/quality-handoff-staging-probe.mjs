import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHmac} from 'node:crypto';
assert.equal(process.env.WORKBENCH_SESSION_SECRET,'isolated-staging-secret-not-for-production-20260911');
assert.equal(process.env.QUALITY_OA_SYNC_ENABLED,'0');
assert.ok(existsSync('/app/data/.inline-staging-only'));
const userId=process.env.QUALITY_PILOT_USER_ID,now=Math.floor(Date.now()/1000);
const p=Buffer.from(JSON.stringify({userId,role:'admin',loginSource:'dingtalk_authcode',dingUser:{userId},iat:now,exp:now+600})).toString('base64url');
const login='wb_session='+p+'.'+createHmac('sha256',process.env.WORKBENCH_SESSION_SECRET).update(p).digest('hex');
const base='http://127.0.0.1:8092/workbench/quality-pilot';
const get=async(path,actor='manager')=>{
  const r=await fetch(base+path,{headers:{cookie:login+'; quality_simulation='+actor},redirect:'manual'});
  assert.equal(r.status,200,path);return r;
};
const ids=['644ba322-7543-427d-a7ce-efbc2fbc05d5','455bebdd-eeb8-41c1-b951-9ec3091ac6d7'];
const list=await (await get('/api/workbench/quality/events?projection=1&managerStage=DELEGATE')).json();
for(const id of ids){
  const event=list.data.events.find(x=>x.actionRef===id);assert.ok(event,'Missing pending event '+id);
  assert.deepEqual(event.managerStages,['DELEGATE']);assert.ok(event.planningHandoff);
  const detail=await (await get('/api/workbench/quality/events/'+id+'?projection=1')).json();
  assert.ok(detail.data.viewModel.event.planningHandoff);
  const url=new URL(event.planningHandoff.planningUrl,'http://local');
  const draft=await (await get('/api/workbench/conversation/draft'+url.search)).json();
  assert.ok(draft.draft.tasks.length,'Existing draft preserved');
  assert.equal((await get(url.pathname.replace('/workbench/quality-pilot','')+url.search)).status,200);
  console.log('PASS list + detail + existing planning draft:',event.eventNumber,draft.draft.tasks.length,'items');
}
for(const actor of ['employee-1','employee-2','employee-3']){
  const list=await (await get('/api/workbench/quality/events?projection=1',actor)).json();
  assert.ok(list.data.events.every(x=>!ids.includes(x.actionRef)));
}
console.log('PASS unassigned employees cannot see pending manager events; no business writes performed');

