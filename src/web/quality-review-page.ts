import type { WorkbenchShellRole } from "./workbench-shell";
import { renderWorkbenchPage } from "./workbench-shell";
import { QUALITY_REVIEW_STYLES } from "./quality-review-styles";

const SOURCE_URL = "https://alidocs.dingtalk.com/i/nodes/lo1YvX0prG98k9woqvrYVPw7xzbmLdEZ";

export function renderQualityReviewPage(params: {
  role: WorkbenchShellRole;
  userId: string;
  userLabel?: string;
}): string {
  return renderWorkbenchPage({
    role: params.role,
    activeNav: "quality-tracking",
    title: "反馈研判工作台",
    pageTitle: "反馈研判工作台",
    description: "整理最近 6 个月的客户反馈，并将研判状态同步回钉钉原表。",
    userLabel: params.userLabel,
    sessionUserId: params.userId,
    extraCss: QUALITY_REVIEW_STYLES,
    mainHtml: `<main class="qr-page" id="qualityReviewRoot">
  <section class="qr-topbar">
    <div><h2>反馈研判工作台</h2><p class="qr-muted">先判断是否进入质量流程；风险标签仅帮助排序，不替代人工判断。</p></div>
    <div class="qr-actions"><span class="qr-sync-status" id="qualityReviewSyncStatus" role="status">正在读取同步状态…</span><button class="btn btn-secondary" id="qualityReviewSync" type="button">立即同步</button><a class="btn btn-secondary" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">打开钉钉原表</a></div>
  </section>
  <nav class="qr-scopebar" aria-label="研判范围">
    <button class="qr-scope is-on" type="button" data-review-scope="UNREVIEWED">待判断 <span class="qr-count" data-count="unreviewed">0</span></button>
    <button class="qr-scope" type="button" data-review-scope="NEEDS_INFO">待补资料 <span class="qr-count" data-count="needsInfo">0</span></button>
    <button class="qr-scope" type="button" data-review-scope="COMPLETED">已完成 <span class="qr-count" data-count="completed">0</span></button>
  </nav>
  <form class="qr-filterbar" id="qualityReviewFilters">
    <input class="qr-input" name="q" type="search" placeholder="搜索反馈单号、型号、序列号、描述或分类" aria-label="关键词">
    <select class="qr-select" name="risk" aria-label="风险标签"><option value="ALL">全部风险</option><option value="HIGH_RISK">高风险</option><option value="REPEAT">重复问题</option><option value="NONE">无风险标签</option></select>
    <select class="qr-select" name="deviceModel" aria-label="设备型号"><option value="">全部型号</option></select>
    <select class="qr-select" name="category" aria-label="问题分类"><option value="">全部分类</option></select>
    <button class="btn btn-secondary" type="submit">筛选</button>
  </form>
  <section class="qr-layout">
    <aside class="qr-panel qr-queue-panel" aria-label="反馈队列"><div class="qr-queue-head" id="qualityReviewQueueMeta">正在加载反馈…</div><div class="qr-queue" id="qualityReviewQueue" aria-live="polite"><div class="qr-loading">正在加载…</div></div></aside>
    <article class="qr-panel qr-detail" id="qualityReviewDetail" aria-live="polite"><div class="qr-detail-empty">从左侧选择一条反馈开始研判</div></article>
  </section>
</main>
<dialog class="qr-dialog" id="qualityReviewNoteDialog" aria-labelledby="qualityReviewNoteTitle"><div class="qr-dialog-body"><div class="qr-dialog-head"><div><h2 id="qualityReviewNoteTitle">保存研判</h2><p class="qr-muted">备注可选，可记录判断依据或需要补充的内容。</p></div><button class="qr-close" type="button" data-close-dialog>×</button></div><label class="qr-field">备注（可选）<textarea class="qr-textarea" id="qualityReviewNote" maxlength="2000"></textarea></label><div class="qr-feedback" id="qualityReviewNoteFeedback" role="status"></div><div class="qr-dialog-actions"><button class="btn btn-secondary" type="button" data-close-dialog>取消</button><button class="btn btn-primary" type="button" id="qualityReviewConfirm">确认</button></div></div></dialog>
<dialog class="qr-dialog" id="qualityReportDialog" aria-labelledby="qualityReportTitle"><div class="qr-dialog-body"><div class="qr-dialog-head"><div><h2 id="qualityReportTitle">通报质量异常</h2><p class="qr-muted">提交成功后，该反馈才会标记为“已进入后续流程”。</p></div><button class="qr-close" type="button" data-close-report>×</button></div><form id="qualityReportForm"><div class="qr-form"><label class="qr-field is-wide">事件标题<input class="qr-input" name="title" required maxlength="200"></label><label class="qr-field is-wide">质量事件现状<textarea class="qr-textarea" name="currentSituation" required maxlength="10000"></textarea></label><label class="qr-field">发生或反馈时间<input class="qr-input" name="occurredAt" maxlength="64"></label><label class="qr-field">反馈人<input class="qr-input" name="reporter" maxlength="100"></label><label class="qr-field">设备型号<input class="qr-input" name="deviceModel" maxlength="200"></label><label class="qr-field">设备序列号<input class="qr-input" name="serialNo" maxlength="200"></label><label class="qr-field">导管批次<input class="qr-input" name="catheterBatch" maxlength="200"></label><label class="qr-field">问题分类<input class="qr-input" name="category" maxlength="200"></label><label class="qr-field">紧急程度<select class="qr-select" name="urgency"><option value="LOW">低</option><option value="MEDIUM" selected>中</option><option value="HIGH">高</option><option value="CRITICAL">紧急</option></select></label><label class="qr-field is-wide">影响<textarea class="qr-textarea" name="impact" maxlength="2000"></textarea></label><label class="qr-field is-wide">补充说明<textarea class="qr-textarea" name="notes" maxlength="10000"></textarea></label></div><div class="qr-feedback" id="qualityReportFeedback" role="status"></div><div class="qr-dialog-actions"><button class="btn btn-secondary" type="button" id="qualitySaveReportDraft">保存草稿</button><button class="btn btn-primary" type="submit">提交质量异常</button></div></form></div></dialog>`,
    scriptHtml: `<script>${buildClientScript()}</script>`,
  });
}

