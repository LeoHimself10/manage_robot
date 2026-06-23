import { COMPETENCY_EVAL_PAGE_CSS } from "./competency-eval-page-styles";
import { renderWorkbenchPage, type WorkbenchNavId } from "./workbench-shell";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderCompetencyEvalPage(params: {
  userLabel?: string;
  sessionUserId?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
  competencyEvalEnabled?: boolean;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";

  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-competency-eval" as WorkbenchNavId,
    title: "能力评估",
    pageTitle: "能力评估 · 主管工作台",
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    portfolioEnabled: Boolean(params.portfolioEnabled),
    showAdminOpsLink: params.showAdminOpsLink,
    competencyEvalEnabled: Boolean(params.competencyEvalEnabled),
    bodyClass: "page-shell--chat page-shell--comp-eval",
    hideMainHead: true,
    extraCss: COMPETENCY_EVAL_PAGE_CSS,
    mainHtml: `
  <div class="ce-root" id="compEvalChatCard">
    <header class="ce-topbar">
      <div class="ce-topbar-brand">
        <div class="ce-logo" aria-hidden="true">评</div>
        <div>
          <div class="ce-topbar-title">能力评估助手</div>
          <div class="ce-topbar-sub">${who} · 定性能力 · 不修改任务</div>
        </div>
      </div>
      <div class="ce-topbar-spacer"></div>
      <div class="ce-rubric-pill" id="compEvalRubricBanner" hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
        <span id="compEvalRubricLabel"></span>
      </div>
      <label class="ce-upload-btn" title="上传评估标准（.md / .docx）">
        <input type="file" id="compEvalFileInput" accept=".md,.markdown,.docx,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        <span class="ce-upload-text">上传标准</span>
      </label>
    </header>

    <div class="ce-scroll" id="compEvalChatLog" aria-live="polite">
      <div class="ce-thread" id="compEvalThread">
        <div class="ce-empty" id="compEvalChatEmpty">
          <h2>今天想评估谁？</h2>
          <p>先上传能力标准文档，再用人名 + 时间范围提问。我会结合钉钉日报证据给出定性分析，不会改动任何任务。</p>
          <div class="ce-suggestions" id="compEvalChips">
            <button type="button" class="ce-suggest perf-chip" data-q="评张三最近30天">
              <span class="ce-suggest-label">评估某人</span>
              <span class="ce-suggest-hint">例：评张三最近 30 天</span>
            </button>
            <button type="button" class="ce-suggest perf-chip" data-q="换一个人评李四最近30天">
              <span class="ce-suggest-label">换一个人</span>
              <span class="ce-suggest-hint">对比不同下属的表现</span>
            </button>
            <button type="button" class="ce-suggest perf-chip" data-q="这份标准有哪些维度？">
              <span class="ce-suggest-label">解读标准</span>
              <span class="ce-suggest-hint">这份标准有哪些维度</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <footer class="ce-footer">
      <div class="ce-composer-wrap">
        <div class="ce-composer">
          <label class="ce-attach" for="compEvalFileInput" title="上传评估标准">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </label>
          <textarea id="compEvalChatInput" rows="1" placeholder="发送消息…" aria-label="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
          <button type="button" class="ce-send" id="compEvalChatSend" aria-label="发送" title="发送" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
          </button>
        </div>
        <p class="ce-hint">Enter 发送 · Shift+Enter 换行 · 评估基于日报证据，非交付 KPI</p>
      </div>
    </footer>
  </div>`,
    scriptHtml: `<script src="/static/performance-chat-markdown.js"></script><script>${buildCompetencyEvalClientJs()}</script>`,
  });
}

