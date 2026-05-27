import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderManagerProjectsPage(params: {
  userLabel?: string;
  presentation?: boolean;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const presentation = Boolean(params.presentation);
  const bodyClass = presentation ? "page-shell--presentation" : "";

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目总览 · 主管工作台</title>
<style>
${WORKBENCH_APP_BASE_CSS}
.page-shell--presentation .topbar .btn:not(.presentation-exit),
.page-shell--presentation #newProjectBtn,
.page-shell--presentation #refreshBtn { display: none !important; }
.page-shell--presentation .project-card { font-size: 1.05rem; }
.page-shell--presentation .project-card .kpi-row .val { font-size: 1.35rem; }
.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
.project-card { border: 1px solid var(--border, #e5e7eb); border-radius: 12px; padding: 16px; background: var(--card-bg, #fff); cursor: pointer; transition: box-shadow .15s; }
.project-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.project-card.attn-blocked { border-color: #f87171; }
.project-card.attn-needs { border-color: #fb923c; }
.project-card h3 { margin: 0 0 6px; font-size: 1.1rem; }
.project-card .desc { color: var(--muted, #6b7280); font-size: 13px; margin: 0 0 12px; min-height: 1.2em; }
.project-card .headline { font-size: 13px; font-weight: 600; color: #b45309; margin: 0 0 10px; }
.project-card .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; font-size: 11px; }
.project-card .kpi-row .lbl { color: var(--muted, #6b7280); }
.project-card .kpi-row .val { font-weight: 700; font-size: 1rem; }
.toolbar-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 8px; }
</style>
</head>
<body class="${bodyClass}">
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">主管工作台</div>
      <h1 class="page-title">项目总览</h1>
      <p class="page-desc">按大项目聚合任务进展，适合周会 / 月会一屏汇报。${who}</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        <a class="active" href="/workbench/manager/projects">项目总览</a>
        <a href="/workbench/manager/tasks">历史任务</a>
        <a href="/workbench/manager/chat?thread=main">智能规划助手</a>
        <a href="/workbench/employee?view=new" id="navMyTasks">我负责的任务</a>
      </nav>
      <button type="button" class="btn btn-secondary btn-sm" id="presentationBtn">开会展示</button>
      <a class="btn btn-ghost btn-sm presentation-exit" id="exitPresentationBtn" href="/workbench/manager/projects" hidden>退出开会模式</a>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <div class="card">
    <div class="toolbar-row">
      <button type="button" class="btn btn-primary btn-sm" id="newProjectBtn">新建项目</button>
      <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn">刷新</button>
      <p class="muted" id="loadMeta" style="margin:0;" role="status" aria-live="polite">加载中…</p>
    </div>
    <div id="projectGrid" class="project-grid">
      <div class="empty-state">加载中…</div>
    </div>
  </div>
</div>

<dialog id="newProjectDialog">
  <form method="dialog" id="newProjectForm" class="form-stack" style="min-width:320px;padding:8px;">
    <h2 style="margin:0 0 12px;">新建大项目</h2>
    <label>名称 <input id="newProjectName" required autocomplete="off" /></label>
    <label>描述 <textarea id="newProjectDesc" rows="3" placeholder="业务线、范围简述"></textarea></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button type="button" class="btn btn-ghost" id="newProjectCancel">取消</button>
      <button type="submit" class="btn btn-primary">创建</button>
    </div>
    <p class="feedback muted" id="newProjectFeedback"></p>
  </form>
</dialog>

<script>
(function () {
  ${buildWorkbenchViewSwitchClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var PRESENTATION = ${presentation ? "true" : "false"};
  if (PRESENTATION) {
    document.body.classList.add('page-shell--presentation');
    var exitBtn = document.getElementById('exitPresentationBtn');
    if (exitBtn) exitBtn.hidden = false;
  }
  var grid = document.getElementById('projectGrid');
  var loadMeta = document.getElementById('loadMeta');
  function attnClass(bucket) {
    if (bucket === 'blocked') return 'attn-blocked';
    if (bucket === 'needs_manager') return 'attn-needs';
    return '';
  }
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function renderCards(cards) {
    if (!cards || !cards.length) {
      grid.innerHTML = '<div class="empty-state">暂无项目。可点击「新建项目」开始归类大任务。</div>';
      return;
    }
    grid.innerHTML = cards.map(function (c) {
      var b = c.breakdown || {};
      var href = '/workbench/manager/tasks?projectId=' + encodeURIComponent(c.projectId);
      return '<article class="project-card ' + attnClass(c.attentionBucket) + '" data-project-id="' + esc(c.projectId) + '" tabindex="0" role="button">'
        + '<h3>' + esc(c.name) + '</h3>'
        + (c.description ? '<p class="desc">' + esc(c.description) + '</p>' : '<p class="desc">—</p>')
        + '<p class="headline">' + esc(c.headline || c.attentionLabel) + '</p>'
        + '<div class="kpi-row">'
        + '<div><div class="lbl">待您处理</div><div class="val">' + (b.needsManager||0) + '</div></div>'
        + '<div><div class="lbl">待承接</div><div class="val">' + (b.waitingAccept||0) + '</div></div>'
        + '<div><div class="lbl">执行中</div><div class="val">' + (b.inProgress||0) + '</div></div>'
        + '<div><div class="lbl">阻塞</div><div class="val">' + (b.blocked||0) + '</div></div>'
        + '<div><div class="lbl">已完成</div><div class="val">' + (b.done||0) + '</div></div>'
        + '</div>'
        + '<p class="muted" style="margin:10px 0 0;font-size:12px;">' + (c.taskCount||0) + ' 条大任务 · ' + esc(c.attentionLabel) + '</p>'
        + '</article>';
    }).join('');
    grid.querySelectorAll('.project-card').forEach(function (el) {
      function go() {
        var pid = el.getAttribute('data-project-id');
        if (pid) window.location.href = '/workbench/manager/tasks?projectId=' + encodeURIComponent(pid);
      }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }
  async function load() {
    loadMeta.textContent = '加载中…';
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'load failed');
      renderCards(data.cards || []);
      loadMeta.textContent = '共 ' + (data.cards ? data.cards.length : 0) + ' 个视图（含未归类）';
    } catch (e) {
      grid.innerHTML = '<div class="empty-state">加载失败</div>';
      loadMeta.textContent = String(e.message || e);
    }
  }
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('presentationBtn').addEventListener('click', function () {
    window.location.href = '/workbench/manager/projects?presentation=1';
  });
  var dlg = document.getElementById('newProjectDialog');
  document.getElementById('newProjectBtn').addEventListener('click', function () { dlg.showModal(); });
  document.getElementById('newProjectCancel').addEventListener('click', function () { dlg.close(); });
  document.getElementById('newProjectForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var fb = document.getElementById('newProjectFeedback');
    fb.textContent = '';
    try {
      var res = await fetch('/api/workbench/manager/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('newProjectName').value.trim(),
          description: document.getElementById('newProjectDesc').value.trim()
        })
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'create failed');
      dlg.close();
      document.getElementById('newProjectName').value = '';
      document.getElementById('newProjectDesc').value = '';
      await load();
    } catch (err) {
      fb.textContent = String(err.message || err);
    }
  });
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });
  load();
})();
</script>
</body>
</html>`;
}
