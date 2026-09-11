'use strict';
// Review prototype only. OA comments and node returns are browser-local simulations.
// Existing source snapshots, AI attempts and formal analysis versions stay intact.
const acceptanceOriginal = {
  seed, renderSource, taskHeader, owner,
  demoAction, openGuide, renderActivity
};
const acceptanceCommentTimers = new Map();
const ACCEPTANCE_LIMIT = 2000;

function initAcceptance(data) {
  for (const e of data.events) {
    e.oaComments ||= [];
    e.acceptanceHistory ||= [];
    if (e.finalDraft && !('outcome' in e.finalDraft)) {
      e.legacyFinalDraft = clone(e.finalDraft);
      e.finalDraft = {outcome:'PASS', comment:e.finalDraft.conclusion || '', target:'', reason:''};
    }
  }
  return data;
}
seed = function() { return initAcceptance(acceptanceOriginal.seed()); };
initAcceptance(storeData);
persist();

function acceptanceDraft(e) {
  return e.finalDraft ||= {outcome:'', comment:'', target:'', reason:''};
}
function acceptanceNodes(e) {
  const result = [];
  for (const manager of [...new Set(tasks(e).map(t=>t.manager))]) {
    const children = tasks(e).filter(t=>t.manager===manager);
    result.push({id:'manager:'+manager, kind:'MANAGER', person:manager,
      title:'主管节点', taskIds:children.map(t=>t.id)});
    for (const t of children) result.push({id:t.nodeId, kind:'EMPLOYEE', person:t.person,
      manager:t.manager, title:t.title, taskIds:[t.id], taskId:t.id});
  }
  return result;
}
function acceptanceGate(e) {
  if (e.mode!=='quality') return '当前尚未进入质量验收，请先完成主管验收。';
  if (!tasks(e).length || tasks(e).some(t=>t.status!=='passed' || !t.evidence.some(ev=>ev.versions.length)))
    return '仍有任务尚未通过主管验收或缺少执行证据。';
  if (e.supervisorReturn?.pending) return '主管正在处理质量退回，重新提交后再验收。';
  if (e.sync?.status==='pending') return '初析中的任务要求已变更，请先由主管确认同步。';
  return '';
}
function renderAcceptanceNodes(e, target, name='acceptanceTarget') {
  return `<fieldset class="acceptance-node-list"><legend class="sr-only">选择退回节点</legend>${acceptanceNodes(e).map(n=>`
    <label class="acceptance-node ${n.kind==='EMPLOYEE'?'employee':'manager'}">
      <input type="radio" name="${name}" value="${esc(n.id)}" ${target===n.id?'checked':''}>
      <span><strong>${esc(n.person)}</strong>${badge(n.kind==='MANAGER'?'主管':'员工')}
      <small>${n.kind==='MANAGER'?'由主管核对验收意见，继续组织处理':esc(n.title)}</small></span>
    </label>`).join('')}</fieldset>`;
}
function acceptanceImpact(e, target) {
  const n=acceptanceNodes(e).find(n=>n.id===target);
  if (!n) return '<strong>先选择一个退回节点</strong>可以退回主管，也可以退回某个员工承担的具体任务。';
  if (n.kind==='MANAGER') return `<strong>退回给主管 · ${esc(n.person)}</strong>由主管核对问题并组织后续处理。员工已提交的结果和历史证据保留，由主管判断哪些工作需要补充。`;
  return `<strong>退回给员工 · ${esc(n.person)}</strong>${esc(n.title)} → ${esc(n.manager)}重新验收 → 佟成质量验收。其他任务的有效结果与全部历史证据保留。`;
}
function renderAcceptanceHistory(e) {
  const history = e.acceptanceHistory;
  const legacy = e.closures.filter(c=>!c.acceptanceId);
  if (!history.length && !legacy.length) return '';
  return `<details class="acceptance-history"><summary>历史验收记录 · ${history.length+legacy.length} 条</summary>
    ${[...history].reverse().map(h=>`<article class="acceptance-history-item">${badge(h.outcome==='PASS'?'验收通过':h.outcome==='REOPEN'?'重开事件':'验收不通过',h.outcome==='PASS'?'green':'amber')}
      <small>佟成 · ${esc(h.time)}${h.target?' · 退回给 '+esc(h.target.person):''}</small><p>${esc(h.comment)}</p></article>`).join('')}
    ${[...legacy].reverse().map(c=>`<article class="acceptance-history-item">${badge('历史验收通过','green')} <small>${esc(c.author)} · ${esc(c.time)}</small><p>${esc(c.conclusion)}</p>
      <details class="link-details"><summary>查看历史完整记录</summary>${block('最终分类',c.category)}${block('根因',c.root)}${block('处理措施',c.measure)}${block('验证结果',c.validation)}</details></article>`).join('')}
  </details>`;
}
function commentState(c) {
  return c.status==='SENT'?'已同步到 OA 评论（模拟）':c.status==='FAILED'?'同步失败，验收结果已保存（模拟）':'正在同步到 OA 评论（模拟）';
}
function renderOaComments(e, includeLink=true) {
  return `<section class="oa-comments" aria-label="OA评论预览"><header class="oa-comments-header"><div><h3>OA 评论</h3><p>故障处理反馈 · ${esc(e.source.no)}</p></div>${badge('同步效果预览','blue')}</header>
    <div class="oa-comments-body">${e.oaComments.length?[...e.oaComments].reverse().map(c=>`<article class="oa-comment" data-comment-id="${esc(c.id)}">
      <div class="oa-comment-avatar" aria-hidden="true">佟</div><div class="oa-comment-main"><div class="oa-comment-heading"><span><strong>${esc(c.author)}</strong> 添加了评论</span><time>${esc(c.time.slice(5))}</time></div>
      <div class="oa-comment-content">${esc(c.content)}</div><div class="oa-comment-state ${c.status.toLowerCase()}" role="status"><span>${commentState(c)}</span>${c.status==='FAILED'?`<button class="text-btn" data-acceptance-retry="${esc(c.id)}">重试同步</button>`:''}</div>
      </div></article>`).join(''):'<p class="oa-comments-empty">尚无质量验收评论。验收通过后，填写的验收意见会出现在这里。</p>'}</div>
    <footer class="oa-comments-footer"><span>当前为本地演示，未向真实 OA 单据发送评论。</span>${includeLink?'<button class="text-btn" data-acceptance="view-comments">查看来源单据评论 →</button>':''}</footer></section>`;
}

