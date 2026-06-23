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
    <div class="ce-sidebar-backdrop" id="compEvalSidebarBackdrop" hidden aria-hidden="true"></div>
    <aside class="ce-sidebar" id="compEvalSidebar" aria-label="评估会话历史">
      <div class="ce-sidebar-head">
        <button type="button" class="ce-new-session" id="compEvalNewSession">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          新评估
        </button>
        <button type="button" class="ce-sidebar-collapse" id="compEvalSidebarCollapse" aria-label="收起会话列表" title="收起">◀</button>
      </div>
      <ul class="ce-session-list" id="compEvalSessionList" role="list"></ul>
      <p class="ce-sidebar-tip">会话保存在服务器，换设备登录可继续查看。</p>
    </aside>

    <div class="ce-main">
      <header class="ce-topbar">
        <button type="button" class="ce-sidebar-expand" id="compEvalSidebarExpand" aria-label="展开会话列表" title="会话历史">☰</button>
        <button type="button" class="ce-sidebar-toggle" id="compEvalSidebarToggle" aria-label="打开会话列表" aria-expanded="false">☰</button>
        <div class="ce-topbar-brand">
          <div class="ce-logo" aria-hidden="true">评</div>
          <div>
            <div class="ce-topbar-title">能力评估助手</div>
            <div class="ce-topbar-sub">${who} · 定性能力 · 不修改任务</div>
          </div>
        </div>
        <div class="ce-topbar-spacer"></div>
        <div class="ce-jobreq-pill" id="compEvalJobReqBanner" hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span id="compEvalJobReqLabel"></span>
        </div>
        <label class="ce-upload-btn" title="上传岗位要求（.md / .docx）">
          <input type="file" id="compEvalFileInput" accept=".md,.markdown,.docx,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span class="ce-upload-text">上传岗位要求</span>
        </label>
      </header>

      <div class="ce-scroll" id="compEvalChatLog" aria-live="polite">
        <div class="ce-thread" id="compEvalThread">
          <div class="ce-empty" id="compEvalChatEmpty">
            <h2>今天想评估谁？</h2>
            <p>可上传岗位要求（可选），用人名 + 时间范围提问。我会结合钉钉日报证据给出定性分析，不会改动任何任务。</p>
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
    </div>
  </div>`,
    scriptHtml: `<script src="/static/performance-chat-markdown.js"></script><script>${buildCompetencyEvalClientJs()}</script>`,
  });
}

function buildCompetencyEvalClientJs(): string {
  return `
