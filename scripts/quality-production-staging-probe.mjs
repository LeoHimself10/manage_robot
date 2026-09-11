import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
// Only the isolated staging secret can be used for synthetic auth tests.
assert.equal(process.env.WORKBENCH_SESSION_SECRET,'isolated-staging-secret-not-for-production-20260911');
const userId=process.env.QUALITY_PILOT_USER_ID;
function cookie(id=userId){const p=Buffer.from(JSON.stringify({userId:id,role:'employee',loginSource:'dingtalk_authcode',dingUser:{userId:id},iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');return 'wb_session='+p+'.'+createHmac('sha256',process.env.WORKBENCH_SESSION_SECRET).update(p).digest('hex');}
for(const path of ['/ma-workbench/','/tong/','/api/quality-oa/sources','/api/quality-oa/workflow','/api/quality-oa/tong','/workbench/quality?perspective=manager','/workbench/quality?perspective=employee']){
  const r=await fetch('http://127.0.0.1:8092/workbench/quality-pilot'+path,{headers:{cookie:cookie()},redirect:'manual'});
  assert.equal(r.status,200,path);const text=await r.text();assert.ok(!text.includes('http://127.0.0.1:880'),path);
  console.log('PASS',path);
}
for(const [path,target] of [['/workbench','/ma-workbench/'],['/workbench/quality','/ma-workbench/'],['/workbench/quality?perspective=quality_management','/tong/']]){
  const r=await fetch('http://127.0.0.1:8092/workbench/quality-pilot'+path,{headers:{cookie:cookie()},redirect:'manual'});
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/workbench/quality-pilot'+target);console.log('PASS redirect',path);
}
for(const value of ['',cookie('not-allowed')]){
  const r=await fetch('http://127.0.0.1:8092/workbench/quality-pilot/api/quality-oa/sources',{headers:{cookie:value}});
  assert.equal(r.status,403);console.log('PASS denied identity');
}