renderFinal = function(e) {
  let html=`<div class="section-heading"><div><h3>质量验收</h3><p>核对任务结果与证据，选择本次验收结果。</p></div>${badge(statusText[e.mode],tone(e))}</div>`;
  if (e.mode==='closed') {
    const c=e.closures.at(-1);
    return html+`<div class="acceptance-record"><h3>✓ 验收通过，事件已关闭</h3><p>${esc(c?.conclusion||'历史验收通过')}</p><small>${esc(c?.author||'佟成')} · ${esc(c?.time||'')} · 证据与历史版本已保留</small></div>`+
      renderOaComments(e)+`<div class="form-actions"><button class="btn" data-tab="evidence">查看验收证据</button><button class="text-btn" data-action="reopen">选择节点并重开事件</button></div>`+renderAcceptanceHistory(e);
  }
  if (e.mode!=='quality') {
    const ret=e.returnInfo;
    html+=ret&&['returned','reopened'].includes(e.mode)?`<div class="acceptance-record returned"><h3>${e.mode==='reopened'?'事件已重开':'验收不通过'} · 已退回${ret.kind==='MANAGER'?'主管':'员工'}</h3><p>${esc(ret.reason)}</p><small>当前处理：${esc(ret.person||tasks(e).find(t=>t.id===ret.taskId)?.person||'对应责任人')} · ${esc(ret.time)}</small></div>`:note('任务处理及主管验收完成后，再进行质量验收。');
    html+=`<div class="form-actions"><span class="muted">${ret?.kind==='MANAGER'?'等待主管核对并重新提交验收。':'补充处理并通过主管验收后，再交佟成验收。'}</span><button class="btn" data-tab="evidence">查看责任链与证据</button></div>`;
    return html+(e.oaComments.length?renderOaComments(e):'')+renderAcceptanceHistory(e);
  }
  const f=acceptanceDraft(e),gate=acceptanceGate(e);
  html+=`<div class="acceptance-summary"><strong>${tasks(e).filter(t=>t.status==='passed').length} / ${tasks(e).length} 项任务已通过主管验收 · ${tasks(e).reduce((n,t)=>n+t.evidence.length,0)} 份任务证据</strong><button class="text-btn" data-tab="evidence">查看结果与证据 →</button></div>`;
  if (gate) html+=note(gate,'amber');
  html+=`<form id="finalForm" novalidate><fieldset class="acceptance-options"><legend class="sr-only">验收结果</legend>
    <label class="acceptance-option"><input type="radio" name="acceptanceOutcome" value="PASS" ${f.outcome==='PASS'?'checked':''}><span><strong>验收通过</strong><small>填写验收意见，同步到原始 OA 评论</small></span></label>
    <label class="acceptance-option"><input type="radio" name="acceptanceOutcome" value="FAIL" ${f.outcome==='FAIL'?'checked':''}><span><strong>验收不通过</strong><small>选择主管或员工节点，退回补充处理</small></span></label>
  </fieldset>`;
  if (f.outcome==='PASS') html+=`<section class="acceptance-panel"><div class="acceptance-comment-target"><span class="comment-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg></span><div><strong>同步位置：原始 OA 单据的「评论」区</strong><small>${esc(e.source.no)} · ${esc(e.source.title)}</small></div></div>
    <label class="form-field"><span>验收意见 <i class="required">*</i></span><textarea id="acceptanceComment" name="comment" maxlength="2000" placeholder="填写本次验收意见，例如：处理结果和验证证据已核对，同意验收通过。">${esc(f.comment)}</textarea></label>
    <div class="acceptance-input-meta"><span>提交后将关闭事件，并将这段意见连同事件编号同步到 OA 评论。</span><span id="acceptanceCount">${f.comment.length} / ${ACCEPTANCE_LIMIT}</span></div>
    <div class="form-error" id="finalError" role="alert" hidden></div><div class="form-actions"><span class="tiny muted">输入内容自动暂存，尚未提交</span><button type="submit" class="btn primary">确认通过并同步评论</button></div></section>`;
  else if (f.outcome==='FAIL') html+=`<section class="acceptance-panel"><h4>退回到哪个节点？</h4><p class="muted">按责任链选择一个主管节点或员工任务节点。</p>${renderAcceptanceNodes(e,f.target)}
    <div class="acceptance-impact" id="acceptanceImpact">${acceptanceImpact(e,f.target)}</div>
    <label class="form-field"><span>不通过原因与补充要求 <i class="required">*</i></span><textarea name="reason" maxlength="2000" placeholder="说明哪里未通过、需要补充什么，便于接收人继续处理。">${esc(f.reason)}</textarea></label>
    <div class="form-error" id="finalError" role="alert" hidden></div><div class="form-actions"><span class="tiny muted">退回意见会交给所选节点；历史结果与证据保留。</span><button type="submit" class="btn primary">确认退回</button></div></section>`;
  else html+='<p class="acceptance-choice-hint">选择验收结果后继续。</p>';
  return html+'</form>'+renderAcceptanceHistory(e);
};

