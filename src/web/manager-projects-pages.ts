import { WORKBENCH_PROJECT_OVERVIEW_CSS } from "./workbench-project-overview-styles";
import { renderWorkbenchPage } from "./workbench-shell";
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
  showAdminOpsLink?: boolean;
}): string {
  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-proj",
    title: "项目总览",
    pageTitle: "项目总览 · 主管工作台",
    description: "按项目查看主任务整体进展；需要子任务明细请进入历史任务。周会汇报请使用周度看板。",
    userLabel: params.userLabel,
    portfolioEnabled: true,
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: WORKBENCH_PROJECT_OVERVIEW_CSS,
    mainHtml: `
  <div class="card">
    <div class="proj-page-toolbar">
      <button type="button" class="btn btn-primary btn-sm" id="newProjectBtn">新建项目</button>
      <button type="button" class="btn btn-ghost btn-sm" id="refreshBtn">刷新</button>
      <input type="search" class="proj-search" id="projectSearch" placeholder="搜索项目名称…" aria-label="搜索项目" />
      <div class="proj-filter-chips" id="projectFilterChips" aria-label="快捷筛选">
        <button type="button" class="proj-filter-chip" data-proj-filter="all" aria-pressed="true">全部</button>
        <button type="button" class="proj-filter-chip" data-proj-filter="needs_manager">有待您处理</button>
        <button type="button" class="proj-filter-chip" data-proj-filter="blocked">有阻塞</button>
        <button type="button" class="proj-filter-chip" data-proj-filter="unassigned">仅未归类</button>
      </div>
      <p class="proj-load-meta" id="loadMeta" role="status" aria-live="polite">加载中…</p>
    </div>
    <div id="projectGrid" class="project-grid">
      <div class="empty-state">加载中…</div>
    </div>
  </div>

<div class="wb-modal-overlay wb-project-dialog" id="newProjectDialogOverlay" role="dialog" aria-modal="true" aria-labelledby="newProjectDialogTitle">
  <div class="wb-modal wb-modal--sm" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="newProjectDialogTitle">新建项目</h3>
      <button type="button" class="wb-modal__close" id="newProjectCancel" aria-label="关闭">×</button>
    </div>
    <form id="newProjectForm" class="wb-modal__body form-stack">
      <label>名称 <input id="newProjectName" required autocomplete="off" /></label>
      <label>描述 <textarea id="newProjectDesc" rows="3" placeholder="业务线、范围简述"></textarea></label>
      <p class="feedback muted" id="newProjectFeedback"></p>
    </form>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-ghost" id="newProjectCancelFoot">取消</button>
      <button type="submit" form="newProjectForm" class="btn btn-primary">创建</button>
    </div>
  </div>
</div>`,
    scriptHtml: `<script>
(function () {
  ${buildWorkbenchViewSwitchClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var grid = document.getElementById('projectGrid');
  var loadMeta = document.getElementById('loadMeta');
  var allCards = [];
  var projFilter = 'all';
  var searchKw = '';

  function attnClass(bucket) {
    if (bucket === 'blocked') return 'attn-blocked';
    if (bucket === 'needs_manager') return 'attn-needs';
    return '';
  }
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function tasksHref(projectId, extraScope) {
    var q = 'view=group&projectId=' + encodeURIComponent(projectId);
    if (extraScope) q += '&scope=' + encodeURIComponent(extraScope);
    return '/workbench/manager/tasks?' + q;
  }
  function dashboardHref(projectId) {
    return '/workbench/manager/dashboard?projectId=' + encodeURIComponent(projectId);
  }
  function renderProgress(c) {
    var p = c.progress || {};
    var pill = '<span class="project-card__pill tone-' + esc(p.pillTone || 'idle') + '">' + esc(p.pillLabel || '—') + '</span>';
    var summary = '<span class="project-card__summary">' + esc(p.summary || '') + '</span>';
    var tagInner = '';
    if (p.tags && p.tags.length) {
      tagInner = p.tags.map(function (t) {
        return '<span class="project-card__tag">' + esc(t.label || '') + '</span>';
      }).join('');
    }
    var barInner = '';
    if (p.barSegments && p.barSegments.length) {
      barInner = p.barSegments.map(function (s) {
        return '<span class="seg seg-' + esc(s.tone || 'running') + '" style="width:' + esc(String(s.pct || 0)) + '%"></span>';
      }).join('');
    }
    return '<div class="project-card__progress">'
      + '<div class="project-card__progress-main">'
      + '<div class="project-card__progress-row">' + pill + summary + '</div>'
      + '<div class="project-card__tags-slot"><div class="project-card__tags">' + tagInner + '</div></div>'
      + '</div>'
      + '<div class="project-card__bar">' + barInner + '</div>'
      + '</div>';
  }
  function filterCards(cards) {
    var kw = searchKw.trim().toLowerCase();
    return cards.filter(function (c) {
      if (kw && String(c.name || '').toLowerCase().indexOf(kw) < 0) return false;
      if (projFilter === 'all') return true;
      if (projFilter === 'unassigned') return String(c.projectId) === '__unassigned__';
      if (projFilter === 'needs_manager') {
        return (c.taskBuckets && c.taskBuckets.needs_manager > 0) || c.attentionBucket === 'needs_manager';
      }
      if (projFilter === 'blocked') {
        return (c.taskBuckets && c.taskBuckets.blocked > 0) || c.attentionBucket === 'blocked';
      }
      return true;
    });
  }
  function renderCards(cards) {
    var visible = filterCards(cards);
    if (!visible.length) {
      grid.innerHTML = '<div class="empty-state">暂无匹配项目。可调整筛选或点击「新建项目」。</div>';
      return;
    }
    grid.innerHTML = visible.map(function (c) {
      var pid = String(c.projectId || '');
      var isUnassigned = pid === '__unassigned__';
      var primaryLabel = isUnassigned ? '整理未归类任务' : '查看任务列表';
      var desc = c.description ? esc(c.description) : (isUnassigned ? '待整理归属的主任务' : '—');
      return '<article class="project-card ' + attnClass(c.attentionBucket) + '" data-project-id="' + esc(pid) + '" tabindex="0" role="button">'
        + '<div class="project-card__head"><h3>' + esc(c.name) + '</h3><p class="desc">' + desc + '</p></div>'
        + renderProgress(c)
        + '<div class="project-card__actions">'
        + '<button type="button" class="btn btn-primary btn-sm" data-card-go="' + esc(pid) + '">' + esc(primaryLabel) + '</button>'
        + (isUnassigned ? '' : '<a class="btn btn-ghost btn-sm" href="' + dashboardHref(pid) + '">周度看板</a>')
        + '</div>'
        + '</article>';
    }).join('');
    grid.querySelectorAll('.project-card').forEach(function (el) {
      function go(ev) {
        if (ev.target.closest('.project-card__actions .btn')) return;
        var id = el.getAttribute('data-project-id');
        if (id) window.location.href = tasksHref(id, id === '__unassigned__' ? 'unassigned' : '');
      }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
      });
    });
    grid.querySelectorAll('[data-card-go]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var pid = btn.getAttribute('data-card-go');
        if (!pid) return;
        var scope = pid === '__unassigned__' ? 'unassigned' : '';
        window.location.href = tasksHref(pid, scope);
      });
    });
  }
  async function load() {
    loadMeta.textContent = '加载中…';
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || 'load failed');
      allCards = data.cards || [];
      renderCards(allCards);
      var n = allCards.filter(function (c) { return String(c.projectId) !== '__unassigned__'; }).length;
      var un = allCards.find(function (c) { return String(c.projectId) === '__unassigned__'; });
      loadMeta.textContent = n + ' 个项目' + (un && un.taskCount ? ' · 未归类 ' + un.taskCount + ' 条' : '');
    } catch (e) {
      grid.innerHTML = '<div class="empty-state">加载失败</div>';
      loadMeta.textContent = String(e.message || e);
    }
  }
  document.getElementById('refreshBtn').addEventListener('click', load);
  document.getElementById('projectSearch').addEventListener('input', function (e) {
    searchKw = String(e.target.value || '');
    renderCards(allCards);
  });
  document.querySelectorAll('[data-proj-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      projFilter = chip.getAttribute('data-proj-filter') || 'all';
      document.querySelectorAll('[data-proj-filter]').forEach(function (c) {
        c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
      });
      renderCards(allCards);
    });
  });
  var dlg = document.getElementById('newProjectDialogOverlay');
  function openNewProjectDialog() {
    if (dlg) dlg.setAttribute('data-open', 'true');
  }
  function closeNewProjectDialog() {
    if (dlg) dlg.removeAttribute('data-open');
  }
  document.getElementById('newProjectBtn').addEventListener('click', openNewProjectDialog);
  document.getElementById('newProjectCancel').addEventListener('click', closeNewProjectDialog);
  document.getElementById('newProjectCancelFoot').addEventListener('click', closeNewProjectDialog);
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) closeNewProjectDialog();
  });
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
      closeNewProjectDialog();
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
</script>`,
  });
}