function buildClientScript(): string {
  return String.raw`(function () {
  var root=document.getElementById('qualityReviewRoot'); if(!root)return;
  var scope='UNREVIEWED',items=[],selectedKey='',pendingDecision='',loading=false;
  var queue=document.getElementById('qualityReviewQueue'),detail=document.getElementById('qualityReviewDetail');
  var filters=document.getElementById('qualityReviewFilters');
  var noteDialog=document.getElementById('qualityReviewNoteDialog'),reportDialog=document.getElementById('qualityReportDialog');
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
  function clear(n){if(n)n.replaceChildren();}
  function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});}
  async function api(url,options){var response=await fetch(url,Object.assign({headers:{'Content-Type':'application/json'}},options||{}));var body=await response.json().catch(function(){return{};});if(!response.ok)throw new Error(body.error||'请求失败');return body.data;}
  function value(v){return v==null||String(v).trim()===''?'—':String(v);}
  function addBadge(mount,text,cls){mount.appendChild(el('span','qr-badge'+(cls?' '+cls:''),text));}
  function current(){return items.find(function(item){return item.sourceKey===selectedKey;})||null;}
  function setSelectOptions(name,values,label){var select=filters.elements[name],chosen=select.value;clear(select);var first=el('option','',label);first.value='';select.appendChild(first);values.forEach(function(v){var option=el('option','',v);option.value=v;select.appendChild(option);});select.value=chosen;}
  function renderQueue(data){clear(queue);document.getElementById('qualityReviewQueueMeta').textContent='共 '+data.pagination.total+' 条 · 按风险与反馈时间排序';if(!items.length){queue.appendChild(el('div','qr-empty','当前范围没有待处理反馈'));renderDetail();return;}items.forEach(function(item){var b=el('button','qr-item'+(item.sourceKey===selectedKey?' is-on':''));b.type='button';b.dataset.sourceKey=item.sourceKey;var badges=el('div','qr-badges');if(item.risk.highRisk)addBadge(badges,'高风险','is-risk');if(item.risk.repeat)addBadge(badges,'重复问题','is-repeat');if(item.sourceUpdatedSinceDecision)addBadge(badges,'资料已更新','is-update');if(item.review.status==='ORDINARY')addBadge(badges,'普通反馈');if(item.review.status==='NEEDS_INFO')addBadge(badges,'待补资料');if(item.review.status==='REPORTED')addBadge(badges,'已进入后续流程');b.appendChild(badges);b.appendChild(el('div','qr-item-title',value(item.feedbackNo)+' · '+value(item.deviceModel)));b.appendChild(el('div','qr-item-meta',value(item.feedbackAt)+' · '+value(item.category)+'\n'+value(item.issueDescription).slice(0,96)));b.addEventListener('click',function(){selectedKey=item.sourceKey;renderQueue(data);renderDetail();});queue.appendChild(b);});}
  function kv(label,val){var n=el('div','qr-kv');n.appendChild(el('span','',label));n.appendChild(el('strong','',value(val)));return n;}
  function section(title,text){var n=el('section','qr-section');var head=el('div','qr-section-head');head.appendChild(el('h3','',title));n.appendChild(head);n.appendChild(el('p','qr-text',value(text)));return n;}
  function writebackLabel(w){if(!w)return'尚未产生回写任务';var labels={PENDING:'等待回写',SENDING:'正在回写',RETRY:'自动重试中',SENT:'已同步到钉钉原表',DEAD:'回写失败',SUPERSEDED:'旧结果已淘汰'};return(labels[w.status]||w.status)+(w.lastError?' · '+w.lastError:'');}
  function renderDetail(){clear(detail);var item=current();if(!item){detail.appendChild(el('div','qr-detail-empty','从左侧选择一条反馈开始研判'));return;}var head=el('div','qr-section-head');var titleBox=el('div','');titleBox.appendChild(el('h2','qr-detail-title',value(item.feedbackNo)+' · '+value(item.deviceModel)));titleBox.appendChild(el('p','qr-muted',value(item.feedbackAt)+' · '+value(item.reporter)));head.appendChild(titleBox);var badges=el('div','qr-badges');if(item.risk.highRisk)addBadge(badges,'高风险','is-risk');if(item.risk.repeat)addBadge(badges,'重复问题','is-repeat');if(item.sourceUpdatedSinceDecision)addBadge(badges,'资料已更新','is-update');head.appendChild(badges);detail.appendChild(head);
    var grid=el('div','qr-detail-grid');[['反馈时间',item.feedbackAt],['反馈人',item.reporter],['设备型号',item.deviceModel],['设备序列号',item.serialNo],['导管批次',item.catheterBatch],['问题分类',item.category]].forEach(function(pair){grid.appendChild(kv(pair[0],pair[1]));});detail.appendChild(grid);
    detail.appendChild(section('问题描述',item.issueDescription));detail.appendChild(section('原表处理信息',[item.status&&('原表状态：'+item.status),item.owner&&('负责人：'+item.owner),item.solution&&('解决方案：'+item.solution),item.finalCause&&('最终原因：'+item.finalCause),item.customerFollowup&&('客户跟进：'+item.customerFollowup)].filter(Boolean).join('\n')));
    detail.appendChild(section('异常依据',(item.risk.triggers||[]).map(function(t){return t.label||t.code;}).join('\n')||'无风险规则命中'));
    detail.appendChild(section('关联反馈',(item.relatedFeedback||[]).map(function(r){return value(r.feedbackNo)+' · '+value(r.feedbackAt)+' · '+value(r.issueDescription);}).join('\n')||'暂无关联反馈'));
    if(item.review.note)detail.appendChild(el('div','qr-note','研判备注：'+item.review.note));
    var wb=el('div','qr-writeback'+(item.writeback&&item.writeback.status==='DEAD'?' is-failed':''),writebackLabel(item.writeback));if(item.writeback&&item.writeback.status==='DEAD'){var retry=el('button','btn btn-secondary btn-sm','重新回写');retry.type='button';retry.style.marginLeft='10px';retry.addEventListener('click',retryWriteback);wb.appendChild(retry);}detail.appendChild(wb);
    var actions=el('div','qr-actionbar');if(item.review.status!=='REPORTED'){var ordinary=el('button','btn btn-secondary','普通反馈');ordinary.type='button';ordinary.addEventListener('click',function(){openDecision('ORDINARY');});var needs=el('button','btn btn-secondary','待补资料');needs.type='button';needs.addEventListener('click',function(){openDecision('NEEDS_INFO');});var report=el('button','btn btn-primary','通报质量异常');report.type='button';report.addEventListener('click',openReport);actions.append(ordinary,needs,report);}else{var view=el('a','btn btn-primary','查看质量事件');view.href='/workbench/quality?eventId='+encodeURIComponent(item.review.eventId||'');view.target='_blank';view.rel='noopener noreferrer';actions.appendChild(view);}detail.appendChild(actions);
  }
  async function load(keepSelection){if(loading)return;loading=true;clear(queue);queue.appendChild(el('div','qr-loading','正在加载…'));try{var fd=new FormData(filters),params=new URLSearchParams({scope:scope,q:String(fd.get('q')||''),risk:String(fd.get('risk')||'ALL'),deviceModel:String(fd.get('deviceModel')||''),category:String(fd.get('category')||''),page:'1',pageSize:'100'});var data=await api('/api/workbench/quality/review-queue?'+params);items=data.items||[];Object.keys(data.stats||{}).forEach(function(k){document.querySelectorAll('[data-count="'+k+'"]').forEach(function(n){n.textContent=String(data.stats[k]);});});setSelectOptions('deviceModel',data.filters.deviceModels||[],'全部型号');setSelectOptions('category',data.filters.categories||[],'全部分类');if(!keepSelection||!items.some(function(i){return i.sourceKey===selectedKey;}))selectedKey=items[0]?items[0].sourceKey:'';renderQueue(data);renderDetail();}catch(error){clear(queue);queue.appendChild(el('div','qr-empty',error.message));clear(detail);detail.appendChild(el('div','qr-detail-empty','加载失败，请稍后重试'));}finally{loading=false;}}
  function openDecision(decision){var item=current();if(!item)return;pendingDecision=decision;document.getElementById('qualityReviewNoteTitle').textContent=decision==='ORDINARY'?'标记为普通反馈':'标记为待补资料';document.getElementById('qualityReviewNote').value=item.review.note||'';document.getElementById('qualityReviewNoteFeedback').textContent='';noteDialog.showModal();}
  async function saveDecision(){var item=current();if(!item)return;var feedback=document.getElementById('qualityReviewNoteFeedback');feedback.textContent='正在保存…';try{await api('/api/workbench/quality/source/'+encodeURIComponent(item.sourceKey)+'/review',{method:'POST',body:JSON.stringify({decision:pendingDecision,note:document.getElementById('qualityReviewNote').value,expectedVersion:item.review.version,requestId:uuid()})});noteDialog.close();selectedKey='';await load(false);}catch(error){feedback.textContent=error.message;}}
  function fill(form,name,value){if(form.elements[name])form.elements[name].value=value||'';}
  function openReport(){var item=current();if(!item)return;var f=document.getElementById('qualityReportForm');f.reset();fill(f,'title',(item.category||'客户反馈')+' · '+(item.deviceModel||item.feedbackNo||'质量异常'));fill(f,'currentSituation',item.issueDescription);fill(f,'occurredAt',item.feedbackAt);fill(f,'reporter',item.reporter);fill(f,'deviceModel',item.deviceModel);fill(f,'serialNo',item.serialNo);fill(f,'catheterBatch',item.catheterBatch);fill(f,'category',item.category);fill(f,'impact',item.impact);document.getElementById('qualityReportFeedback').textContent='';reportDialog.showModal();}
  function draftFromForm(){var f=document.getElementById('qualityReportForm'),fd=new FormData(f);return{title:String(fd.get('title')||''),currentSituation:String(fd.get('currentSituation')||''),occurredAt:String(fd.get('occurredAt')||''),reporter:String(fd.get('reporter')||''),deviceModel:String(fd.get('deviceModel')||''),serialNo:String(fd.get('serialNo')||''),catheterBatch:String(fd.get('catheterBatch')||''),category:String(fd.get('category')||''),urgency:String(fd.get('urgency')||'MEDIUM'),impact:String(fd.get('impact')||''),notes:String(fd.get('notes')||'')};}
  async function createReport(submit){var item=current();if(!item)return;var feedback=document.getElementById('qualityReportFeedback');feedback.textContent=submit?'正在提交…':'正在保存草稿…';try{var created=await api('/api/workbench/quality/events/drafts',{method:'POST',body:JSON.stringify({sourceKeys:[item.sourceKey],draft:draftFromForm(),requestId:uuid()})});if(submit){var event=created.event;await api('/api/workbench/quality/events/'+encodeURIComponent(event.eventId)+'/submit',{method:'POST',body:JSON.stringify({expectedVersion:event.version,requestId:uuid()})});reportDialog.close();selectedKey='';await load(false);}else{feedback.textContent='草稿已保存，可在“我通报的事件”中继续编辑。';}}catch(error){feedback.textContent=error.message;}}
  async function retryWriteback(){var item=current();if(!item)return;try{await api('/api/workbench/quality/source/'+encodeURIComponent(item.sourceKey)+'/writeback/retry',{method:'POST',body:JSON.stringify({requestId:uuid()})});await load(true);}catch(error){alert(error.message);}}
  document.querySelectorAll('[data-review-scope]').forEach(function(button){button.addEventListener('click',function(){scope=button.dataset.reviewScope;document.querySelectorAll('[data-review-scope]').forEach(function(b){b.classList.toggle('is-on',b===button);});selectedKey='';void load(false);});});
  filters.addEventListener('submit',function(event){event.preventDefault();selectedKey='';void load(false);});
  document.getElementById('qualityReviewConfirm').addEventListener('click',saveDecision);document.querySelectorAll('[data-close-dialog]').forEach(function(b){b.addEventListener('click',function(){noteDialog.close();});});document.querySelectorAll('[data-close-report]').forEach(function(b){b.addEventListener('click',function(){reportDialog.close();});});document.getElementById('qualityReportForm').addEventListener('submit',function(e){e.preventDefault();void createReport(true);});document.getElementById('qualitySaveReportDraft').addEventListener('click',function(){void createReport(false);});
  document.getElementById('qualityReviewSync').addEventListener('click',async function(){var status=document.getElementById('qualityReviewSyncStatus');status.textContent='正在同步来源…';try{await api('/api/workbench/quality/source/sync',{method:'POST',body:'{}'});status.textContent='来源同步完成';await load(true);}catch(error){status.textContent=error.message;}});
  void api('/api/workbench/quality/source').then(function(data){var s=data.sync||data;document.getElementById('qualityReviewSyncStatus').textContent=s.lastSuccessAt?'上次同步：'+s.lastSuccessAt:'尚无成功同步记录';}).catch(function(){document.getElementById('qualityReviewSyncStatus').textContent='暂时无法读取同步状态';});
  void load(false);
})();`;
}