readFinal = function() {
  const form=$('finalForm'),e=eventById();
  if (!form||!e) return;
  const f=acceptanceDraft(e);
  const choice=form.querySelector('[name="acceptanceOutcome"]:checked');
  if (choice) f.outcome=choice.value;
  if (form.elements.namedItem('comment')) f.comment=form.elements.namedItem('comment').value;
  if (form.elements.namedItem('reason')) f.reason=form.elements.namedItem('reason').value;
  const target=form.querySelector('[name="acceptanceTarget"]:checked');
  if (target) f.target=target.value;
  persist();
  return f;
};
function acceptanceError(message) {
  const el=$('finalError');
  if (!el) return toast(message);
  el.hidden=false;el.textContent=message;el.scrollIntoView({block:'center'});
}
function rerenderAcceptance(e) { if(state.selected===e.id) render(); }
function syncOaComment(e,c,retry=false) {
  if (retry) {
    if (c.status!=='FAILED') return;
    c.status='PENDING';c.failDelivery=false;c.attempts+=1;
    log(e,'重新同步验收评论（模拟）','保留原评论内容，仅重试同一条评论。');
    rerenderAcceptance(e);
  }
  const key=e.id+':'+c.id;
  if (c.status!=='PENDING'||acceptanceCommentTimers.has(key)) return;
  acceptanceCommentTimers.set(key,setTimeout(()=>{
    acceptanceCommentTimers.delete(key);
    if (!storeData.events.includes(e)||!e.oaComments.includes(c)||c.status!=='PENDING') return;
    c.status=c.failDelivery?'FAILED':'SENT';
    log(e,c.status==='SENT'?'验收意见已同步到 OA 评论（模拟）':'OA 评论同步失败（模拟）',c.status==='SENT'?'来源单据：'+e.source.no+'；验收意见已保留。':'验收结果保持已通过，可重试评论同步。');
    rerenderAcceptance(e);
  },950));
}
closeEvent = function() {
  const e=eventById(),f=readFinal();
  if (!e||!f||e.mode!=='quality') return;
  if (f.outcome==='FAIL') {
    const n=acceptanceNodes(e).find(n=>n.id===f.target),reason=f.reason.trim();
    if (!n||!reason) return acceptanceError('请选择退回节点，并填写不通过原因与补充要求。');
    return commitAcceptanceReturn(e,n,reason,false);
  }
  const gate=acceptanceGate(e);
  if (gate) return acceptanceError(gate);
  if (f.outcome!=='PASS'||!f.comment.trim()) return acceptanceError('请填写验收意见，提交后同步到 OA 评论。');
  if (f.comment.length>ACCEPTANCE_LIMIT) return acceptanceError('验收意见最多 2000 字。');
  const comment=f.comment.trim(),round=e.closures.length+1,id=e.id+'-acceptance-'+round;
  if (e.oaComments.some(c=>c.id===id)) return;
  const c={id,author:'佟成',time:NOW,opinion:comment,content:'【质量验收通过】\n事件：'+e.no+' · '+e.source.title+'\n\n'+comment,status:'PENDING',attempts:1,failDelivery:!!e.failNextOaComment};
  e.failNextOaComment=false;
  e.closures.push({acceptanceId:id,author:'佟成',time:NOW,conclusion:comment,category:e.versions.at(-1)?.confirmedCategory||e.managerReview.category});
  e.acceptanceHistory.push({id,outcome:'PASS',comment,time:NOW});
  e.oaComments.push(c);e.mode='closed';e.finalDraft=null;
  log(e,'质量验收通过',comment);
  if (!matchesScope(e)) state.scope='全部事件';
  render();
  toast('验收通过，正在模拟同步到 OA 评论。');
  syncOaComment(e,c);
};
function commitAcceptanceReturn(e,n,reason,reopen) {
  if (reopen?e.mode!=='closed':e.mode!=='quality') return;
  if (n.kind==='MANAGER') {
    e.supervisorReturn={manager:n.person,taskIds:clone(n.taskIds),pending:true,reason,time:NOW};
  } else {
    const t=tasks(e).find(t=>t.id===n.taskId);
    if (!t) return;
    t.status='returned';t.progress=Math.min(t.progress,80);
    t.feedback='收到质量验收退回意见，按要求补充处理并提交新证据。';
    e.supervisorReturn=null;
  }
  e.returnInfo={kind:n.kind,nodeId:n.id,taskId:n.taskId||null,person:n.person,
    taskIds:clone(n.taskIds),reason,requirements:'按上述意见补充处理并提交证据，再经主管验收。',time:NOW};
  e.mode=reopen?'reopened':'returned';e.finalDraft=null;
  e.acceptanceHistory.push({outcome:reopen?'REOPEN':'FAIL',target:clone(n),comment:reason,time:NOW});
  log(e,reopen?'重开事件并退回节点':'质量验收不通过',`退回给${n.kind==='MANAGER'?'主管':'员工'} ${n.person}；${n.title}；${reason}`);
  e.notifications.push({id:'acceptance-return-'+e.acceptanceHistory.length,title:'质量验收'+(reopen?'重开':'不通过')+'，请继续处理',recipient:n.person,status:'SENT',attempts:1});
  closeDialog();if(!matchesScope(e))state.scope='全部事件';state.tab='final';render();
  toast('已退回给'+n.person+'，历史结果和证据已保留（模拟）。');
}
openReturn = function(reopen=false) {
  const e=eventById();
  if (!reopen) {if(e.mode!=='quality')return;acceptanceDraft(e).outcome='FAIL';state.tab='final';render();return;}
  if(e.mode!=='closed')return;
  showDialog('选择节点并重开事件',`<p class="muted">选择继续处理的主管或员工节点。历史验收、证据和已同步的 OA 评论均保留。</p>${renderAcceptanceNodes(e,'','acceptanceReopenTarget')}<div class="acceptance-impact" id="acceptanceReopenImpact">${acceptanceImpact(e,'')}</div>${field('acceptanceReopenReason','重开原因与补充要求','',{full:true})}<div class="form-error" id="reopenError" role="alert" hidden></div>`,'确认重开并退回',()=>{
    const id=document.querySelector('[name="acceptanceReopenTarget"]:checked')?.value;
    const n=acceptanceNodes(e).find(n=>n.id===id),reason=document.querySelector('[name="acceptanceReopenReason"]').value.trim();
    if(!n||!reason){$('reopenError').hidden=false;$('reopenError').textContent='请选择节点，并填写重开原因与补充要求。';return;}
    commitAcceptanceReturn(e,n,reason,true);
  });
};

