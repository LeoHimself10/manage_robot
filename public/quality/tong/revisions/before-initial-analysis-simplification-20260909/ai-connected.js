'use strict';
let tongAiHealth=null;
const tongRealNow=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
function tongRequest(e) {
  const s=e.source;
  const source=Object.fromEntries(['id','version','no','title','what','how','date','occurred','person','model','serial','batch','software','impact']
    .map(k=>[k,k==='version'?Number(initialInput(e).sourceVersion):String(s[k]||'')]));
  if(e.sourceUpdate&&e.sourceConfirmed)source.how+='\n'+initialInput(e).sourceUpdate;
  return {requestId:crypto.randomUUID(),source,
    event:{no:e.no,category:e.managerReview.category,risk:e.risk,managerConclusion:e.managerReview.conclusion,
      managerTime:e.managerReview.time,upstreamAi:{...clone(e.ai),dataScope:'HISTORICAL_UI_SAMPLE',note:'上游旧演示研判，仅为未验证参考，不能视为新模型事实'}},
    attachments:e.source.fileIds.map(id=>({name:sourceFiles[id].name,type:sourceFiles[id].type,description:e.attachmentNotes?.[id]||''}))};
}
function mapRealInitial(d) {
  const o=d.output;
  const due=new Date(d.createdAt);due.setDate(due.getDate()+o.suggestedTotalDueDays);
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(due);
  return {problemDirection:o.problemDirection,confirmedCategory:o.confirmedCategoryReference,
    sourceSummary:o.sourceFactSummary.join('\n'),confirmedFacts:o.confirmedFacts.join('\n'),
    analysisBasis:o.analysisBasis.map(x=>x.statement+'〔'+x.sourceReference+'〕').join('\n'),
    basis:o.analysisBasis.map(x=>({statement:x.statement,source:x.sourceType+' · '+x.sourceReference})),
    initialConclusion:o.preliminaryConclusion,causeHypotheses:o.causeHypotheses.join('\n'),
    investigationDirections:o.investigationDirections.join('\n'),informationGaps:o.informationGaps.join('\n'),
    processingRequirements:o.handlingRequirements.join('\n'),suggestedDueAt:date+'T18:00',suggestedDueDays:o.suggestedTotalDueDays,
    departmentCandidates:o.primaryDepartmentCandidates.map(x=>({name:x.departmentName,reason:x.recommendationReason})),
    deliverables:o.deliverables.map(x=>({title:x.name,output:x.description,criteria:x.acceptanceCriteria,source:'AI_SUGGESTED',selected:false}))};
}
async function receiveRealInitial(e,a,preserve) {
  try {
    const response=await fetch('/api/quality-ui/initial-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a.requestBody),signal:AbortSignal.timeout(210000)});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'原系统 AI 请求失败');
    if(!storeData.events.includes(e)||!e.initialAi.attempts.includes(a))return;
    const d=result.data;
    a.raw=clone(d);a.status='SUCCEEDED';a.time=tongRealNow(d.createdAt);a.output=mapRealInitial(d);a.failure=null;
    a.input={...a.input,modelVersion:d.model,promptVersion:d.promptVersion,ruleVersion:d.input.ruleContext.version,knowledgeVersion:d.input.productKnowledge.version};
    if(state.selected===e.id&&state.tab==='analysis')readEditor();
    if(!preserve&&!e.initialHumanTouched){e.editor=initialDraftFrom(e,a);e.initialAi.feedback='原系统 AI 初析已生成并预填。请核对内容、选择必须成果，再正式确认。';}
    else e.initialAi.feedback='原系统 AI 初析已生成。人工草稿保持原样，可查看新原稿或主动选择预填。';
    e.initialAi.feedbackError=false;
    log(e,'原系统 AI 质量初析生成成功','请求 '+a.id+' · '+d.model+' · '+(d.durationMs/1000).toFixed(1)+' 秒');
  } catch(error) {
    if(!storeData.events.includes(e)||!e.initialAi.attempts.includes(a))return;
    a.status='FAILED';a.failure=error.name==='TimeoutError'?'等待响应超时，可刷新恢复请求或继续人工填写。':error.message;
    a.canRecover=error.name==='TimeoutError'||error.name==='TypeError';
    e.initialAi.feedback=a.failure+' 已有 AI 原稿与人工内容保留。';e.initialAi.feedbackError=true;
    log(e,'原系统 AI 初析请求失败',a.failure);
  } finally {
    if(storeData.events.includes(e)){persist();if(state.selected===e.id&&state.tab==='analysis')render();}
  }
}
generateInitial=async function(){
  const e=eventById();if(!e||e.mode==='closed'||e.initialAi.attempts.some(a=>a.status==='GENERATING'))return;
  readEditor();const preserve=!!e.draft||!!e.editor?.initialAiAttemptId||!!e.initialHumanTouched;
  const recover=e.initialAi.attempts.find(a=>a.real&&a.canRecover);
  const body=recover?.requestBody||tongRequest(e);
  const a=recover||{id:body.requestId,number:e.initialAi.attempts.length+1,real:true,time:tongRealNow(),
    input:{...clone(initialInput(e)),modelVersion:tongAiHealth?.analysis?.model||'原系统配置',promptVersion:tongAiHealth?.analysis?.promptVersion||'原系统配置'},
    output:null,failure:null,requestBody:body};
  a.status='GENERATING';a.canRecover=false;if(!recover)e.initialAi.attempts.push(a);
  initialAttemptSelection=a.id;e.initialAi.feedback='原系统 AI 正在分析当前来源、主管结论与附件人工说明…';e.initialAi.feedbackError=false;
  log(e,'发起原系统 AI 质量初析','请求编号 '+a.id+'；输入快照独立保留。');persist();render();
  await receiveRealInitial(e,a,preserve);
};
const renderOriginalInitialRaw=renderInitialRaw;
renderInitialRaw=function(e,canEdit){
  const a=currentInitialAttempt(e);
  const status=tongAiHealth===null?'正在检查 AI 连接':tongAiHealth.connected?'原系统 AI 已连接':'AI 服务未就绪';
  let html=renderOriginalInitialRaw(e,canEdit).replace(badge('交互模拟','blue'),badge(status,'blue')).replace('正在模拟生成 AI 初析','正在请求原系统 AI');
  html=html.replace('AI 原始初析 <span',`AI 原始初析 ${a?'<small class="tiny muted">· '+(a.real?'真实 AI 请求':'历史演示记录')+'</small>':''} <span`);
  if(a?.real&&a.raw)html+=`<details class="initial-details"><summary>原系统 AI 调用记录</summary><div class="read-grid">${pair('请求编号',a.id)}${pair('实际模型',a.raw.model)}${pair('生成时间',a.time)}${pair('耗时',(a.raw.durationMs/1000).toFixed(1)+' 秒')}${pair('Token 用量',String(a.raw.usage?.totalTokens||0))}${pair('提示词版本',a.raw.promptVersion)}</div></details>`;
  return html;
};
const connectedAnalysisForm=initialForm;
initialForm=function(e){return connectedAnalysisForm(e).replace('仅提交这里的说明和附件元信息给模拟初析','仅提交这里的说明和附件元信息给原系统 AI');};
// Canned failure switches remain in the archived prototype, not the live AI path.
openGuide=function(){oldGuideInitial();const fill=document.querySelector('[data-demo="fill-analysis"]');if(fill)fill.textContent='调用原系统 AI 初析';};
$('guideButton').onclick=openGuide;
document.querySelector('.prototype-bar>strong').textContent='AI 已接入原系统';
document.querySelector('.prototype-bar>span').textContent='事件与部门为样例 · AI 实时生成 · 业务操作仍为本地交互';
fetch('/api/quality-ui/status').then(r=>r.json()).then(r=>{tongAiHealth=r.data||{connected:false};readEditor();render();}).catch(()=>{tongAiHealth={connected:false};readEditor();render();});
for(const e of storeData.events)for(const a of e.initialAi.attempts){
  if(a.real&&a.raw?.createdAt)a.time=tongRealNow(a.raw.createdAt);
  if(a.real&&a.requestBody&&!a.output&&(a.canRecover||a.failure?.includes('页面刷新'))){a.status='GENERATING';a.failure=null;a.canRecover=false;receiveRealInitial(e,a,true);}
}
render();
