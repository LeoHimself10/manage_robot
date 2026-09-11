import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join,resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// The OA inbox is an intake adapter. Formal quality events and task progress
// continue to use the original workbench database and its existing services.
export async function createOaWorkflow({store,originalRoot,serviceRoot,dbPath,modelEnv}) {
  serviceRoot ||= resolve(originalRoot,'../ma-quality-workbench-v1');
  dbPath ||= join(originalRoot,'data/local-quality-initial-analysis-v1/workbench.sqlite');
  const actor='quality-supervisor-local';
  const roleConfigPath=join(dirname(dbPath),'local-role-config.json');
  if(existsSync(roleConfigPath)){
    const roles=JSON.parse(readFileSync(roleConfigPath,'utf8'));
    process.env.WORKBENCH_MANAGER_USER_IDS=roles.managerUserIds || process.env.WORKBENCH_MANAGER_USER_IDS || '';
    if(roles.managerIdsFile)process.env.WORKBENCH_MANAGER_IDS_FILE=roles.managerIdsFile;
    if(roles.dynamicManagerIdsFile)process.env.WORKBENCH_DYNAMIC_MANAGER_IDS_FILE=roles.dynamicManagerIdsFile;
  }
  process.env.WORKBENCH_SQLITE_PATH=dbPath;
  process.env.PLAN_SESSION_DIR=join(dirname(dbPath),'sessions');
  process.env.PLAN_SESSION_EVENTS_PATH=join(dirname(dbPath),'events','plan-session-events.jsonl');
  process.env.WORKBENCH_MANAGER_USER_IDS=[...new Set([...(process.env.WORKBENCH_MANAGER_USER_IDS||'').split(','),actor])].filter(Boolean).join(',');
  process.env.QUALITY_AFTERSALES_MANAGER_USER_IDS=actor;
  process.env.QUALITY_MANAGEMENT_USER_IDS='quality-employee-local';
  process.env.QUALITY_SOURCE_WRITEBACK_ENABLED='0';
  process.env.QUALITY_NOTIFICATION_WORKER_ENABLED='0';
  const load=file=>import(pathToFileURL(join(serviceRoot,'src',file)).href);
  const [ma,oa,review,taxonomy]=await Promise.all([
    load('quality/ma-workbench/service.ts'),load('quality/oa/quality-oa-source.ts'),
    load('quality/reviews/quality-source-assessment-service.ts'),
    load('quality/ai-original-assessment/historical-feedback-taxonomy-v0.ts')]);
  const service=ma.createMaWorkbenchService({dbPath,listAttachments:oa.listQualityOaAttachments});
  const persistence=review.createQualitySourceAssessmentService({dbPath});
  const db=new DatabaseSync(dbPath);db.exec('PRAGMA busy_timeout=8000');
  store.db.exec(`CREATE TABLE IF NOT EXISTS oa_workflow_versions(source_id TEXT,oa_version INTEGER,quality_version INTEGER,PRIMARY KEY(source_id,oa_version));
    CREATE TABLE IF NOT EXISTS oa_workflow_human_facts(source_id TEXT,version INTEGER,description TEXT,PRIMARY KEY(source_id,version));`);
  function syncSource(source) {
    for(const row of store.db.prepare('SELECT version,raw,at FROM oa_source_versions WHERE id=? ORDER BY version').all(source.id)) {
      if(store.db.prepare('SELECT 1 FROM oa_workflow_versions WHERE source_id=? AND oa_version=?').get(source.id,row.version))continue;
      const instance=JSON.parse(row.raw);
      // Keep the original fields, and supply the legacy adapter's canonical
      // names from the exact same version (never from today's source values).
      const projected=JSON.parse(store.db.prepare('SELECT payload FROM oa_source_versions WHERE id=? AND version=?').get(source.id,row.version).payload);
      for(const [name,value] of Object.entries({WHAT:projected.what,WHERE:projected.where,WHEN:projected.occurred,HOW:projected.how,'设备型号':projected.model,'设备序列号':projected.serial,'软件版本':projected.software,'导管生产批号':projected.batch,'影响程度':projected.impact}))
        if(value&&!instance.formComponentValues.some(f=>f.name===name))instance.formComponentValues.push({id:'mapped:'+name,name,value,componentType:'TextField'});
      const result=oa.ingestQualityOaInstance({dbPath,processInstanceId:source.instanceId,processCode:store.scope.processCode,
        instance,receivedAt:row.at,reporterName:source.person,oaUrl:source.url});
      store.db.prepare('INSERT INTO oa_workflow_versions VALUES (?,?,?)').run(source.id,row.version,result.sourceVersion);
    }
    const key='oa:'+source.instanceId;
    for(const row of store.db.prepare("SELECT response,source_version FROM oa_ai WHERE source_id=? AND status='SUCCEEDED' ORDER BY at").all(source.id)) {
      const data=JSON.parse(row.response).data;
      const mapping=store.db.prepare('SELECT quality_version FROM oa_workflow_versions WHERE source_id=? AND oa_version=?').get(source.id,row.source_version);
      persistence.saveAiAssessment({sourceKey:key,sourceVersion:mapping.quality_version,requestId:data.requestId,
        sourceSnapshot:data.input.sourceSnapshot,output:data.output,retrievedCases:data.retrievedCases||[],actorUserId:actor});
    }
    return key;
  }
  function get(id) {
    const source=store.get(id);if(!source)throw new ma.MaWorkbenchError('NOT_FOUND','反馈不存在');
    const detail=service.get(syncSource(source),actor);
    detail.oaVersion=source.version;
    detail.humanFacts=Object.fromEntries(store.db.prepare('SELECT version,description FROM oa_workflow_human_facts WHERE source_id=?').all(id).map(x=>[x.version,x.description]));
    return detail;
  }
  function check(id,body) {
    const source=store.get(id),detail=get(id);
    if(body.version!==source.version)throw new ma.MaWorkbenchError('VERSION_CONFLICT','OA 来源已更新，请刷新核对后继续');
    if(!source.activeForMa&&!detail.event)throw new ma.MaWorkbenchError('VERSION_CONFLICT','本条 OA 已流转，暂不能提交新的研判');
    return {source,detail,key:'oa:'+source.instanceId,base:{requestId:body.requestId,expectedSourceVersion:detail.sourceVersion}};
  }
  function mutate(action,id,body) {
    if(action==='admit'&&store.get(id)?.oaStatus!=='RUNNING')throw new ma.MaWorkbenchError('VERSION_CONFLICT','只有审批中的 OA 记录才能进入质量流程');
    const {detail,key,base}=check(id,body);
    if(action!=='admit'&&!detail.admission)throw new ma.MaWorkbenchError('NOT_ADMITTED','请先从全部事件确认进入质量事件');
    if(action==='admit')service.admit(key,actor,base);
    else if(action==='save') {
      const category=taxonomy.HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.find(c=>c.primaryLabel===body.draft?.primary);
      const secondary=category?.secondaryCategories.find(c=>c.secondaryLabel===body.draft?.secondary);
      if(!secondary||!body.draft?.description?.trim())throw new ma.MaWorkbenchError('INVALID_ASSESSMENT','请补全分类和事实摘要');
      const saved=service.saveAssessment(key,actor,{...base,expectedVersion:body.expectedVersion,categoryMode:'STANDARD',
        primaryCategoryCode:category.primaryCode,secondaryCategoryCode:secondary.secondaryCode,riskLevel:body.draft.risk,
        conclusion:body.draft.conclusion,adoptionMode:body.adoption,changeReason:body.draft.changeReason});
      store.db.prepare('INSERT OR IGNORE INTO oa_workflow_human_facts VALUES (?,?,?)').run(id,saved.assessment.version,body.draft.description);
    } else if(action==='submit') service.submit(key,actor,{...base,expectedAssessmentVersion:body.expectedVersion});
    else throw new ma.MaWorkbenchError('NOT_FOUND','操作不存在');
    return get(id);
  }
  const analysisModule=await import(pathToFileURL(join(originalRoot,'src/quality/analysis/quality-analysis-service.ts')).href);
  const contracts=await import(pathToFileURL(join(originalRoot,'src/quality/analysis/quality-analysis-contracts.ts')).href);
  const directoryModule=await import(pathToFileURL(join(originalRoot,'src/quality/analysis/quality-department-directory.ts')).href);
  const analysis=analysisModule.createQualityAnalysisService({dbPath,env:modelEnv});
  const qualityActor='quality-employee-local';
  function tongGet(id) {
    const detail=get(id);
    if(!detail.event)throw new Error('尚未正式推送质量初析');
    const workspace=analysis.workspace({eventId:detail.event.id,viewerUserId:qualityActor});
    const directory=directoryModule.createQualityDepartmentDirectory(dbPath);
    try {workspace.departments=workspace.departments.map(d=>({...d,managerName:directory.resolveManager(d.departmentId).managerName}));}finally{directory.close();}
    return {id,source:store.get(id),detail,workspace};
  }
  return {get,mutate,list:()=>store.list().map(s=>({id:s.id,detail:get(s.id)})),
    tongList:()=>store.list().filter(s=>get(s.id).event).map(s=>tongGet(s.id)),tongGet,
    async tongMutate(action,id,body){
      const {workspace}=tongGet(id),eventId=workspace.event.eventId;
      if(action==='generate') {
        if(!/^[a-f0-9-]{36}$/i.test(body.requestId||''))throw new Error('请求编号无效');
        await analysis.generate({eventId,actorUserId:qualityActor,requestId:body.requestId});
      } else if(action==='draft')analysis.saveDraft({eventId,actorUserId:qualityActor,draft:contracts.saveQualityAnalysisDraftSchema.parse(body.draft)});
      else if(action==='confirm')analysis.confirm({eventId,actorUserId:qualityActor,...contracts.confirmQualityAnalysisSchema.parse(body.confirm)});
      else throw new Error('操作不存在');
      return tongGet(id);
    },
    requireAssessment(id,version){const {detail}=check(id,{version});if(!detail.admission||!detail.canAssess)throw new ma.MaWorkbenchError('NOT_ADMITTED','请先从全部事件确认进入质量事件，再进行研判');},
    close(){analysis.close();service.close();persistence.close();db.close();}};
}