renderSource = function(e) {
  const html=acceptanceOriginal.renderSource(e),start=html.indexOf('<div class="source-tabs">'),end=html.indexOf('</div>',start);
  if(start<0||end<0)return html;
  const tab=`<button data-source-tab="comments" class="${state.sourceTab==='comments'?'active':''}">OA 评论${e.oaComments.length?' · '+e.oaComments.length:''}</button>`;
  const header=html.slice(0,end)+tab+'</div>';
  return header+(state.sourceTab==='comments'?renderOaComments(e,false):html.slice(end+6));
};
function supervisorReturnNotice(e) {
  if(!e.supervisorReturn?.pending)return '';
  return `<div class="acceptance-root-return"><strong>已退回主管 ${esc(e.supervisorReturn.manager)} · 待继续处理</strong><p>${esc(e.supervisorReturn.reason)}</p><small>员工已提交的结果与证据保留；由主管核对并组织补充处理。</small></div>`;
}
owner = function(e) { return e.supervisorReturn?.pending?e.supervisorReturn.manager:acceptanceOriginal.owner(e); };
taskHeader = function(e) { return supervisorReturnNotice(e)+acceptanceOriginal.taskHeader(e); };
renderActivity = function(e) {
  return acceptanceOriginal.renderActivity(e)+(e.oaComments.length?renderOaComments(e):'');
};
demoAction = function(action) {
  const e=eventById();
  if(action==='fill-final') {
    if(!e||e.mode!=='quality')return toast('请先打开待验收事件。');
    e.finalDraft={outcome:'PASS',comment:'已核对处理结果、对照复测和主管验收记录，证据完整，验证结果符合处理要求，同意验收通过。',target:'',reason:''};
    persist();closeDialog();state.tab='final';render();return;
  }
  const wasPending=!!e?.supervisorReturn?.pending;
  acceptanceOriginal.demoAction(action);
  if(action==='task-update'&&wasPending&&e.mode==='quality') {
    e.supervisorReturn.pending=false;
    log(e,'主管重新提交质量验收（模拟）','主管已处理退回意见并重新核对现有员工结果和证据。',e.supervisorReturn.manager);
    render();
  }
};
openGuide = function() {
  acceptanceOriginal.openGuide();
  const section=document.createElement('section');section.className='read-section';
  section.innerHTML='<h3>OA 评论同步情境</h3><p class="tiny muted">可验证同步失败后重试；不重复提交验收，也不新增重复评论。</p><button class="btn" data-acceptance="fail-next-comment">模拟下一次评论同步失败</button>';
  $('dialogBody').appendChild(section);
};
$('guideButton').onclick=openGuide;
document.addEventListener('change',ev=>{
  if(ev.target.name==='acceptanceOutcome'){readFinal();render();}
  if(ev.target.name==='acceptanceTarget'){readFinal();$('acceptanceImpact').innerHTML=acceptanceImpact(eventById(),ev.target.value);}
  if(ev.target.name==='acceptanceReopenTarget')$('acceptanceReopenImpact').innerHTML=acceptanceImpact(eventById(),ev.target.value);
});
document.addEventListener('input',ev=>{
  if(!ev.target.closest('#finalForm'))return;
  if($('acceptanceCount'))$('acceptanceCount').textContent=acceptanceDraft(eventById()).comment.length+' / '+ACCEPTANCE_LIMIT;
  if($('finalError'))$('finalError').hidden=true;
});
document.addEventListener('click',ev=>{
  const b=ev.target.closest('[data-acceptance],[data-acceptance-retry]');
  if(!b)return;const e=eventById();if(!e)return;
  if(b.dataset.acceptanceRetry){const c=e.oaComments.find(c=>c.id===b.dataset.acceptanceRetry);if(c)syncOaComment(e,c,true);return;}
  if(b.dataset.acceptance==='view-comments'){readFinal();state.tab='source';state.sourceTab='comments';render();}
  if(b.dataset.acceptance==='fail-next-comment'){e.failNextOaComment=true;persist();closeDialog();toast('下一次验收通过后，将模拟 OA 评论同步失败。');}
});
for(const e of storeData.events)for(const c of e.oaComments)if(c.status==='PENDING')syncOaComment(e,c);
render();
