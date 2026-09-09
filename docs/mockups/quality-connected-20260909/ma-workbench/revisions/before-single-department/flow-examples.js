'use strict';
// Interactive, explicitly fictional downstream snapshots. No business operations or remote calls.
const exampleScenes={
 assigned:{label:'已分配 / 待承接',mode:'active',description:'主管已发放 4 项任务，员工尚未确认承接。'},
 execution:{label:'执行与退回',mode:'active',description:'1 项通过、1 项执行中、1 项退回补充、1 项待承接。'},
 quality:{label:'待质量终验',mode:'quality',description:'4 项任务均通过主管验收，证据包已送佟成终验。'},
 returned:{label:'终验退回',mode:'active',description:'佟成将回归验证节点退回补充，历史证据继续保留。'},
 closed:{label:'完整结果 / 已关闭',mode:'closed',description:'查看初析、分配、承办、证据和终验的完整结果。'}
};
const exampleOwners=['陈昊（模拟）','林悦（模拟）','周岚（模拟）','赵敏（模拟）'];
const exampleTaskSpecs=[
 {title:'定位大容量图像导出的性能瓶颈',department:'软件研发组',manager:'程远（模拟主管）',requirement:'复现 128 MB、512 MB、1 GB 三档数据导出，拆分读取、编码与写盘耗时，提交性能采样和定位报告。',acceptance:'同一设备、同一数据集重复 5 次；记录各阶段耗时及环境，定位依据可复核。',dependency:'无前置任务。',file:'导出链路性能定位报告.txt',result:'确认耗时主要集中在逐帧同步写入与高频进度刷新，已提交 5 轮基线记录。'},
 {title:'优化分批写入与导出进度反馈',department:'软件研发组',manager:'程远（模拟主管）',requirement:'根据定位结论完成批量写入及进度刷新优化，处理导出取消场景，交付修订记录和开发自测证据。',acceptance:'1 GB 演示数据导出不超过 35 秒；取消操作可响应，已写入文件处理符合约定。',dependency:'以前序性能定位结果作为输入。',file:'批量写入优化与自测记录.txt',result:'已完成批量写入和进度刷新优化，1 GB 数据自测 31.7 秒；取消操作自测通过。'},
 {title:'完成容量、介质及取消场景回归',department:'软件测试组',manager:'顾宁（模拟主管）',requirement:'覆盖 3 档数据容量、本地磁盘与外接介质，核对导出文件完整性，并补充取消场景与对照复测记录。',acceptance:'20 项功能检查全部通过；文件数量与校验值一致；慢速介质的进度提示清晰可读。',dependency:'使用优化版本执行回归；保留原版本作为对照。',file:'导出功能回归验证记录.txt',result:'完成 20 项功能回归，文件数量与校验值一致，补齐慢速介质和取消场景对照。'},
 {title:'完成现场复核并整理用户反馈',department:'客户服务组',manager:'刘航（模拟主管）',requirement:'按回归通过的版本在演示现场复核导出流程，记录实际操作体验、环境及确认结果。',acceptance:'现场确认记录完整，版本与设备对应清楚，导出结果可正常打开。',dependency:'需等待软件优化与回归通过后进行现场复核。',file:'现场导出体验复核记录.txt',result:'演示现场确认导出等待缩短，进度提示连续，导出图像可正常打开，复核记录已签收。'}
];
function exampleEvidence(r,t,spec,index,status){
 const returned=index===2,done=['passed','submitted'].includes(status);
 if(['pending','active'].includes(status))return [];
 const versions=[{version:1,time:'2026-09-08 09:10',result:returned?'退回补充：缺少慢速介质与取消场景对照':'主管验收通过',content:`${spec.file}\n\n交互评审模拟资料，不是真实检测结果。\n事件：${r.eventNo}\n任务：${t.title}\n提交人：${t.person}\n\n验证要求\n${spec.acceptance}\n\nV1 结果\n${returned?'已覆盖常规容量和本地磁盘，缺少慢速介质与取消场景对照，需要补充。':spec.result}\n\n附件归属：后续任务证据，与 OA 原始附件分别保存。`}];
 if(returned&&done)versions.push({version:2,time:'2026-09-08 12:20',result:status==='passed'?'主管验收通过':'待主管验收',content:`${spec.file}\n\n交互评审模拟资料 · V2\n事件：${r.eventNo}\n任务：${t.title}\n提交人：${t.person}\n\n本次补充\n1. 补齐慢速介质的 3 档容量记录。\n2. 补齐导出取消与重新导出的对照。\n3. 20 项功能回归通过，文件数量与校验值一致。\n\n演示性能记录\n128 MB：12.6 秒 → 5.1 秒\n512 MB：48.2 秒 → 16.4 秒\n1 GB：95.8 秒 → 31.7 秒\n\nV1 及其退回意见继续保留，所有数值仅用于界面评审。`});
 return [{id:t.id+'-e1',name:spec.file,person:t.person,versions}];
}
function buildFlowExample(r,scene='closed'){
 const selected=exampleScenes[scene]||exampleScenes.closed;
 const f={example:true,scene,mode:selected.mode,manager:'程远（模拟主管）',department:'软件研发 / 软件测试 / 客户服务',due:'2026-09-10 18:00',assignedAt:'2026-09-07 09:00',reviewTime:'2026-09-05 14:00',updated:scene==='assigned'?'2026-09-07 09:00':scene==='execution'?'2026-09-08 10:40':scene==='returned'?'2026-09-08 14:30':'2026-09-08 14:50',analyses:[],tasks:[],activity:[]};
 const analysis={version:1,author:'佟成',time:'2026-09-06 09:20',category:'软件与数据功能 / 数据、报告与测量',direction:'围绕大容量图像导出的处理耗时、文件完整性和操作反馈开展分析。',facts:'员工反馈“图像导出时间较长”，来源关联服务日志；后续复测数据均为本原型独立模拟。',basis:'演示复测中，数据容量增加时耗时明显增长；应拆分读取、编码及写盘耗时，区分程序处理与外部存储的影响。',conclusion:'初步指向导出链路的同步写入和刷新频率，需要通过性能采样、优化及对照回归验证。',gap:'需补充三档容量的性能采样、慢速介质与取消操作记录。',requirements:'1. 定位主要耗时环节，保留复现环境和基线。\n2. 形成优化措施并完成开发自测。\n3. 对照验证导出耗时和文件完整性。\n4. 收集现场复核结果。',department:'软件研发组，协同软件测试组与客户服务组',due:f.due};
 f.analyses=[analysis,{...analysis,version:2,time:'2026-09-06 14:30',basis:'已核对演示性能采样：1 GB 数据原版本导出约 95.8 秒，需重点核查逐帧写入与高频界面刷新。',conclusion:'将性能定位、批量写入优化、回归验证和现场复核分别形成可验收事项；最终根因以对照结果确认。',requirements:analysis.requirements+'\n新增：覆盖 128 MB、512 MB、1 GB 及本地 / 外接介质；记录取消场景。',reason:'补充容量、介质和取消场景，防止仅验证常规路径。',sync:'三位模拟主管于 09-07 09:00 将 V2 要求纳入对应正式任务。'}];
 const statuses=scene==='assigned'?['pending','pending','pending','pending']:scene==='execution'?['passed','active','returned','pending']:scene==='returned'?['passed','passed','returned','passed']:['passed','passed','passed','passed'];
 f.tasks=exampleTaskSpecs.map((spec,index)=>{
  const status=statuses[index],accepted=status!=='pending',passed=status==='passed',returned=status==='returned';
  const t={...spec,id:r.id+'-t'+(index+1),number:'QTK-DEMO-0'+(index+1),person:exampleOwners[index],status,due:['2026-09-08 18:00','2026-09-09 18:00','2026-09-10 12:00','2026-09-10 18:00'][index],assigned:f.assignedAt,accepted:accepted?'2026-09-07 '+['09:12','09:18','09:26','09:40'][index]:null,progress:passed?100:returned?80:status==='active'?65:0,submitted:passed||returned?'2026-09-08 09:10':null,reviewed:passed?'2026-09-08 13:00':returned?'2026-09-08 10:20':null,lastUpdate:status==='pending'?f.assignedAt:status==='active'?'2026-09-08 10:35':passed?'2026-09-08 13:00':'2026-09-08 10:20',update:passed?spec.result:returned?(scene==='returned'?'按质量终验意见补充低速介质原始采样和场景对照，重新整理证据包。':'常规回归已完成，正在补齐慢速介质和取消场景对照。'):status==='active'?'批量写入改动完成，正在联调取消操作与导出进度显示；当前自报进度 65%。':'任务已发放，等待员工确认承接。',supervisor:passed?'已逐项核对交付物和验收标准，本任务通过主管验收。':returned?(scene==='returned'?'质量终验要求补充低速介质的原始采样记录；完成后重新提交主管验收。':'缺少慢速介质和取消场景对照，请补充原始记录后重新提交。'):'尚未提交完成，主管验收未开始。',evidence:[],history:[]};
  t.evidence=exampleEvidence(r,t,spec,index,status);
  t.history.push({at:t.assigned,title:'主管确认并发放任务',by:spec.manager,body:'已明确任务要求、交付物、承办人和期限。'});
  if(accepted)t.history.push({at:t.accepted,title:'员工确认承接',by:t.person,body:'确认执行要求与截止时间。'});
  if(status==='active')t.history.push({at:t.lastUpdate,title:'更新执行进度 · 65%',by:t.person,body:t.update});
  if(t.submitted)t.history.push({at:t.submitted,title:'提交执行结果与证据 V1',by:t.person,body:index===2?'已完成常规容量和本地磁盘验证；慢速介质与取消场景对照尚需补齐。':spec.result});
  if(index===2&&(passed||returned))t.history.push({at:'2026-09-08 10:20',title:'主管退回补充',by:spec.manager,body:'缺少慢速介质和取消场景对照，V1 保留。'});
  if(index===2&&passed)t.history.push({at:'2026-09-08 12:20',title:'补交证据 V2',by:t.person,body:'补齐所需对照，重新提交主管验收。'});
  if(passed)t.history.push({at:t.reviewed,title:'主管验收通过',by:spec.manager,body:t.supervisor});
  if(scene==='returned'&&index===2){
   // Quality return happens after earlier supervisor acceptance; keep both facts visible.
   t.evidence=exampleEvidence(r,t,spec,index,'passed');t.reviewed='2026-09-08 13:00';
   t.history.push({at:'2026-09-08 12:20',title:'补交证据 V2',by:t.person,body:'补齐常规回归对照后重新提交。'},{at:'2026-09-08 13:00',title:'主管验收通过',by:spec.manager,body:'主管核对 V2 后通过验收。'},{at:'2026-09-08 14:30',title:'质量终验指定节点退回',by:'佟成',body:'需增加低速介质的原始采样记录，其他节点结果保留。'});
   t.history.sort((a,b)=>a.at.localeCompare(b.at));t.qualityReturned=true;
  }
  return t;
 });
 f.activity=[{category:'研判',time:f.reviewTime,person:'马荣鑫',title:'完成分类与风险研判并推送初析',text:'分类：软件与数据功能 / 数据、报告与测量；风险：中。',tab:'review'},...f.analyses.map(a=>({category:'初析',time:a.time,person:'佟成',title:'提交质量初析 V'+a.version,text:a.version===1?'形成分析方向、信息缺口及建议责任部门。':a.reason,tab:'analysis'})),{category:'分配',time:f.assignedAt,person:f.manager,title:'协调 3 个部门，发放 4 项正式任务',text:'软件研发 2 项、软件测试 1 项、客户服务 1 项；分别确认承办人和期限。',tab:'tasks'}];
 for(const t of f.tasks)for(const h of t.history.slice(1))f.activity.push({category:h.title.includes('质量終验')||h.title.includes('质量终验')?'终验':h.title.includes('主管')?'验收':'承办',time:h.at,person:h.by,title:h.title+' · '+t.title,text:h.body,taskId:t.id});
 if(['quality','returned','closed'].includes(scene))f.activity.push({category:'验收',time:'2026-09-08 13:20',person:f.manager,title:'汇总主管验收与任务证据包',text:'4 项任务通过主管验收，提交佟成质量终验。',tab:'audit'});
 f.qualityReview={state:scene==='closed'?'passed':scene==='returned'?'returned':scene==='quality'?'pending':'not_started',rootCause:'逐帧同步写入与高频进度刷新增加了导出开销；外部低速存储进一步放大等待时间。',measures:'批量写入、降低进度刷新频率并完善取消处理；新增容量与介质组合回归。',validation:'3 档容量导出耗时均下降；20 / 20 项功能检查通过，文件数量与校验值一致。',returnReason:'低速介质的汇总结果已有，但缺少原始采样与环境记录；请回归验证节点补齐后再提终验。',returnedNode:r.id+'-t3',checks:[['定位依据','性能采样、日志与代码改动互相对应。'],['措施落实','优化版本、修订记录与任务交付物一致。'],['验证完整性','容量、介质、取消场景及文件完整性均有记录。']]};
 if(scene==='closed'){f.closedAt='2026-09-08 14:50';f.final='佟成核对定位依据、优化措施、主管验收及验证记录后通过质量终验。本事件关闭，初析与证据历史版本继续保留。';f.activity.push({category:'终验',time:f.closedAt,person:'佟成',title:'质量终验通过，关闭事件',text:f.final,tab:'audit'});}
 return f;
}
function seedFlowExamples(){
 const r=rows.find(x=>x.id==='a8');if(!r)return;
 r.review='已通报';r.eventNo='QT-DEMO-20260905-008';r.manualConclusion='根据图像导出耗时问题，确认分类为软件与数据功能 / 数据、报告与测量，风险为中；推送佟成进一步分析。';
 flows.a8=buildFlowExample(r,'closed');
}
function seedExampleAssessment(){
 const r=rows.find(x=>x.id==='a8'),a=assessmentFor(r);if(!r||!a)return;
 a.draft={primary:'软件与数据功能',secondary:'数据、报告与测量',risk:'MEDIUM',description:r.title,conclusion:r.manualConclusion,changeReason:'结合原始描述确认分类，后续通过采样与回归验证实际原因。'};
 a.finalized=true;a.dirty=false;a.adoption='MANUAL';a.saved=[{version:1,sourceVersion:r.version,at:'2026-09-05 14:00',by:'马荣鑫（演示）',draft:structuredClone(a.draft),adoption:'MANUAL',aiId:null}];
}
function renderExampleControls(r){
 if(viewState.surface!=='event'||!$('detailFlow'))return;
 $('flowExampleControls')?.remove();
 const f=flows[r.id];
 const content=f?.example?`<div class="example-intro"><b>后续流程模拟数据</b><span>${exampleScenes[f.scene].description}</span><small>切换仅预览不同状态，不是业务操作</small></div><div class="example-scenes" aria-label="后续流程演示状态">${Object.entries(exampleScenes).map(([key,scene])=>`<button class="chip ${key===f.scene?'active':''}" data-flow-scene="${key}" aria-pressed="${key===f.scene}">${scene.label}</button>`).join('')}</div>`:`<div class="example-intro"><span>想查看初析、分配、承办和终验的完整界面？</span><button class="text-btn" data-open-flow-example>查看完整流程样例 ${icon('arrow')}</button><small>独立模拟记录</small></div>`;
 $('detailFlow').insertAdjacentHTML('beforebegin',`<section id="flowExampleControls" class="flow-example-controls" aria-label="后续流程原型演示">${content}</section>`);
}
function switchFlowScene(scene){
 const r=currentRow(),old=flows[r.id];if(!old?.example||!exampleScenes[scene])return;
 const bar=$('flowExampleControls'),top=bar?.getBoundingClientRect().top;
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());
 flows[r.id]=buildFlowExample(r,scene);viewState.taskFilter='全部任务';viewState.analysisVersion=null;viewState.activityFilter='全部';
 renderTabs();renderDetail();updateWorkspaceHeading();
 if(top!==undefined)window.scrollBy({top:$('flowExampleControls').getBoundingClientRect().top-top,behavior:'instant'});
 toast('演示状态：'+exampleScenes[scene].label+'；仅切换模拟数据。');
}
function openFlowExample(tab='analysis'){
 const r=rows.find(x=>x.id==='a8');
 if(viewState.surface==='event'){
  const context=viewState.feedbackContext;
  history.replaceState({...history.state,maSurface:'event',record:r.id,feedback:context},'',eventUrl(r.id));displayEvent(r.id,tab);
 }else{
  const context=snapshotFeedback(state.selected);viewState.feedbackContext=context;
  history.replaceState({maSurface:'feedback',record:state.selected,feedback:context},'',feedbackUrl(state.selected));
  history.pushState({maSurface:'event',record:r.id,feedback:context,enteredFromFeedback:true},'',eventUrl(r.id));displayEvent(r.id,tab);
 }
}
function exampleTaskNavigation(){const assigning=viewState.viewedPhase!==4;return `<div class="subnav example-task-nav"><button class="chip ${assigning?'active':''}" data-example-task-view="3">主管分配结果</button><button class="chip ${!assigning?'active':''}" data-example-task-view="4">员工承办结果</button><span class="quiet">模拟正式任务结果 · 马荣鑫只读查看</span></div>`;}
function renderExampleTasks(r){
 const f=flows[r.id],assigning=viewState.viewedPhase!==4;
 if(assigning)return exampleTaskNavigation()+`<div class="example-heading"><div><span class="eyebrow">主管确认结果</span><h3>4 项任务，分配到 3 个协作部门</h3><p>${f.manager}统筹 · 依据佟成初析 V2 · ${f.assignedAt} 确认发放</p></div>${tag('已确认分配','green')}</div><div class="assignment-owners">${[['软件研发组','程远（模拟主管）','性能定位、导出优化 · 2 项'],['软件测试组','顾宁（模拟主管）','对照回归验证 · 1 项'],['客户服务组','刘航（模拟主管）','现场复核反馈 · 1 项']].map(([dept,name,scope])=>`<article><span class="owner-marker">${dept.slice(0,1)}</span><div><b>${dept}</b><p>${name}</p><small>${scope}</small></div></article>`).join('')}</div><div class="section-head"><h3>具体分配事项</h3><span class="quiet">人员、期限与验收标准均来自模拟分配结果</span></div><div class="assignment-table-wrap"><table class="assignment-table"><thead><tr><th>任务 / 交付物</th><th>承办人 / 分配主管</th><th>截止时间</th><th>当前状态</th><th>查看</th></tr></thead><tbody>${f.tasks.map(t=>`<tr><td><small>${t.number}</small><b>${esc(t.title)}</b><span>${esc(t.file)}</span></td><td><b>${t.person}</b><small>${t.manager}</small></td><td>${t.due.slice(5)}<small>${t.department}</small></td><td>${tag(taskStatus[t.status][0],taskStatus[t.status][1])}</td><td><button class="text-btn" data-task="${t.id}">承办结果 ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div><details class="assignment-memo" open><summary>分配依据与任务衔接</summary><p>质量初析 V2 明确问题方向与处理要求；主管分别确认具体承办人、交付物和期限。</p><div class="handoff-line"><span>性能定位</span>${icon('arrow')}<span>导出优化</span>${icon('arrow')}<span>回归验证</span>${icon('arrow')}<span>现场复核</span></div><p class="quiet">箭头表示交付物输入关系。承接状态、执行进度和验收结果分别记录。</p></details>`;
 const filters=['全部任务','待承接','执行与补充','待验收','已通过'],visible=f.tasks.filter(taskMatch);
 return exampleTaskNavigation()+`<div class="example-heading"><div><span class="eyebrow">员工提交与主管反馈</span><h3>按任务查看实际承办结果</h3><p>${exampleScenes[f.scene].description} 点击任务查看提交内容、证据和处理记录。</p></div><span class="quiet">截至 ${f.updated} · 模拟</span></div><div class="task-toolbar"><div class="chips">${filters.map(label=>{const original=viewState.taskFilter;viewState.taskFilter=label;const n=f.tasks.filter(taskMatch).length;viewState.taskFilter=original;return `<button class="chip ${original===label?'active':''}" data-task-filter="${label}">${label} ${n}</button>`;}).join('')}</div></div>${visible.length?visible.map(t=>renderExampleTask(t,f)).join(''):emptyStage('该状态下暂无任务','切换其他状态查看样例。')}`;
}
function renderExampleTask(t,f){const status=taskStatus[t.status];return `<details class="task-card example-task" id="task-${t.id}" data-task-card="${t.id}"><summary><div><h3>${t.title}</h3><small>${t.person} · ${t.department}${t.qualityReturned?' · 质量终验指定节点退回':''}</small></div><div>${tag(status[0],status[1])}<small>${t.evidence.length} 份证据</small></div><div>${t.due.slice(5)}<small>截止时间</small></div><div>${t.progress}%<div class="progress-track"><i style="width:${t.progress}%"></i></div><small>员工自报</small></div>${icon('chevron')}</summary><div class="task-details"><div class="task-facts">${textFact('分配主管',t.manager)}${textFact('任务发放',t.assigned)}${textFact('承接时间',t.accepted||'等待员工确认')}${textFact('当前验收',t.qualityReturned?'主管已验收，质量终验退回':status[0])}</div><div class="task-log-grid"><section><h3>员工承办结果</h3><div class="employee-log"><span class="quiet">${t.person} · ${t.lastUpdate}</span><p>${t.update}</p><span class="quiet">${t.status==='passed'?'提交已通过主管验收。':t.status==='returned'?'正在补充，需再次提交验证。':t.status==='submitted'?'员工已提交完成，等待主管验收。':t.status==='active'?'尚未提交完成，进度为员工自报。':'尚未承接，暂无执行结果。'}</span></div><h3>${t.qualityReturned?'质量退回意见':'主管验收意见'}</h3><div class="review-note ${t.status==='returned'?'returned':''}"><p>${t.supervisor}</p><span class="quiet">${t.qualityReturned?'佟成 · 2026-09-08 14:30':t.manager+(t.reviewed?' · '+t.reviewed:'')}</span></div><h3>提交的任务证据</h3>${t.evidence.length?t.evidence.map(e=>evidenceButton(t,e)).join(''):'<div class="task-empty">尚未提交证据；承接后在执行过程中补充。</div>'}<details class="task-requirements"><summary>核对任务要求与验收标准</summary><p>${t.requirement}</p><p><b>验收标准：</b>${t.acceptance}</p><p class="quiet">${t.dependency}</p></details></section><section><h3>完整承办记录</h3><ol class="timeline">${t.history.map(h=>`<li><div class="timeline-title">${h.title}<time>${h.at} · ${h.by}</time></div><p>${h.body}</p></li>`).join('')}</ol></section></div></div></details>`;}
function exampleAuditNav(f){return `<div class="subnav"><button class="chip ${viewState.auditTab==='evidence'?'active':''}" data-audit-tab="evidence">任务证据 ${f.tasks.reduce((n,t)=>n+t.evidence.length,0)}</button><button class="chip ${viewState.auditTab==='results'?'active':''}" data-audit-tab="results">验收结果</button><button class="chip ${viewState.auditTab==='activity'?'active':''}" data-audit-tab="activity">处理动态 ${f.activity.length}</button><span class="quiet">全部为独立模拟数据</span></div>`;}
function renderExampleAudit(r){
 const f=flows[r.id],q=f.qualityReview,nav=exampleAuditNav(f);
 if(viewState.auditTab==='evidence')return nav+`<div class="example-heading"><div><span class="eyebrow">后续任务证据包</span><h3>证据按承办任务归档，版本可追溯</h3><p>OA 原始附件保留在来源资料中；这里是主管与员工后续提交的模拟证据。</p></div></div>`+f.tasks.map(t=>`<section class="evidence-group"><div class="section-head"><div><h3>${t.title}</h3><p class="quiet">${t.person} · ${t.department}</p></div><button class="text-btn" data-task="${t.id}">查看承办记录 ${icon('arrow')}</button></div>${t.evidence.length?t.evidence.map(e=>evidenceButton(t,e)).join(''):'<p class="task-empty">尚未提交证据</p>'}</section>`).join('');
 if(viewState.auditTab==='activity'){
  const categories=['全部','研判','初析','分配','承办','验收','终验'],logs=f.activity.filter(a=>viewState.activityFilter==='全部'||viewState.activityFilter===a.category).sort((a,b)=>b.time.localeCompare(a.time));
  return nav+`<div class="chips activity-filters">${categories.map(c=>`<button class="chip ${viewState.activityFilter===c?'active':''}" data-activity-filter="${c}">${c}</button>`).join('')}</div>${logs.map(a=>`<article class="activity-item"><time>${a.time}<br>${a.person}</time>${tag(a.category)}<div><h3>${a.title}</h3><p>${a.text}</p><button class="text-btn" ${a.taskId?'data-task="'+a.taskId+'"':'data-tab="'+a.tab+'"'}>查看对应记录 ${icon('arrow')}</button></div></article>`).join('')||emptyStage('暂无此类记录','切换全部查看完整动态。')}`;
 }
 const started=q.state!=='not_started',title=q.state==='passed'?'质量终验通过 · 事件已关闭':q.state==='returned'?'质量终验退回 · 指定节点补充':q.state==='pending'?'主管验收已完成 · 等待佟成终验':'员工任务处理中 · 尚未进入质量终验';
 return nav+`<section class="quality-review-banner ${q.state}"><div><span class="eyebrow">质量终验 · 佟成</span><h3>${title}</h3><p>${q.state==='passed'?f.final:q.state==='returned'?q.returnReason:q.state==='pending'?'任务结果与证据包已齐备，待佟成逐项核对后填写终验结论。':'当前显示已有主管反馈；完成任务并通过主管验收后，再送质量终验。'}</p></div>${tag(q.state==='passed'?'已通过':q.state==='returned'?'退回补充':q.state==='pending'?'待终验':'未开始',q.state==='passed'?'green':q.state==='returned'?'amber':'blue')}</section>${q.state==='returned'?`<div class="quality-return-node"><div><b>退回节点：完成容量、介质及取消场景回归</b><p>承办：周岚（模拟） · 主管：顾宁（模拟主管）</p><small>2026-09-08 14:30 · 其他 3 项任务结果保留，V1 / V2 证据均可追溯。</small></div><button class="btn" data-task="${r.id}-t3">查看退回节点</button></div>`:''}${started?`<div class="quality-verdict-grid"><section><div class="section-head"><h3>终验核对项</h3><span class="quiet">${q.state==='pending'?'待佟成确认':'已记录核对意见'}</span></div>${q.checks.map(([label,text],i)=>`<div class="quality-check"><span class="check-dot ${q.state==='pending'?'waiting':q.state==='returned'&&i===2?'issue':''}">${q.state==='pending'?'○':q.state==='returned'&&i===2?'!':'✓'}</span><div><b>${label}</b><p>${text}</p></div>${tag(q.state==='pending'?'待核对':q.state==='returned'&&i===2?'需补原始记录':'已核对',q.state==='pending'?'blue':q.state==='returned'&&i===2?'amber':'green')}</div>`).join('')}</section><section class="quality-findings"><h3>${q.state==='passed'?'最终归档结论':'待终验核实的处理摘要'}</h3><div>${textFact('问题分类',f.analyses.at(-1).category)}${textFact('原因',q.rootCause)}${textFact('措施',q.measures)}</div><p class="quiet">${q.state==='passed'?'佟成 · '+f.closedAt:'上述内容来自承办结果汇总，质量结论以终验确认为准。'}</p></section></div><section class="validation-results"><div class="section-head"><h3>对照验证结果 · 模拟数据</h3><span class="quiet">同一测试环境 · 数值仅用于界面评审</span></div><table><thead><tr><th>数据容量</th><th>优化前</th><th>优化后</th><th>核对结果</th></tr></thead><tbody>${[['128 MB','12.6 秒','5.1 秒'],['512 MB','48.2 秒','16.4 秒'],['1 GB','95.8 秒','31.7 秒']].map(a=>`<tr><td>${a[0]}</td><td>${a[1]}</td><td><b>${a[2]}</b></td><td>${q.state==='returned'?'需补低速介质原始记录':'文件数量与校验值一致'}</td></tr>`).join('')}</tbody></table><p class="quiet">${q.validation} ${q.state==='passed'?'佟成已核对本组记录。':'以上为员工提交的结果，质量终验尚未通过。'}</p></section>`:''}<section class="supervisor-results"><div class="section-head"><h3>逐项主管验收结果</h3><span class="quiet">主管验收和质量终验分别记录</span></div>${f.tasks.map(t=>`<div class="record-line"><div>${tag(t.qualityReturned?'主管曾验收通过':taskStatus[t.status][0],t.qualityReturned?'green':taskStatus[t.status][1])}</div><div><h3>${t.title}</h3><p>${t.qualityReturned?'V2 已通过主管验收，现按质量终验意见补充原始采样。':t.supervisor}</p><button class="text-btn" data-task="${t.id}">查看承办与证据</button></div><time class="quiet">${t.manager}<br>${t.reviewed||'尚未验收'}</time></div>`).join('')}</section>`;
}
function advanceExampleEvidence(id){
 const f=flows[id];if(!f?.example)return;
 const t=f.tasks.find(t=>t.status==='returned');if(!t)return toast('该状态没有待补充任务，可切换“执行与退回”体验。');
 t.status='submitted';t.progress=100;t.lastUpdate='2026-09-08 15:00';t.update='已补充所需场景原始记录并重新提交，目前等待主管验收。';t.supervisor='已收到新版本证据，等待主管重新验收。';
 const e=t.evidence[0],version=e.versions.length+1;e.versions.push({version,time:t.lastUpdate,result:'待主管验收',content:`${e.name}\n\n模拟补充 V${version}\n任务：${t.title}\n提交人：${t.person}\n\n已补齐低速介质采样、取消场景及环境记录，等待主管核验。\n历史版本继续保留；本内容仅用于交互评审。`});
 t.history.push({at:t.lastUpdate,title:'补充证据 V'+version+' 并重新提交',by:t.person,body:t.update});
 f.activity.push({category:'承办',time:t.lastUpdate,person:t.person,title:'提交补充证据 V'+version,text:t.update,taskId:t.id});f.updated=t.lastUpdate;
 renderDetail();toast('模拟收到新证据，当前待主管验收；未自动通过。');
}
function initializeFlowExamples(){
 const originalGuide=showGuide;
 showGuide=function(){originalGuide();$('infoBody').insertAdjacentHTML('afterbegin','<div class="example-guide-link"><b>新增：完整后续流程样例</b><p>图像导出时间较长 · 初析 V1/V2、4 项跨部门任务、证据与质量终验。</p><button class="btn primary" data-open-flow-example>打开完整流程演示 '+icon('arrow')+'</button></div>');};
 $('openGuide').onclick=showGuide;
 document.querySelector('.scope-summary .text-btn').outerHTML='<button class="text-btn" data-open-flow-example>完整后续流程样例 '+icon('arrow')+'</button>';
 if(viewState.surface==='event')renderExampleControls(currentRow());
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||b.disabled)return;
 if(!['flowScene','openFlowExample','exampleTaskView'].some(k=>Object.hasOwn(b.dataset,k)))return;
 e.preventDefault();e.stopImmediatePropagation();
 if(b.dataset.flowScene)switchFlowScene(b.dataset.flowScene);
 if(Object.hasOwn(b.dataset,'openFlowExample')){$('infoDialog').close();openFlowExample();}
 if(b.dataset.exampleTaskView){viewState.viewedPhase=Number(b.dataset.exampleTaskView);goTab('tasks');}
},true);
