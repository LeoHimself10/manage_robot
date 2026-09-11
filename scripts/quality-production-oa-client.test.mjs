import test from 'node:test';
import assert from 'node:assert/strict';
import {DingTalkOaClient} from '../src/quality/oa/oa-client.mjs';
test('inbox queries every status; admission remains a separate check',async()=>{
  const client=new DingTalkOaClient({});let sent;
  client.request=async(path,body)=>{sent=body;return {list:[]};};
  await client.listIds('approved-process',10,20,2);
  assert.equal(sent.processCode,'approved-process');assert.equal(sent.nextToken,2);
  assert.ok(!Object.hasOwn(sent,'statuses'));
});
