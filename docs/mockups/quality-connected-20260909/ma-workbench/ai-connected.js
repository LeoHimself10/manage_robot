'use strict';
// Real AI transport. Manual decisions and sample workflow remain separate.
const maAiStorage = 'quality-ma-real-ai-v1';
const maHandling = {ORDINARY:'普通反馈', NEEDS_INFO:'待补资料', QUALITY_ANOMALY:'质量异常'};
let maAiHealth = null;
function maSource(r) {
  return Object.fromEntries(['id','version','no','title','what','how','date','occurred','person','model','serial','batch','software','impact']
    .map(k => [k, k === 'version' ? Number(r.version || 1) : String(r[k] || '')]));
}
function saveMaAi() {
  const saved={};
  for(const [id,a] of Object.entries(assessments))if(a.snapshots.some(s=>s.real)||a.pendingRequest){
    saved[id]=Object.fromEntries(['snapshots','selectedAI','draft','adoption','adoptedId','pendingRequest','error','saved','dirty'].map(k=>[k,a[k]]));
  }
  try { localStorage.setItem(maAiStorage, JSON.stringify(saved)); }
  catch { toast('浏览器存储空间不足；AI 原稿仍已保存在本地服务。'); }
}
try {
  const saved = JSON.parse(localStorage.getItem(maAiStorage) || '{}');
  for (const [id,a] of Object.entries(saved)) if (rows.some(r=>r.id===id) && Array.isArray(a.snapshots)) {
    const base=assessmentFor(rows.find(r=>r.id===id));
    for(const key of ['snapshots','selectedAI','draft','adoption','adoptedId','pendingRequest','error','saved','dirty'])if(a[key]!==undefined)base[key]=a[key];
    base.running = false;
    admissions[id] ||= {sourceVersion:rows.find(r=>r.id===id).version,at:demoNow};
  }
} catch { /* Invalid browser cache must not prevent a fresh request. */ }
async function requestMaAi(r,a,body) {
  a.running=true; a.error=''; a.pendingRequest=body; saveMaAi();
  if (state.selected===r.id) renderAssessmentBody();
  const generation=assessmentGeneration;
  try {
    const response=await fetch('/api/quality-ui/assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(210000)});
    const result=await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'AI 请求失败');
    if (generation!==assessmentGeneration || assessments[r.id]!==a) return;
    const d=result.data,o=d.output;
    const matched=o.similarCases.map(c=>({case: d.retrievedCases.find(x=>x.caseId===c.caseId),reason:c.similarityReason}));
    const s={id:d.requestId,real:true,version:a.snapshots.length+1,sourceVersion:d.sourceVersion,
      at:new Date(d.createdAt).toLocaleString('zh-CN',{hour12:false}),model:d.model,rules:o.provenance.categoryDictionaryVersion,
      cases:o.provenance.caseLibraryVersion,taxonomy:o.provenance.categoryDictionaryVersion,promptVersion:d.promptVersion,
      primary:d.category.primary,secondary:d.category.secondary,risk:o.riskLevel,strength:'本次模型未单独评级',
      description:body.source.what||body.source.title,handling:o.handlingRecommendation,
      conclusion:'建议处理：'+maHandling[o.handlingRecommendation]+'。\n'+o.reasoningBasis.map(b=>b.statement).join('\n'),
      basis:o.reasoningBasis.map(b=>b.statement+'〔'+b.citationIds.join('、')+'〕'),
      missing:o.missingInformation.map(x=>x.field+'：'+x.reason).join('\n')||'本次未列出额外信息缺口。',
      uncertainty:o.uncertainties.map(x=>x.topic+'：'+x.reason).join('\n'),
      caseTitle:matched.map(x=>x.case?.title||'未命名历史案例').join('；')||'本次未引用相似案例',
      caseReason:matched.map(x=>x.reason).join('\n'),raw:structuredClone(d)};
    if (!a.snapshots.some(x=>x.id===s.id)) a.snapshots.push(s);
    a.selectedAI=s.id; a.pendingRequest=null;
    toast('原系统 AI 研判已生成，请核对后决定是否采纳。');
  } catch (error) {
    if (generation!==assessmentGeneration || assessments[r.id]!==a) return;
    a.error=error.name==='TimeoutError'?'等待 AI 响应超时；可刷新恢复请求，已有人工内容保留。':error.message;
    // Keep timed-out request ID for recovery without a second model call.
    if (error.name!=='TimeoutError' && error.name!=='TypeError') a.pendingRequest=null;
  } finally {
    if (assessments[r.id]===a) {a.running=false;saveMaAi();if(state.selected===r.id)renderAssessmentBody();}
  }
}
runAssessmentAI=async function(){
  const r=currentRow();if(!r||!admissions[r.id])return;
  const a=assessmentFor(r);if(a.running||a.finalized)return;
  await requestMaAi(r,a,a.pendingRequest||{requestId:crypto.randomUUID(),source:maSource(r)});
};
renderAI=function(r,a){
  const s=chosenSnapshot(a);
  const connected=maAiHealth?.connected;
  const status=maAiHealth===null?'正在检查 AI 连接':connected?'原系统 AI 已连接':'AI 服务未就绪';
  let body=a.running?'<div class="ai-empty" role="status"><span class="ai-loader"></span><h3>原系统 AI 正在研判…</h3><p>正在分析当前来源资料；你可以继续填写人工研判。</p></div>':!s?'<div class="ai-empty"><h3>资料已就绪，点击“AI 研判”开始分析</h3><p>使用原系统模型、分类字典与历史案例检索。</p></div>':
    `<div id="aiSnapshot" data-ai-id="${esc(s.id)}"><div class="ai-meta"><span>建议 V${s.version} · 来源 V${s.sourceVersion} · ${esc(s.at)}</span><span>${s.real?'真实 AI 生成':'历史演示建议'}</span></div>
    <div class="ai-facts">${textFact('建议分类',s.primary+' / '+s.secondary)}${textFact('建议风险',riskLabels[s.risk])}${s.handling?textFact('建议处理',maHandling[s.handling]):''}</div>
    <div class="ai-conclusion"><b>AI 原始结论</b><p style="white-space:pre-line">${esc(s.conclusion)}</p></div>
    <div class="ai-evidence"><section><h4>判断依据</h4><ul>${s.basis.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul><h4>信息缺口与不确定性</h4><p style="white-space:pre-line">${esc(s.missing)}</p><p style="white-space:pre-line">${esc(s.uncertainty)}</p></section>
    <section><h4>相似案例 · ${s.real?'原系统案例库':'历史演示资料'}</h4><b>${esc(s.caseTitle)}</b><p style="white-space:pre-line">${esc(s.caseReason)}</p>${s.real?(s.raw.output.citations.map(c=>'<p class="quiet">'+esc(c.citationId+' · '+c.description)+'</p>').join('')):''}</section></div>
    <details class="ai-provenance"><summary>建议来源与版本记录</summary><p>请求编号：${esc(s.id)}<br>模型：${esc(s.model)}<br>提示词：${esc(s.promptVersion||'演示')}<br>分类字典：${esc(s.taxonomy)}<br>案例库：${esc(s.cases)}${s.real?'<br>用时：'+(s.raw.durationMs/1000).toFixed(1)+' 秒 · Token：'+Number(s.raw.usage?.totalTokens||0):''}</p></details>
    ${!a.finalized?'<div class="ai-adoption"><span>将这份建议用于下方人工研判</span><button class="btn" data-adopt-ai="DIRECT">直接采纳</button><button class="btn" data-adopt-ai="MODIFIED">修改后采纳</button><button class="text-btn" data-adopt-ai="MANUAL">否决并自行判断</button></div>':''}</div>`;
  return `<section class="assessment-section ai-section"><div class="section-head"><div><span class="assessment-step">01 · 辅助建议</span><h3>AI 原始研判 <span class="tag">${esc(status)}</span></h3></div><div class="ai-tools">${a.snapshots.length>1?`<select id="aiSnapshotVersion" aria-label="AI 建议版本">${[...a.snapshots].reverse().map(x=>`<option value="${esc(x.id)}" ${s?.id===x.id?'selected':''}>建议 V${x.version} · ${x.real?'真实 AI':'历史演示'}</option>`).join('')}</select>`:''}${!a.finalized?`<button class="btn primary" data-run-ai ${a.running?'disabled':''}>${icon('refresh')}${a.running?'研判中…':a.pendingRequest?'恢复 AI 请求':s?'重新 AI 研判':'AI 研判'}</button>`:''}</div></div>${a.error?`<div class="form-error" role="alert">${esc(a.error)}</div>`:''}${body}<p class="demo-inline">当前事件为样例资料；新生成内容来自原系统 AI。附件仅提供元信息，未读取文件内容。</p></section>`;
};
document.querySelector('.prototype-bar>strong').textContent='AI 已接入原系统';
document.querySelector('.prototype-bar>span').textContent='事件及附件为样例 · AI 实时生成 · 人工研判独立保存';
const applyConnectedMaSuggestion=applySuggestion;
applySuggestion=function(mode){applyConnectedMaSuggestion(mode);saveMaAi();};
const saveConnectedMaAssessment=saveAssessment;
saveAssessment=function(){const result=saveConnectedMaAssessment();saveMaAi();return result;};
showGuide=function(){info('马荣鑫工作台 · AI 接入说明','<p>AI 研判已接入原系统 Qwen，使用同一提示词、分类字典、历史案例检索及结果校验。生成结果与人工草稿分别保存，刷新后仍可查看。</p><p>事件、部门和附件仍为界面样例，后续推送、任务及 OA 流程仍是本地交互。当前模型未读取附件正文。</p><ol><li>进入“待我研判”，打开记录并点击“AI 研判”。</li><li>查看真实分类、风险、建议处理、判断依据和信息缺口。</li><li>直接采纳、修改后采纳或自行判断；重新生成会保留旧 AI 版本和人工内容。</li></ol>');};
$('openGuide').onclick=showGuide;
document.addEventListener('input',e=>{if(e.target.closest('#assessmentForm'))queueMicrotask(saveMaAi);});
document.addEventListener('change',e=>{if(e.target.closest('#assessmentForm')||e.target.id==='aiSnapshotVersion')queueMicrotask(saveMaAi);});
document.addEventListener('click',()=>queueMicrotask(saveMaAi));
fetch('/api/quality-ui/status').then(r=>r.json()).then(r=>{maAiHealth=r.data||{connected:false};renderAssessmentBody();}).catch(()=>{maAiHealth={connected:false};renderAssessmentBody();});
for(const [id,a] of Object.entries(assessments)) if(a.pendingRequest&&!a.finalized)requestMaAi(rows.find(r=>r.id===id),a,a.pendingRequest);
