import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPeopleDirectoryStore} from '../src/infra/people-directory-store.ts';
import {createQualityDepartmentDirectory} from '../src/quality/analysis/quality-department-directory.ts';
import {resolveQualityCapabilities} from '../src/security/quality-capabilities.ts';
import {createProductionAccess} from './quality-production-access.mjs';
import {seedSimulationDirectory,resolveSimulationActor,simulationSessionToken,SIMULATION_ACTORS,simulationNavigation} from './quality-simulation.mjs';
const secret='isolated-unit-test-secret-'.repeat(3);
test('simulation replaces assignable contacts, preserves history, and resolves exactly one fake manager',()=>{
 const dir=mkdtempSync(join(tmpdir(),'quality-simulation-'));const path=join(dir,'workbench.sqlite');const env={...process.env};
 try{
  process.env.QUALITY_PILOT_TEST_MODE='1';process.env.WORKBENCH_SQLITE_PATH=path;
  createPeopleDirectoryStore(path).close();const db=new DatabaseSync(path);
  db.prepare("INSERT INTO dingtalk_contacts(user_id,name,department_ids_json,department_names_json,last_synced_at) VALUES('real-person','真实人员','[\"real-dept\"]','[\"真实部门\"]',?)").run(new Date().toISOString());db.close();
  seedSimulationDirectory(path,'qa-operator');seedSimulationDirectory(path,'qa-operator');
  const directory=createQualityDepartmentDirectory(path);const deps=directory.listAssignableDepartments();assert.equal(deps.length,1);assert.equal(deps[0].departmentName,'模拟测试部门');
  assert.equal(directory.resolveManager(deps[0].departmentId).managerUserId,'QUALITY_SIM_MANAGER');directory.close();
  const people=createPeopleDirectoryStore(path);assert.equal(people.getContact('real-person').active,false);assert.equal(people.listContacts().filter(p=>p.active).length,4);people.close();
  for(const a of SIMULATION_ACTORS){const caps=resolveQualityCapabilities(a.userId);assert.equal(caps.baseRole,a.role);assert.equal(caps.canAccessTracking,true);assert.equal(caps.canAnalyzeQuality,false);}
  process.env.QUALITY_PILOT_TEST_MODE='0';assert.throws(()=>seedSimulationDirectory(path,'qa-operator'));
 }finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);rmSync(dir,{recursive:true,force:true});}
});
test('only fixed simulation identities are selectable and Ma/Tong return to the real operator',()=>{
 const pick=(path,query='',cookie='')=>resolveSimulationActor(path,new URL('https://test.invalid'+path+query),cookie);
 assert.equal(pick('/workbench/quality','?perspective=manager').userId,'QUALITY_SIM_MANAGER');
 assert.equal(pick('/workbench/quality','?perspective=employee&simulation=employee-3').userId,'QUALITY_SIM_EMPLOYEE_3');
 assert.equal(pick('/api/workbench/employee/tasks','','quality_simulation=employee-2').userId,'QUALITY_SIM_EMPLOYEE_2');
 assert.equal(pick('/tong/','','quality_simulation=employee-2'),null);
 assert.throws(()=>pick('/workbench/quality','?simulation=real-person'));
 assert.ok(!simulationNavigation(null).includes('_blank'));
});
test('internal simulated sessions preserve real operator audit and cannot authenticate at the outer DingTalk gate',()=>{
 const now=Math.floor(Date.now()/1000);const identity={userId:'qa-operator',session:{userId:'qa-operator',sid:'test-sid',role:'admin',loginSource:'dingtalk_authcode',iat:now,exp:now+600,dingUser:{userId:'qa-operator',name:'测试操作人'}}};
 for(const a of SIMULATION_ACTORS){const token=simulationSessionToken(identity,a,secret);const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));assert.equal(payload.userId,a.userId);assert.equal(payload.impersonation.actorUserId,'qa-operator');
 const access=createProductionAccess({secret,userId:'qa-operator',origin:'https://test.invalid'});assert.equal(access({headers:{cookie:'wb_session='+token}}),null);}
 assert.equal(identity.session.userId,'qa-operator');assert.throws(()=>simulationSessionToken(identity,{userId:'real-person'},secret));
});
