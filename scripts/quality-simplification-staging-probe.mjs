import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
assert.equal(process.env.WORKBENCH_SESSION_SECRET,'isolated-staging-secret-not-for-production-20260911');
assert.equal(process.env.QUALITY_OA_SYNC_ENABLED,'0');
assert.ok(existsSync('/app/data/.inline-staging-only'));
const userId=process.env.QUALITY_PILOT_USER_ID,now=Math.floor(Date.now()/1000);
const payload=Buffer.from(JSON.stringify({userId,role:'admin',loginSource:'dingtalk_authcode',dingUser:{userId,name:'隔离测试'},iat:now,exp:now+600})).toString('base64url');
const login='wb_session='+payload+'.'+createHmac('sha256',process.env.WORKBENCH_SESSION_SECRET).update(payload).digest('hex');
const base='http://127.0.0.1:8092/workbench/quality-pilot';
let cookie=login;
async function request(path,method='GET',save=false){
 const r=await fetch(base+path,{method,headers:{cookie},redirect:'manual'});
 if(save){const map=new Map(cookie.split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)));for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split(/=(.*)/s);map.set(k,v);}cookie=[...map].map(([k,v])=>k+'='+v).join('; ');}
 return r;
}
assert.equal((await request('/api/quality-oa/tong')).status,403);
assert.equal((await request('/ma-workbench/','GET',true)).status,200);
assert.equal((await request('/api/quality-oa/tong')).status,403);
assert.equal((await request('/tong/','GET',true)).status,200);
let res=await request('/api/quality-oa/tong');assert.equal(res.status,200);
const fixture=await res.json();writeFileSync('/app/data/r10-ui-fixture.json',JSON.stringify(fixture));
const savedTong=cookie;
assert.equal((await request('/tong/dashboard.js')).status,200);
for(const [view,simulation] of [['manager','manager'],['employee','employee-1']]){
 assert.equal((await request('/workbench/quality?perspective='+view+'&simulation='+simulation,'GET',true)).status,200);
 assert.equal((await request('/api/quality-oa/tong')).status,403);
 assert.equal((await request('/api/quality-oa/tong/final-close','POST')).status,403);
 assert.equal((await request('/tong/dashboard.js')).status,403);
}
cookie=savedTong.replace(/quality_view=[^;]+/,'quality_view=forged');
assert.equal((await request('/api/quality-oa/tong')).status,403);
cookie='';assert.equal((await request('/api/quality-oa/tong')).status,403);
console.log('PASS actual HTTP: explicit Tong switch, Ma/manager/employee denied reads and writes, forged/absent context denied. Fixture events:',fixture.items.length);