(function(){
  var API_BASE = '/api/workbench/competency-eval';
  var COLLAPSE_KEY = 'comp_eval_sidebar_collapsed';
  var root = document.getElementById('compEvalChatCard');
  var chatScroll = document.getElementById('compEvalChatLog');
  var chatThread = document.getElementById('compEvalThread');
  var chatEmpty = document.getElementById('compEvalChatEmpty');
  var chatInput = document.getElementById('compEvalChatInput');
  var chatSend = document.getElementById('compEvalChatSend');
  var fileInput = document.getElementById('compEvalFileInput');
  var jobReqBanner = document.getElementById('compEvalJobReqBanner');
  var jobReqLabel = document.getElementById('compEvalJobReqLabel');
  var sessionList = document.getElementById('compEvalSessionList');
  var newSessionBtn = document.getElementById('compEvalNewSession');
  var sidebarToggle = document.getElementById('compEvalSidebarToggle');
  var sidebarCollapse = document.getElementById('compEvalSidebarCollapse');
  var sidebarExpand = document.getElementById('compEvalSidebarExpand');
  var sidebarBackdrop = document.getElementById('compEvalSidebarBackdrop');

  var activeSessionId = '';
  var activeSession = null;
  var listItems = [];
  var streaming = false;

  function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
  function fmtAssistant(text){
    if(typeof window.formatPerfAssistantHtml==='function') return window.formatPerfAssistantHtml(text||'');
    return esc(text||'');
  }

  function apiJson(url, opts){
    return fetch(url, opts || {}).then(function(r){
      return r.json().then(function(j){ return { ok: r.ok, body: j }; });
    });
  }

  function formatSessionTime(ts){
    var d = new Date(ts);
    var today = new Date();
    if(d.toDateString()===today.toDateString()){
      return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
    }
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function setSidebarCollapsed(collapsed){
    if(!root) return;
    root.classList.toggle('is-sidebar-collapsed', collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch(e0) {}
  }

  function setSidebarOpen(open){
    if(!root) return;
    root.classList.toggle('is-sidebar-open', open);
    if(sidebarBackdrop){
      sidebarBackdrop.hidden = !open;
      sidebarBackdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if(sidebarToggle) sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderSessionList(){
    if(!sessionList) return;
    sessionList.innerHTML = '';
    if(!listItems.length){
      sessionList.innerHTML = '<li class="ce-session-empty">暂无会话，点击「新评估」开始</li>';
      return;
    }
    listItems.forEach(function(sess){
      var li = document.createElement('li');
      li.className = 'ce-session-item'+(sess.sessionId===activeSessionId?' is-active':'');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ce-session-btn';
      btn.innerHTML = '<span class="ce-session-title">'+esc(sess.title||'新评估')+'</span>'+
        '<span class="ce-session-meta">'+formatSessionTime(sess.updatedAt)+' · '+(sess.messageCount||0)+' 轮</span>';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ce-session-del';
      del.title = '删除会话';
      del.setAttribute('aria-label','删除会话');
      del.textContent = '×';
      del.addEventListener('click', function(e){
        e.stopPropagation();
        deleteSession(sess.sessionId);
      });
      btn.addEventListener('click', function(){ switchSession(sess.sessionId); });
      li.appendChild(btn);
      li.appendChild(del);
      sessionList.appendChild(li);
    });
  }

  function applySessionJobReq(sess){
    if(!sess) { setJobReqBanner(''); return; }
    if(sess.jobReqFilename) setJobReqBanner(sess.jobReqFilename);
    else setJobReqBanner('');
  }

  function loadSessionById(id){
    return apiJson(API_BASE+'/sessions/'+encodeURIComponent(id)).then(function(res){
      if(!res.ok || !res.body || !res.body.session) throw new Error('load failed');
      activeSession = res.body.session;
      activeSessionId = activeSession.sessionId;
      applySessionJobReq(activeSession);
      paintMessages(activeSession.messages || [], activeSession.jobReqFilename);
      return activeSession;
    });
  }

  function refreshListAndActive(){
    return apiJson(API_BASE+'/sessions').then(function(res){
      if(!res.ok || !res.body) throw new Error('list failed');
      listItems = res.body.sessions || [];
      activeSessionId = String(res.body.activeSessionId || (listItems[0] && listItems[0].sessionId) || '');
      renderSessionList();
      if(!activeSessionId) return null;
      return loadSessionById(activeSessionId);
    });
  }

  function persistSessionPatch(patch){
    if(!activeSessionId) return Promise.resolve();
    return apiJson(API_BASE+'/sessions/'+encodeURIComponent(activeSessionId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).then(function(res){
      if(res.ok && res.body && res.body.session){
        activeSession = res.body.session;
        listItems = listItems.map(function(it){
          if(it.sessionId !== activeSession.sessionId) return it;
          return {
            sessionId: activeSession.sessionId,
            title: activeSession.title,
            createdAt: activeSession.createdAt,
            updatedAt: activeSession.updatedAt,
            messageCount: (activeSession.messages||[]).length,
            activeJobReqId: activeSession.activeJobReqId,
            jobReqFilename: activeSession.jobReqFilename
          };
        }).sort(function(a,b){ return Date.parse(b.updatedAt)-Date.parse(a.updatedAt); });
        renderSessionList();
      }
    });
  }

  function switchSession(id){
    if(streaming) return;
    if(id===activeSessionId) { setSidebarOpen(false); return; }
    apiJson(API_BASE+'/sessions/'+encodeURIComponent(id)+'/activate', { method: 'POST' })
      .then(function(){ return loadSessionById(id); })
      .then(function(){ renderSessionList(); setSidebarOpen(false); chatInput.focus(); })
      .catch(function(e){ alert('切换失败：'+(e.message||e)); });
  }

  function createNewSession(){
    if(streaming) return;
    if(activeSession && !activeSession.messages.length && activeSession.title==='新评估'){
      setSidebarOpen(false);
      chatInput.focus();
      return;
    }
    apiJson(API_BASE+'/sessions', { method: 'POST' })
      .then(function(res){
        if(!res.ok || !res.body || !res.body.session) throw new Error('create failed');
        activeSession = res.body.session;
        activeSessionId = activeSession.sessionId;
        listItems.unshift({
          sessionId: activeSession.sessionId,
          title: activeSession.title,
          createdAt: activeSession.createdAt,
          updatedAt: activeSession.updatedAt,
          messageCount: 0
        });
        renderSessionList();
        applySessionJobReq(activeSession);
        paintMessages([]);
        setSidebarOpen(false);
        chatInput.focus();
      })
      .catch(function(e){ alert('创建失败：'+(e.message||e)); });
  }

  function deleteSession(id){
    if(streaming) return;
    apiJson(API_BASE+'/sessions/'+encodeURIComponent(id), { method: 'DELETE' })
      .then(function(res){
        if(!res.ok) throw new Error('delete failed');
        listItems = res.body.sessions || [];
        activeSessionId = String(res.body.activeSessionId || '');
        renderSessionList();
        if(activeSessionId) return loadSessionById(activeSessionId);
        activeSession = null;
        paintMessages([]);
      })
      .catch(function(e){ alert('删除失败：'+(e.message||e)); });
  }

  function persistTurn(role, content){
    if(!activeSession) return Promise.resolve();
    var messages = (activeSession.messages || []).slice();
    messages.push({ role: role, content: content });
    return persistSessionPatch({ messages: messages }).then(function(){
      if(activeSession) activeSession.messages = messages;
    });
  }

  function setJobReqBanner(filename){
    console.log('[DEBUG] setJobReqBanner called, filename:', filename, 'bannerEl:', jobReqBanner, 'labelEl:', jobReqLabel);
    if(!jobReqBanner || !jobReqLabel) { console.warn('[DEBUG] setJobReqBanner early return: banner or label element missing'); return; }
    if(!filename){
      jobReqBanner.hidden = true;
      jobReqLabel.textContent = '';
      return;
    }
    jobReqBanner.hidden = false;
    jobReqLabel.textContent = filename;
    console.log('[DEBUG] setJobReqBanner done: banner.hidden =', jobReqBanner.hidden, 'label.textContent =', jobReqLabel.textContent);
  }

  function clearThreadDom(){
    var keep = chatEmpty;
    var nodes = chatThread.querySelectorAll('.ce-msg');
    nodes.forEach(function(n){ n.remove(); });
    if(keep) keep.style.display = '';
  }

  function scrollBottom(){
    if(chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function updateSendState(){
    var hasText = (chatInput.value||'').trim().length > 0;
    chatSend.disabled = streaming || !hasText;
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

  function paintMessages(messages, jobReqFilename?: string){
    clearThreadDom();
    if(!messages || !messages.length){
      if(chatEmpty) chatEmpty.style.display = '';
      return;
    }
    messages.forEach(function(turn){
      var bubble = addMsg(turn.role === 'user' ? 'user' : 'bot');
      if(turn.role === 'user'){
        if(jobReqFilename){
          bubble.innerHTML = '<div class="ce-file-chip"><span class="ce-file-chip-icon">📄</span><span class="ce-file-chip-name">'+esc(jobReqFilename)+'</span></div>';
          var txt = document.createElement('div');
          txt.textContent = turn.content;
          bubble.appendChild(txt);
        } else {
          bubble.textContent = turn.content;
        }
      } else {
        bubble.innerHTML = fmtAssistant(turn.content);
      }
    });
    scrollBottom();
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

  function uploadJobReq(file){
    if(!file) return;
    console.log('[DEBUG] uploadJobReq called, file:', file.name);
    var fd = new FormData();
    fd.append('file', file, file.name);
    fetch(API_BASE+'/job-req/upload', { method: 'POST', body: fd })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(res){
        console.log('[DEBUG] upload response:', JSON.stringify(res));
        if(!res.ok || !res.body || res.body.ok===false){
          var msg = (res.body && (res.body.message || res.body.error)) || '上传失败';
          alert(msg);
          return;
        }
        var jobReq = res.body.jobReq || {};
        var filename = String(jobReq.filename||'未命名');
        console.log('[DEBUG] jobReq:', JSON.stringify(jobReq), 'filename:', filename);
        // wait for session patch to complete before updating UI,
        // so activeSession.activeJobReqId is populated before user can click send
        persistSessionPatch({
          activeJobReqId: jobReq.jobReqId,
          jobReqFilename: filename
        }).then(function(){
          console.log('[DEBUG] persistSessionPatch done, calling setJobReqBanner');
          setJobReqBanner(filename);
        }).catch(function(e){ console.error('[DEBUG] persistSessionPatch failed:', e); });
      })
      .catch(function(e){ alert('上传失败：'+(e.message||e)); });
  }

  function sendChat(text){
    var msg = (text!=null?text:chatInput.value||'').trim();
    if(!msg || streaming) return;
    var sess = activeSession;
    if(!sess) return;
    streaming = true;
    updateSendState();
    chatInput.value=''; autoGrow();
    var u = addMsg('user'); u.textContent = msg;
    var bubble = addMsg('bot');
    showTyping(bubble);
    var hasText = false;
    var finalMessage = '';
    var history = sess.messages.slice();
    var payload = {
      message: msg,
      stream: true,
      conversationHistory: history,
      activeJobReqId: sess.activeJobReqId || undefined
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
            if(ev.event==='status' && !hasText) showTyping(bubble);
            else if(ev.event==='delta' && ev.data.message) setStream(ev.data.message);
            else if(ev.event==='done' && ev.data.message){
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
        if(finalMessage && activeSession){
          var messages = (activeSession.messages || []).slice();
          messages.push({ role: 'user', content: msg });
          messages.push({ role: 'assistant', content: finalMessage });
          persistSessionPatch({ messages: messages });
        }
        streaming=false;
        updateSendState();
        chatInput.focus();
      });
  }

  try {
    setSidebarCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  } catch(eInit) {}

  refreshListAndActive().catch(function(e){
    alert('加载会话失败：'+(e.message||e));
  }).finally(function(){ updateSendState(); });

  if(newSessionBtn) newSessionBtn.addEventListener('click', createNewSession);
  if(sidebarToggle) sidebarToggle.addEventListener('click', function(){
    setSidebarOpen(!root.classList.contains('is-sidebar-open'));
  });
  if(sidebarCollapse) sidebarCollapse.addEventListener('click', function(){ setSidebarCollapsed(true); });
  if(sidebarExpand) sidebarExpand.addEventListener('click', function(){ setSidebarCollapsed(false); });
  if(sidebarBackdrop) sidebarBackdrop.addEventListener('click', function(){ setSidebarOpen(false); });
  if(fileInput){
    fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      if(f) uploadJobReq(f);
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
