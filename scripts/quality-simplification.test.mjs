import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createQualityViewAccess} from './quality-view-access.mjs';
const views=createQualityViewAccess({secret:'isolated-unit-test-secret-with-32-characters',prefix:'/pilot'});
const identity={userId:'operator',session:{role:'admin'}};
const now=Date.parse('2026-09-16T08:00:00Z');
const req=view=>({headers:{cookie:views.cookie(identity,view,now).split(';')[0]}});
test('Tong view is explicit, signed, user-bound and expiring',()=>{
  assert.equal(views.isTong(req('tong'),identity,now),true);
  for(const role of ['ma','manager','employee-1','admin','other'])assert.equal(views.isTong(req(role),identity,now),false);
  assert.equal(views.isTong(req('tong'),{userId:'different'},now),false);
  assert.equal(views.isTong(req('tong'),identity,now+43200000),false);
  assert.equal(views.isTong(req('tong'),{...identity,session:{impersonation:{}}},now),false);
  const forged=req('tong');forged.headers.cookie=forged.headers.cookie.slice(0,-1)+'x';
  assert.equal(views.isTong(forged,identity,now),false);
  const duplicate=req('tong');duplicate.headers.cookie+='; '+duplicate.headers.cookie;
  assert.equal(views.isTong(duplicate,identity,now),false);
  assert.equal(views.isTong({headers:{'x-quality-view':'tong'}},identity,now),false);
});
const context={};
runInNewContext(readFileSync(new URL('../public/quality/business-display.js',import.meta.url),'utf8'),context);
runInNewContext(readFileSync(new URL('../public/quality/tong/dashboard-data.js',import.meta.url),'utf8'),context);
test('display translates source markers, preserves meaningful text and model codes',()=>{
  const display=context.QualityBusinessDisplay;
  assert.equal(display.text('更换导管后恢复 [oa:oTsFjJW4TjKfkgFsGUjWnm0B451789213574668]'),'更换导管后恢复 〔来源反馈〕');
  assert.equal(display.reference('SOURCE_SNAPSHOT','oa:opaque'),'来源反馈');
  assert.equal(display.reference('HISTORICAL_CASE','历史第875条'),'历史案例 · 历史第875条');
  assert.equal(display.text('Mobile+ / 501251002'), 'Mobile+ / 501251002');
});
function event(id,mode,extra={}) {return {id,mode,risk:'中风险',real:{finalReview:{event:{createdAt:'2026-09-15T00:00:00Z',updatedAt:'2026-09-15T00:00:00Z'},history:[],nodes:[],...extra}}};}
test('dashboard counts events once using live formal tasks, and keeps current backlog outside period',()=>{
  const work={subtaskId:'s1',formalStatus:'IN_PROGRESS',dueAt:'2026-09-15'};
  const rows=[event('open','active',{nodes:[{work},{work}]}),event('done','closed',{nodes:[{work}],history:[{action:'QUALITY_CLOSED',occurredAt:'2026-09-16T02:00:00Z'}]}),event('pending','analysis',{event:{createdAt:'2026-01-01T00:00:00Z'}}),event('future','active',{nodes:[{work:{...work,dueAt:'2026-09-16'}}]})];
  const d=context.QualityDashboardData.summarize(rows,7,now);
  assert.deepEqual([...d.groups.overdue],['open']);assert.deepEqual([...d.groups.analysis],['pending']);assert.deepEqual([...d.groups.closed],['done']);
  assert.equal(d.groups.periodNew.includes('pending'),false);
});
test('period activity records close then reopen without calling reopened events currently closed',()=>{
  const row=event('reopen','reopened',{history:[{action:'QUALITY_CLOSED',occurredAt:'2026-09-16T01:00:00Z'},{action:'QUALITY_CLOSED',occurredAt:'2026-09-16T02:00:00Z'},{action:'QUALITY_REOPENED',occurredAt:'2026-09-16T03:00:00Z'}]});
  const d=context.QualityDashboardData.summarize([row],7,now);
  assert.equal(d.groups.closed.length,0);assert.equal(d.groups.periodClosed.length,1);assert.equal(d.groups.periodReopened.length,1);
  assert.equal(d.buckets.reduce((n,b)=>n+b.closed,0),1);
});
