import { PERFORMANCE_PAGE_CSS } from "./performance-page-styles";
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
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
  competencyEvalEnabled?: boolean;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const desc =
    `基于上传的能力标准与钉钉日报，对下属做定性能力评估（非交付 KPI）。${who}`;

  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-competency-eval" as WorkbenchNavId,
    title: "能力评估",
    pageTitle: "能力评估 · 主管工作台",
    description: desc,
    userLabel: params.userLabel,
    portfolioEnabled: Boolean(params.portfolioEnabled),
    showAdminOpsLink: params.showAdminOpsLink,
    competencyEvalEnabled: Boolean(params.competencyEvalEnabled),
    extraCss: PERFORMANCE_PAGE_CSS,
    mainBodyClass: "app-shell--performance",
    mainHtml: `
  <div class="perf-stack">
    <div class="comp-eval-rubric-banner" id="compEvalRubricBanner" hidden></div>
    <section class="card perf-chat-card" id="compEvalChatCard">
      <div class="perf-chat-head">
        <div class="perf-chat-head-avatar">AI</div>
        <div>
          <h2>能力评估助手</h2>
          <p>上传评估标准 · 结合日报证据 · 不会修改任何任务</p>
        </div>
        <label class="comp-eval-upload-btn" title="上传评估标准（.md / .docx）">
          <input type="file" id="compEvalFileInput" accept=".md,.markdown,.docx,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
          <span aria-hidden="true">📎</span>
          <span class="comp-eval-upload-lbl">上传标准</span>
        </label>
        <span class="perf-chat-status">在线</span>
      </div>
      <div class="perf-chat-log" id="compEvalChatLog">
        <div class="perf-chat-empty" id="compEvalChatEmpty">
          <p>上传能力标准后，用自然语言开始评估 👇</p>
          <div class="perf-chips" id="compEvalChips">
            <button type="button" class="perf-chip" data-q="评张三最近30天">评 [姓名] 最近30天</button>
            <button type="button" class="perf-chip" data-q="换一个人评李四最近30天">换一个人</button>
            <button type="button" class="perf-chip" data-q="这份标准有哪些维度？">这份标准有哪些维度</button>
          </div>
        </div>
      </div>
      <div class="perf-composer">
        <textarea id="compEvalChatInput" rows="1" placeholder="输入问题，回车发送（Shift+Enter 换行）"></textarea>
        <button type="button" class="perf-send" id="compEvalChatSend" aria-label="发送" title="发送">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
        </button>
      </div>
    </section>
  </div>
  <style>
  .comp-eval-rubric-banner {
    padding: 12px 16px;
    border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
    background: var(--primary-soft);
    font-size: 13px;
    color: var(--text);
  }
  .comp-eval-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    margin-right: 10px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text);
    transition: border-color .15s ease, background .15s ease;
  }
  .comp-eval-upload-btn:hover { border-color: var(--primary); background: var(--primary-soft); }
  .comp-eval-upload-lbl { display: none; }
  @media (min-width: 640px) { .comp-eval-upload-lbl { display: inline; } }
  </style>`,
    scriptHtml: `<script src="/static/performance-chat-markdown.js"></script><script>${buildCompetencyEvalClientJs()}</script>`,
  });
}

function buildCompetencyEvalClientJs(): string {
  return `
(function(){
  var API_BASE = '/api/workbench/competency-eval';
  var chatLog = document.getElementById('compEvalChatLog');
  var chatEmpty = document.getElementById('compEvalChatEmpty');
  var chatInput = document.getElementById('compEvalChatInput');
  var chatSend = document.getElementById('compEvalChatSend');
  var fileInput = document.getElementById('compEvalFileInput');
  var rubricBanner = document.getElementById('compEvalRubricBanner');
  var HISTORY_KEY = 'comp_eval_chat_history_v1';
  var activeRubricId = '';
  var streaming = false;
  var chatHistory = [];

  function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
  function fmtAssistant(text){
    if(typeof window.formatPerfAssistantHtml==='function') return window.formatPerfAssistantHtml(text||'');
    return esc(text||'');
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
    row.className = 'perf-msg-row '+(who==='user'?'is-user':'is-bot');
    var avatar = document.createElement('div');
    avatar.className = 'perf-avatar '+(who==='user'?'is-user':'is-bot');
    avatar.textContent = who==='user' ? '我' : 'AI';
    var bubble = document.createElement('div');
    bubble.className = 'perf-bubble';
    row.appendChild(avatar);
    row.appendChild(bubble);
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
    return bubble;
  }

  function showTyping(bubble){ bubble.innerHTML = '<span class="perf-dots"><i></i><i></i><i></i></span>'; }

  function autoGrow(){
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(140, chatInput.scrollHeight) + 'px';
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
    if(!rubricBanner) return;
    if(!title){
      rubricBanner.hidden = true;
      rubricBanner.textContent = '';
      return;
    }
    rubricBanner.hidden = false;
    rubricBanner.textContent = '已加载：'+title+'（'+dimensionCount+'个维度）';
  }

  function restoreChatFromHistory(){
    if(!chatHistory.length) return;
    chatHistory.forEach(function(turn){
      var bubble = addMsg(turn.role === 'user' ? 'user' : 'bot');
      if(turn.role === 'user') bubble.textContent = turn.content;
      else bubble.innerHTML = fmtAssistant(turn.content);
    });
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
    chatInput.value=''; autoGrow();
    var u = addMsg('user'); u.textContent = msg;
    var bubble = addMsg('bot');
    showTyping(bubble);
    chatSend.disabled = true;
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
      function setStream(t){ hasText=true; bubble.innerHTML = fmtAssistant(t)+'<span class="perf-stream-cursor"></span>'; chatLog.scrollTop = chatLog.scrollHeight; }
      function pump(){
        return reader.read().then(function(chunk){
          if(chunk.done){
            if(!hasText) bubble.textContent = '未收到回复，请重试。';
            else {
              bubble.innerHTML = bubble.innerHTML.replace(/<span class="perf-stream-cursor"><\\/span>/,'');
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
        chatSend.disabled=false;
        chatInput.focus();
      });
  }

  loadHistory();
  restoreChatFromHistory();

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
