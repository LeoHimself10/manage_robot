'use strict';
// Standalone review prototype: no business API, model call, OA mutation or notification.
// Admission, AI snapshots, human assessment versions and formal reports have separate lifetimes.
const admissions = {};
const assessments = {};
let assessmentGeneration = 0;
const riskLabels = {LOW:'低', MEDIUM:'中', HIGH:'高'};
// Labels from the accepted system's HISTORICAL_FEEDBACK_TAXONOMY_V0 dictionary.
const assessmentCategories = {
 '导管本体':['断裂、折断与脱落','弯折、扭曲与旋转异常','通过性与头端形态','材料、涂层及其他导管问题'],
 '成像与光学表现':['成像暗或信号弱','模糊、颜色与伪影','图像抖动或NURD','无法成像或成像中断'],
 'PIU、连接与装载':['装载、识别与错误码','功率、0dB与光学耦合','对中、顶针、滑环及连接硬件'],
 '主机硬件与配件':['显示器与屏幕','电源、线缆与接口','机械结构与外部配件'],
 '软件与数据功能':['稳定性、重启与报错','数据、报告与测量','功能、界面、配置与网络'],
 '操作、培训与维护':['使用、连接、装载与校准','培训、维护与保养','运输、搬运与存储'],
 '临床与患者因素':['患者、血管与病变因素','临床安全与术式兼容性'],
 '包装、生产与供应':['包装、标签与外观','生产、装配与工艺','来料、供应商与材料'],
 '其他与待确认':['信息不足或无法判断','其他一般反馈']
};
const manualKeys = ['primary','secondary','risk','description','conclusion','changeReason'];
const comparedKeys = ['primary','secondary','risk','conclusion'];
const keyLabels = {primary:'一级分类',secondary:'二级分类',risk:'风险等级',conclusion:'研判结论'};
function newAssessment(r){return {snapshots:[],selectedAI:null,running:false,error:'',adoption:'MANUAL',adoptedId:null,saved:[],dirty:true,finalized:false,draft:{primary:'',secondary:'',risk:'',description:r.what||r.title,conclusion:'',changeReason:''}};}
function assessmentFor(r){return assessments[r.id]||(assessments[r.id]=newAssessment(r));}
function seedAdmissions(){
 assessmentGeneration++;
 viewState.lastAdmitted=null;
 Object.keys(admissions).forEach(k=>delete admissions[k]);
 Object.keys(assessments).forEach(k=>delete assessments[k]);
 for(const r of rows){
  if(['a1','a9'].includes(r.id)){r.review='未选入';continue;}
  admissions[r.id]={sourceVersion:r.version,at:r.date,by:'客服主管（演示）'};
  if(flows[r.id]||['普通反馈','待补资料'].includes(r.review)){
   const a=assessmentFor(r);a.finalized=true;
   a.draft.handling=flows[r.id]?'QUALITY_ANOMALY':r.review==='普通反馈'?'ORDINARY':'NEEDS_INFO';
   a.draft.conclusion=r.comment||(flows[r.id]?'已核对原始资料，确认通报质量异常，交由质量主管初析。':r.review==='普通反馈'?'现场核实后归为普通反馈，保存结论。':'请补充完整操作步骤、设备日志及现场确认。');
   a.draft.missing=a.draft.handling==='NEEDS_INFO'?a.draft.conclusion:'';
   a.saved.push({version:1,sourceVersion:r.updated?r.version-1:r.version,at:r.date,by:'客服主管（演示）',draft:structuredClone(a.draft),adoption:'MANUAL',aiId:null,seeded:true});a.dirty=false;
  }
 }
}
function decorateIntakeList(){
 document.querySelectorAll('#listContent [data-enter-event]').forEach(b=>b.remove());
 for(const tr of document.querySelectorAll('#listContent tr[data-row]')){
  const r=rows.find(x=>x.id===tr.dataset.row);if(!r)continue;
  if(!admissions[r.id])tr.querySelector('.event-id').textContent='OA 原始事件 · 尚未选入';
  else if(!flows[r.id])tr.querySelector('.event-id').textContent=r.review==='待研判'?'已选入 · 等待研判确认':'已选入 · '+r.review;
  if(state.scope!=='全部事件'&&admissions[r.id])tr.children[4].insertAdjacentHTML('beforeend',`<button class="text-btn event-row-link" data-open-assessment="${r.id}">${r.review==='待研判'?'开始研判':'查看处理记录'} ${icon('arrow')}</button>`);
 }
 if($('resultSummary'))$('resultSummary').innerHTML=`共 <strong>${filtered().length}</strong> 条${state.query?' · 搜索“'+esc(state.query)+'”':''}<span style="margin-left:14px">${state.scope==='全部事件'?'员工提交即接入此处；确认选入后才进入待我研判':state.scope==='待我研判'?'仅显示已确认选入、尚未确认处理结论的记录':'查看已保存的处理结果与进度'}</span>`;
 if($('queueNotice'))$('queueNotice').hidden=state.scope!=='待我研判'||!viewState.lastAdmitted;
}
function confirmIntake(id){
 const r=rows.find(x=>x.id===id);if(!r)return;
 if(admissions[id])return openAdmitted(id);
 info('确认进入质量事件',`<p class="confirm-lead">将这条事件加入你的<strong>待我研判</strong>？</p><div class="confirm-record"><b>${esc(r.title)}</b><p>OA ${r.no} · 来源 V${r.version}</p><p>${esc(r.person)} · ${r.date} · ${r.fileIds.length} 份原始附件</p></div><p>确认后进入质量事件的待研判环节，由你核对分类、风险和结论；完成研判后再推送质量主管初析。</p><button class="btn primary" data-confirm-intake="${id}">确认加入待我研判 ${icon('arrow')}</button>`);
 $('closeInfo').textContent='取消';
}
function admitRecord(id){
 const r=rows.find(x=>x.id===id);if(!r)return;
 if(admissions[id])return toast('该事件已选入，不会重复加入。');
 admissions[id]={sourceVersion:r.version,at:demoNow,by:'客服主管（演示）'};
 r.review='待研判';assessmentFor(r);viewState.lastAdmitted=id;
 $('infoDialog').close();setSurface('feedback');
 state.scope='待我研判';state.query='';state.page=1;state.selected=null;state.filters={};state.fileKind='全部';
 $('searchInput').value='';for(const id of ['approvalFilter','productFilter','attachmentFilter','dateFrom','dateTo','stageFilter'])$(id).value='';
 $('filterPanel').hidden=true;$('toggleFilters').setAttribute('aria-expanded','false');
 history.replaceState({maSurface:'feedback',feedback:snapshotFeedback(null)},'',feedbackUrl());
 renderList();renderDetail();
 $('queueNotice').innerHTML=`<div><b>已加入待我研判</b><p>${esc(r.title)} · 原始表单及 ${r.fileIds.length} 份附件已关联</p></div><button class="btn primary" data-open-assessment="${id}">开始 AI 与人工研判 ${icon('arrow')}</button>`;
 $('queueNotice').hidden=false;$('inbox').scrollIntoView({block:'start',behavior:'instant'});
 toast('已加入待我研判，尚未推送质量初析。');
}
function openAdmitted(id,tab){
 if(!admissions[id])return confirmIntake(id);
 if(viewState.surface==='event'){if(state.selected===id&&tab)goTab(tab);return;}
 viewState.lastAdmitted=null;
 const context=snapshotFeedback(id);viewState.feedbackContext=context;
 history.replaceState({maSurface:'feedback',record:id,feedback:context},'',feedbackUrl(id));
 history.pushState({maSurface:'event',record:id,feedback:context,enteredFromFeedback:true},'',eventUrl(id));
 displayEvent(id,tab);
}
function updateWorkspaceHeading(){
 const r=currentRow(),scope=viewState.feedbackContext?.scope||'全部事件';
 const pending=!flows[r.id];
 document.querySelector('.breadcrumb').innerHTML=`质量追踪 <span>/</span> <button class="breadcrumb-link" data-return-feedback>${esc(scope)}</button> <span>/</span> ${pending?'AI 与人工研判':esc(r.eventNo)}`;
 document.querySelector('.event-toolbar').innerHTML=`<button class="btn" data-return-feedback>← 返回${esc(scope)}</button><span class="quiet">${pending?'已进入质量事件 · 完成研判后推送质量初析':'质量事件 · 持续跟踪初析、分配、承办与验收'}</span>`;
 document.title=(pending?'待我研判':r.eventNo)+' · 客服主管 · 交互原型';
}
function snapshotFixture(r,n){
 const isCatheter=r.id==='a1',isImage=r.id==='a2',enough=isCatheter||isImage;
 const primary=isCatheter?'导管本体':isImage?'成像与光学表现':'其他与待确认';
 const secondary=isCatheter?'通过性与头端形态':isImage?'模糊、颜色与伪影':'信息不足或无法判断';
 return Object.freeze({id:`AI-DEMO-${r.id}-${n}`,version:n,sourceVersion:r.version,at:demoNow,model:'演示模型 · 未调用真实 AI',rules:'演示规则 V1',cases:'演示案例库 V1',taxonomy:'HISTORICAL_FEEDBACK_TAXONOMY_V0',primary,secondary,risk:'MEDIUM',strength:enough?'一般':'不足',description:r.what||r.title,conclusion:isCatheter?'现场反馈存在头端变形与推送受阻现象，初步归为通过性与头端形态问题；当前资料尚不能确定根因。':isImage?'现场反馈启动后图像间歇闪烁，初步归为成像表现异常；需结合日志和对照复测核实触发条件。':'当前记录不足以确定具体问题分类和根因；需结合补充的现场经过、日志及影响情况进一步分析。',basis:isCatheter?['WHAT 描述头端异常与推送受阻，优先按可观察现象分类。','来源关联现场照片、视频、服务日志与原始数据；本演示未解析文件内容。']:isImage?['描述主要指向成像表现，尚无证据确定具体部件根因。','来源关联视频和服务日志；仍需核对异常发生时段。']:['来源描述和关联资料不足以形成完整判断。','建议保留问题现象，补齐材料后再重新确认。'],missing:'需补充异常发生时的完整操作步骤、对照复测记录及实际影响确认。',uncertainty:'问题原因尚未确认；员工填写的影响程度不能直接等同最终风险等级。',caseTitle:isCatheter?'DEMO-CASE-01 · 推送受阻与头端形态异常':isImage?'DEMO-CASE-02 · 启动阶段图像闪烁':'暂无可引用的匹配案例',caseReason:isCatheter?'相似点：推送阻力与头端局部形态。差异：产品批次和触发条件仍待核实。':isImage?'相似点：启动阶段出现图像异常。差异：软件版本和复测条件仍待核实。':'补充资料后再检查是否存在可参考的历史案例。'});
}
function chosenSnapshot(a){return a.snapshots.find(s=>s.id===a.selectedAI)||a.snapshots.at(-1);}
function adoptedSnapshot(a){return a.snapshots.find(s=>s.id===a.adoptedId);}
function assessmentDiff(a){const s=adoptedSnapshot(a);return s?comparedKeys.filter(k=>a.draft[k]!==s[k]):[];}
function choiceOptions(values,selected,empty='请选择'){return `<option value="">${empty}</option>`+values.map(v=>`<option value="${esc(v)}" ${selected===v?'selected':''}>${esc(v)}</option>`).join('');}
function renderAI(r,a){
 const s=chosenSnapshot(a);
 let body;
 if(a.running)body='<div class="ai-empty" role="status"><span class="ai-loader"></span><h3>正在演示 AI 研判过程…</h3><p>按当前来源版本生成独立建议快照，人工填写内容继续保留。</p></div>';
 else if(!s)body='<div class="ai-empty"><h3>原始资料已就绪，尚未运行 AI 研判</h3><p>点击右上角“AI 研判”，查看分类、风险、判断依据与相似案例。<br>也可以直接填写下方人工研判。</p></div>';
 else body=`<div id="aiSnapshot" data-ai-id="${s.id}"><div class="ai-meta"><span>建议 V${s.version} · 引用来源 V${s.sourceVersion} · ${s.at}</span><span>证据充分性：${s.strength}</span></div><div class="ai-facts">${textFact('建议分类',s.primary+' / '+s.secondary)}${textFact('建议风险',riskLabels[s.risk])}</div><div class="ai-conclusion"><b>AI 原始结论</b><p>${esc(s.conclusion)}</p></div><div class="ai-evidence"><section><h4>判断依据</h4><ul>${s.basis.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><h4>信息缺口与不确定性</h4><p>${s.missing}</p><p>${s.uncertainty}</p></section><section><h4>相似案例 · 演示资料</h4><b>${s.caseTitle}</b><p>${s.caseReason}</p><button class="text-btn" data-show-ai-case>查看案例要点 ${icon('arrow')}</button></section></div><details class="ai-provenance"><summary>建议来源与版本记录</summary><p>${s.id} · ${s.model}<br>${s.rules} · ${s.cases}<br>分类字典：${s.taxonomy}<br>此处结果为预设演示建议，不代表真实模型分析。</p></details>${!a.finalized?`<div class="ai-adoption"><span>将这份建议用于下方人工研判</span><button class="btn" data-adopt-ai="DIRECT">直接采纳</button><button class="btn" data-adopt-ai="MODIFIED">修改后采纳</button><button class="text-btn" data-adopt-ai="MANUAL">否决并自行判断</button></div>`:''}</div>`;
 return `<section class="assessment-section ai-section"><div class="section-head"><div><span class="assessment-step">01 · 辅助建议</span><h3>AI 原始研判 <span class="tag">独立快照 · 只读</span></h3></div><div class="ai-tools">${a.snapshots.length>1?`<select id="aiSnapshotVersion" aria-label="AI 建议版本">${[...a.snapshots].reverse().map(x=>`<option value="${x.id}" ${s?.id===x.id?'selected':''}>建议 V${x.version}${x===a.snapshots.at(-1)?' · 最新':' · 历史'}</option>`).join('')}</select>`:''}${!a.finalized?`<button class="btn primary" data-run-ai ${a.running?'disabled':''}>${icon('refresh')}${s?'重新 AI 研判':'AI 研判'}<span class="button-demo">演示</span></button>`:''}</div></div>${body}<p class="demo-inline">仅演示交互：没有调用真实模型，也没有读取真实 OA 附件内容。</p></section>`;
}
function renderAssessment(r){
 if(!admissions[r.id])return emptyStage('请先确认选入','从全部事件核对详细资料，点击“进入质量事件”后才加入待我研判。');
 const a=assessmentFor(r),d=a.draft,last=a.saved.at(-1);
 const intro=`<div class="assessment-intro"><div><b>先 AI 辅助，再由你确认</b><p>已选入待我研判 · 来源 V${r.version} · ${admissions[r.id].at}。${a.finalized?'已保存处理结论。':'已进入质量事件，完成分类、风险和结论研判后，确认推送质量主管初析。'}</p></div><button class="btn" data-tab="attachments">${icon('clip')}查看原始附件 ${r.fileIds.length}</button></div>`;
 if(a.finalized)return intro+(a.snapshots.length?renderAI(r,a):`<div class="section-note">${icon('info')}这条既有演示记录未保留 AI 建议快照；下方只展示已有人工结论。</div>`)+`<section class="assessment-section"><div class="section-head"><h3>客服主管的最终研判 ${badge(r.review)}</h3><span class="quiet">人工 V${last?.version||1} · 引用来源 V${last?.sourceVersion||r.version}</span></div><p class="long-fact">${esc(d.conclusion)}</p>${d.primary?`<div class="facts-grid">${textFact('分类',d.primary+' / '+d.secondary)}${textFact('风险',riskLabels[d.risk])}${textFact('判断方式',a.adoption==='DIRECT'?'直接采纳 AI':a.adoption==='MODIFIED'?'修改后采纳':'人工填写')}</div>`:''}${d.changeReason?`<p>人工判断 / 修正原因：${esc(d.changeReason)}</p>`:''}${d.missing?`<div class="change-note">需补充：${esc(d.missing)}</div>`:''}<div class="assessment-next">${flows[r.id]?`<span>已关联 ${r.eventNo}，进入质量主管初析及后续处理。</span><button class="btn primary" data-tab="analysis">查看质量主管初析 ${icon('arrow')}</button>`:r.review==='待补资料'?`<span>${r.version>(last?.sourceVersion||r.version)?'OA 资料已更新为 V'+r.version+'；旧结论继续保留。':'等待员工补齐资料，保留原始表单与附件。'}</span>${r.version>(last?.sourceVersion||r.version)?'<button class="btn primary" data-reopen-assessment>按当前版本重新研判</button>':''}`:'<span>普通反馈已结束，未生成质量主管初析或承办任务。</span>'}</div>${renderHumanHistory(a)}</section>`;
 return intro+renderAI(r,a)+`<section class="assessment-section human-section"><div class="section-head"><div><span class="assessment-step">02 · 最终判断</span><h3>我的人工研判</h3></div><span id="adoptionStatus" class="tag blue">${adoptionLabel(a)}</span></div><p class="quiet">可采用 AI 建议，也可自行填写。人工修改不会覆盖上方 AI 原始快照。</p><form id="assessmentForm" novalidate><div class="assessment-fields"><label>一级分类 <em>*</em><select data-assessment-field="primary" aria-label="人工一级分类">${choiceOptions(Object.keys(assessmentCategories),d.primary)}</select></label><label>二级分类 <em>*</em><select data-assessment-field="secondary" aria-label="人工二级分类">${choiceOptions(assessmentCategories[d.primary]||[],d.secondary,'先选择一级分类')}</select></label><label>风险等级 <em>*</em><select data-assessment-field="risk" aria-label="人工风险等级"><option value="">请选择风险</option>${Object.entries(riskLabels).map(([k,v])=>`<option value="${k}" ${d.risk===k?'selected':''}>${v}</option>`).join('')}</select></label><label class="span-all">事实摘要 / 正式问题描述 <em>*</em><textarea data-assessment-field="description" rows="2" maxlength="2000">${esc(d.description)}</textarea></label><label class="span-all">研判结论 <em>*</em><textarea data-assessment-field="conclusion" rows="3" maxlength="2000" placeholder="结合来源事实，写明最终判断和依据">${esc(d.conclusion)}</textarea></label><label class="span-all" id="changeReasonField">人工判断 / 修正原因 <em id="reasonRequired">${a.adoption!=='DIRECT'||assessmentDiff(a).length?'*':''}</em><textarea data-assessment-field="changeReason" rows="2" maxlength="2000" placeholder="修改或否决 AI 建议时，说明依据；未使用 AI 时说明独立判断依据">${esc(d.changeReason)}</textarea></label></div><div id="assessmentDifferences" class="assessment-differences"></div><p class="form-error" id="assessmentError" role="alert" hidden></p><div class="assessment-save"><span class="quiet" id="assessmentSaveStatus">${last&&!a.dirty?'人工 V'+last.version+' 已保存，尚未推送质量初析。':'当前尚有未保存内容；保存不会推送质量主管初析。'}</span><button class="btn" type="button" data-save-assessment>保存研判</button></div></form></section><section class="assessment-section disposition-section"><span class="assessment-step">03 · 推送初析</span><h3>确认研判结果，再进入下一环节</h3><p id="dispositionText">${dispositionText()}</p><div class="assessment-next"><span id="dispositionHint" class="quiet">${last&&!a.dirty?'已保存人工 V'+last.version+'，请核对后确认。':'请先保存当前人工研判。'}</span><button class="btn primary" data-confirm-disposition ${!last||a.dirty?'disabled':''}>${dispositionLabel()} ${icon('arrow')}</button></div>${renderHumanHistory(a)}</section>`;
}
function adoptionLabel(a){return a.adoption==='DIRECT'?'直接采纳 AI · 建议 V'+(adoptedSnapshot(a)?.version||''):a.adoption==='MODIFIED'?'修改后采纳 AI':'人工独立判断';}
function dispositionLabel(){return '确认并推送质量初析';}
function dispositionText(){return '确认分类、风险与研判结论后，推送质量主管进行质量初析；本事件从待我研判移至跟踪处理中。';}
function renderHumanHistory(a){return a.saved.length?`<details class="human-history"><summary>人工研判版本记录 · ${a.saved.length} 版</summary>${[...a.saved].reverse().map(s=>`<article><b>人工 V${s.version}</b><small>${s.by} · ${s.at} · 来源 V${s.sourceVersion}${s.aiId?' · 引用 '+s.aiId:' · 人工填写'}</small><p>${esc(s.draft.conclusion)}</p>${s.draft.changeReason?`<p>原因：${esc(s.draft.changeReason)}</p>`:''}</article>`).join('')}</details>`:'';}
function renderAssessmentBody(){const r=currentRow();if(r&&state.tab==='review'){renderDetailContent(r);updateAssessmentDiff();}}
function updateAssessmentDiff(){
 const r=currentRow();if(!r||!$('assessmentForm'))return;
 const a=assessmentFor(r),diff=assessmentDiff(a);
 if($('adoptionStatus'))$('adoptionStatus').textContent=adoptionLabel(a);
 $('assessmentDifferences').innerHTML=diff.length?`与采用的 AI 快照不同：<b>${diff.map(k=>keyLabels[k]).join('、')}</b>。请说明修正原因。`:'';
 $('reasonRequired').textContent=a.adoption!=='DIRECT'||diff.length?'*':'';
 $('dispositionText').textContent=dispositionText();
 const button=document.querySelector('[data-confirm-disposition]');
 if(button){button.disabled=!a.saved.length||a.dirty;button.innerHTML=dispositionLabel()+' '+icon('arrow');}
 $('assessmentSaveStatus').textContent=a.dirty?'当前内容尚未保存；保存不会推送质量主管初析。':'人工 V'+a.saved.at(-1)?.version+' 已保存，尚未推送质量初析。';
 $('dispositionHint').textContent=a.dirty?'请先保存当前人工研判。':'已保存，可核对后确认。';
}
async function runAssessmentAI(){
 const r=currentRow();if(!r||!admissions[r.id])return;
 const a=assessmentFor(r);if(a.running||a.finalized)return;
 const generation=assessmentGeneration;a.running=true;renderAssessmentBody();
 await new Promise(resolve=>setTimeout(resolve,850));
 if(generation!==assessmentGeneration||assessments[r.id]!==a)return;
 const s=snapshotFixture(r,a.snapshots.length+1);a.snapshots.push(s);a.selectedAI=s.id;a.running=false;
 if(state.selected===r.id)renderAssessmentBody();toast('演示 AI 建议已生成；请选择采纳方式或自行填写人工结论。');
}
function applySuggestion(mode){
 const r=currentRow(),a=assessmentFor(r),s=chosenSnapshot(a);if(!s||a.finalized)return;
 a.adoption=mode;a.adoptedId=s.id;a.dirty=true;
 if(mode!=='MANUAL'){for(const k of ['primary','secondary','risk','description','conclusion'])a.draft[k]=s[k];a.draft.changeReason='';}
 renderAssessmentBody();$('assessmentForm')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function assessmentError(text){$('assessmentError').hidden=false;$('assessmentError').textContent=text;$('assessmentError').scrollIntoView({block:'center',behavior:'instant'});}
function validateAssessment(a){
 const d=a.draft;
 if(!d.primary||!d.secondary||!d.risk||!d.description.trim()||!d.conclusion.trim())return '请补全两级分类、风险、问题描述与研判结论。';
 if((a.adoption!=='DIRECT'||assessmentDiff(a).length)&&!d.changeReason.trim())return '请填写人工判断 / 修正原因，说明与 AI 建议不同的依据。';
 return '';
}
function saveAssessment(){
 const r=currentRow();if(!admissions[r.id])return;
 const a=assessmentFor(r);if(a.finalized)return;
 const error=validateAssessment(a);if(error)return assessmentError(error);
 if(!a.dirty&&a.saved.length)return toast('当前版本已保存，无需重复保存。');
 a.saved.push({version:a.saved.length+1,sourceVersion:r.version,at:demoNow,by:'客服主管（演示）',draft:structuredClone(a.draft),adoption:a.adoption,aiId:a.adoptedId});a.dirty=false;
 renderAssessmentBody();$('dispositionHint')?.scrollIntoView({block:'center',behavior:'instant'});
 toast('人工研判已保存；仍在待我研判，尚未推送初析。');
}
function confirmDisposition(){
 const r=currentRow(),a=assessmentFor(r),s=a.saved.at(-1);
 if(!s||a.dirty||a.finalized)return;
 if(s.sourceVersion!==r.version)return assessmentError('来源版本已变化，请重新核对并保存研判。');
 info(dispositionLabel()+' · 演示',`<div class="confirm-record"><b>${esc(r.title)}</b><p>OA ${r.no} · 来源 V${r.version} · 人工 V${s.version}</p><p>风险：${riskLabels[s.draft.risk]}</p><p>分类：${esc(s.draft.primary)} / ${esc(s.draft.secondary)}</p></div><p class="long-fact">${esc(s.draft.conclusion)}</p><p>${dispositionText()}</p><p class="quiet">仅更新本次原型会话，不向真实系统发送通知或提交数据。</p><button class="btn primary" data-submit-disposition="${r.id}" data-human-version="${s.version}">${dispositionLabel()}</button>`);
 $('closeInfo').textContent='暂不确认，保留已保存研判';
}
function commitDisposition(id,version){
 const r=rows.find(x=>x.id===id),a=r&&assessments[id],s=a?.saved.at(-1);
 if(!r||!s||a.dirty||a.finalized||s.version!==Number(version)||s.sourceVersion!==r.version)return;
 r.manualConclusion=s.draft.conclusion;r.review='已通报';a.finalized=true;
 if(r.review==='已通报'){
  r.eventNo='QT-DEMO-20260908-'+r.id.replace(/\D/g,'').padStart(3,'0');flows[id]=makeFlow(r,'analysis');flows[id].reviewTime=demoNow;flows[id].updated=demoNow;
  flows[id].activity=[{category:'研判',time:demoNow,person:'客服主管',title:'确认并推送质量初析',text:s.draft.conclusion,tab:'review'}];
 }
 $('infoDialog').close();
 // Recompute counts without moving the mounted event detail or replacing its persistent navigation.
 renderTabs();goTab(r.review==='已通报'?'overview':'review');
 const flow=$('detailFlow');if(flow)flow.innerHTML=phasePath(r);syncDetailNavigation();
 document.querySelector('#detail .detail-meta').innerHTML=`<span>OA 审批 ${r.no}</span><span>${esc(r.person)} · ${r.date}</span>${badge(r.approval,'approval')} ${badge(r.review)}`;
 document.querySelector('#detail .detail-eyebrow').innerHTML=`${r.eventNo?'质量事件 '+r.eventNo:'已保存人工结论'} ${tag('演示记录')}<span>来源 V${r.version}</span>`;
 updateWorkspaceHeading();$('detail').scrollIntoView({block:'start',behavior:'instant'});toast(r.review==='已通报'?'演示：已确认通报，等待质量主管初析。':'演示：处理结论已确认，移入'+(r.review==='待补资料'?'待补资料':'已结束')+'。');
}
function reopenAssessment(){
 const r=currentRow(),a=assessmentFor(r),s=a.saved.at(-1);if(r.review!=='待补资料'||!s||r.version<=s.sourceVersion)return;
 a.finalized=false;a.dirty=true;a.adoption='MANUAL';a.adoptedId=null;r.review='待研判';
 a.draft={...newAssessment(r).draft,primary:a.draft.primary,secondary:a.draft.secondary,risk:a.draft.risk};renderTabs();renderAssessmentBody();
 $('detailFlow').innerHTML=phasePath(r);syncDetailNavigation();document.querySelector('#detail .detail-meta').innerHTML='<span>OA 审批 '+r.no+'</span><span>'+esc(r.person)+' · '+r.date+'</span>'+badge(r.approval,'approval')+' '+badge(r.review);toast('已按新的来源版本进入重新研判，旧结论已保留。');
}
function initializeAssessmentUI(){
 $('inbox').insertAdjacentHTML('beforebegin','<div class="queue-notice" id="queueNotice" hidden role="status"></div>');
 document.querySelector('.subtitle').textContent='汇总员工提交的 OA 原始事件，确认选入后进入待我研判，再跟踪初析、分配与承办结果。';
 document.querySelector('.scope-summary p').innerHTML='<strong>处理顺序：</strong>全部事件核对资料 → 确认进入质量事件 → 待我研判（AI + 人工）→ 确认后续处理';
 document.querySelector('.search-tip').innerHTML='<span>支持 OA / 事件编号和尾号。试试 <button class="search-example" data-query="48912">48912</button>（尚未选入）或 <button class="search-example" data-query="45802">45802</button>（处理中）</span><span>全部事件的详情在当前行下方展开</span>';
 $('inboxTitle').textContent='事件与处理记录';
 showGuide=function(){info('客服主管视角 · 交互评审',`<p>所有数据与 AI 结果为演示；刷新恢复初始状态，未连接真实服务。</p><ol><li>在“全部事件”搜索 48912，核对详细表单和 4 份 OA 附件。</li><li>点击“进入质量事件”，取消不会选入；确认后加入待我研判。</li><li>在待我研判打开该事件，运行 AI 研判，选择直接采纳、修改后采纳或自行判断。</li><li>修改 AI 结论须说明原因。保存研判后，仍需确认并推送质量主管初析。</li><li>已通报的事件可查看初析、主管分配、员工承办与验收结果。</li></ol><div class="scenario-list"><button class="btn" data-scenario="a1">从未选入事件开始 · 48912 ${icon('arrow')}</button><button class="btn" data-scenario="a2">已选入待研判 · 51826 ${icon('arrow')}</button><button class="btn" data-scenario="a5">后续处理中 · 45802 ${icon('arrow')}</button><button class="btn" data-scenario="a10">待补资料已收到新版本 ${icon('arrow')}</button></div><button class="text-btn" data-reset-demo>重置全部演示状态</button>`);$('closeInfo').textContent='关闭';};
 $('openGuide').onclick=showGuide;
 if(viewState.surface==='event')updateWorkspaceHeading();
 renderTabs();
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||b.disabled)return;
 const keys=['confirmIntake','openAssessment','runAi','adoptAi','saveAssessment','confirmDisposition','submitDisposition','showAiCase','reopenAssessment'];
 if(!keys.some(k=>Object.hasOwn(b.dataset,k)))return;
 e.preventDefault();e.stopImmediatePropagation();
 if(b.dataset.confirmIntake)admitRecord(b.dataset.confirmIntake);
 if(b.dataset.openAssessment)openAdmitted(b.dataset.openAssessment);
 if(Object.hasOwn(b.dataset,'runAi'))runAssessmentAI();
 if(b.dataset.adoptAi)applySuggestion(b.dataset.adoptAi);
 if(Object.hasOwn(b.dataset,'saveAssessment'))saveAssessment();
 if(Object.hasOwn(b.dataset,'confirmDisposition'))confirmDisposition();
 if(b.dataset.submitDisposition)commitDisposition(b.dataset.submitDisposition,b.dataset.humanVersion);
 if(Object.hasOwn(b.dataset,'reopenAssessment'))reopenAssessment();
 if(Object.hasOwn(b.dataset,'showAiCase')){const s=chosenSnapshot(assessmentFor(currentRow()));info(s.caseTitle,`<p>${s.caseReason}</p><p>案例要点：先核对现场条件与原始证据，再确认分类和根因。此处仅为界面演示，没有检索真实案例库。</p>`);}
},true);
document.addEventListener('input',e=>{
 const key=e.target.dataset.assessmentField;if(!key||!manualKeys.includes(key))return;
 const a=assessmentFor(currentRow());a.draft[key]=e.target.value;a.dirty=true;
 if(key==='primary'){a.draft.secondary='';document.querySelector('[data-assessment-field="secondary"]').innerHTML=choiceOptions(assessmentCategories[a.draft.primary]||[],'');}
 if(a.adoption==='DIRECT'&&assessmentDiff(a).length)a.adoption='MODIFIED';
 if($('assessmentError'))$('assessmentError').hidden=true;updateAssessmentDiff();
});
document.addEventListener('change',e=>{if(e.target.id==='aiSnapshotVersion'){const a=assessmentFor(currentRow());a.selectedAI=e.target.value;renderAssessmentBody();}});
document.addEventListener('submit',e=>{if(e.target.id==='assessmentForm'){e.preventDefault();saveAssessment();}});
