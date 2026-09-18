import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createProductionAccess} from './quality-production-access.mjs';
const secret='test-only-secret-with-at-least-32-characters';
const origin='https://managebot.vivolightsales.com';
const now=1800000000000;
const authenticate=createProductionAccess({secret,userId:'cao',origin});
function request(overrides={}, headers={}) {
  const value={userId:'cao',role:'employee',loginSource:'dingtalk_authcode',dingUser:{userId:'cao'},iat:now/1000-10,exp:now/1000+100,...overrides};
  const payload=Buffer.from(JSON.stringify(value)).toString('base64url');
  return {headers:{cookie:`wb_session=${payload}.${createHmac('sha256',secret).update(payload).digest('hex')}`,...headers}};
}
test('only allowed real DingTalk identity succeeds',()=>assert.equal(authenticate(request(),now)?.userId,'cao'));
for(const [name,change] of Object.entries({other:{userId:'other'},expired:{exp:now/1000},fallback:{loginSource:'entry'},password:{loginSource:'external_password'},signedLink:{loginSource:'signed_link'},delegation:{impersonation:{actorUserId:'cao'}},mismatchedDingUser:{dingUser:{userId:'other'}},invalidExpiry:{exp:'999999999999'},future:{iat:now/1000+500},invalidRole:{role:'root'}})) {
  test(`reject ${name}`,()=>assert.equal(authenticate(request(change),now),null));
}
test('reject foreign origin',()=>assert.equal(authenticate(request({}, {origin:'https://evil.example'}),now),null));
test('reject cross-site',()=>assert.equal(authenticate(request({}, {'sec-fetch-site':'cross-site'}),now),null));
test('reject forged and absent cookies',()=>{assert.equal(authenticate({headers:{cookie:'wb_session=x.'+'0'.repeat(64)}},now),null);assert.equal(authenticate({headers:{}},now),null);});
test('reject duplicate session cookies',()=>{const r=request();r.headers.cookie+='; '+r.headers.cookie;assert.equal(authenticate(r,now),null);});
test('fail closed without secure configuration',()=>assert.throws(()=>createProductionAccess({secret,userId:'cao',origin:'http://localhost'})));

test('configured post access is evaluated on every request and revokes an existing session',()=>{
  let holder='other';const auth=createProductionAccess({secret,userId:'cao',origin,allowedUser:id=>id===holder});
  const r=request({userId:'other',dingUser:{userId:'other'}});
  assert.equal(auth(r,now)?.userId,'other');holder='replacement';assert.equal(auth(r,now),null);
});
