import {describe,it,expect} from 'vitest';
import {normalizeDraftTasksForSession} from '../../src/agent/draft-person-fields';
import {prevalidateWorkbenchDraftRevision} from '../../src/agent/workbench/draft-revise-prevalidate';
const starter = {id:'__quality_planning__',title:'故障数据保全',deliverables:['原始日志'],completionCriteria:['日志完整']};
const draft = () => ({qualityHandoff:{planningRequired:true},tasks:[{...starter},{id:'task_2',title:'分析',dependencyTaskIds:['task_1']},{id:'task_3',title:'复现',dependencyTaskIds:['task_1']} ]});
describe('quality starter dependency promotion',()=>{
 it('repairs the observed AI draft on load and accepts an already-open editor submission without mutating input',()=>{
  const raw=draft(), before=structuredClone(raw);const normalized=normalizeDraftTasksForSession(raw);
  expect((normalized.tasks as any[]).map(t=>t.id)).toEqual(['task_1','task_2','task_3']);
  expect(prevalidateWorkbenchDraftRevision({draft:raw}).ok).toBe(true);
  expect(raw).toEqual(before);expect(normalizeDraftTasksForSession(normalized)).toEqual(normalized);
 });
 it('remaps explicit placeholder dependencies too',()=>{
  const raw=draft();raw.tasks[1].dependencyTaskIds=['__quality_planning__'];
  expect((normalizeDraftTasksForSession(raw).tasks as any[])[1].dependencyTaskIds).toEqual(['task_1']);
 });
 it('preserves the empty starter and refuses to guess missing or deleted dependencies',()=>{
  const empty={qualityHandoff:{},tasks:[{...starter,title:'待规划执行任务',deliverables:[]}]};
  expect((normalizeDraftTasksForSession(empty).tasks as any[])[0].id).toBe('__quality_planning__');
  const raw=draft();raw.tasks[1].dependencyTaskIds=['task_99'];expect(prevalidateWorkbenchDraftRevision({draft:raw}).ok).toBe(false);
  expect(prevalidateWorkbenchDraftRevision({draft:{tasks:raw.tasks.slice(1)}}).ok).toBe(false);
 });
 it('does not rename ordinary, confirmed, or colliding task identities',()=>{
  const raw=draft();
  for(const sample of [{tasks:raw.tasks},{...raw,qualityHandoff:{planning:{}}},{...raw,tasks:[...raw.tasks,{id:'task_1',title:'existing'}]}])
   expect((normalizeDraftTasksForSession(sample).tasks as any[])[0].id).toBe('__quality_planning__');
 });
});
