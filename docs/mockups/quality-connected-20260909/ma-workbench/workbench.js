'use strict';
// This file only runs in the standalone HTML prototype. All names, results and files below are demo data.
const viewState={taskFilter:'全部任务',analysisVersion:null,auditTab:'evidence',activityFilter:'全部',reviewDrafts:{},evidence:null,viewedPhase:null,surface:'feedback',feedbackContext:null};
const originalContent=renderDetailContent;
const originalInfo=info;
info=function(title,body){$('closeInfo').textContent='知道了';originalInfo(title,body);};
const originalReset=reset;
const originalFiltered=filtered;
const demoNow='2026-09-08 15:00';
const modes={analysis:{label:'待佟成初析',index:2,owner:'佟成',next:'完成质量初析，明确处理要求和建议责任部门。'},assignment:{label:'待主管分配',index:3,owner:'测试主管',next:'主管在原任务系统确认任务、承办人和期限。'},active:{label:'员工处理中',index:4,owner:'测试员工2、测试员工3',next:'员工2补充复测证据；员工3确认承接抽样复核任务。'},quality:{label:'待质量终验',index:5,owner:'佟成',next:'主管验收已通过，等待佟成核对证据并填写终验结论。'},closed:{label:'已关闭',index:6,owner:'流程已结束',next:'终验结论、任务结果及历史证据均可追溯。'}};
const taskStatus={passed:['主管验收通过','green'],returned:['退回补充','amber'],pending:['待员工承接','blue'],active:['执行中','blue'],submitted:['待主管验收','blue']};
const flows={};
const stamp=(r,time='16:00')=>r.date.slice(0,10)+' '+time;
function tag(text,tone=''){return `<span class="tag ${tone}">${esc(text)}</span>`;}
function textFact(label,value){return fact(esc(label),value);}
function note(text){return `<div class="section-note">${icon('lock')}<span>${text}</span></div>`;}
function emptyStage(title,text,button=''){return `<div class="empty-stage">${icon('clock')}<h3>${title}</h3><p>${text}</p>${button}</div>`;}
function taskEvidence(id,name,person,taskTitle,returned=false){
 return {id,name,person,versions:[{version:1,time:'2026-09-08 10:30',result:returned?'主管退回，需补充':'主管验收通过',content:`${name}\n\n交互评审演示文件 · 不代表真实检测或业务结论\n\n所属任务：${taskTitle}\n提交人：${person}（演示）\n版本：V1\n\n一、执行内容\n按任务要求核对样例记录，整理检查范围及处理过程。\n\n二、检查结果\n本示例已记录检查项、执行人和检查时间。${returned?'\n复测记录缺少对照样本与复核签字，当前证据未通过验收。':'\n检查记录齐全，已完成主管要求的样例核验。'}\n\n三、附件归属\n本文件是后续任务证据，不是员工提交 OA 时的原始附件。\n\n说明：所有内容仅用于验证界面交互。`}]};
}
function makeFlow(r,mode){
 const packaging=r.id==='a5';
 const titles=packaging?['核对批次标签与出库记录','修正规则并补充复测记录','完成入库记录抽样复核']:['核对原始记录并定位问题','完成处理措施与复测','完成独立验证与结果复核'];
 const f={mode,manager:'测试主管',department:packaging?'生产部（演示）':'软件研发部（演示）',due:'2026-09-10 18:00',reviewTime:stamp(r),updated:'2026-09-08 14:10',analyses:[],tasks:[],activity:[],reopened:false};
 if(mode!=='analysis'){
  const a={version:1,author:'佟成',time:'2026-09-07 09:20',category:packaging?'包装与标签 / 信息一致性':'设备功能 / 稳定性',direction:packaging?'优先核对标签生成、装箱与出库复核环节。':'结合现场日志与复测结果定位异常触发条件。',facts:r.title+'；原始提交资料及附件保留在 OA 来源快照中。',basis:packaging?'比对原始照片与出库记录，当前存在标签信息不一致的线索。':'已阅读现场描述与原始附件，需通过测试复核问题。',conclusion:packaging?'初步指向标签信息校验环节，实际根因待追溯记录和复测确认。':'初步判断需要对异常条件进行复现，并核对记录完整性。',gap:packaging?'需补齐同批次出库记录、规则版本与独立复核结果。':'需补齐复现步骤、对照记录和独立验证结果。',requirements:packaging?'追溯涉及批次；核对标签规则；提交修正前后对照与复测证据。':'完成问题定位、处理措施、复测和独立验证，逐项上传任务证据。',department:f.department,due:f.due};
  f.analyses.push(a);
  if(mode!=='assignment')f.analyses.push({...a,version:2,time:'2026-09-07 11:00',requirements:a.requirements+'\n新增：复测记录须包含对照样本和复核签字。',reason:'补充证据要求，确保主管验收时可以逐项核对。',sync:'测试主管于 09-07 14:00 将新增要求确认写入正式任务。'});
 }
 if(!['analysis','assignment'].includes(mode)){
  f.tasks=titles.map((title,i)=>{
   const status=mode==='active'?['passed','returned','pending'][i]:'passed';
   const task={id:r.id+'-t'+(i+1),title,person:'测试员工'+(i+1),status,due:'2026-09-'+(i===1?'09':'10')+' 18:00',assigned:'2026-09-07 14:00',accepted:status==='pending'?null:'2026-09-07 '+(i===0?'14:22':'14:38'),progress:status==='pending'?0:status==='returned'?60:100,requirement:(packaging?['追溯涉及批次，对照标签、装箱与出库记录，提交差异核对清单。','核对标签校验规则，补充修正前后对照、复测样本和复核签字。','按确认的抽样范围完成入库记录复核，记录差异与独立复核结果。']:['核对现场描述与日志，提交定位依据和检查记录。','根据定位结果执行处理措施，提交处理前后对照和复测记录。','独立复核处理结果，提交验证范围、方法和结论。'])[i],acceptance:(packaging?['涉及批次及记录可追溯，差异项逐条说明。','复测样本、对照结果及复核签字完整，可重复核对。','抽样范围明确，核对结果经独立复核。']:['定位依据与原始事实对应。','措施与复测记录完整，结果可复核。','验证方法及结论完整，复核人明确。'])[i],dependency:'无正式依赖，与其他任务并行开展。',update:status==='pending'?'任务已发放，等待员工确认承接。':status==='returned'?'已完成规则核对与第一轮复测，正在补充对照样本和复核签字。':'已完成任务要求，结果和检查记录已提交。',submitted:status==='pending'?null:'2026-09-08 '+(i===0?'10:30':'13:40'),supervisor:status==='returned'?'复测结果缺少对照样本与复核签字，请补齐后重新提交。':status==='pending'?'员工尚未承接，未进入验收。':'已核对任务要求与提交证据，本项验收通过。',reviewed:status==='pending'?null:'2026-09-08 '+(i===0?'11:15':'14:10'),evidence:[]};
   if(status!=='pending')task.evidence.push(taskEvidence(task.id+'-e1',packaging?['批次追溯核对记录.txt','规则复测记录.txt','抽样复核记录.txt'][i]:['定位检查记录.txt','处理复测记录.txt','独立验证记录.txt'][i],task.person,title,status==='returned'));
   return task;
  });
 }
 f.activity=[{category:'研判',time:f.reviewTime,person:'马荣鑫',title:'通报为质量异常',text:'已保存人工研判，关联质量事件 '+r.eventNo+'。',tab:'review'}];
 if(f.analyses.length)f.activity.push({category:'初析',time:'2026-09-07 09:20',person:'佟成',title:'完成质量初析 V1',text:'提出问题方向、建议责任部门和处理要求。',tab:'analysis'});
 if(f.analyses.length>1)f.activity.push({category:'初析',time:'2026-09-07 11:00',person:'佟成',title:'发布初析 V2',text:'补充复测证据要求；V1 继续保留。',tab:'analysis'});
 if(f.tasks.length)f.activity.push({category:'分配',time:'2026-09-07 14:00',person:'测试主管',title:'确认并发放 3 项正式任务',text:'已确认承办人、任务要求和期限。',tab:'tasks'});
 for(const t of f.tasks){if(t.accepted)f.activity.push({category:'承办',time:t.accepted,person:t.person,title:'承接任务：'+t.title,text:'员工确认承接，进入执行。',taskId:t.id});if(t.reviewed)f.activity.push({category:'验收',time:t.reviewed,person:f.manager,title:t.status==='returned'?'退回补充：'+t.title:'验收通过：'+t.title,text:t.supervisor,taskId:t.id});}
 if(mode==='quality')f.activity.push({category:'验收',time:'2026-09-08 14:25',person:f.manager,title:'全部任务通过主管验收',text:'已汇总证据，送交佟成进行质量终验。',tab:'audit'});
 if(mode==='closed'){f.closedAt='2026-09-08 14:40';f.final='处理措施和验证记录已经核对，主管验收通过；佟成完成质量终验并关闭事件。';f.activity.push({category:'终验',time:f.closedAt,person:'佟成',title:'质量终验通过，事件关闭',text:f.final,tab:'audit'});}
 return f;
}
function seedFlows(){
 Object.keys(flows).forEach(k=>delete flows[k]);
 for(const [id,mode] of [['a5','active'],['a4','analysis'],['a11','assignment'],['a7','quality'],['a12','closed']]){const r=rows.find(r=>r.id===id);r.review='已通报';r.eventNo=r.eventNo||'QT-DEMO-'+r.date.slice(0,10).replaceAll('-','')+'-'+id.slice(1).padStart(3,'0');flows[id]=makeFlow(r,mode);}
 seedFlowExamples();
 seedAdmissions();
 seedExampleAssessment();
}
seedFlows();
scopes.splice(0,scopes.length,'全部事件','待我研判','待补资料','跟踪处理中','已结束');
matchScope=function(r){return state.scope==='全部事件'||state.scope==='待我研判'&&!!admissions[r.id]&&r.review==='待研判'||state.scope==='待补资料'&&r.review==='待补资料'||state.scope==='跟踪处理中'&&flows[r.id]&&flows[r.id].mode!=='closed'||state.scope==='已结束'&&(r.review==='普通反馈'||flows[r.id]?.mode==='closed');};
filtered=function(){return originalFiltered().filter(r=>!state.filters.stage||(state.filters.stage==='unreported'?!flows[r.id]:flows[r.id]?.mode===state.filters.stage));};
renderTabs=function(){const current=state.scope;const counts={};for(const s of scopes){state.scope=s;counts[s]=rows.filter(matchScope).length;}state.scope=current;$('scopeTabs').innerHTML=scopes.map(s=>`<button role="tab" aria-selected="${s===current}" class="tab" data-scope="${s}">${s}<span class="count">${counts[s]}</span></button>`).join('');};
function stageLabel(r){if(!admissions[r.id])return '尚未选入研判';return flows[r.id]?modes[flows[r.id].mode].label:r.review==='普通反馈'?'普通反馈已结束':r.review==='待补资料'?'等待补充资料':'等待马荣鑫研判';}
function stageOwner(r){if(!admissions[r.id])return '查看详情后确认选入';const f=flows[r.id];if(f?.mode==='active')return [...new Set(f.tasks.filter(t=>t.status!=='passed').map(t=>t.status==='submitted'?f.manager:t.person))].join('、');return f?modes[f.mode].owner:r.review==='待补资料'?r.person:r.review==='普通反馈'?'研判已完成':'马荣鑫';}
function nextStep(f){if(f.mode!=='active')return modes[f.mode].next;return f.tasks.filter(t=>t.status!=='passed').map(t=>t.status==='submitted'?f.manager+'验收'+t.person+'的提交':t.person+(t.status==='returned'?'补充证据':t.status==='pending'?'确认承接':'继续执行')).join('；')+'。';}
renderList=function(){
 if($('detail'))$('detailStore').appendChild($('detail'));renderTabs();const list=filtered(),pages=Math.max(1,Math.ceil(list.length/state.pageSize));state.page=Math.min(state.page,pages);$('clearSearch').hidden=!$('searchInput').value;$('resetFilters').hidden=!hasFilters();
 $('resultSummary').innerHTML=`共 <strong>${list.length}</strong> 条反馈${state.query?' · 搜索“'+esc(state.query)+'”':''}<span style="margin-left:12px">OA 审批、研判和后续处理分别展示</span>`;
 if(!list.length){$('listContent').innerHTML=emptyStage('没有匹配的反馈','试试审批编号或事件编号尾号，或清除筛选。','<button class="btn" data-action="reset">清空筛选</button>');$('pagination').hidden=true;return;}
 $('pagination').hidden=false;const current=list.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
 $('listContent').innerHTML=`<div class="table-wrap"><table aria-label="马荣鑫反馈与处理进度列表"><colgroup><col style="width:20%"><col style="width:23%"><col style="width:13%"><col style="width:13%"><col style="width:21%"><col style="width:10%"></colgroup><thead><tr><th>OA 编号 / 质量事件</th><th>反馈摘要 / 产品</th><th>提交人 / 时间</th><th>OA / 研判状态</th><th>当前处理 / 处理人</th><th>OA 附件</th></tr></thead><tbody>${current.map(r=>{const f=flows[r.id];return `<tr data-row="${r.id}" class="${state.selected===r.id?'selected':''}" aria-selected="${state.selected===r.id}"><td><button class="approval-link" data-select="${r.id}" aria-expanded="${state.selected===r.id}" aria-controls="detail">${icon('chevron')}${highlight(r.no)}</button><span class="event-id">${r.eventNo?highlight(r.eventNo):'尚未通报质量事件'}</span>${r.updated?'<span class="cell-sub">资料已更新 · V'+r.version+'</span>':''}</td><td><span class="summary-title">${highlight(r.title)}</span><div class="cell-sub">${r.product} · ${highlight(r.model)}</div></td><td>${esc(r.person)}<div class="cell-sub">${r.date}</div></td><td>${badge(r.approval,'approval')}<div style="margin-top:6px">${badge(r.review)}</div></td><td><span class="stage-button">${stageLabel(r)}</span><div class="stage-owner ${f?.tasks.some(t=>t.status==='returned')?'stage-alert':''}">${esc(stageOwner(r))}</div>${f?`<button class="text-btn event-row-link" data-enter-event="${r.id}">进入质量事件 ${icon('arrow')}</button>`:''}</td><td><button class="attachment-count ${r.fileIds.length?'':'none'}" data-attachments="${r.id}" aria-label="查看 ${r.no} 的原始附件">${icon('clip')}${r.fileIds.length} 份</button></td></tr>${state.selected===r.id?`<tr class="detail-row" data-detail-for="${r.id}"><td colspan="6"><div id="inlineDetailMount"></div></td></tr>`:''}`;}).join('')}</tbody></table></div>`;
 if($('inlineDetailMount'))$('inlineDetailMount').appendChild($('detail'));
 $('pagination').innerHTML=`<span>当前 ${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,list.length)} 条 · 每页 ${state.pageSize} 条</span><div class="pages"><button class="page-btn" data-page="${state.page-1}" aria-label="上一页" ${state.page===1?'disabled':''}>‹</button>${Array.from({length:pages},(_,i)=>`<button class="page-btn ${state.page===i+1?'active':''}" data-page="${i+1}" ${state.page===i+1?'aria-current="page"':''}>${i+1}</button>`).join('')}<button class="page-btn" data-page="${state.page+1}" aria-label="下一页" ${state.page===pages?'disabled':''}>›</button></div>`;
 document.querySelectorAll('.approval-link>.icon').forEach(e=>e.classList.add('row-chevron'));
};
const baseWorkbenchList=renderList;
renderList=function(){baseWorkbenchList();decorateIntakeList();};
const originalSelect=selectRecord;
selectRecord=function(id,tab){
 if(viewState.surface==='feedback'&&state.scope!=='全部事件'&&admissions[id]){openAdmitted(id,['attachments','form','history'].includes(tab)?tab:undefined);return;}
 if(viewState.surface==='feedback'&&!['attachments','form','history'].includes(tab))tab='form';
 if(state.selected!==id){viewState.analysisVersion=null;viewState.taskFilter='全部任务';viewState.activityFilter='全部';viewState.auditTab='evidence';viewState.viewedPhase=null;}
 originalSelect(id,tab);
};
reset=function(){if(viewState.surface==='event'){setSurface('feedback');history.replaceState({maSurface:'feedback'},'',feedbackUrl());}originalReset();if($('stageFilter'))$('stageFilter').value='';};
function currentRow(){return rows.find(r=>r.id===state.selected);}
const detailLabels={overview:'处理总览',attachments:'OA 附件',form:'原始表单',history:'审批与版本',review:'我的研判',analysis:'佟成初析',tasks:'分配与承办',audit:'验收与动态'};
function viewedPhaseForTab(tab){return tab==='overview'?null:['attachments','form','history'].includes(tab)?0:tab==='review'?1:tab==='analysis'?2:tab==='tasks'?(viewState.viewedPhase===4?4:3):5;}
function syncDetailNavigation(){
 const raw=['attachments','form','history'].includes(state.tab);
 document.querySelectorAll('#detail .detail-tabs [data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===state.tab||viewState.surface==='event'&&b.dataset.tab==='attachments'&&raw)));
 viewState.viewedPhase=viewedPhaseForTab(state.tab);
 document.querySelectorAll('#detail [data-phase]').forEach(b=>{const viewed=Number(b.dataset.phase)===viewState.viewedPhase;b.classList.toggle('viewed',viewed);b.setAttribute('aria-pressed',String(viewed));});
 if($('flowViewing'))$('flowViewing').textContent='正在查看：'+detailLabels[state.tab];
 $('detailContent').setAttribute('aria-label',detailLabels[state.tab]);
}
function detailFooter(r){
 if(viewState.surface==='feedback')return `<p>${admissions[r.id]?'已选入质量处理；再次进入将打开当前研判或处理记录。':'确认选入后才加入“待我研判”，由 AI 辅助、马荣鑫作最终判断。'}</p><div class="footer-actions"><button class="btn primary" data-enter-event="${r.id}">进入质量事件 ${icon('arrow')}</button></div>`;
 return '<p>来源事实、AI 建议与人工结论分别保留；后续处理结果可持续跟踪。</p><div class="footer-actions"><button class="btn" data-action="oa">'+icon('out')+'查看 OA 原单</button>'+(state.tab!=='overview'?'<button class="btn" data-tab="overview">返回处理总览</button>':'')+'</div>';
}
function goTab(tab){
 const r=currentRow();if(!r)return;
 if(viewState.surface==='feedback'&&!['attachments','form','history'].includes(tab))return;
 const navigation=viewState.surface==='event'?$('detailFlow'):document.querySelector('#detail .detail-tabs');
 // A phase click takes over from any still-running smooth scroll used to open the row.
 if(navigation)window.scrollTo({top:window.scrollY,left:window.scrollX,behavior:'instant'});
 const previousTop=navigation?.getBoundingClientRect().top;
 state.tab=tab;
 if(!navigation){renderDetail();return;}
 // Keep the selected row, heading, tabs and phase buttons mounted; replace only the content below.
 syncDetailNavigation();renderDetailContent(r);
 document.querySelector('#detail .detail-footer').innerHTML=detailFooter(r);
 const delta=navigation.getBoundingClientRect().top-previousTop;
 if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'});
}
renderDetail=function(){
 const r=currentRow(),mount=viewState.surface==='event'?$('eventDetailMount'):$('inlineDetailMount');if(!r||!mount){$('detailStore').appendChild($('detail'));$('detail').innerHTML='';return;}mount.appendChild($('detail'));$('detail').className='detail panel';
 if(viewState.surface==='feedback'){renderFeedbackDetail(r);return;}
 const f=flows[r.id],raw=['attachments','form','history'].includes(state.tab),tabs=[['overview','处理总览'],['attachments','OA 原始资料'],['review','我的研判'],['analysis','佟成初析'],['tasks','分配与承办'],['audit','验收与动态']];
 $('detail').innerHTML=`<header class="detail-heading"><div><div class="detail-eyebrow"><span>${f?'质量事件 '+r.eventNo:'质量处理 · '+r.review}</span>${tag('演示记录')}<span>来源 V${r.version}</span></div><h2 class="detail-title">${esc(r.title)}</h2><div class="detail-meta"><span>OA 审批 ${r.no}</span><span>${esc(r.person)} · ${r.date}</span><span>${badge(r.approval,'approval')} ${badge(r.review)}</span></div></div><div class="detail-tools"><button class="text-btn" data-action="copy-number">${icon('copy')}复制 OA 编号</button><button class="text-btn muted" data-action="back">${icon('up')}收起详情</button></div></header><div class="detail-tabs"><div class="tabs" role="tablist" aria-label="反馈及后续处理">${tabs.map(([id,label])=>`<button class="tab" role="tab" aria-selected="${id===state.tab||id==='attachments'&&raw}" data-tab="${id}">${label}${id==='attachments'?'<span class="count">'+r.fileIds.length+'</span>':''}</button>`).join('')}</div></div><div class="detail-flow" id="detailFlow">${phasePath(r)}</div><div class="detail-content" id="detailContent" role="region"></div><footer class="detail-footer"><p>${f?'后续处理由各环节负责人完成；马荣鑫在此查看结果与进度。':'员工提交即接入；正式通报后，继续在同一条记录中跟踪处理。'}</p><div class="footer-actions"><button class="btn" data-action="oa">${icon('out')}查看 OA 原单</button>${state.tab!=='overview'?'<button class="btn" data-tab="overview">返回处理总览</button>':!f&&r.review!=='普通反馈'?'<button class="btn primary" data-tab="review">'+(r.review==='待补资料'?'查看补充要求':'进入人工研判')+icon('arrow')+'</button>':''}</div></footer>`;
 document.querySelector('#detail .detail-tools [data-action="back"]')?.remove();
 document.querySelector('#detail .detail-footer').innerHTML=detailFooter(r);
 syncDetailNavigation();renderDetailContent(r);
 renderExampleControls(r);
};
function renderFeedbackDetail(r){
 if(!['attachments','form','history'].includes(state.tab))state.tab='form';
 $('detail').innerHTML=`<header class="detail-heading"><div><div class="detail-eyebrow"><span>OA 原始事件</span>${tag('来源只读')}<span>V${r.version}</span></div><h2 class="detail-title">${esc(r.title)}</h2><div class="detail-meta"><span>OA 审批 ${r.no}</span><span>${esc(r.person)} · ${r.date}</span>${badge(r.approval,'approval')} ${tag(admissions[r.id]?'已选入质量处理':'尚未选入研判')}</div></div><div class="detail-tools"><button class="text-btn" data-action="copy-number">${icon('copy')}复制编号</button><button class="text-btn muted" data-action="back">${icon('up')}收起详情</button></div></header><div class="detail-tabs"><div class="tabs" role="tablist" aria-label="原始事件资料">${[['form','详细事件'],['attachments','OA 附件 '+r.fileIds.length],['history','审批与版本']].map(([id,label])=>`<button class="tab" role="tab" data-tab="${id}">${label}</button>`).join('')}</div><span class="quiet">先核对资料，再确认选入</span></div><div class="detail-content" id="detailContent" role="region"></div><footer class="detail-footer">${detailFooter(r)}</footer>`;
 syncDetailNavigation();renderDetailContent(r);
}
function feedbackUrl(record){const url=new URL(location.href);url.searchParams.delete('view');if(record)url.searchParams.set('record',record);else url.searchParams.delete('record');return url.pathname+url.search;}
function eventUrl(record){const url=new URL(location.href);url.searchParams.set('record',record);url.searchParams.set('view','event');return url.pathname+url.search;}
function setSurface(surface){
 viewState.surface=surface;const event=surface==='event';document.body.classList.toggle('event-surface',event);
 if($('eventWorkspace'))$('eventWorkspace').hidden=!event;
 document.querySelector('.breadcrumb').innerHTML=event?'质量追踪 <span style="margin:0 8px">/</span> <button class="breadcrumb-link" data-return-feedback>全部事件</button> <span style="margin:0 8px">/</span> 质量事件':'质量追踪 <span style="margin:0 8px">/</span> 全部事件';
 document.title=event?'质量事件 '+(currentRow()?.eventNo||'')+' · 马荣鑫视角':'全部事件 · 马荣鑫工作台 · 交互原型';
}
function snapshotFeedback(record){return {scope:state.scope,query:state.query,page:state.page,selected:record,tab:state.selected===record&&['attachments','form','history'].includes(state.tab)?state.tab:'form',fileKind:state.fileKind,filters:structuredClone(state.filters),filtersOpen:!$('filterPanel').hidden,scrollY:window.scrollY};}
function displayEvent(record,tab){
 if(!admissions[record])return false;
 state.selected=record;state.tab=tab||(flows[record]?'overview':'review');viewState.viewedPhase=null;viewState.analysisVersion=null;viewState.taskFilter='全部任务';viewState.auditTab='evidence';viewState.activityFilter='全部';
 setSurface('event');renderDetail();updateWorkspaceHeading();window.scrollTo({top:0,behavior:'instant'});return true;
}
function enterEvent(record){if(admissions[record])openAdmitted(record);else confirmIntake(record);}
function displayFeedback(context){
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());setSurface('feedback');
 const c=context||{};state.scope=c.scope==='全部反馈'?'全部事件':c.scope||'全部事件';state.query=c.query||'';state.page=c.page||1;state.selected=c.selected||null;state.tab=c.tab||'attachments';if(state.scope!=='全部事件')state.selected=null;state.fileKind=c.fileKind||'全部';state.filters=c.filters||{approval:'',product:'',attachment:'',from:'',to:'',stage:''};
 $('searchInput').value=state.query;
 for(const [id,key] of [['approvalFilter','approval'],['productFilter','product'],['attachmentFilter','attachment'],['dateFrom','from'],['dateTo','to'],['stageFilter','stage']])$(id).value=state.filters[key]||'';
 $('filterPanel').hidden=!c.filtersOpen;$('toggleFilters').setAttribute('aria-expanded',String(!!c.filtersOpen));
 renderList();renderDetail();
 requestAnimationFrame(()=>window.scrollTo({top:Math.max(0,Number(c.scrollY)||0),behavior:'instant'}));
}
function returnToFeedback(){
 if(viewState.surface!=='event')return;
 if(history.state?.enteredFromFeedback){history.back();return;}
 const context=viewState.feedbackContext||{selected:state.selected,page:Math.floor(rows.findIndex(r=>r.id===state.selected)/state.pageSize)+1};
 history.replaceState({maSurface:'feedback',record:context.selected,feedback:context},'',feedbackUrl(context.selected));displayFeedback(context);
}
function initializeEventNavigation(){
 $('detailStore').insertAdjacentHTML('beforebegin',`<section id="eventWorkspace" hidden aria-label="质量事件详情"><div class="event-toolbar"><button class="btn" data-return-feedback><span style="display:inline-flex;transform:rotate(180deg)">${icon('arrow')}</span>返回全部事件</button><span class="quiet">质量事件详情 · 查看本事件的后续处理</span></div><div id="eventDetailMount"></div></section>`);
 history.scrollRestoration='manual';
 const params=new URLSearchParams(location.search),record=params.get('record'),saved=history.state;
 if(params.get('view')==='event'&&admissions[record]){viewState.feedbackContext=saved?.feedback||{selected:record,page:Math.floor(rows.findIndex(r=>r.id===record)/state.pageSize)+1};history.replaceState({...saved,maSurface:'event',record,feedback:viewState.feedbackContext},'',eventUrl(record));displayEvent(record);}
 else{setSurface('feedback');if(record&&rows.some(r=>r.id===record))selectRecord(record,'form');history.replaceState({maSurface:'feedback',record},'',feedbackUrl(record));}
 window.addEventListener('popstate',event=>{const route=event.state;if(route?.maSurface==='event'&&admissions[route.record]){viewState.feedbackContext=route.feedback;displayEvent(route.record);}else displayFeedback(route?.feedback||viewState.feedbackContext);});
}
function phasePath(r){
 const f=flows[r.id],ordinary=r.review==='普通反馈',ix=f?modes[f.mode].index:ordinary?2:1;
 const phases=[['提交接入','attachments','员工 / OA'],['AI 与人工研判','review','马荣鑫'],['质量初析','analysis','佟成'],['任务分配','tasks','主管'],['员工承办','tasks','承办员工'],['质量终验','audit','佟成']];
 return `<div class="flow-context"><span>业务进度：${stageLabel(r)}</span><span id="flowViewing">正在查看：${detailLabels[state.tab]}</span></div><nav class="phase-path" aria-label="处理流程，可切换查看各阶段">${phases.map(([label,tab,who],i)=>`<button class="phase ${i<ix?'done':i===ix&&!ordinary?'current':''}" data-phase="${i}" data-phase-tab="${tab}" aria-controls="detailContent" aria-pressed="false" ${i===ix&&!ordinary?'aria-current="step"':''}><span class="phase-number">${i<ix?icon('check'):i+1}</span><span><b>${label}</b><small>${who}</small></span></button>`).join('')}</nav>`;
}
function renderOverview(r){const f=flows[r.id];if(!f)return `<div class="status-banner"><div><span class="eyebrow">当前处理</span><h3>${stageLabel(r)}</h3><p>${r.review==='普通反馈'?'本次研判结论为普通反馈，来源与附件继续保留。':r.review==='待补资料'?'已发出补充要求；OA 新资料到达后，应重新核对来源版本。':'可先核对员工提交的资料，再保存自己的人工研判。'}</p></div><button class="btn primary" data-tab="review">${r.review==='待研判'?'进入人工研判':'查看研判记录'}${icon('arrow')}</button></div><div class="overview-grid"><section><div class="section-head"><h3>原始反馈</h3><button class="text-btn" data-tab="attachments">查看 ${r.fileIds.length} 份 OA 附件</button></div><div class="overview-summary"><p>${esc(r.what||r.title)}</p><div class="facts-grid">${textFact('提交人',r.person)}${textFact('产品',r.product+' / '+r.model)}${textFact('来源版本','V'+r.version)}</div></div></section><section><div class="section-head"><h3>后续处理</h3></div>${emptyStage('尚未进入质量初析',r.review==='普通反馈'?'普通反馈已结束，本条没有后续分配与承办任务。':'完成研判并确认推送初析后，佟成初析、主管分配和员工承办结果会持续关联到这里。')}</section></div>`;
 const counts={passed:f.tasks.filter(t=>t.status==='passed').length,returned:f.tasks.filter(t=>t.status==='returned').length,pending:f.tasks.filter(t=>t.status==='pending').length};const latest=f.analyses.at(-1);const sorted=[...f.activity].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,3);
 return `<div class="status-banner"><div><span class="eyebrow">${f.mode==='closed'?'归档结果':'当前处理 · '+esc(stageOwner(r))}</span><h3>${modes[f.mode].label}${counts.returned?tag(counts.returned+' 项需补充','amber'):''}</h3><p>${esc(nextStep(f))}</p></div><button class="btn primary" ${f.mode==='quality'||f.mode==='closed'?'data-audit-tab="results"':'data-tab="'+(f.mode==='analysis'?'analysis':'tasks')+'"'}>${f.mode==='analysis'?'查看初析进度':f.mode==='quality'||f.mode==='closed'?'查看验收结果':'查看分配与承办'}${icon('arrow')}</button></div><div class="overview-grid"><section><div class="section-head"><h3>处理结果摘要</h3><span class="quiet">截至 ${f.updated} · 演示</span></div><div class="overview-summary"><p><strong>佟成初析：</strong>${latest?esc(latest.conclusion):'已进入待初析队列，尚未提交初析结果。'}</p><p><strong>分配与承办：</strong>${f.tasks.length?`共 ${f.tasks.length} 项任务，${counts.passed} 项通过主管验收${counts.returned?'，'+counts.returned+' 项退回补充':''}${counts.pending?'，'+counts.pending+' 项待员工承接':''}${f.tasks.some(t=>t.status==='submitted')?'，'+f.tasks.filter(t=>t.status==='submitted').length+' 项待主管验收':''}${f.tasks.some(t=>t.status==='active')?'，'+f.tasks.filter(t=>t.status==='active').length+' 项执行中':''}。`:'主管尚未发放员工任务。'}</p><p><strong>质量终验：</strong>${f.mode==='closed'?'佟成已通过终验，事件已关闭。':f.mode==='quality'?'已具备主管验收结果，等待质量终验。':'尚未进入质量终验。'}</p><div class="facts-grid">${textFact('主管',f.tasks.length?f.manager:'待确认分配')}${textFact('处理期限',latest?f.due:'初析后确认')}${textFact('已通过 / 总任务',f.tasks.length?counts.passed+' / '+f.tasks.length:'尚未分配')}</div></div><div class="section-head" style="margin-top:22px"><h3>需要关注</h3>${f.mode==='active'?'<button class="text-btn demo-update" data-update="'+r.id+'">模拟收到进度更新</button>':''}</div>${f.tasks.some(t=>t.status!=='passed')?`<ul class="focus-list">${f.tasks.filter(t=>t.status!=='passed').map(t=>`<li>${tag(taskStatus[t.status][0],taskStatus[t.status][1])}<button data-task="${t.id}">${esc(t.title)}<small>${t.person} · ${t.status==='returned'?esc(t.supervisor):'截止 '+t.due}</small></button></li>`).join('')}</ul>`:`<div class="section-note">${icon('info')}<span>${esc(nextStep(f))}</span></div>`}</section><section><div class="section-head"><h3>最新处理动态</h3><button class="text-btn" data-audit-tab="activity">全部动态 ${icon('arrow')}</button></div>${sorted.map(a=>`<div class="link-row"><div><span>${esc(a.title)}</span><p>${a.person} · ${a.time}</p></div><button class="text-btn" ${a.taskId?'data-task="'+a.taskId+'"':'data-tab="'+a.tab+'"'} aria-label="查看${esc(a.title)}">${icon('chevron')}</button></div>`).join('')}<div class="section-head" style="margin-top:24px"><h3>相关资料</h3></div><div class="link-row"><div>员工提交的 OA 附件<p>原始表单与来源版本</p></div><button class="text-btn" data-tab="attachments">${r.fileIds.length} 份 ${icon('chevron')}</button></div><div class="link-row"><div>后续任务证据<p>按任务归档，保留历史版本</p></div><button class="text-btn" data-audit-tab="evidence">${f.tasks.reduce((n,t)=>n+t.evidence.length,0)} 份 ${icon('chevron')}</button></div></section></div>`;
}
function renderAnalysis(r){
 const f=flows[r.id];if(!f)return emptyStage('尚未进入质量初析','本事件尚未完成研判并推送初析；不会提前生成佟成的初析结果。');
 if(!f.analyses.length)return `${note('马荣鑫可跟踪初析进度；初析内容由佟成填写。')}<div class="manager-line"><span class="avatar">佟</span><div><h3>佟成 · 待提交质量初析</h3><p>来源：${r.eventNo} · 研判通报时间 ${f.reviewTime}</p></div>${tag('待初析','blue')}</div>${emptyStage('尚未提交初析结果','佟成完成初析后，这里会显示问题方向、分析依据、初步结论、处理要求与版本记录。','<button class="btn" data-tab="review">查看马荣鑫的研判</button>')}`;
 const selected=f.analyses.find(a=>a.version===viewState.analysisVersion)||f.analyses.at(-1),latest=f.analyses.at(-1),isLatest=selected.version===latest.version;
 return `${note('以下是佟成已提交的初析。每次修订独立保留，人员分配结果在“分配与承办”中查看。')}<div class="analysis-meta"><div><h3>佟成的质量初析 ${tag('V'+selected.version,isLatest?'blue':'')}${isLatest?' '+tag('当前版本','green'):''}</h3><p class="quiet" style="margin-top:6px">提交人：佟成 · ${selected.time} · 引用来源 V${r.version}</p></div><label><span class="field-label">查看初析版本</span><select id="analysisVersion">${[...f.analyses].reverse().map(a=>`<option value="${a.version}" ${a.version===selected.version?'selected':''}>V${a.version}${a.version===latest.version?' · 当前版本':' · 历史只读'} · ${a.time}</option>`).join('')}</select></label></div>${selected.reason?`<div class="change-note"><b>本次修订：</b>${esc(selected.reason)}<br>${esc(selected.sync)}</div>`:!isLatest?'<div class="change-note">正在查看历史 V1。后续修订未覆盖此版本。</div>':''}<section class="analysis-block"><h3>方向与建议</h3><div class="facts-grid">${textFact('人工确认分类',selected.category)}${textFact('主责部门',selected.department)}${textFact('建议总期限',selected.due)}</div></section><section class="analysis-block"><h3>分析与判断</h3>${[['问题方向',selected.direction],['来源事实摘要',selected.facts],['分析依据',selected.basis],['初步结论',selected.conclusion],['信息缺口',selected.gap]].map(([k,v])=>`<dl class="analysis-text"><dt>${k}</dt><dd>${esc(v)}</dd></dl>`).join('')}</section><section class="analysis-block"><h3>处理要求</h3><div class="long-fact" style="white-space:pre-line">${esc(selected.requirements)}</div><p class="quiet" style="margin-top:12px">主责部门已由初析确认；具体承办人和正式任务期限以该部门主管在原任务系统发布的任务为准。</p></section>`;
}
function taskMatch(t){return viewState.taskFilter==='全部任务'||viewState.taskFilter==='待承接'&&t.status==='pending'||viewState.taskFilter==='执行与补充'&&['active','returned'].includes(t.status)||viewState.taskFilter==='待验收'&&t.status==='submitted'||viewState.taskFilter==='已通过'&&t.status==='passed';}
function evidenceButton(t,e){const v=e.versions.at(-1);return `<button class="evidence-link" data-evidence="${e.id}" data-evidence-task="${t.id}"><span>${icon('file')} ${esc(e.name)}<small>${e.person} · V${v.version}${e.versions.length>1?' · 含 '+e.versions.length+' 个版本':''} · ${v.result}</small></span>${icon('chevron')}</button>`;}
function renderTask(t,f){const [label,tone]=taskStatus[t.status];return `<details class="task-card" id="task-${t.id}" data-task-card="${t.id}"><summary><div><h3>${esc(t.title)}</h3><small>承办人：${t.person} · ${f.department}</small></div><div>${tag(label,tone)}<small>${t.evidence.length} 份证据</small></div><div><span style="font-size:13px">${t.due.slice(5)}</span><small>任务截止</small></div><div><span style="font-size:13px">${t.progress}%</span><div class="progress-track" aria-label="员工自报进度 ${t.progress}%"><i style="width:${t.progress}%"></i></div><small>员工自报</small></div>${icon('chevron')}</summary><div class="task-details"><div class="task-facts">${textFact('分配主管',f.manager)}${textFact('发放时间',t.assigned)}${textFact('承接结果',t.accepted?'已承接 · '+t.accepted:'等待员工确认承接')}${textFact('主管验收',t.status==='passed'?'已通过':t.status==='returned'?'退回补充':t.status==='submitted'?'等待主管验收':'尚未验收')}</div><div class="task-log-grid"><section><h3>任务要求</h3><p style="line-height:1.85;white-space:pre-line">${esc(t.requirement)}</p><p style="margin-top:12px;font-size:13px"><span class="quiet">验收标准：</span>${esc(t.acceptance)}</p><p class="quiet" style="margin:10px 0 20px">${esc(t.dependency)}</p><h3>员工当前反馈</h3><div class="employee-log"><span class="quiet">${t.person} · ${t.lastUpdate||t.submitted||t.assigned}</span><p>${esc(t.update)}</p><span class="quiet">${t.status==='passed'?'员工提交完成，且已通过主管验收。':t.status==='submitted'?'员工已提交完成，等待主管验收。':t.status==='returned'?'本次提交被退回，任务仍在处理中。':'当前尚未完成提交。'}</span></div><h3>${t.resubmitted?'上次主管验收意见（本次已重新提交）':'主管验收意见'}</h3><div class="review-note ${t.status==='returned'||t.resubmitted?'returned':''}">${t.resubmitted?tag('上次退回补充','amber'):tag(label,tone)}<p>${esc(t.resubmitted?t.priorReview:t.supervisor)}</p>${t.reviewed?'<p class="quiet">'+f.manager+' · '+t.reviewed+'</p>':''}</div><h3>本任务证据</h3>${t.evidence.length?t.evidence.map(e=>evidenceButton(t,e)).join(''):'<div class="task-empty">本任务尚未上传证据。</div>'}</section><section><h3>承办记录</h3><ol class="timeline"><li><div class="timeline-title">主管发放任务<time>${t.assigned}</time></div><p>${f.manager}确认承办人、要求和期限。</p></li><li><div class="timeline-title">${t.accepted?'员工已承接':'等待员工承接'}<time>${t.accepted||'尚无承接时间'}</time></div><p>${t.person}${t.accepted?'确认承接。':'尚未确认。'}</p></li>${t.submitted?`<li><div class="timeline-title">员工提交完成<time>${t.submitted}</time></div><p>提交结果与证据，等待主管验收。</p></li>`:''}${t.reviewed?`<li><div class="timeline-title">${t.status==='returned'?'主管退回补充':t.status==='passed'?'主管验收通过':'上次验收退回'}<time>${t.reviewed}</time></div><p>${esc(t.resubmitted?t.priorReview:t.supervisor)}</p></li>`:''}${t.resubmitted?`<li><div class="timeline-title">补充后重新提交<time>${t.resubmitted}</time></div><p>证据新增 V2，V1 和退回意见继续保留。</p></li>`:''}</ol></section></div></div></details>`;}
function renderTasks(r){if(flows[r.id]?.example)return renderExampleTasks(r);
 const f=flows[r.id];if(!f)return emptyStage('尚无后续分配','本条未通报质量事件，因此没有主管分配或员工承办结果。');
 if(!f.tasks.length)return `${note('分配和承办结果来自原任务系统。在马荣鑫视角可以查看，不在这里代替主管分配。')}<div class="manager-line"><span class="avatar">${f.mode==='analysis'?'佟':'管'}</span><div><h3>${f.mode==='analysis'?'等待佟成完成初析':'已完成初析，等待主管确认分配'}</h3><p>${f.mode==='analysis'?'初析提交后再进入任务分配。':f.department+' · 建议期限 '+f.due}</p></div></div>${emptyStage('尚未发放员工任务',f.mode==='analysis'?'本环节暂未开始，不显示预设承办人或虚构分配结果。':'主管确认承办人和任务要求后，具体事项、承接结果与执行进度会显示在这里。','<button class="btn" data-tab="analysis">查看佟成初析</button>')}`;
 const filters=['全部任务','待承接','执行与补充','待验收','已通过'];const filteredTasks=f.tasks.filter(taskMatch),passed=f.tasks.filter(t=>t.status==='passed').length;
 return `${note('正式任务的负责人、期限、承接、执行和主管验收结果在此只读展示。任务卡按事项组织，证据归入对应任务。')}<div class="manager-line"><span class="avatar">管</span><div><h3>${f.manager} · 负责本事件任务分配与验收</h3><p>${f.department} · 已于 2026-09-07 14:00 确认分配</p></div><div class="manager-summary"><strong>${passed} / ${f.tasks.length} 项通过主管验收</strong><p>任务并行开展，完成情况逐项核对</p></div></div><div class="task-toolbar"><div class="chips" aria-label="任务状态筛选">${filters.map(label=>{const saved=viewState.taskFilter;viewState.taskFilter=label;const count=f.tasks.filter(taskMatch).length;viewState.taskFilter=saved;return `<button class="chip ${saved===label?'active':''}" data-task-filter="${label}" aria-pressed="${saved===label}">${label} ${count}</button>`;}).join('')}</div><span class="quiet">点击任务展开承办结果</span></div>${filteredTasks.length?filteredTasks.map(t=>renderTask(t,f)).join(''):emptyStage('当前分类没有任务','切换“全部任务”可以查看完整分配结果。')}<p class="quiet" style="margin-top:14px">员工自报 100% 或提交完成，均不等于主管验收通过；主管验收与佟成的质量终验分别记录。</p>`;
}
function renderAudit(r){if(flows[r.id]?.example)return renderExampleAudit(r);
 const f=flows[r.id];if(!f)return emptyStage('尚无后续证据与验收记录','OA 原始附件仍可在“OA 原始资料”中查看。');
 const entries=f.tasks.flatMap(t=>t.evidence.map(e=>({t,e}))),sub=viewState.auditTab;
 let html=`<div class="subnav"><button class="chip ${sub==='evidence'?'active':''}" data-audit-tab="evidence">任务证据 ${entries.length}</button><button class="chip ${sub==='results'?'active':''}" data-audit-tab="results">验收结果</button><button class="chip ${sub==='activity'?'active':''}" data-audit-tab="activity">处理动态 ${f.activity.length}</button><span class="quiet">本事件公开处理记录</span></div>`;
 if(sub==='evidence')return html+note('这里汇总后续任务证据。与 OA 原始附件分开保存，同一任务的历史证据版本不会被覆盖。')+(entries.length?entries.map(({t,e})=>`<section style="margin-bottom:20px"><div class="section-head"><div><h3>${esc(t.title)}</h3><p class="quiet" style="margin-top:5px">承办人 ${t.person} · ${taskStatus[t.status][0]}</p></div><button class="text-btn" data-task="${t.id}">查看承办记录 ${icon('arrow')}</button></div>${evidenceButton(t,e)}</section>`).join(''):emptyStage('暂未提交任务证据','员工上传后，会按具体任务归档到这里。'));
 if(sub==='results')return html+(f.mode==='closed'?`<div class="quality-outcome"><h3>${icon('check')} 质量终验通过 · 事件已关闭</h3><p>${esc(f.final)}</p><p class="quiet">终验人：佟成 · ${f.closedAt} · 历史版本继续保留</p></div><div class="facts-grid" style="margin-bottom:24px">${textFact('最终分类',f.analyses.at(-1).category)}${textFact('最终原因（演示）','记录校验环节存在遗漏，已修正并补齐复核。')}${textFact('措施（演示）','更新检查要求并补齐记录。')}${textFact('验证结果（演示）','对照与独立复核已通过。')}</div>`:`<div class="status-banner"><div><span class="eyebrow">质量终验 · 佟成</span><h3>${f.mode==='quality'?'等待质量终验':'尚未进入终验'}</h3><p>${f.mode==='quality'?'主管验收已通过，等待佟成核对证据后作最终判断。':'需要先完成任务执行和主管验收，再进入质量终验。'}</p></div>${tag(f.mode==='quality'?'待终验':'前序环节处理中','blue')}</div>`)+`<div class="section-head"><h3>逐项主管验收结果</h3><span class="quiet">主管验收和质量终验分别记录</span></div>${f.tasks.length?f.tasks.map(t=>`<div class="record-line"><div>${tag(taskStatus[t.status][0],taskStatus[t.status][1])}</div><div><h3>${esc(t.title)}</h3><p>${esc(t.supervisor)}</p><button class="text-btn" data-task="${t.id}" style="font-size:12px;min-height:30px">查看任务与证据</button></div><time class="quiet">${t.reviewed?f.manager+' · '+t.reviewed:'尚无主管验收记录'}</time></div>`).join(''):emptyStage('尚无主管验收记录','任务尚未发放。')}`;
 const filters=['全部','研判','初析','分配','承办','验收','终验'];const logs=[...f.activity].filter(a=>viewState.activityFilter==='全部'||a.category===viewState.activityFilter).sort((a,b)=>b.time.localeCompare(a.time));
 return html+`<div class="chips activity-filters">${filters.map(label=>`<button class="chip ${viewState.activityFilter===label?'active':''}" data-activity-filter="${label}">${label}</button>`).join('')}</div>${logs.length?logs.map(a=>`<article class="activity-item"><time>${a.time}<br>${a.person}</time>${tag(a.category)}<div><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p><button class="text-btn" style="font-size:12px;min-height:30px" ${a.taskId?'data-task="'+a.taskId+'"':'data-tab="'+a.tab+'"'}>查看对应记录 ${icon('arrow')}</button></div></article>`).join(''):emptyStage('当前分类暂无记录','切换“全部”查看本事件的处理动态。')}`;
}
function renderReview(r){return renderAssessment(r);}
renderDetailContent=function(r){
 if(['attachments','form','history'].includes(state.tab)){originalContent(r);if(viewState.surface==='feedback')return;$('detailContent').insertAdjacentHTML('afterbegin',`<div class="subnav source-subtabs">${[['attachments','OA 附件 '+r.fileIds.length],['form','原始表单'],['history','审批与版本']].map(([key,label])=>`<button class="chip ${state.tab===key?'active':''}" data-tab="${key}">${label}</button>`).join('')}<span class="quiet">员工原始提交，来源只读</span></div>`);return;}
 $('detailContent').innerHTML=state.tab==='overview'?renderOverview(r):state.tab==='analysis'?renderAnalysis(r):state.tab==='tasks'?renderTasks(r):state.tab==='audit'?renderAudit(r):renderReview(r);if(state.tab==='review')updateAssessmentDiff();
};
function openTask(id){const r=currentRow(),f=flows[r.id];if(f?.example)viewState.viewedPhase=4;if(!f?.tasks.some(t=>t.id===id))return;viewState.taskFilter='全部任务';goTab('tasks');const d=$('task-'+id);d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});}
function openEvidence(taskId,evidenceId,version){
 const r=currentRow(),f=flows[r?.id],t=f?.tasks.find(t=>t.id===taskId),e=t?.evidence.find(e=>e.id===evidenceId);if(!e)return;
 const v=e.versions.find(v=>v.version===Number(version))||e.versions.at(-1);viewState.evidence={taskId,evidenceId,version:v.version};
 $('evidenceBody').innerHTML=`<header><div><h2>${esc(e.name)}</h2><p>${r.eventNo} · ${esc(t.title)} · 后续任务证据</p></div><button class="icon-btn" data-close-evidence aria-label="关闭任务证据预览">${icon('close')}</button></header><div class="document-layout"><div class="document-page"><pre>${esc(v.content)}</pre></div><aside class="document-meta"><label><span class="field-label">证据版本</span><select id="evidenceVersion">${[...e.versions].reverse().map(x=>`<option value="${x.version}" ${x.version===v.version?'selected':''}>V${x.version} ${x.version===e.versions.at(-1).version?'· 最新':'· 历史'}</option>`).join('')}</select></label>${textFact('提交人',e.person)}${textFact('提交时间',v.time)}${textFact('本版本验收状态',v.result)}${textFact('所属任务',t.title)}<p>历史证据不会被新版本覆盖。此处展示独立演示文件。</p></aside></div><footer><span class="quiet">关闭预览后，保留所选任务与列表位置。</span><button class="btn primary" data-download-evidence>${icon('down')}下载此版本</button></footer>`;
 if(!$('evidenceDialog').open)$('evidenceDialog').showModal();
}
function downloadEvidence(){const {taskId,evidenceId,version}=viewState.evidence;const e=flows[currentRow().id].tasks.find(t=>t.id===taskId).evidence.find(e=>e.id===evidenceId),v=e.versions.find(v=>v.version===version);const url=URL.createObjectURL(new Blob(['\uFEFF'+v.content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=e.name.replace('.txt','-V'+version+'-演示.txt');a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
// Admission and AI-assisted assessment are implemented in assessment.js; downstream projections remain here.
function simulateUpdate(id){const f=flows[id];if(f?.example){advanceExampleEvidence(id);return;}if(!f||f.mode!=='active')return;const t=f.tasks.find(t=>t.status==='returned');if(!t)return toast('本轮进度更新已展示，可重置演示后再体验。');t.priorReview=t.supervisor;t.supervisor='已补交 V2，目前等待主管重新验收。';t.status='submitted';t.progress=100;t.resubmitted='2026-09-08 15:00';t.lastUpdate=t.resubmitted;t.update='已补齐对照样本和复核签字，上传 V2 后重新提交，等待主管验收。';const e=t.evidence[0];e.versions.push({version:2,time:t.resubmitted,result:'待主管验收',content:`${e.name}\n\n交互评审演示文件 · V2\n\n所属任务：${t.title}\n提交人：${t.person}\n\n本次补充\n1. 已补齐对照样本信息。\n2. 已补齐复核记录与签字栏示例。\n3. 重新提交主管验收，当前尚未通过。\n\nV1 及其退回意见继续保留。\n所有内容仅用于交互演示。`});const pending=f.tasks.find(t=>t.status==='pending');if(pending){pending.status='active';pending.accepted='2026-09-08 14:50';pending.progress=20;pending.supervisor='尚未提交完成，暂未进入主管验收。';pending.lastUpdate='2026-09-08 14:55';pending.update='已确认承接，正在整理抽样范围与核对清单。';f.activity.push({category:'承办',time:pending.accepted,person:pending.person,title:'承接任务：'+pending.title,text:'已确认承接并开始执行。',taskId:pending.id});}
 f.activity.push({category:'承办',time:t.resubmitted,person:t.person,title:'补齐证据 V2，重新提交验收',text:'历史 V1 与退回记录保留，本次等待主管重新验收。',taskId:t.id});f.updated=demoNow;renderList();renderDetail();toast('演示：收到员工承接与证据 V2 更新，等待主管验收。');}
showGuide=function(){info('马荣鑫视角 · 交互评审',`<p>查看所有已接入反馈，并持续跟踪关联事件。下列人员、任务、结论和文件均为演示内容。</p><div class="scenario-list">${[['a5','员工处理中','查看佟成 V2 初析、3 项任务与退回补充'],['a4','待佟成初析','已通报，尚未提交初析结果'],['a11','待主管分配','初析已完成，尚未发放员工任务'],['a7','待质量终验','任务均通过主管验收'],['a12','已关闭','查看最终结论、证据与历史记录'],['a1','待我研判','查看 4 份 OA 附件，体验保存草稿和通报']].map(([id,title,desc])=>`<button class="btn" data-scenario="${id}"><span>${title}<small>${desc}</small></span>${icon('arrow')}</button>`).join('')}</div><button class="text-btn" data-reset-demo>重置全部演示状态</button><p>所有演示变更仅在本页内生效。马荣鑫在后续流程中只查看，不代替佟成、主管或员工提交业务操作。</p>`);$('closeInfo').textContent='关闭';};
// The extension intercepts only the controls whose meanings are expanded here.
document.addEventListener('click',e=>{
 const b=e.target.closest('button,a');if(!b||b.disabled)return;
 const handles=['enterEvent','returnFeedback','tab','phase','select','progress','scenario','task','taskFilter','auditTab','activityFilter','evidence','closeEvidence','downloadEvidence','saveDraft','submitReview','confirmReview','update','resetDemo'];
 if(!handles.some(k=>Object.hasOwn(b.dataset,k)))return;e.preventDefault();e.stopImmediatePropagation();
 if(b.dataset.enterEvent)enterEvent(b.dataset.enterEvent);
 if(Object.hasOwn(b.dataset,'returnFeedback'))returnToFeedback();
 if(b.dataset.tab)goTab(b.dataset.tab);
 if(Object.hasOwn(b.dataset,'phase')){viewState.viewedPhase=Number(b.dataset.phase);if(viewState.viewedPhase===5)viewState.auditTab='results';goTab(b.dataset.phaseTab);}
 if(b.dataset.select)selectRecord(b.dataset.select,'overview');
 if(b.dataset.progress)selectRecord(b.dataset.progress,'overview');
 if(b.dataset.scenario){$('infoDialog').close();reset();selectRecord(b.dataset.scenario,'overview');}
 if(b.dataset.task)openTask(b.dataset.task);
 if(b.dataset.taskFilter){viewState.taskFilter=b.dataset.taskFilter;renderDetailContent(currentRow());}
 if(b.dataset.auditTab){viewState.auditTab=b.dataset.auditTab;goTab('audit');}
 if(b.dataset.activityFilter){viewState.activityFilter=b.dataset.activityFilter;renderDetailContent(currentRow());}
 if(b.dataset.evidence)openEvidence(b.dataset.evidenceTask,b.dataset.evidence);
 if(Object.hasOwn(b.dataset,'closeEvidence'))$('evidenceDialog').close();
 if(Object.hasOwn(b.dataset,'downloadEvidence'))downloadEvidence();
 if(b.dataset.update)simulateUpdate(b.dataset.update);
 if(Object.hasOwn(b.dataset,'resetDemo')){$('infoDialog').close();rows=structuredClone(baseRows).sort((a,b)=>b.date.localeCompare(a.date));seedFlows();viewState.reviewDrafts={};reset();toast('演示数据已恢复。');}
},true);
document.addEventListener('change',e=>{if(e.target.id==='analysisVersion'){viewState.analysisVersion=Number(e.target.value);renderDetailContent(currentRow());}if(e.target.id==='evidenceVersion'){const v=viewState.evidence;openEvidence(v.taskId,v.evidenceId,e.target.value);}});
document.querySelector('h1').textContent='全部事件';
document.title='马荣鑫工作台 · 反馈与全流程跟踪 · 交互原型';
document.querySelector('.breadcrumb').innerHTML='质量追踪 <span style="margin:0 8px">/</span> 马荣鑫工作台';
document.querySelector('.subtitle').textContent='查找员工提交的 OA 反馈，查看原始资料；已通报的记录可进入关联质量事件。';
document.querySelector('.user small').textContent=' · 反馈研判与跟踪';
document.querySelector('.page-header').insertAdjacentHTML('afterend',`<div class="scope-summary">${icon('info')}<p><strong>查看顺序：</strong>查找反馈 → 核对 OA 资料 → 点击“进入质量事件” → 跟踪后续处理。</p><button class="text-btn" data-scenario="a5">查看处理中样例 ${icon('arrow')}</button></div>`);
document.querySelector('.search-tip').innerHTML='<span>搜索 OA / 事件编号，也支持尾号。试试 <button class="search-example" data-query="45802">45802</button>（处理中）或 <button class="search-example" data-query="48912">48912</button>（待研判）</span><span>点击一行，就在该行下方展开</span>';
document.querySelector('#searchInput').placeholder='搜索 OA 编号、质量事件编号或反馈关键词';
document.querySelector('#searchInput').setAttribute('aria-label','搜索 OA 编号、质量事件编号或反馈关键词');
document.querySelector('#inboxTitle').textContent='全部已接入反馈 · 后续处理持续关联';
document.querySelector('#scopeTabs').setAttribute('aria-label','反馈与处理范围');
$('filterPanel').insertAdjacentHTML('afterbegin','<label><span class="field-label">后续处理阶段</span><select id="stageFilter"><option value="">全部处理阶段</option><option value="unreported">尚未通报</option>'+Object.entries(modes).map(([k,v])=>'<option value="'+k+'">'+v.label+'</option>').join('')+'</select></label>');
$('filterPanel').style.gridTemplateColumns='repeat(3,minmax(0,1fr))';
const originalApply=$('applyFilters').onclick;$('applyFilters').onclick=()=>{if($('dateFrom').value&&$('dateTo').value&&$('dateFrom').value>$('dateTo').value){toast('开始日期不能晚于结束日期。');return;}originalApply();state.filters.stage=$('stageFilter').value;refreshList();};
$('resetFilters').onclick=reset;$('openGuide').onclick=showGuide;
document.querySelector('.footer-note').textContent='独立交互原型 · 所有业务记录为演示数据 · 后续任务状态由原任务系统提供，来源与人工结论分别留存。';
document.body.insertAdjacentHTML('beforeend','<dialog class="evidence-dialog" id="evidenceDialog" aria-label="任务证据预览"><div id="evidenceBody"></div></dialog>');
renderList();renderDetail();
initializeEventNavigation();
initializeAssessmentUI();
initializeFlowExamples();
