import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badgeClass(status: string): string {
  if (status === "BLOCKED") return "blocked";
  if (status === "ASSIGNED" || status === "CHANGES_REQUESTED") return status === "CHANGES_REQUESTED" ? "pending" : "assigned";
  if (status === "IN_PROGRESS") return "progress";
  if (status === "DONE") return "done";
  if (status === "REJECTED") return "rejected";
  return "assigned";
}

export function renderManagerTasksPage(params: {
  planId?: string;
  planTitle?: string;
  userLabel?: string;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>历史任务 · 主管工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">主管工作台</div>
      <h1 class="page-title">历史任务管理</h1>
      <p class="page-desc">查看已发布任务的进度与负责人，必要时调整分配方案。列表优先突出阻塞与待处理事项。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        <a class="active" href="/workbench/manager/tasks">历史任务</a>
        <a href="/workbench/manager/chat">智能规划助手</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <div class="card">
    <div class="tabs" role="tablist" aria-label="任务操作">
      <button type="button" class="tabs-btn" role="tab" aria-selected="true" aria-controls="mgrPanelList" id="mgrTabList" data-tab-target="mgrPanelList">任务列表</button>
      <button type="button" class="tabs-btn" role="tab" aria-selected="false" aria-controls="mgrPanelReassign" id="mgrTabReassign" data-tab-target="mgrPanelReassign">调整分配</button>
    </div>

    <section class="tab-panel panel-stack" id="mgrPanelList" role="tabpanel" aria-labelledby="mgrTabList">
      <section class="kpis" aria-live="polite">
        <div class="kpi"><div class="lbl">任务总数</div><div class="val" id="kpiTotal">—</div></div>
        <div class="kpi"><div class="lbl">待处理 / 待改派</div><div class="val" id="kpiPending">—</div></div>
        <div class="kpi"><div class="lbl">进行中 / 阻塞</div><div class="val" id="kpiActive">—</div></div>
      </section>
      <div>
        <p class="page-desc" style="margin:0 0 14px;">${who}可见的全部任务，按状态优先级排序。</p>
        <div id="taskTableMount">
          <div class="empty-state">加载中…</div>
        </div>
        <div class="feedback muted" id="tableFeedback"></div>
      </div>
    </section>

    <section class="tab-panel" id="mgrPanelReassign" role="tabpanel" aria-labelledby="mgrTabReassign" hidden>
      <h2>调整分配</h2>
      <p class="page-desc" style="margin:0 0 14px;">选择任务并指定新负责人（按<strong>姓名</strong>查找），保存后立即生效。</p>
      <div class="form-stack">
        <label>任务
          <select id="reassignPlanId"><option value="">请选择任务</option></select>
        </label>
        <label>新负责人（输入姓名或部门，弹出候选）
          <div class="combo" style="position:relative;">
            <input id="reassignAssigneeInput" type="search" autocomplete="off" placeholder="至少输入 2 个字符" style="width:100%;" />
            <input id="reassignAssigneeUserId" type="hidden" value="" />
            <ul id="reassignAssigneeOptions" class="combo-options" hidden></ul>
          </div>
        </label>
        <label>改派范围（可选）
          <select id="reassignSubtaskPick" class="reassign-subtask-pick" aria-disabled="true">
            <option value="">全部子任务（未完成）</option>
          </select>
        </label>
        <label>说明
          <textarea id="reassignNote" placeholder="简要说明改派原因"></textarea>
        </label>
        <div>
          <button type="button" class="btn btn-primary" id="reassignBtn">保存改派</button>
        </div>
        <div class="feedback muted" id="reassignFeedback"></div>
      </div>
    </section>
  </div>
</div>
<script>
(function () {
  function setText(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
  }
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function setActiveTab(targetId) {
    document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
      var active = btn.getAttribute('data-tab-target') === targetId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel[id^="mgrPanel"]').forEach(function (panel) {
      panel.hidden = panel.id !== targetId;
    });
  }
  document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tid = btn.getAttribute('data-tab-target') || 'mgrPanelList';
      setActiveTab(tid);
    });
  });
  function priorityRank(status) {
    if (status === 'BLOCKED') return 0;
    if (status === 'REJECTED') return 1;
    if (status === 'ASSIGNED' || status === 'CHANGES_REQUESTED') return 2;
    if (status === 'IN_PROGRESS') return 3;
    return 4;
  }
  function badgeClass(status) {
    if (status === 'BLOCKED') return 'blocked';
    if (status === 'CHANGES_REQUESTED') return 'pending';
    if (status === 'ASSIGNED') return 'assigned';
    if (status === 'IN_PROGRESS') return 'progress';
    if (status === 'DONE') return 'done';
    if (status === 'REJECTED') return 'rejected';
    return 'assigned';
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function loadSubtasksForReassign() {
    var sel = document.getElementById('reassignPlanId');
    var st = document.getElementById('reassignSubtaskPick');
    if (!sel || !st) return;
    var opt = sel.selectedOptions && sel.selectedOptions[0];
    var taskNo = opt ? String(opt.getAttribute('data-task-no') || '').trim() : '';
    st.innerHTML = '<option value="">全部子任务（未完成）</option>';
    if (!taskNo) {
      st.setAttribute('aria-disabled', 'true');
      return;
    }
    st.removeAttribute('aria-disabled');
    try {
      var res = await fetch('/api/workbench/tasks/detail?taskNo=' + encodeURIComponent(taskNo));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;
      var subs = (data.subtasks || []).filter(function (s) {
        return String(s.status || '').toUpperCase() !== 'DONE';
      });
      subs.forEach(function (s, idx) {
        var o = document.createElement('option');
        o.value = String(s.subtaskId || '');
        var title = String(s.title || '').trim() || '（无标题）';
        var stLabel = String(s.statusLabel || s.status || '未知').trim();
        var who = String(s.assigneeDisplayName || s.assigneeUserId || '').trim() || '未指定';
        var line = (idx + 1) + '. ' + title + ' · 【' + stLabel + '】 当前负责人：' + who;
        o.textContent = line;
        o.title = line;
        st.appendChild(o);
      });
    } catch (e) {}
  }

  var assigneeSearchTimer = null;
  function closeAssigneeCombo() {
    var ul = document.getElementById('reassignAssigneeOptions');
    if (ul) { ul.hidden = true; ul.innerHTML = ''; }
  }
  async function runAssigneeSearch() {
    var input = document.getElementById('reassignAssigneeInput');
    var ul = document.getElementById('reassignAssigneeOptions');
    var hid = document.getElementById('reassignAssigneeUserId');
    if (!input || !ul) return;
    var kw = String(input.value || '').trim().toLowerCase();
    if (kw.length < 2) {
      closeAssigneeCombo();
      return;
    }
    setFb('reassignFeedback', '查找中…', 'muted');
    try {
      var res = await fetch('/api/workbench/manager/contacts?keyword=' + encodeURIComponent(kw));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var contacts = data.contacts || [];
      if (!contacts.length) {
        ul.innerHTML = '';
        ul.hidden = true;
        setFb('reassignFeedback', '无匹配结果', 'muted');
        return;
      }
      ul.innerHTML = contacts.map(function (c) {
        var dept = escapeHtml(c.departmentSummary || c.departmentName || '');
        var tag = c.matchedField === 'department' ? '<span class="combo-tag">按部门匹配</span>' : '';
        return '<li role="option" tabindex="-1" data-user-id="' + escapeHtml(c.userId) + '">'
          + '<span>' + escapeHtml(c.name || c.userId) + ' · ' + dept + '</span>' + tag + '</li>';
      }).join('');
      ul.querySelectorAll('li[role="option"]').forEach(function (li) { li.removeAttribute('aria-selected'); });
      ul.hidden = false;
      setFb('reassignFeedback', '点击选择负责人', 'ok');
      ul.querySelectorAll('li[role="option"]').forEach(function (li) {
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          var uid = li.getAttribute('data-user-id') || '';
          if (hid) hid.value = uid;
          input.value = li.textContent.replace(/按部门匹配/g, '').trim();
          closeAssigneeCombo();
        });
      });
    } catch (e) {
      setFb('reassignFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }
  function scheduleAssigneeSearch() {
    if (assigneeSearchTimer) clearTimeout(assigneeSearchTimer);
    assigneeSearchTimer = setTimeout(function () { void runAssigneeSearch(); }, 250);
  }

  async function loadTasks() {
    setFb('tableFeedback', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/manager/tasks');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      tasks.sort(function (a, b) {
        var pa = priorityRank(a.status);
        var pb = priorityRank(b.status);
        if (pa !== pb) return pa - pb;
        var ta = Date.parse(a.updatedAt || '') || 0;
        var tb = Date.parse(b.updatedAt || '') || 0;
        return tb - ta;
      });

      var pending = tasks.filter(function (t) {
        return t.status === 'ASSIGNED' || t.status === 'CHANGES_REQUESTED' || t.status === 'REJECTED';
      }).length;
      var active = tasks.filter(function (t) {
        return t.status === 'IN_PROGRESS' || t.status === 'BLOCKED';
      }).length;
      setText('kpiTotal', String(tasks.length));
      setText('kpiPending', String(pending));
      setText('kpiActive', String(active));

      var mount = document.getElementById('taskTableMount');
      var sel = document.getElementById('reassignPlanId');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无任务。请到钉钉与机器人发起规划并发布。</div>';
        sel.innerHTML = '<option value="">暂无任务</option>';
        setFb('tableFeedback', '', 'muted');
        return;
      }

      var rows = tasks.map(function (t) {
        var detail = '<a href="/workbench/manager/task?taskNo=' + encodeURIComponent(t.taskNo || '') + '">查看详情</a>';
        return '<tr>'
          + '<td><code>' + escapeHtml(t.taskNo || '—') + '</code></td>'
          + '<td>' + escapeHtml(t.title || '—') + '</td>'
          + '<td>' + escapeHtml(t.assigneeSummary || '—') + '</td>'
          + '<td>' + escapeHtml(String(t.subtasksCount || 0)) + '（阻塞 ' + escapeHtml(String(t.blockedCount || 0)) + '）</td>'
          + '<td><span class="badge ' + badgeClass(t.status) + '">' + escapeHtml(t.statusLabel || t.status) + '</span></td>'
          + '<td>' + escapeHtml(t.updatedAt || '—') + '<br>' + detail + '</td>'
          + '</tr>';
      }).join('');

      mount.innerHTML = '<div class="table-wrap"><table class="data">'
        + '<thead><tr><th>业务编号</th><th>标题</th><th>负责人</th><th>子任务</th><th>状态</th><th>更新时间</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';

      sel.innerHTML = '<option value="">请选择任务</option>' + tasks.map(function (t) {
        var optLabel = escapeHtml(t.taskNo || '任务') + ' · ' + escapeHtml(t.title || '') + ' · ' + escapeHtml(t.statusLabel || t.status);
        return '<option value="' + escapeHtml(t.planId) + '" data-task-no="' + escapeHtml(t.taskNo || '') + '">' + optLabel + '</option>';
      }).join('');

      if (!sel.dataset.boundReassignTask) {
        sel.dataset.boundReassignTask = '1';
        sel.addEventListener('change', function () { void loadSubtasksForReassign(); });
      }
      void loadSubtasksForReassign();
      var focus = ${JSON.stringify(params.planId ?? "")};
      if (focus) sel.value = focus;

      setFb('tableFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">加载失败，请稍后重试。</div>';
      setFb('tableFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  var reassignInput = document.getElementById('reassignAssigneeInput');
  if (reassignInput && !reassignInput.dataset.boundCombo) {
    reassignInput.dataset.boundCombo = '1';
    reassignInput.addEventListener('input', function () { scheduleAssigneeSearch(); });
    reassignInput.addEventListener('blur', function () {
      setTimeout(function () { closeAssigneeCombo(); }, 200);
    });
    reassignInput.addEventListener('keydown', function (ev) {
      var ul = document.getElementById('reassignAssigneeOptions');
      var hid = document.getElementById('reassignAssigneeUserId');
      var input = reassignInput;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeAssigneeCombo();
        return;
      }
      if (!ul || ul.hidden) return;
      var items = Array.prototype.slice.call(ul.querySelectorAll('li[role="option"]'));
      if (!items.length) return;
      var cur = items.findIndex(function (li) { return li.getAttribute('aria-selected') === 'true'; });
      if (cur < 0) cur = 0;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        cur = (cur + 1) % items.length;
        items.forEach(function (li, i) { li.setAttribute('aria-selected', i === cur ? 'true' : 'false'); });
        items[cur].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        cur = (cur - 1 + items.length) % items.length;
        items.forEach(function (li, i) { li.setAttribute('aria-selected', i === cur ? 'true' : 'false'); });
        items[cur].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ev.key === 'Enter') {
        var pick = items.find(function (li) { return li.getAttribute('aria-selected') === 'true'; }) || items[0];
        if (!pick) return;
        ev.preventDefault();
        var uid = pick.getAttribute('data-user-id') || '';
        if (hid) hid.value = uid;
        input.value = pick.textContent.replace(/按部门匹配/g, '').trim();
        closeAssigneeCombo();
      }
    });
  }

  document.getElementById('reassignBtn').addEventListener('click', async function () {
    var planId = (document.getElementById('reassignPlanId').value || '').trim();
    var assigneeUserId = (document.getElementById('reassignAssigneeUserId').value || '').trim();
    var note = (document.getElementById('reassignNote').value || '').trim();
    var subPick = document.getElementById('reassignSubtaskPick');
    var subtaskId = subPick ? String(subPick.value || '').trim() : '';
    if (!planId) { setFb('reassignFeedback', '请选择任务', 'err'); return; }
    if (!assigneeUserId) { setFb('reassignFeedback', '请先查找并选择新负责人', 'err'); return; }
    var btn = document.getElementById('reassignBtn');
    btn.disabled = true;
    setFb('reassignFeedback', '保存中…', 'muted');
    try {
      var payload = { planId: planId, assigneeUserId: assigneeUserId, note: note };
      if (subtaskId) payload.subtaskId = subtaskId;
      var res = await fetch('/api/workbench/manager/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('reassignFeedback', '改派已保存', 'ok');
      document.getElementById('reassignAssigneeInput').value = '';
      document.getElementById('reassignAssigneeUserId').value = '';
      closeAssigneeCombo();
      document.getElementById('reassignNote').value = '';
      if (subPick) subPick.value = '';
      await loadTasks();
    } catch (e) {
      setFb('reassignFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadTasks();
})();
</script>
</body>
</html>`;
}

export function renderManagerChatPage(params: {
  planId?: string;
  planTitle?: string;
  userLabel?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>智能规划助手 · 主管工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body class="page-shell--chat">
<div class="app-shell">
  <header class="topbar topbar--compact">
    <div>
      <div class="brand">主管工作台</div>
      <h1 class="page-title">智能规划助手</h1>
      <p class="page-desc">用自然语言补充背景、调整诉求或追问草案；回复会写入会话记录便于追溯。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        <a href="/workbench/manager/tasks">历史任务</a>
        <a class="active" href="/workbench/manager/chat">智能规划助手</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <div class="chat-main">
    <section class="chat-message-pane">
      <div class="chat-stream" aria-live="polite">
        <ul class="msg-list" id="msgList"><li class="muted" style="border-style:dashed;">加载中…</li></ul>
      </div>
      <div class="chat-composer">
        <div class="form-stack">
          <textarea id="msgInput" placeholder="补充背景、调整诉求或追问草案…"></textarea>
          <div class="roster-upload-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;">
            <label class="btn btn-secondary" for="rosterFileInput" style="margin:0;cursor:pointer;">上传花名册</label>
            <input id="rosterFileInput" type="file" accept=".md,.markdown,.txt,.docx,.pdf" style="display:none;" />
            <span class="muted" id="rosterStatus"></span>
          </div>
          <div class="chat-composer-actions">
            <button type="button" class="btn btn-primary" id="sendBtn">发送</button>
          </div>
          <div class="feedback muted" id="sendFeedback"></div>
        </div>
      </div>
    </section>
  </div>
</div>

<script>
(function () {
  var activePlanId = ${JSON.stringify(params.planId ?? "")};

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function roleClass(role) {
    var normalized = String(role || '').toLowerCase();
    if (normalized === 'user') return 'msg-bubble--user';
    if (normalized === 'assistant') return 'msg-bubble--assistant';
    return 'msg-bubble--system';
  }
  function scrollMessageStreamToBottom() {
    var box = document.getElementById('msgList');
    if (!box) return;
    var stream = box.closest('.chat-stream');
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }
  var msgInput = document.getElementById('msgInput');
  function focusComposer() {
    if (!msgInput) return;
    requestAnimationFrame(function () {
      msgInput.focus();
      var composer = document.querySelector('.chat-composer');
      if (composer && window.innerWidth <= 860) {
        composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  function roleLabel(role) {
    var r = String(role || '').toLowerCase();
    if (r === 'user') return '我';
    if (r === 'assistant') return '规划助手';
    return '系统';
  }
  function formatMsgTime(at) {
    if (!at) return '';
    try {
      var d = new Date(at);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  async function loadMessages(planId) {
    var box = document.getElementById('msgList');
    if (!planId) {
      box.innerHTML = '<li class="muted" style="border-style:dashed;">暂无规划会话。请到钉钉与机器人发起一条规划，发布后再回来查看。</li>';
      return;
    }
    box.innerHTML = '<li class="muted" style="border-style:dashed;">加载中…</li>';
    try {
      var res = await fetch('/api/workbench/conversation/messages?planId=' + encodeURIComponent(planId));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var msgs = data.messages || [];
      if (!msgs.length) {
        box.innerHTML = '<li class="muted" style="border-style:dashed;">暂无消息，请在下方发送第一条。</li>';
        return;
      }
      box.innerHTML = msgs.map(function (m) {
        var role = String(m.role || 'system');
        var rl = roleLabel(role);
        var rowClass = role === 'user' ? 'msg-row msg-row--user' : (role === 'assistant' ? 'msg-row msg-row--assistant' : 'msg-row msg-row--assistant');
        var bubbleClass = 'msg-bubble ' + roleClass(role);
        var tm = formatMsgTime(m.at);
        var metaLine = '<div class="msg-meta">' + escapeHtml(rl) + (tm ? ' · ' + escapeHtml(tm) : '') + '</div>';
        var body;
        if (role === 'assistant' && m.html) {
          body = '<div class="msg-body msg-body--assistant">' + m.html + '</div>';
        } else {
          body = '<div class="msg-body">' + escapeHtml(m.content || '') + '</div>';
        }
        return '<li class="' + rowClass + '"><div class="' + bubbleClass + '">' + metaLine + body + '</div></li>';
      }).join('');
      scrollMessageStreamToBottom();
    } catch (e) {
      box.innerHTML = '<li style="color:#dc2626;">加载消息失败</li>';
    }
  }

  var sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async function () {
      var planId = String(activePlanId || '').trim();
      var message = (document.getElementById('msgInput').value || '').trim();
      if (!planId) { setFb('sendFeedback', '暂无规划会话，请先在钉钉发起。', 'err'); return; }
      if (!message) { setFb('sendFeedback', '请输入消息内容', 'err'); return; }
      sendBtn.disabled = true;
      setFb('sendFeedback', '发送中…', 'muted');
      try {
        var res = await fetch('/api/workbench/conversation/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: planId, message: message })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        document.getElementById('msgInput').value = '';
        setFb('sendFeedback', '已发送', 'ok');
        await loadMessages(planId);
        scrollMessageStreamToBottom();
        focusComposer();
      } catch (e) {
        setFb('sendFeedback', String(e && e.message ? e.message : e), 'err');
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  var rosterInput = document.getElementById('rosterFileInput');
  var rosterStatusEl = document.getElementById('rosterStatus');
  if (rosterInput) {
    rosterInput.addEventListener('change', async function () {
      var file = rosterInput.files && rosterInput.files[0];
      if (!file) return;
      var planId = String(activePlanId || '').trim();
      if (!planId) {
        rosterStatusEl.textContent = '请先在钉钉发起规划后再上传花名册';
        rosterStatusEl.style.color = '#dc2626';
        rosterInput.value = '';
        return;
      }
      rosterStatusEl.textContent = '上传中…';
      rosterStatusEl.style.color = '';
      try {
        var fd = new FormData();
        fd.append('planId', planId);
        fd.append('file', file, file.name);
        var res = await fetch('/api/workbench/manager/upload-roster', {
          method: 'POST',
          body: fd,
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        rosterStatusEl.textContent =
          '已上传 ' + escapeHtml(data.filename || file.name) +
          '（' + (data.kind || '') + '，' + (data.chars || 0) + ' 字符）。' +
          '请在下方说明你想分配的任务与要求。';
        rosterStatusEl.style.color = '#0f766e';
      } catch (err) {
        rosterStatusEl.textContent = '上传失败：' + (err && err.message ? err.message : err);
        rosterStatusEl.style.color = '#dc2626';
      } finally {
        rosterInput.value = '';
      }
    });
  }

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  if (activePlanId) {
    void loadMessages(activePlanId);
  } else {
    document.getElementById('msgList').innerHTML =
      '<li class="muted" style="border-style:dashed;">暂无规划会话。请到钉钉与机器人发起一条规划，发布后再回来查看。</li>';
    if (sendBtn) sendBtn.disabled = true;
  }
})();
</script>
</body>
</html>`;
}
