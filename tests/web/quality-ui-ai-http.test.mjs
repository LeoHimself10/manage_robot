import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAiHandler } from '../../scripts/quality-ui-ai-http.mjs';

async function fixture(t, run) {
  const directory=await mkdtemp(join(tmpdir(),'quality-ai-test-'));
  const publicRoot=join(directory,'public');await mkdir(publicRoot);await writeFile(join(publicRoot,'index.html'),'<h1>Workbench</h1>');
  const journalPath=join(directory,'private','attempts.jsonl');
  const roots={};let calls=0;
  const runtime={health:{connected:true,model:'test-only'},validate(_kind,body){if(!body.requestId||!body.source?.version)throw new Error('bad input');return body;},
    async run(kind,body){calls++;return run?run(kind,body):{output:{requestId:body.requestId},model:'test-only'};}};
  let handler=createAiHandler({runtime,roots,journalPath});
  const server=http.createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;roots[port]=publicRoot;
  const base=`http://127.0.0.1:${port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return {base,journalPath,get calls(){return calls;},restart(){handler=createAiHandler({runtime,roots,journalPath});},
    post(body,headers={}){return fetch(base+'/api/quality-ui/assessment',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}};
}
const request=()=>({requestId:randomUUID(),source:{version:1,title:'input'}});

test('same request, concurrent retries and service restart all reuse one model result',async t=>{
  let release;const blocked=new Promise(r=>release=r);
  const f=await fixture(t,async()=>{await blocked;return {output:{conclusion:'model result'},model:'test-only'};});
  const body=request();const one=f.post(body),two=f.post(body);release();
  const results=await Promise.all([one,two]);
  assert.deepEqual(await results[0].json(),await results[1].json());assert.equal(f.calls,1);
  f.restart();const retry=await f.post(body);assert.equal(retry.status,200);assert.equal(f.calls,1);
  const changed=await f.post({...body,source:{...body.source,version:2}});assert.equal(changed.status,409);assert.equal(f.calls,1);
});
test('model error never creates fallback output and does not expose secrets',async t=>{
  const f=await fixture(t,async()=>{throw Object.assign(new Error('secret-provider-error-token'),{code:'MODEL_TIMEOUT'});});
  const body=request(),response=await f.post(body),data=await response.json();
  assert.equal(response.status,502);assert.equal(data.code,'MODEL_TIMEOUT');assert.equal(data.data,undefined);
  assert.ok(!JSON.stringify(data).includes('secret-provider'));assert.equal(f.calls,1);
  const journal=await readFile(f.journalPath,'utf8');assert.match(journal,/FAILED/);assert.ok(!journal.includes('secret-provider'));
  await f.post(body);assert.equal(f.calls,1);
  await f.post(request());assert.equal(f.calls,2);
});
test('cross origin, malformed input and form submissions are rejected before model calls',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post(request(),{Origin:'https://outside.example'})).status,403);
  assert.equal((await f.post(request(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.post({})).status,400);
  assert.equal((await fetch(f.base+'/api/quality-ui/assessment')).status,405);
  assert.equal(f.calls,0);
  assert.equal((await fetch(f.base+'/')).status,200);
  assert.equal((await fetch(f.base+'/.env')).status,404);
});
test('an unfinished attempt after server restart requires an explicit new request',async t=>{
  const f=await fixture(t);const body=request();await f.post(body);
  const line=JSON.parse((await readFile(f.journalPath,'utf8')).split('\n')[0]);
  await writeFile(f.journalPath,JSON.stringify(line)+'\n');f.restart();
  const response=await f.post(body);
  assert.equal(response.status,502);assert.match((await response.json()).error,/中断/);assert.equal(f.calls,1);
  await f.post(request());assert.equal(f.calls,2);
});
