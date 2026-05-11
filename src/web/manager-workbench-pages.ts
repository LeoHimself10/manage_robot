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
  userLabel?: string;
}): string {
  const ctx = params.planId
    ? `<div class="banner-plan">当前聚焦任务：<code>${escapeHtml(params.planId)}</code></div>`
    : "";
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
        <a href="/workbench/manager/chat">与 Agent 对话</a>
      </nav>
      <a class="btn btn-secondary" href="/api/workbench/me" target="_blank" rel="noopener">当前身份</a>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  ${ctx}

  <section class="kpis" aria-live="polite">
    <div class="kpi"><div class="lbl">任务总数</div><div class="val" id="kpiTotal">—</div></div>
    <div class="kpi"><div class="lbl">待处理 / 待确认</div><div class="val" id="kpiPending">—</div></div>
    <div class="kpi"><div class="lbl">进行中 / 阻塞</div><div class="val" id="kpiActive">—</div></div>
  </section>

  <div class="card">
    <h2>任务列表</h2>
    <p class="page-desc" style="margin:0 0 14px;">${who}可见的全部任务，按状态优先级排序。</p>
    <div id="taskTableMount">
      <div class="empty-state">加载中…</div>
    </div>
    <div class="feedback muted" id="tableFeedback"></div>
  </div>

  <div class="card">
    <h2>调整分配</h2>
    <p class="page-desc" style="margin:0 0 14px;">选择任务并指定新负责人，保存后立即生效。</p>
    <div class="form-stack">
      <label>任务
        <select id="reassignPlanId"><option value="">请选择任务</option></select>
      </label>
      <label>新负责人（钉钉 userId）
        <input id="reassignAssignee" type="text" autocomplete="off" placeholder="例如 emp_qa_001" />
      </label>
      <label>说明
        <textarea id="reassignNote" placeholder="简要说明改派原因"></textarea>
      </label>
      <div>
        <button type="button" class="btn btn-primary" id="reassignBtn">保存改派</button>
      </div>
      <div class="feedback muted" id="reassignFeedback"></div>
    </div>
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
  function priorityRank(status) {
    if (status === 'BLOCKED') return 0;
    if (status === 'ASSIGNED' || status === 'CHANGES_REQUESTED') return 1;
    if (status === 'ACCEPTED' || status === 'IN_PROGRESS') return 2;
    return 3;
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
        return t.status === 'ASSIGNED' || t.status === 'CHANGES_REQUESTED';
      }).length;
      var active = tasks.filter(function (t) {
        return t.status === 'IN_PROGRESS' || t.status === 'BLOCKED' || t.status === 'ACCEPTED';
      }).length;
      setText('kpiTotal', String(tasks.length));
      setText('kpiPending', String(pending));
      setText('kpiActive', String(active));

      var mount = document.getElementById('taskTableMount');
      var sel = document.getElementById('reassignPlanId');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无任务。可通过「与 Agent 对话」发起新规划。</div>';
        sel.innerHTML = '<option value="">暂无任务</option>';
        setFb('tableFeedback', '', 'muted');
        return;
      }

      var rows = tasks.map(function (t) {
        var note = t.progressNote ? '<br><span class="meta">最近进度：' + escapeHtml(t.progressNote) + '</span>' : '';
        return '<tr>'
          + '<td><code>' + escapeHtml(t.planId) + '</code></td>'
          + '<td>' + escapeHtml(t.title || '—') + '</td>'
          + '<td>' + escapeHtml(t.assigneeUserId || '—') + '</td>'
          + '<td><span class="badge ' + badgeClass(t.status) + '">' + escapeHtml(t.statusLabel || t.status) + '</span></td>'
          + '<td>' + escapeHtml(t.updatedAt || '—') + '</td>'
          + '</tr>';
      }).join('');

      mount.innerHTML = '<div class="table-wrap"><table class="data">'
        + '<thead><tr><th>任务 ID</th><th>标题</th><th>负责人</th><th>状态</th><th>更新时间</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table></div>';

      sel.innerHTML = '<option value="">请选择任务</option>' + tasks.map(function (t) {
        return '<option value="' + escapeHtml(t.planId) + '">' + escapeHtml(t.planId) + ' · ' + escapeHtml(t.statusLabel || t.status) + '</option>';
      }).join('');

      var focus = ${JSON.stringify(params.planId ?? "")};
      if (focus) sel.value = focus;

      setFb('tableFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">加载失败，请稍后重试。</div>';
      setFb('tableFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('reassignBtn').addEventListener('click', async function () {
    var planId = (document.getElementById('reassignPlanId').value || '').trim();
    var assigneeUserId = (document.getElementById('reassignAssignee').value || '').trim();
    var note = (document.getElementById('reassignNote').value || '').trim();
    if (!planId) { setFb('reassignFeedback', '请选择任务', 'err'); return; }
    if (!assigneeUserId) { setFb('reassignFeedback', '请填写新负责人 userId', 'err'); return; }
    var btn = document.getElementById('reassignBtn');
    btn.disabled = true;
    setFb('reassignFeedback', '保存中…', 'muted');
    try {
      var res = await fetch('/api/workbench/manager/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: planId, assigneeUserId: assigneeUserId, note: note })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('reassignFeedback', '改派已保存', 'ok');
      document.getElementById('reassignAssignee').value = '';
      document.getElementById('reassignNote').value = '';
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
  userLabel?: string;
}): string {
  const ctx = params.planId
    ? `<div class="banner-plan">当前线程：<code>${escapeHtml(params.planId)}</code> · 可直接在此继续对话。</div>`
    : "";
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent 对话 · 主管工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">主管工作台</div>
      <h1 class="page-title">与 Agent 对话</h1>
      <p class="page-desc">继续已有任务线程或开启新的规划会话。消息仅展示业务内容，便于追溯。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        <a href="/workbench/manager/tasks">历史任务</a>
        <a class="active" href="/workbench/manager/chat">与 Agent 对话</a>
      </nav>
      <button type="button" class="btn btn-secondary" id="newThreadBtn">开启新会话</button>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  ${ctx}

  <div class="card">
    <div class="page-desc" style="margin:0 0 12px;">操作者：<strong>${who}</strong></div>
    <div class="split-chat">
      <div>
        <h3 style="margin-top:0;">会话线程</h3>
        <ul class="thread-list" id="threadList"><li class="muted" style="cursor:default;border-style:dashed;">加载中…</li></ul>
      </div>
      <div>
        <h3 style="margin-top:0;">消息与输入</h3>
        <label style="display:grid;gap:6px;font-size:13px;font-weight:500;margin-bottom:10px;">
          当前任务 ID
          <select id="planSelect"><option value="">请选择线程</option></select>
        </label>
        <ul class="msg-list" id="msgList"><li class="muted" style="border-style:dashed;">请选择左侧线程</li></ul>
        <div class="form-stack" style="margin-top:12px;">
          <label>发送给 Agent
            <textarea id="msgInput" placeholder="补充背景、调整诉求或追问草案…"></textarea>
          </label>
          <button type="button" class="btn btn-primary" id="sendBtn">发送</button>
          <div class="feedback muted" id="sendFeedback"></div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
(function () {
  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }

  async function loadThreads() {
    try {
      var res = await fetch('/api/workbench/conversation/threads');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var threads = data.threads || [];
      var ul = document.getElementById('threadList');
      var sel = document.getElementById('planSelect');
      if (!threads.length) {
        ul.innerHTML = '<li style="cursor:default;border-style:dashed;color:#64748b;">暂无会话，点击右上角开启新会话。</li>';
        sel.innerHTML = '<option value="">暂无线程</option>';
        return;
      }
      ul.innerHTML = threads.map(function (t, i) {
        return '<li data-plan-id="' + escapeHtml(t.planId) + '" tabindex="0" role="button">'
          + '<strong>' + escapeHtml(t.planId) + '</strong><br>'
          + '<span style="font-size:12px;color:#64748b;">更新 ' + escapeHtml(t.updatedAt || '—') + ' · ' + (t.turns || 0) + ' 轮</span>'
          + '</li>';
      }).join('');
      sel.innerHTML = '<option value="">请选择线程</option>' + threads.map(function (t) {
        return '<option value="' + escapeHtml(t.planId) + '">' + escapeHtml(t.planId) + '</option>';
      }).join('');

      var focus = ${JSON.stringify(params.planId ?? "")};
      if (focus) {
        sel.value = focus;
        highlightThread(focus);
        void loadMessages(focus);
      }

      ul.querySelectorAll('li[data-plan-id]').forEach(function (li) {
        li.addEventListener('click', function () {
          var pid = li.getAttribute('data-plan-id') || '';
          sel.value = pid;
          highlightThread(pid);
          void loadMessages(pid);
        });
      });
    } catch (e) {
      document.getElementById('threadList').innerHTML = '<li style="cursor:default;color:#dc2626;">加载失败</li>';
    }
  }

  function highlightThread(planId) {
    document.querySelectorAll('.thread-list li[data-plan-id]').forEach(function (li) {
      li.classList.toggle('active', li.getAttribute('data-plan-id') === planId);
    });
  }

  async function loadMessages(planId) {
    var box = document.getElementById('msgList');
    if (!planId) {
      box.innerHTML = '<li class="muted" style="border-style:dashed;">请选择线程</li>';
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
        return '<li><strong>' + escapeHtml(m.role || '') + '</strong>' + escapeHtml(m.content || '') + '</li>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      box.innerHTML = '<li style="color:#dc2626;">加载消息失败</li>';
    }
  }

  document.getElementById('planSelect').addEventListener('change', function () {
    var pid = this.value || '';
    highlightThread(pid);
    void loadMessages(pid);
  });

  document.getElementById('sendBtn').addEventListener('click', async function () {
    var planId = (document.getElementById('planSelect').value || '').trim();
    var message = (document.getElementById('msgInput').value || '').trim();
    if (!planId) { setFb('sendFeedback', '请先选择任务线程', 'err'); return; }
    if (!message) { setFb('sendFeedback', '请输入消息内容', 'err'); return; }
    var btn = document.getElementById('sendBtn');
    btn.disabled = true;
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
      await loadThreads();
    } catch (e) {
      setFb('sendFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('newThreadBtn').addEventListener('click', async function () {
    var btn = document.getElementById('newThreadBtn');
    btn.disabled = true;
    setFb('sendFeedback', '创建会话…', 'muted');
    try {
      var res = await fetch('/api/workbench/conversation/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var pid = data.planId || '';
      window.location.href = '/workbench/manager/chat?planId=' + encodeURIComponent(pid);
    } catch (e) {
      setFb('sendFeedback', String(e && e.message ? e.message : e), 'err');
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadThreads();
})();
</script>
</body>
</html>`;
}
