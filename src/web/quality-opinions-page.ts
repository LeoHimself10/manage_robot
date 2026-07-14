import type { WorkbenchShellRole } from "./workbench-shell";
import { renderWorkbenchPage } from "./workbench-shell";
import { QUALITY_TRACKING_STYLES } from "./quality-tracking-styles";

export function renderQualityOpinionsPage(params: { role: WorkbenchShellRole; userId: string; isSpecialist: boolean }): string {
  return renderWorkbenchPage({
    role: params.role,
    activeNav: "quality-opinions",
    title: "质量意见",
    pageTitle: "质量意见",
    description: params.isSpecialist ? "按评论人查看私密质量事件意见。" : "就质量事件现状与对应质量专员进行私密双向评论。",
    sessionUserId: params.userId,
    extraCss: QUALITY_TRACKING_STYLES,
    mainHtml: `<main class="qt-grid" id="qualityOpinionsRoot" data-specialist="${params.isSpecialist ? "1" : "0"}">
  <section class="qt-card qt-hero"><div><span class="qt-pill">双方私密</span><h2>${params.isSpecialist ? "下级质量意见" : "给质量专员的意见"}</h2><p class="qt-muted">仅您和对应质量专员可见，不进入正式验收链路。</p></div></section>
  <div class="qt-opinion-layout">
    <section class="qt-card"><h3>${params.isSpecialist ? "按评论人分组" : "可评论的进行中事件"}</h3><div class="qt-list" id="qualityOpinionEvents"><div class="qt-empty">正在加载…</div></div><h3>我的对话</h3><div class="qt-list" id="qualityOpinionThreads"></div></section>
    <section class="qt-card qt-conversation"><div id="qualityOpinionHeading"><h3>选择一条对话</h3><p class="qt-muted">历史评论会按时间顺序显示。</p></div><div class="qt-messages" id="qualityOpinionMessages"><div class="qt-empty">尚未选择对话。</div></div><form id="qualityOpinionForm"><label class="qt-field">私密评论<textarea class="qt-textarea" id="qualityOpinionBody" maxlength="5000" required placeholder="请输入对质量事件现状的观察或回复"></textarea></label><div class="qt-form-feedback" id="qualityOpinionFeedback" role="status"></div><button class="btn btn-primary" id="qualityOpinionSend" type="submit">发送评论</button></form></section>
  </div>
</main>`,
    scriptHtml: `<script>${clientScript()}</script>`,
  });
}

function clientScript(): string {
  return String.raw`(function(){
  var root=document.getElementById('qualityOpinionsRoot');if(!root)return;var specialist=root.getAttribute('data-specialist')==='1';var eventsMount=document.getElementById('qualityOpinionEvents');var threadsMount=document.getElementById('qualityOpinionThreads');var messagesMount=document.getElementById('qualityOpinionMessages');var form=document.getElementById('qualityOpinionForm');var body=document.getElementById('qualityOpinionBody');var feedback=document.getElementById('qualityOpinionFeedback');var send=document.getElementById('qualityOpinionSend');var current=null;
  var statusText={PENDING_ASSIGNMENT:'待分配',PENDING_ACCEPTANCE:'待承接',IN_PROGRESS:'处理中',PENDING_PRIMARY_REVIEW:'待原主责确认',PENDING_QUALITY_REVIEW:'待终验',CLOSED:'已关闭'};
  function el(tag,cls,text){var item=document.createElement(tag);if(cls)item.className=cls;if(text!=null)item.textContent=String(text);return item;}function clear(item){item.replaceChildren();}function uuid(){return crypto.randomUUID();}
  async function api(path,options){var response=await fetch(path,options||{});var payload=await response.json().catch(function(){return{};});if(!response.ok||!payload.ok)throw new Error(payload.error||('请求失败（'+response.status+'）'));return payload.data||{};}function post(path,data){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  function threadCard(item){var card=el('button','qt-thread-card');card.type='button';card.append(el('strong','',item.eventNo+' · '+item.eventTitle),el('span','qt-row-meta',(specialist?'评论人：'+item.reportUserId:'对应质量专员：'+item.specialistUserId)+' · '+(statusText[item.eventStatus]||item.eventStatus)));card.addEventListener('click',function(){void openThread(item).catch(showError);});return card;}
  async function load(){var threadData=await api('/api/workbench/quality/opinions/threads');clear(threadsMount);if(!threadData.threads.length)threadsMount.appendChild(el('div','qt-empty','暂无私密对话。'));else threadData.threads.forEach(function(item){threadsMount.appendChild(threadCard(item));});clear(eventsMount);if(specialist){var groups={};threadData.threads.forEach(function(item){(groups[item.reportUserId]||(groups[item.reportUserId]=[])).push(item);});Object.keys(groups).sort().forEach(function(report){var group=el('section','qt-opinion-group');group.appendChild(el('h4','',report+'（'+groups[report].length+'）'));groups[report].forEach(function(item){group.appendChild(threadCard(item));});eventsMount.appendChild(group);});if(!Object.keys(groups).length)eventsMount.appendChild(el('div','qt-empty','暂时没有下级发来的质量意见。'));return;}var data=await api('/api/workbench/quality/opinions/events');if(!data.events.length)eventsMount.appendChild(el('div','qt-empty','暂无可评论的进行中质量事件。'));data.events.forEach(function(item){var card=el('article','qt-mini-card');card.append(el('strong','',item.eventNo+' · '+item.title),el('div','qt-row-desc',item.currentSituation),el('div','qt-row-meta','公开状态：'+(statusText[item.status]||item.status)));var button=el('button','btn btn-secondary btn-sm','就此事件评论');button.type='button';button.addEventListener('click',function(){void post('/api/workbench/quality/opinions/threads',{eventId:item.eventId,specialistUserId:item.specialistUserId}).then(openThread).then(load).catch(showError);});card.appendChild(button);eventsMount.appendChild(card);});}
  async function openThread(item){current=item;document.getElementById('qualityOpinionHeading').replaceChildren(el('h3','',item.eventNo+' · '+item.eventTitle),el('p','qt-muted','当前公开状态：'+(statusText[item.eventStatus]||item.eventStatus)+'。评论仅限双方查看。'));var data=await api('/api/workbench/quality/opinions/threads/'+encodeURIComponent(item.threadId)+'/messages');clear(messagesMount);if(!data.messages.length)messagesMount.appendChild(el('div','qt-empty','暂无评论，可以发送第一条。'));data.messages.forEach(function(message){var mine=message.senderUserId===(specialist?item.specialistUserId:item.reportUserId);var bubble=el('div','qt-message'+(mine?' is-mine':''));bubble.append(el('div','',message.body),el('span','qt-row-meta',message.senderUserId+' · '+new Date(message.createdAt).toLocaleString('zh-CN',{hour12:false})));messagesMount.appendChild(bubble);});body.disabled=item.readOnly;send.disabled=item.readOnly;feedback.textContent=item.readOnly?'事件已关闭，历史评论只读。':'';}
  function showError(error){feedback.textContent=error&&error.message?error.message:String(error);}form.addEventListener('submit',function(event){event.preventDefault();if(!current)return;var text=body.value.trim();if(!text)return;send.disabled=true;feedback.textContent='正在发送…';void post('/api/workbench/quality/opinions/threads/'+encodeURIComponent(current.threadId)+'/messages',{body:text,requestId:uuid()}).then(function(){body.value='';return openThread(current);}).then(function(){return load();}).catch(showError).finally(function(){if(current&&!current.readOnly)send.disabled=false;});});void load().catch(showError);
})();`;
}