function buildCompetencyEvalClientJs(): string {
  return `
(function(){
  var API_BASE = '/api/workbench/competency-eval';
  var chatScroll = document.getElementById('compEvalChatLog');
  var chatThread = document.getElementById('compEvalThread');
  var chatEmpty = document.getElementById('compEvalChatEmpty');
  var chatInput = document.getElementById('compEvalChatInput');
  var chatSend = document.getElementById('compEvalChatSend');
  var fileInput = document.getElementById('compEvalFileInput');
  var rubricBanner = document.getElementById('compEvalRubricBanner');
  var rubricLabel = document.getElementById('compEvalRubricLabel');
  var HISTORY_KEY = 'comp_eval_chat_history_v1';
  var activeRubricId = '';
  var streaming = false;
  var chatHistory = [];

  function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
  function fmtAssistant(text){
    if(typeof window.formatPerfAssistantHtml==='function') return window.formatPerfAssistantHtml(text||'');
    return esc(text||'');
  }

  function scrollBottom(){
    if(chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function updateSendState(){
    var hasText = (chatInput.value||'').trim().length > 0;
    chatSend.disabled = streaming || !hasText;
  }

  function loadHistory(){
    try {
      var raw = sessionStorage.getItem(HISTORY_KEY);
      if(!raw) return;
      var parsed = JSON.parse(raw);
      if(Array.isArray(parsed)) chatHistory = parsed;
    } catch(e0) {}
  }
  function saveHistory(){
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory.slice(-20))); } catch(e1) {}
  }
  function pushTurn(role, content){
    chatHistory.push({ role: role, content: content });
    if(chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    saveHistory();
  }

  function hideEmpty(){ if(chatEmpty) chatEmpty.style.display='none'; }

  function addMsg(who){
    hideEmpty();
    var row = document.createElement('div');
    row.className = 'ce-msg '+(who==='user'?'is-user':'is-assistant');
    if(who==='user'){
      var inner = document.createElement('div');
      inner.className = 'ce-msg-inner';
      row.appendChild(inner);
      chatThread.appendChild(row);
      scrollBottom();
      return inner;
    }
    var avatar = document.createElement('div');
    avatar.className = 'ce-avatar';
    avatar.textContent = 'AI';
    var body = document.createElement('div');
    body.className = 'ce-msg-body';
    row.appendChild(avatar);
    row.appendChild(body);
    chatThread.appendChild(row);
    scrollBottom();
    return body;
  }

  function showTyping(bubble){
    bubble.innerHTML = '<div class="ce-typing" aria-label="正在输入"><i></i><i></i><i></i></div>';
  }

  function autoGrow(){
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(200, chatInput.scrollHeight) + 'px';
    updateSendState();
  }

  function parseSseBlock(block){
    var event='message', data='';
    block.split('\\n').forEach(function(line){
      if(line.indexOf('event:')===0) event = line.slice(6).trim();
      else if(line.indexOf('data:')===0) data = line.slice(5).trim();
    });
    if(!data) return null;
    try { return { event: event, data: JSON.parse(data) }; } catch(e){ return null; }
  }

  function setRubricBanner(title, dimensionCount){
    if(!rubricBanner || !rubricLabel) return;
    if(!title){
      rubricBanner.hidden = true;
      rubricLabel.textContent = '';
      return;
    }
    rubricBanner.hidden = false;
    rubricLabel.textContent = title + ' · ' + dimensionCount + ' 个维度';
  }

  function restoreChatFromHistory(){
    if(!chatHistory.length) return;
    hideEmpty();
    chatHistory.forEach(function(turn){
      var bubble = addMsg(turn.role === 'user' ? 'user' : 'bot');
      if(turn.role === 'user') bubble.textContent = turn.content;
      else bubble.innerHTML = fmtAssistant(turn.content);
    });
    scrollBottom();
  }

  function uploadRubric(file){
    if(!file) return;
    var fd = new FormData();
    fd.append('file', file, file.name);
    fetch(API_BASE+'/rubrics/upload', { method: 'POST', body: fd })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        if(!res.ok || !res.body || res.body.ok===false){
          var msg = (res.body && (res.body.message || res.body.error)) || '上传失败';
          alert(msg);
          return;
        }
        activeRubricId = String(res.body.activeRubricId || (res.body.rubric && res.body.rubric.rubricId) || '');
        var rubric = res.body.rubric || {};
        setRubricBanner(String(rubric.title||'未命名标准'), Number(rubric.dimensionCount||0));
      })
      .catch(function(e){ alert('上传失败：'+(e.message||e)); });
  }

  function sendChat(text){
    var msg = (text!=null?text:chatInput.value||'').trim();
    if(!msg || streaming) return;
    streaming = true;
    updateSendState();
    chatInput.value=''; autoGrow();
    var u = addMsg('user'); u.textContent = msg;
    var bubble = addMsg('bot');
    showTyping(bubble);
    var hasText = false;
    var finalMessage = '';
    var payload = {
      message: msg,
      stream: true,
      conversationHistory: chatHistory.slice(),
      activeRubricId: activeRubricId || undefined
    };
    fetch(API_BASE+'/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body: JSON.stringify(payload)
    }).then(function(r){
      if(!r.ok || !r.body) throw new Error('HTTP '+r.status);
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function setStream(t){ hasText=true; bubble.innerHTML = fmtAssistant(t)+'<span class="ce-stream-cursor"></span>'; scrollBottom(); }
      function pump(){
        return reader.read().then(function(chunk){
          if(chunk.done){
            if(!hasText) bubble.textContent = '未收到回复，请重试。';
            else {
              bubble.innerHTML = bubble.innerHTML.replace(/<span class="ce-stream-cursor"><\\/span>/,'');
              if(!finalMessage) finalMessage = bubble.textContent || '';
            }
            return;
          }
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split('\\n\\n');
          buf = parts.pop() || '';
          parts.forEach(function(block){
            var ev = parseSseBlock(block);
            if(!ev) return;
            if(ev.event==='status'){
              if(!hasText) showTyping(bubble);
            } else if(ev.event==='delta' && ev.data.message){
              setStream(ev.data.message);
            } else if(ev.event==='done' && ev.data.message){
              hasText=true;
              finalMessage = String(ev.data.message||'');
              bubble.innerHTML = fmtAssistant(finalMessage);
              scrollBottom();
            } else if(ev.event==='error'){
              bubble.textContent = '出错了：'+(ev.data.error||'未知错误');
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function(e){ bubble.textContent = '请求失败：'+(e.message||e); })
      .finally(function(){
        if(finalMessage){
          pushTurn('user', msg);
          pushTurn('assistant', finalMessage);
        }
        streaming=false;
        updateSendState();
        chatInput.focus();
      });
  }

  loadHistory();
  restoreChatFromHistory();
  updateSendState();

  if(fileInput){
    fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      if(f) uploadRubric(f);
      fileInput.value = '';
    });
  }
  chatSend.addEventListener('click', function(){ sendChat(); });
  chatInput.addEventListener('input', autoGrow);
  chatInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
  Array.prototype.forEach.call(document.querySelectorAll('.perf-chip'), function(chip){
    chip.addEventListener('click', function(){ sendChat(chip.dataset.q); });
  });
})();
`;
}
