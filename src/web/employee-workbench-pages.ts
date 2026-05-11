import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderEmployeeNewTasksPage(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>新任务 · 员工工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">员工工作台</div>
      <h1 class="page-title">新分配的任务</h1>
      <p class="page-desc">主管分配给您的待处理事项。请在接受前核对标题与说明；拒绝或申请修改必须填写理由。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="员工导航">
        <a class="active" href="/workbench/employee/new">新任务</a>
        <a href="/workbench/employee/current">当前任务</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <section class="kpis">
    <div class="kpi"><div class="lbl">待处理数量</div><div class="val" id="kpiNew">—</div></div>
    <div class="kpi"><div class="lbl">待确认</div><div class="val" id="kpiPending">—</div></div>
    <div class="kpi"><div class="lbl">提示</div><div class="val" style="font-size:15px;font-weight:600;line-height:1.35;margin-top:8px;color:#64748b;">优先处理阻塞风险</div></div>
  </section>

  <div id="cardsMount"><div class="empty-state">加载中…</div></div>
  <div class="feedback muted" id="listFeedback"></div>

  <div class="card" id="actionPanel" style="display:none;">
    <h3 id="actionTitle">补充说明</h3>
    <div class="form-stack">
      <label>说明（必填）
        <textarea id="actionNote" placeholder="请填写拒绝理由、补充信息或修改诉求"></textarea>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="confirmActionBtn">提交</button>
        <button type="button" class="btn btn-secondary" id="cancelActionBtn">取消</button>
      </div>
      <div class="feedback muted" id="actionFeedback"></div>
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

  var pending = null;

  async function loadNew() {
    setFb('listFeedback', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/new');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var pend = tasks.filter(function (t) { return t.status === 'CHANGES_REQUESTED'; }).length;
      document.getElementById('kpiNew').textContent = String(tasks.length);
      document.getElementById('kpiPending').textContent = String(pend);

      var mount = document.getElementById('cardsMount');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无新任务。请到「当前任务」查看进行中的工作。</div>';
        setFb('listFeedback', '', 'muted');
        return;
      }

      mount.innerHTML = '<div class="task-cards">' + tasks.map(function (t) {
        var st = t.status === 'CHANGES_REQUESTED' ? '<span class="badge pending">待确认</span>' : '<span class="badge assigned">待处理</span>';
        return '<article class="task-card" data-plan-id="' + escapeHtml(t.planId) + '">'
          + '<div class="head"><div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + st + '</div>'
          + '<p class="title">' + escapeHtml(t.title || t.planId) + '</p>'
          + '<p class="meta">任务 ID <code>' + escapeHtml(t.planId) + '</code></p></div></div>'
          + '<div class="actions">'
          + '<button type="button" class="btn btn-primary" data-act="accept">接受</button>'
          + '<button type="button" class="btn btn-danger" data-act="reject">拒绝</button>'
          + '<button type="button" class="btn btn-secondary" data-act="customize">补充信息</button>'
          + '<button type="button" class="btn btn-secondary" data-act="request_changes">申请修改</button>'
          + '</div></article>';
      }).join('') + '</div>';

      mount.querySelectorAll('.task-card').forEach(function (card) {
        card.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var planId = card.getAttribute('data-plan-id') || '';
            var act = btn.getAttribute('data-act') || '';
            if (act === 'accept') {
              void submitDirect(planId, 'accept', '');
              return;
            }
            openPanel(planId, act);
          });
        });
      });
      setFb('listFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsMount').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('listFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  function openPanel(planId, action) {
    pending = { planId: planId, action: action };
    document.getElementById('actionNote').value = '';
    document.getElementById('actionPanel').style.display = 'block';
    var titles = {
      reject: '拒绝任务（需填写理由）',
      customize: '补充信息',
      request_changes: '申请修改（需填写诉求）'
    };
    document.getElementById('actionTitle').textContent = titles[action] || '说明';
    setFb('actionFeedback', '', 'muted');
    document.getElementById('actionNote').focus();
  }

  function closePanel() {
    pending = null;
    document.getElementById('actionPanel').style.display = 'none';
  }

  async function submitDirect(planId, action, note) {
    try {
      var res = await fetch('/api/workbench/employee/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: planId, action: action, note: note })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      await loadNew();
    } catch (e) {
      alert(String(e && e.message ? e.message : e));
    }
  }

  document.getElementById('confirmActionBtn').addEventListener('click', async function () {
    if (!pending) return;
    var note = (document.getElementById('actionNote').value || '').trim();
    if (!note) {
      setFb('actionFeedback', '请填写说明', 'err');
      return;
    }
    setFb('actionFeedback', '提交中…', 'muted');
    try {
      await submitDirect(pending.planId, pending.action, note);
      closePanel();
    } catch (e) {
      setFb('actionFeedback', String(e && e.message ? e.message : e), 'err');
    }
  });

  document.getElementById('cancelActionBtn').addEventListener('click', closePanel);

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadNew();
})();
</script>
</body>
</html>`;
}

export function renderEmployeeCurrentTasksPage(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>当前任务 · 员工工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">员工工作台</div>
      <h1 class="page-title">当前任务</h1>
      <p class="page-desc">您已接受或正在推进的任务。提交进度后，主管可在历史任务中查看最新动态。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="员工导航">
        <a href="/workbench/employee/new">新任务</a>
        <a class="active" href="/workbench/employee/current">当前任务</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <section class="kpis">
    <div class="kpi"><div class="lbl">进行中</div><div class="val" id="kpiDoing">—</div></div>
    <div class="kpi"><div class="lbl">阻塞</div><div class="val" id="kpiBlocked">—</div></div>
    <div class="kpi"><div class="lbl">已接受待开工</div><div class="val" id="kpiAccepted">—</div></div>
  </section>

  <div id="cardsMount"><div class="empty-state">加载中…</div></div>
  <div class="feedback muted" id="listFeedback"></div>

  <div class="card">
    <h2>提交进度</h2>
    <p class="page-desc" style="margin:0 0 14px;">请选择任务、更新状态并填写说明（必填）。</p>
    <div class="form-stack">
      <label>任务
        <select id="progPlanId"><option value="">请先加载当前任务</option></select>
      </label>
      <label>进度状态
        <select id="progStatus">
          <option value="IN_EXECUTION">执行中</option>
          <option value="BLOCKED">阻塞</option>
          <option value="DONE">已完成</option>
        </select>
      </label>
      <label>说明
        <textarea id="progNote" placeholder="本阶段进展、风险与下一步计划"></textarea>
      </label>
      <button type="button" class="btn btn-primary" id="progBtn">提交进度</button>
      <div class="feedback muted" id="progFeedback"></div>
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

  async function loadCurrent() {
    setFb('listFeedback', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/current');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var blocked = tasks.filter(function (t) { return t.status === 'BLOCKED'; }).length;
      var accepted = tasks.filter(function (t) { return t.status === 'ACCEPTED'; }).length;
      var doing = tasks.filter(function (t) { return t.status === 'IN_PROGRESS'; }).length;
      document.getElementById('kpiBlocked').textContent = String(blocked);
      document.getElementById('kpiAccepted').textContent = String(accepted);
      document.getElementById('kpiDoing').textContent = String(doing);

      var mount = document.getElementById('cardsMount');
      var sel = document.getElementById('progPlanId');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无当前任务。请先到「新任务」承接分配。</div>';
        sel.innerHTML = '<option value="">暂无任务</option>';
        setFb('listFeedback', '', 'muted');
        return;
      }

      mount.innerHTML = '<div class="task-cards">' + tasks.map(function (t) {
        var bc = t.status === 'BLOCKED' ? 'blocked' : (t.status === 'ACCEPTED' ? 'assigned' : 'progress');
        return '<article class="task-card">'
          + '<span class="badge ' + bc + '">' + escapeHtml(t.statusLabel || t.status) + '</span>'
          + '<p class="title">' + escapeHtml(t.title || t.planId) + '</p>'
          + '<p class="meta">任务 ID <code>' + escapeHtml(t.planId) + '</code>'
          + (t.progressNote ? '<br>最近进度：' + escapeHtml(t.progressNote) : '')
          + '</p></article>';
      }).join('') + '</div>';

      sel.innerHTML = '<option value="">请选择任务</option>' + tasks.map(function (t) {
        return '<option value="' + escapeHtml(t.planId) + '">' + escapeHtml(t.planId) + ' · ' + escapeHtml(t.statusLabel || t.status) + '</option>';
      }).join('');
      setFb('listFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsMount').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('listFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('progBtn').addEventListener('click', async function () {
    var planId = (document.getElementById('progPlanId').value || '').trim();
    var progressStatus = (document.getElementById('progStatus').value || '').trim();
    var note = (document.getElementById('progNote').value || '').trim();
    if (!planId) { setFb('progFeedback', '请选择任务', 'err'); return; }
    if (!note) { setFb('progFeedback', '请填写说明', 'err'); return; }
    var btn = document.getElementById('progBtn');
    btn.disabled = true;
    setFb('progFeedback', '提交中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: planId, progressStatus: progressStatus, note: note })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      document.getElementById('progNote').value = '';
      setFb('progFeedback', '进度已提交', 'ok');
      await loadCurrent();
    } catch (e) {
      setFb('progFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadCurrent();
})();
</script>
</body>
</html>`;
}
