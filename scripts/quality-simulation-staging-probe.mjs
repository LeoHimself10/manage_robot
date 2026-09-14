import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';
assert.equal(process.env.WORKBENCH_SESSION_SECRET,'isolated-staging-secret-not-for-production-20260911');
const id=process.env.QUALITY_PILOT_USER_ID,now=Math.floor(Date.now()/1000),prefix='/workbench/quality-pilot';
const p=Buffer.from(JSON.stringify({sid:'simulation-staging-test',userId:id,role:'admin',primaryRole:'admin',loginSource:'dingtalk_authcode',dingUser:{userId:id,name:'隔离验收操作人'},iat:now,exp:now+600})).toString('base64url');
const auth='wb_session='+p+'.'+createHmac('sha256',process.env.WORKBENCH_SESSION_SECRET).update(p).digest('hex');
const request=(path,actor)=>fetch('http://127.0.0.1:8092'+prefix+path,{headers:{cookie:auth+(actor?'; quality_simulation='+actor:'')},redirect:'manual'});
for(const [ref,role,target] of [['manager','manager','QUALITY_SIM_MANAGER'],... [1,2,3].map(n=>['employee-'+n,'employee','QUALITY_SIM_EMPLOYEE_'+n])]){
 const page=await request('/workbench/quality?perspective='+role+'&simulation='+ref,ref);assert.equal(page.status,200,ref+' page');const html=await page.text();assert.ok(html.includes('模拟视角'));assert.ok(html.includes('class="qpc-page qpc-unified"'));assert.ok(html.includes('data-perspective="'+role+'"'));assert.ok(html.includes('id="qualityCenterTitle">'+(role==='employee'?'我的质量任务':'主管质量工作台')+'</h1>'));assert.ok(!page.headers.getSetCookie().some(c=>c.startsWith('wb_session=')));
 const r=await request('/api/workbench/me',ref);assert.equal(r.status,200);const me=await r.json();assert.equal(me.userId,target);assert.equal(me.impersonation.actorUserId,id);console.log(ref,'page and effective identity OK');
}
const r=await request('/api/quality-oa/tong');assert.equal(r.status,200);const j=await r.json();assert.ok(j.items.length>0);for(const item of j.items){assert.equal(item.workspace.departments.length,1);assert.equal(item.workspace.departments[0].departmentName,'模拟测试部门');assert.equal(item.workspace.departments[0].managerName,'模拟主管');}
console.log('Tong actual API: only simulated department and manager');
const ma=await request('/ma-workbench/','employee-3');assert.equal(ma.status,200);assert.ok(ma.headers.getSetCookie().some(c=>c.startsWith('quality_simulation=;')));console.log('return to Ma clears simulation identity');

if(process.argv.includes('--read-only')){for(const a of ['manager','employee-1','employee-2','employee-3']){const r=await request('/api/workbench/quality/events?projection=1',a);assert.equal(r.status,200,a+' projected events');console.log(a,'projection API OK');}process.exit(0);}
const post=async(path,body,actor)=>{const r=await fetch('http://127.0.0.1:8092'+prefix+path,{method:'POST',headers:{cookie:auth+(actor?'; quality_simulation='+actor:''),'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify({path,error:data.error}));return data;};
const item=j.items[0],stamp=new Date().toISOString();
const draft={requestId:randomUUID(),expectedVersion:item.workspace.draft?.version||0,baseAttemptId:null,primaryDepartmentId:'QUALITY_SIM_DEPT',collaboratorDepartmentIds:[],modificationReason:'隔离预发布模拟人员闭环验收',content:{problemDirection:'测试调查',confirmedCategoryReference:'测试分类',sourceFactSummary:['隔离测试来源'],confirmedFacts:['测试事实'],analysisBasis:['测试依据'],preliminaryConclusion:'测试分析',causeHypotheses:[],investigationDirections:['测试检查'],informationGaps:[],handlingRequirements:['提交测试证据'],suggestedTotalDueAt:'2026-09-30T18:00'},deliverables:[{deliverableId:randomUUID(),name:'模拟验证记录',description:'隔离预发布测试',acceptanceCriteria:'记录验证结果',source:'HUMAN_CUSTOM',selected:true,createdAt:stamp,updatedAt:stamp}]};
const saved=await post('/api/quality-oa/tong/draft',{id:item.id,draft});
const confirmed=await post('/api/quality-oa/tong/confirm',{id:item.id,confirm:{requestId:randomUUID(),expectedDraftVersion:saved.data.workspace.draft.version,expectedEventVersion:saved.data.workspace.event.version,modificationReason:'隔离预发布模拟人员闭环验收'}});
const handoff=confirmed.data.workspace.handoffs[0];assert.equal(handoff.primaryManagerUserId,'QUALITY_SIM_MANAGER');
const q='?thread=side&threadId='+encodeURIComponent(handoff.threadId);const dr=await request('/api/workbench/conversation/draft'+q,'manager');assert.equal(dr.status,200);const dj=await dr.json();assert.ok(dj.draft.tasks.length);
await post('/api/workbench/conversation/draft/assign',{threadKind:'side',threadId:handoff.threadId,planId:dj.planId,taskId:dj.draft.tasks[0].id,assigneeUserId:'QUALITY_SIM_EMPLOYEE_1'},'manager');
const assigned=await (await request('/api/workbench/conversation/draft'+q,'manager')).json();
// Exercise the existing SQLite publisher using only this isolated staging database.
const {createWorkbenchFormalTaskStore}=await import('./src/infra/workbench-formal-task-store.ts');
const store=createWorkbenchFormalTaskStore();const published=store.publishFromSession({planId:assigned.planId,session:{latestDraft:assigned.draft,latestAssignment:assigned.assignment},managerUserId:'QUALITY_SIM_MANAGER',actorUserId:'QUALITY_SIM_MANAGER'});
assert.equal(published.subtasks[0].assigneeUserId,'QUALITY_SIM_EMPLOYEE_1');
await request('/api/quality-oa/tong');
const sid=published.subtasks[0].subtaskId;
const rejected=await fetch('http://127.0.0.1:8092'+prefix+'/api/workbench/employee/action',{method:'POST',headers:{cookie:auth+'; quality_simulation=employee-2','Content-Type':'application/json'},body:JSON.stringify({subtaskId:sid,action:'accept',idempotencyKey:randomUUID()})});const denied=await rejected.json();assert.ok([400,403,404].includes(rejected.status),JSON.stringify(denied));assert.equal(denied.ok,false);assert.equal(store.getSubtaskWithTask(sid).subtask.status,'ASSIGNED');
await post('/api/workbench/employee/action',{subtaskId:sid,action:'accept',idempotencyKey:randomUUID()},'employee-1');
assert.equal(store.getSubtaskWithTask(sid).subtask.status,'IN_PROGRESS');
console.log('PASS simulated department -> analysis confirmation -> manager handoff -> employee assignment -> formal publish -> employee acceptance; other employee denied');
store.close?.();
process.exit(0);
