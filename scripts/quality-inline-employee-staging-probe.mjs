import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
assert.equal(process.env.WORKBENCH_SESSION_SECRET,'isolated-staging-secret-not-for-production-20260911');
assert.ok(existsSync('/app/data/.inline-staging-only'));
const now=Math.floor(Date.now()/1000), userId=process.env.QUALITY_PILOT_USER_ID;
const payload=Buffer.from(JSON.stringify({userId,role:'admin',loginSource:'dingtalk_authcode',dingUser:{userId,name:'隔离验收'},iat:now,exp:now+600})).toString('base64url');
const cookie='wb_session='+payload+'.'+createHmac('sha256',process.env.WORKBENCH_SESSION_SECRET).update(payload).digest('hex');
const base='http://127.0.0.1:8092/workbench/quality-pilot';
const db=new DatabaseSync(process.env.WORKBENCH_SQLITE_PATH);
const row=db.prepare("SELECT s.subtask_id,n.node_id,n.event_id FROM subtasks s JOIN quality_task_links l ON l.subtask_id=s.subtask_id JOIN quality_assignment_nodes n ON n.node_id=l.node_id WHERE s.assignee_user_id='QUALITY_SIM_EMPLOYEE_1' LIMIT 1").get();assert.ok(row);
const node='/api/workbench/quality/nodes/'+row.node_id;
async function request(path,actor='employee-1',body,form){const res=await fetch(base+path,{method:body||form?'POST':'GET',headers:{cookie:cookie+'; quality_simulation='+actor,...(body?{'Content-Type':'application/json'}:{})},body:form||body&&JSON.stringify(body)});return res;}
async function post(path,body,actor='employee-1'){const res=await request(path,actor,body),json=await res.json();assert.equal(res.status,200,JSON.stringify(json));assert.equal(json.ok,true,JSON.stringify(json));return json.data;}
async function detail(actor='employee-1'){const res=await request('/api/workbench/quality/events/'+row.event_id+'?projection=1',actor);assert.equal(res.status,200);return (await res.json()).data.viewModel;}
async function work(){const view=await detail();return view.branch.find(b=>b.subtaskId===row.subtask_id).employeeWork;}
async function upload(requirementId,supersedesId,actor='employee-1'){const form=new FormData();form.append('file',new Blob(['staging evidence only'],{type:'text/plain'}),'verification.txt');form.append('summary','隔离验收证据');form.append('requestId',randomUUID());if(requirementId)form.append('requirementId',requirementId);if(supersedesId)form.append('supersedesId',supersedesId);const res=await request(node+'/evidence',actor,null,form);const json=await res.json();if(actor==='employee-2'){assert.equal(res.status,403);return;}assert.equal(res.status,201,JSON.stringify(json));return json.data.evidence;}
// Only the dedicated staging copy is reset, never the test user's live event.
db.prepare("UPDATE subtasks SET status='ASSIGNED' WHERE subtask_id=?").run(row.subtask_id);
db.prepare("UPDATE quality_assignment_nodes SET status='PENDING_ACCEPTANCE' WHERE node_id=?").run(row.node_id);
let denied=await request('/api/workbench/employee/action','employee-2',{subtaskId:row.subtask_id,action:'accept',idempotencyKey:randomUUID()});assert.ok([400,403,404].includes(denied.status));
await post('/api/workbench/employee/action',{subtaskId:row.subtask_id,action:'accept',idempotencyKey:randomUUID()});
let w=await work();assert.equal(w.formalStatus,'IN_PROGRESS');assert.equal(w.canEdit,true);assert.ok(w.requirements.length>0);
console.log('PASS original acceptance, owner-only inline projection; requirements:',w.requirements.map(r=>r.name).join(' / '));
await post(node+'/employee-draft',{progress:'已核查来源',next:'整理验证记录',completion:'完成核验，见对应附件',expectedVersion:w.draft.version});
assert.equal((await work()).draft.next,'整理验证记录');
await post('/api/workbench/employee/progress',{subtaskId:row.subtask_id,progressStatus:'IN_PROGRESS',note:'已核查来源；下一步整理验证记录',idempotencyKey:randomUUID()});
await upload(null,null,'employee-2');await upload();
w=await work();const incomplete=await request(node+'/submit-completion','employee-1',{expectedVersion:w.nodeVersion,completionNote:'完成',requirementRevision:w.requirementRevision,requestId:randomUUID()});assert.equal(incomplete.status,400,await incomplete.text());
const files=[];for(const r of w.requirements)files.push(await upload(r.id));
const replaced=await upload(undefined,files[0].evidenceId);assert.equal(replaced.fileRevision,2);assert.equal(replaced.requirementId,files[0].requirementId);
const download=await request('/api/workbench/quality/evidence/'+replaced.evidenceId);assert.equal(await download.text(),'staging evidence only');
assert.equal((await request('/api/workbench/quality/evidence/'+replaced.evidenceId,'employee-2')).status,403);
w=await work();const submitBody={expectedVersion:w.nodeVersion,completionNote:'完成核验，见对应附件',requirementRevision:w.requirementRevision,requestId:randomUUID()};
await post(node+'/submit-completion',submitBody);await post(node+'/submit-completion',submitBody);
w=await work();assert.equal(w.nodeStatus,'PENDING_PARENT_REVIEW');assert.equal(w.formalStatus,'DONE');assert.equal(w.canEdit,false);
const late=await request('/api/workbench/employee/progress','employee-1',{subtaskId:row.subtask_id,progressStatus:'IN_PROGRESS',note:'stale page',idempotencyKey:randomUUID()});assert.equal(late.status,400);assert.equal((await work()).formalStatus,'DONE');
const manager=await detail('manager');assert.ok(JSON.stringify(manager).includes(replaced.evidenceId));assert.ok(JSON.stringify(manager).includes('完成核验，见对应附件'));
console.log('PASS draft reload, original progress, multipart upload, required evidence gate, versions, authenticated downloads, atomic completion, manager evidence/summary, stale progress denied');
await post(node+'/review',{decision:'RETURN',reason:'补充验证说明',expectedVersion:w.nodeVersion,requestId:randomUUID()},'manager');w=await work();assert.equal(w.canEdit,true);assert.equal(w.nodeStatus,'RETURNED');assert.equal(w.reviews[0].reason,'补充验证说明');
const third=await upload(undefined,replaced.evidenceId);assert.equal(third.fileRevision,3);w=await work();await post(node+'/submit-completion',{expectedVersion:w.nodeVersion,completionNote:'已补充验证说明',requirementRevision:w.requirementRevision,requestId:randomUUID()});w=await work();await post(node+'/review',{decision:'APPROVE',expectedVersion:w.nodeVersion,requestId:randomUUID()},'manager');w=await work();assert.equal(w.nodeStatus,'APPROVED');assert.equal(w.formalStatus,'DONE');assert.equal(w.canEdit,false);assert.ok(w.files.find(f=>f.evidenceId===files[0].evidenceId));
console.log('PASS supervisor return -> employee V3 -> resubmit -> supervisor approval; historical evidence retained');
db.close();process.exit(0);
