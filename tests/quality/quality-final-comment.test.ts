import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQualityFinalCommentWorker, ensureQualityFinalCommentSchema } from '../../src/quality/oa/quality-final-comment';
import { DingTalkOaClient } from '../../src/quality/oa/oa-client.mjs';

describe('final approval OA comment delivery',()=>{
 let db:DatabaseSync;
 beforeEach(()=>{
  vi.stubEnv('QUALITY_PILOT_TEST_MODE','0');vi.stubEnv('QUALITY_OA_FINAL_COMMENT_ENABLED','1');
  db=new DatabaseSync(':memory:');db.exec('CREATE TABLE quality_events(id TEXT PRIMARY KEY); INSERT INTO quality_events VALUES(\'event\');');
  ensureQualityFinalCommentSchema(db);
  db.prepare(`INSERT INTO quality_final_comment_outbox(closure_id,event_id,process_instance_id,process_code,comment_user_id,opinion,comment_text,status,created_at,updated_at)
    VALUES('closure','event','instance','scope','user','通过','通过 [closure]','QUEUED','now','now')`).run();
 });
 afterEach(()=>{db.close();vi.unstubAllEnvs();});
 const client=()=>({addComment:vi.fn().mockResolvedValue(true),getInstance:vi.fn().mockResolvedValue({operationRecords:[]})});
 const status=(d:DatabaseSync)=>d.prepare('SELECT status FROM quality_final_comment_outbox').get()?.status;
 it('suppresses all remote calls in test mode, even when an old real queue exists',async()=>{
  vi.stubEnv('QUALITY_PILOT_TEST_MODE','1');const c=client(),worker=createQualityFinalCommentWorker(db,c,'scope');
  await worker.processOne();await worker.processOne('closure');expect(c.addComment).not.toHaveBeenCalled();expect(c.getInstance).not.toHaveBeenCalled();
  const fetchImpl=vi.fn();const adapter=new DingTalkOaClient({clientId:'app',clientSecret:'secret',fetchImpl});
  await expect(adapter.addComment({processInstanceId:'instance',commentUserId:'user',text:'通过'})).rejects.toThrow('OA_COMMENT_DISABLED');expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('delivers the frozen target and text only once, including concurrent/repeated attempts',async()=>{
  const c=client(),worker=createQualityFinalCommentWorker(db,c,'scope');
  await Promise.all([worker.processOne(),worker.processOne('closure')]);await worker.processOne('closure');
  expect(c.addComment).toHaveBeenCalledExactlyOnceWith({processInstanceId:'instance',commentUserId:'user',text:'通过 [closure]'});expect(status(db)).toBe('SYNCED');
 });
 it('keeps final review independent of definite failure and retries the same frozen comment',async()=>{
  const c=client();c.addComment.mockRejectedValueOnce(Object.assign(new Error('permission denied'),{definitelyRejected:true}));
  const worker=createQualityFinalCommentWorker(db,c,'scope');await worker.processOne();expect(status(db)).toBe('FAILED');
  await worker.processOne();expect(c.addComment).toHaveBeenCalledTimes(1);
  await worker.processOne('closure');expect(status(db)).toBe('SYNCED');expect(c.addComment.mock.calls[0]).toEqual(c.addComment.mock.calls[1]);
 });
 it('never resends an ambiguous POST; a matching OA record reconciles its outcome',async()=>{
  const c=client();c.addComment.mockRejectedValueOnce(new Error('network timeout'));const worker=createQualityFinalCommentWorker(db,c,'scope');
  await worker.processOne();expect(status(db)).toBe('UNKNOWN');await worker.processOne('closure');expect(status(db)).toBe('UNKNOWN');expect(c.addComment).toHaveBeenCalledTimes(1);
  c.getInstance.mockResolvedValue({operationRecords:[{remark:'通过 [closure]',userId:'user'}]});await worker.processOne('closure');expect(status(db)).toBe('SYNCED');expect(c.addComment).toHaveBeenCalledTimes(1);
 });
 it('never requeues crash recovery or suppressed comments, and rejects another workflow scope',async()=>{
  const c=client();db.exec("UPDATE quality_final_comment_outbox SET status='SENDING'");const worker=createQualityFinalCommentWorker(db,c,'scope');
  expect(status(db)).toBe('UNKNOWN');await worker.processOne();expect(c.addComment).not.toHaveBeenCalled();
  db.exec("UPDATE quality_final_comment_outbox SET status='SUPPRESSED'");await worker.processOne('closure');expect(c.addComment).not.toHaveBeenCalled();
  db.exec("UPDATE quality_final_comment_outbox SET status='QUEUED',process_code='another'");await expect(worker.processOne()).rejects.toThrow('目标');expect(c.addComment).not.toHaveBeenCalled();
 });
 it('uses the official comment request shape and does not retry an unacknowledged POST',async()=>{
  const fetchImpl=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({accessToken:'token',expireIn:7200})})
    .mockResolvedValueOnce({ok:true,status:200,json:async()=>({success:true,result:true})});
  const adapter=new DingTalkOaClient({clientId:'app',clientSecret:'secret',fetchImpl});
  const body={processInstanceId:'instance',commentUserId:'user',text:'终验通过'};
  await adapter.addComment(body);
  expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.dingtalk.com/v1.0/workflow/processInstances/comments');
  expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual(body);
  fetchImpl.mockRejectedValueOnce(new Error('timeout'));await expect(adapter.addComment(body)).rejects.toThrow('timeout');expect(fetchImpl).toHaveBeenCalledTimes(3);
 });
});
