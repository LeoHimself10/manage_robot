import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { buildWorkbenchContactComboClientJs } from "./workbench-contact-combo-snippet";
import { buildWorkbenchFmtTimeClientJs } from "./workbench-datetime";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";

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

function workbenchEnforceActionGuards(): boolean {
  const raw = String(process.env.WORKBENCH_ENFORCE_ACTION_GUARDS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function buildManagerTasksPortfolioClientJs(initialProjectId: string): string {
  return `
  var WB_FILTER_PROJECT_ID = '${initialProjectId.replace(/'/g, "")}';
  async function loadProjectFilterOptions() {
    var sel = document.getElementById('filterProject');
    if (!sel) return;
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;
      var cards = data.cards || [];
      sel.innerHTML = '<option value="">全部项目</option>' + cards.map(function (c) {
        return '<option value="' + escapeHtml(c.projectId) + '">' + escapeHtml(c.name) + '</option>';
      }).join('');
      if (WB_FILTER_PROJECT_ID) sel.value = WB_FILTER_PROJECT_ID;
    } catch (e) {}
  }
  var filterProjectEl = document.getElementById('filterProject');
  if (filterProjectEl) {
    filterProjectEl.addEventListener('change', async function () {
      WB_FILTER_PROJECT_ID = String(filterProjectEl.value || '').trim();
      await loadTasks();
    });
  }
  void (async function () {
    await loadProjectFilterOptions();
    await loadTasks();
  })();
  `;
}

export function renderManagerTasksPage(params: {
  planId?: string;
  planTitle?: string;
  userLabel?: string;
  projectPortfolioEnabled?: boolean;
  initialProjectId?: string;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const portfolio = Boolean(params.projectPortfolioEnabled);
  const initialProjectId = escapeHtml(params.initialProjectId ?? "");
  const portfolioNav = portfolio
    ? '<a href="/workbench/manager/projects">项目总览</a>\n        '
    : "";
  const projectFilter = portfolio
    ? `<label>大项目
          <select id="filterProject">
            <option value="">全部项目</option>
          </select>
        </label>`
    : "";

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
        ${portfolioNav}<a class="active" href="/workbench/manager/tasks">历史任务</a>
        <a href="/workbench/manager/chat">智能规划助手</a>
        <a href="/workbench/employee?view=new" id="navMyTasks">我负责的任务</a>
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
      <section class="kpis kpis--5" aria-live="polite">
        <div class="kpi"><div class="lbl">任务总数</div><div class="val" id="kpiTotal">—</div></div>
        <div class="kpi"><div class="lbl">待您处理</div><div class="val" id="kpiNeedsMgr">—</div></div>
        <div class="kpi"><div class="lbl">待员工承接</div><div class="val" id="kpiWaiting">—</div></div>
        <div class="kpi"><div class="lbl">员工执行中</div><div class="val" id="kpiRunning">—</div></div>
        <div class="kpi"><div class="lbl">已完成</div><div class="val" id="kpiDone">—</div></div>
      </section>
      <div class="mgr-list-toolbar form-stack" role="search" aria-label="任务筛选">
        <label>关注状态
          <select id="filterAttention">
            <option value="">全部</option>
            <option value="needs_manager">待您处理</option>
            <option value="waiting_employee">待员工承接</option>
            <option value="employee_running">员工执行中</option>
            <option value="blocked">阻塞</option>
            <option value="done">已完成</option>
          </select>
        </label>
        <label>标题 / 业务编号
          <input id="filterKeyword" type="search" placeholder="关键词" autocomplete="off" />
        </label>
        <label>负责人
          <input id="filterAssignee" type="search" placeholder="姓名关键词" autocomplete="off" />
        </label>
        ${projectFilter}
        <label>排序
          <select id="filterSort">
            <option value="updated_desc">更新时间 ↓</option>
            <option value="updated_asc">更新时间 ↑</option>
            <option value="task_no">业务编号</option>
            <option value="attention">关注优先级</option>
          </select>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
          <button type="button" class="btn btn-primary btn-sm" id="filterApplyBtn">应用筛选</button>
          <button type="button" class="btn btn-ghost btn-sm" id="filterClearBtn">清除筛选</button>
        </div>
      </div>
      <p class="muted" id="filterResultMeta" style="margin:0 0 10px;font-size:13px;" role="status" aria-live="polite">—</p>
      <div>
        <p class="page-desc" style="margin:0 0 14px;">${who}可见的全部任务；列表状态为「需您关注」视角，与子任务实际状态可能不同。</p>
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
            <input id="reassignAssigneeInput" type="search" autocomplete="off" placeholder="输入姓名或部门（1 字起搜）" style="width:100%;" />
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
        <label id="mgrReassignConfirmWrap" style="display:none;align-items:center;gap:8px;">
          <input type="checkbox" id="mgrReassignConfirm" /> 确认执行改派
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
  ${buildWorkbenchViewSwitchClientJs()}
  ${buildWorkbenchContactComboClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var WB_ENFORCE_ACTION_GUARDS = ${workbenchEnforceActionGuards() ? "true" : "false"};
  if (WB_ENFORCE_ACTION_GUARDS) {
    var mgrWrap = document.getElementById('mgrReassignConfirmWrap');
    if (mgrWrap) mgrWrap.style.display = 'flex';
  }
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
  ${buildWorkbenchFmtTimeClientJs()}
  function attentionRank(bucket) {
    if (bucket === 'needs_manager') return 0;
    if (bucket === 'blocked') return 1;
    if (bucket === 'waiting_employee') return 2;
    if (bucket === 'employee_running') return 3;
    return 4;
  }
  function badgeClassForBucket(bucket) {
    if (bucket === 'needs_manager') return 'pending';
    if (bucket === 'blocked') return 'blocked';
    if (bucket === 'waiting_employee') return 'assigned';
    if (bucket === 'employee_running') return 'progress';
    if (bucket === 'done') return 'done';
    return 'assigned';
  }
  var allTasksCache = [];
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
      setFb('reassignFeedback', '', 'muted');
      return;
    }
    st.removeAttribute('aria-disabled');
    try {
      var res = await fetch('/api/workbench/tasks/detail?taskNo=' + encodeURIComponent(taskNo));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        setFb('reassignFeedback', data.error ? String(data.error) : ('加载子任务失败 HTTP ' + res.status), 'err');
        return;
      }
      var rawSubs = data.subtasks || [];
      var subs = rawSubs.filter(function (s) {
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
      if (!subs.length) {
        setFb(
          'reassignFeedback',
          '该任务下未完成子任务列表为空（可能均已标记完成）。「改派范围」下拉仅列出未完成子任务。',
          'muted',
        );
      } else {
        setFb('reassignFeedback', '', 'muted');
      }
    } catch (e) {
      setFb('reassignFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  wbAttachContactCombo({
    input: 'reassignAssigneeInput',
    hiddenUserId: 'reassignAssigneeUserId',
    optionsList: 'reassignAssigneeOptions',
    minLength: 1,
    searchUrl: function (kw) {
      return '/api/workbench/manager/contacts?keyword=' + encodeURIComponent(kw);
    },
    onFeedback: function (msg, kind) { setFb('reassignFeedback', msg, kind); }
  });

  function renderTaskTable(tasks) {
    var mount = document.getElementById('taskTableMount');
    var meta = document.getElementById('filterResultMeta');
    var total = allTasksCache.length;
    if (meta) meta.textContent = '共 ' + total + ' 条 · 当前显示 ' + tasks.length + ' 条';
    if (!tasks.length) {
      mount.innerHTML = '<div class="empty-state">' + (total ? '无匹配任务。<button type="button" class="btn btn-ghost btn-sm" id="filterClearInline">清除筛选</button>' : '暂无任务。请到钉钉与机器人发起规划并发布。') + '</div>';
      var clr = document.getElementById('filterClearInline');
      if (clr) clr.addEventListener('click', clearFilters);
      return;
    }
    var rows = tasks.map(function (t) {
      var bucket = String(t.attentionBucket || '');
      var hint = String(t.attentionHint || '').trim();
      var stHtml = '<span class="badge ' + badgeClassForBucket(bucket) + '">' + escapeHtml(t.attentionLabel || t.statusLabel || '—') + '</span>';
      if (hint) stHtml += '<br><span class="muted" style="font-size:12px;">' + escapeHtml(hint) + '</span>';
      var detail = '<a href="/workbench/manager/task?taskNo=' + encodeURIComponent(t.taskNo || '') + '">查看详情</a>';
      return '<tr>'
        + '<td><code>' + escapeHtml(t.taskNo || '—') + '</code></td>'
        + '<td>' + escapeHtml(t.title || '—') + '</td>'
        + '<td>' + escapeHtml(t.assigneeSummary || '—') + '</td>'
        + '<td>' + escapeHtml(String(t.subtasksCount || 0)) + '（阻塞 ' + escapeHtml(String(t.blockedCount || 0)) + '）</td>'
        + '<td>' + stHtml + '</td>'
        + '<td>' + fmtTime(t.updatedAt) + '<br>' + detail + '</td>'
        + '</tr>';
    }).join('');
    mount.innerHTML = '<div class="table-wrap"><table class="data">'
      + '<thead><tr><th>业务编号</th><th>标题</th><th>负责人</th><th>子任务</th><th>关注状态</th><th>更新时间</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>';
  }
  function applyFiltersAndSort() {
    var att = String(document.getElementById('filterAttention')?.value || '').trim();
    var kw = String(document.getElementById('filterKeyword')?.value || '').trim().toLowerCase();
    var asg = String(document.getElementById('filterAssignee')?.value || '').trim().toLowerCase();
    var sort = String(document.getElementById('filterSort')?.value || 'updated_desc');
    var list = allTasksCache.slice();
    list = list.filter(function (t) {
      if (att && String(t.attentionBucket || '') !== att) return false;
      if (kw) {
        var hay = (String(t.taskNo || '') + ' ' + String(t.title || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      if (asg) {
        var who = String(t.assigneeSummary || '').toLowerCase();
        if (who.indexOf(asg) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (sort === 'attention') {
        var pa = attentionRank(String(a.attentionBucket || ''));
        var pb = attentionRank(String(b.attentionBucket || ''));
        if (pa !== pb) return pa - pb;
      } else if (sort === 'task_no') {
        return String(a.taskNo || '').localeCompare(String(b.taskNo || ''), 'zh-CN');
      }
      var ta = Date.parse(a.updatedAt || '') || 0;
      var tb = Date.parse(b.updatedAt || '') || 0;
      return sort === 'updated_asc' ? ta - tb : tb - ta;
    });
    renderTaskTable(list);
  }
  function clearFilters() {
    var fa = document.getElementById('filterAttention');
    var fk = document.getElementById('filterKeyword');
    var fas = document.getElementById('filterAssignee');
    var fs = document.getElementById('filterSort');
    if (fa) fa.value = '';
    if (fk) fk.value = '';
    if (fas) fas.value = '';
    if (fs) fs.value = 'updated_desc';
    applyFiltersAndSort();
  }
  async function loadTasks() {
    setFb('tableFeedback', '加载中…', 'muted');
    try {
      var tasksUrl = '/api/workbench/manager/tasks';
      if (WB_PORTFOLIO && WB_FILTER_PROJECT_ID) {
        tasksUrl += '?projectId=' + encodeURIComponent(WB_FILTER_PROJECT_ID);
      }
      var res = await fetch(tasksUrl);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      allTasksCache = data.tasks || [];
      var kNeeds = 0, kWait = 0, kRun = 0, kDone = 0;
      allTasksCache.forEach(function (t) {
        var b = String(t.attentionBucket || '');
        if (b === 'done') kDone++;
        else if (b === 'needs_manager') kNeeds++;
        else if (b === 'waiting_employee') kWait++;
        else if (b === 'employee_running' || b === 'blocked') kRun++;
      });
      setText('kpiTotal', String(allTasksCache.length));
      setText('kpiNeedsMgr', String(kNeeds));
      setText('kpiWaiting', String(kWait));
      setText('kpiRunning', String(kRun));
      setText('kpiDone', String(kDone));

      var sel = document.getElementById('reassignPlanId');
      if (!allTasksCache.length) {
        document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">暂无任务。请到钉钉与机器人发起规划并发布。</div>';
        sel.innerHTML = '<option value="">暂无任务</option>';
        setText('kpiTotal', '0');
        setText('kpiNeedsMgr', '0');
        setText('kpiWaiting', '0');
        setText('kpiRunning', '0');
        setText('kpiDone', '0');
        var meta0 = document.getElementById('filterResultMeta');
        if (meta0) meta0.textContent = '共 0 条 · 当前显示 0 条';
        setFb('tableFeedback', '', 'muted');
        return;
      }

      applyFiltersAndSort();

      sel.innerHTML = '<option value="">请选择任务</option>' + allTasksCache.map(function (t) {
        var optLabel = escapeHtml(t.taskNo || '任务') + ' · ' + escapeHtml(t.title || '') + ' · ' + escapeHtml(t.statusLabel || t.status);
        return '<option value="' + escapeHtml(t.planId) + '" data-task-no="' + escapeHtml(t.taskNo || '') + '">' + optLabel + '</option>';
      }).join('');

      if (!sel.dataset.boundReassignTask) {
        sel.dataset.boundReassignTask = '1';
        sel.addEventListener('change', function () { void loadSubtasksForReassign(); });
      }
      var pageQs = '';
      try {
        pageQs = String(window.location.search || '');
      } catch (e0) {
        pageQs = '';
      }
      var usp = new URLSearchParams(pageQs);
      var focusPlanId = String(usp.get('planId') || '').trim() || String(${JSON.stringify(params.planId ?? "")} || '').trim();
      var focusTab = String(usp.get('focus') || '').trim().toLowerCase();
      var focusSubtaskId = String(usp.get('subtaskId') || '').trim();
      if (focusPlanId) {
        var hasOpt = Array.prototype.some.call(sel.options, function (o) {
          return String(o.value || '') === focusPlanId;
        });
        if (hasOpt) sel.value = focusPlanId;
      }
      if (focusTab === 'reassign') {
        setActiveTab('mgrPanelReassign');
      }
      await loadSubtasksForReassign();
      if (focusSubtaskId) {
        var stPick = document.getElementById('reassignSubtaskPick');
        if (stPick) {
          var hasSubOpt = Array.prototype.some.call(stPick.options, function (o) {
            return String(o.value || '') === focusSubtaskId;
          });
          if (hasSubOpt) stPick.value = focusSubtaskId;
        }
      }

      setFb('tableFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">加载失败，请稍后重试。</div>';
      setFb('tableFeedback', String(e && e.message ? e.message : e), 'err');
    }
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
      if (WB_ENFORCE_ACTION_GUARDS) {
        var c = document.getElementById('mgrReassignConfirm');
        if (!c || !c.checked) { setFb('reassignFeedback', '请勾选确认执行改派', 'err'); return; }
        payload.confirm = true;
        try {
          payload.idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : ('reassign-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        } catch (e0) {
          payload.idempotencyKey = 'reassign-' + Date.now();
        }
      }
      var res = await fetch('/api/workbench/manager/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('reassignFeedback', '改派已保存', 'ok');
      if (WB_ENFORCE_ACTION_GUARDS) {
        var cDone = document.getElementById('mgrReassignConfirm');
        if (cDone) cDone.checked = false;
      }
      document.getElementById('reassignAssigneeInput').value = '';
      document.getElementById('reassignAssigneeUserId').value = '';
      var reassignOpts = document.getElementById('reassignAssigneeOptions');
      if (reassignOpts) { reassignOpts.hidden = true; reassignOpts.innerHTML = ''; }
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
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  var filterApplyBtn = document.getElementById('filterApplyBtn');
  var filterClearBtn = document.getElementById('filterClearBtn');
  if (filterApplyBtn) filterApplyBtn.addEventListener('click', applyFiltersAndSort);
  if (filterClearBtn) filterClearBtn.addEventListener('click', clearFilters);
  ${portfolio ? buildManagerTasksPortfolioClientJs(initialProjectId) : "void loadTasks();"}
})();
</script>
</body>
</html>`;
}

export function renderManagerChatPage(params: {
  threadId?: string;
  threadKind?: "main" | "side";
  planTitle?: string;
  userLabel?: string;
  openDraftEditor?: boolean;
  projectPortfolioEnabled?: boolean;
}): string {
  const initialThreadId = params.threadId ?? "main";
  const initialKind = params.threadKind ?? "main";
  const initialTitle = params.planTitle ?? (initialKind === "main" ? "钉钉规划助手" : "新规划会话");
  const initialOpenDraftEditor = Boolean(params.openDraftEditor);
  const portfolio = Boolean(params.projectPortfolioEnabled);
  const portfolioNav = portfolio
    ? '<a href="/workbench/manager/projects">项目总览</a>\n        '
    : "";
  const projectChipBar = portfolio
    ? `<div class="draft-context-bar" id="projectChipBar" style="margin:0 0 8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <span class="muted" style="font-size:13px;">当前大项目</span>
        <select id="activeProjectSelect" class="btn btn-ghost btn-sm" style="max-width:240px;">
          <option value="">未选择</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" id="clearActiveProjectBtn">清除</button>
        <span class="muted" id="activeProjectHint" style="font-size:12px;"></span>
      </div>`
    : "";

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
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        ${portfolioNav}<a href="/workbench/manager/tasks">历史任务</a>
        <a class="active" href="/workbench/manager/chat?thread=main">智能规划助手</a>
        <a href="/workbench/employee?view=new" id="navMyTasks">我负责的任务</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>
  ${projectChipBar}

  <div class="chat-main">
    <aside class="chat-sidebar" aria-label="会话列表">
      <div class="chat-sidebar-head">
        <button type="button" class="btn btn-primary btn-sm" id="newThreadBtn" style="width:100%;">+ 新规划会话</button>
      </div>
      <ul class="chat-thread-list" id="threadList"><li class="muted" style="padding:8px;">加载中…</li></ul>
      <div class="chat-sidebar-tip">与助手对话可拆解任务、点将并发布。Enter 发送，Shift+Enter 换行。</div>
    </aside>

    <div class="chat-pane">
      <div class="chat-pane-head">
        <div>
          <h2 class="chat-pane-title" id="paneTitle">${escapeHtml(initialTitle)}</h2>
          <div class="chat-pane-sub chat-pane-sub--hidden" id="paneSub">与规划助手协作</div>
        </div>
        <div class="chat-pane-head-actions">
          <span class="chat-thread-badge" id="paneBadge">${initialKind === "main" ? "主线程" : "侧会话"}</span>
        </div>
      </div>
      <div class="draft-context-bar is-muted" id="draftContextBar">
        <span id="draftContextText">暂无草案</span>
      </div>
      <section class="chat-message-pane">
        <div class="chat-stream" id="chatStream" aria-live="polite">
          <ul class="msg-list" id="msgList"></ul>
        </div>
        <div class="chat-composer-wrap">
          <div class="chat-composer-card">
            <textarea id="msgInput" aria-label="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
            <div class="composer-actions">
              <div class="composer-secondary">
                <label class="btn btn-ghost btn-sm" for="rosterFileInput" style="margin:0;cursor:pointer;">上传花名册</label>
                <input id="rosterFileInput" type="file" accept=".md,.markdown,.txt,.docx,.pdf" style="display:none;" />
                <span class="muted" id="rosterStatus"></span>
              </div>
              <button type="button" class="btn btn-primary btn-sm" id="sendBtn">发送</button>
            </div>
            <div class="composer-status muted" id="sendFeedback" hidden></div>
          </div>
        </div>
      </section>
    </div>

    <aside class="draft-context-panel draft-context-panel--empty" id="draftContextPanel" aria-label="草案上下文" data-state="empty">
      <div class="draft-panel-empty-wrap" id="draftPanelEmptyWrap">
        <div class="draft-panel-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        </div>
        <h3 class="draft-panel-empty-title">暂无草案</h3>
        <p class="draft-panel-empty" id="draftPanelEmpty">本会话暂无草案，在下方输入任务开始规划。</p>
      </div>
      <div class="draft-panel-body" id="draftPanelBody" hidden>
        <div class="draft-panel__head">
          <div class="draft-panel__title-row">
            <h3 class="draft-panel__title">草案 <span class="draft-count-badge" id="draftStatCount">0</span></h3>
          </div>
          <div class="draft-panel__meta">
            <div class="draft-assign-progress">
              <div class="draft-assign-progress__bar"><div class="draft-assign-progress__fill" id="draftProgressFill" style="width:0%"></div></div>
              <span class="draft-assign-progress__label" id="draftProgressLabel"><em>0/0</em> 已指派</span>
            </div>
            <div class="draft-due-row" id="draftDueRow" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              最近截止 <strong id="draftStatDue">—</strong>
            </div>
            <button type="button" class="btn-draft-edit-table" id="editDraftBtnPanel" hidden title="在弹窗中编辑 16 列草案表格">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
              编辑草案表格
            </button>
          </div>
        </div>
        <div class="draft-panel__list" id="draftPreviewList" role="list"></div>
        <div class="draft-panel__foot">
          <button type="button" class="btn-draft-publish" id="publishDraftBtnPanel" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
            发放任务
          </button>
          <p class="draft-foot-caption" id="draftFootCaption">将弹窗确认，预检与预览在对话区展示</p>
        </div>
      </div>
    </aside>
  </div>
</div>

<div class="wb-modal-overlay" id="publishPrepareModalOverlay" role="dialog" aria-modal="true" aria-labelledby="publishPrepareModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="publishPrepareModalTitle">发放预检</h3>
      <button type="button" class="wb-modal__close" id="publishPrepareModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p id="publishPrepareSummary" style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">—</p>
      <p id="publishPrepareWarn" class="muted" style="display:none;margin:0;font-size:13px;color:#b45309;">仍有未指派子任务，预检可能提示需先完成点将。</p>
      <p class="muted" style="margin:10px 0 0;font-size:13px;">将在对话中展示发放预览，确认后再正式下发。</p>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="publishPrepareCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="publishPrepareContinueBtn">继续预检</button>
    </div>
  </div>
</div>

<div class="wb-modal-overlay" id="publishConfirmModalOverlay" role="dialog" aria-modal="true" aria-labelledby="publishConfirmModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="publishConfirmModalTitle">确认发放</h3>
      <button type="button" class="wb-modal__close" id="publishConfirmModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">预览已在左侧对话中展示。确认后将正式发放给员工，此操作不可从本页撤销。</p>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="publishConfirmCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="publishConfirmOkBtn">确认发放</button>
    </div>
  </div>
</div>

<script src="/static/workbench-draft-grid.js"></script>
<script>
(function () {
  ${buildWorkbenchViewSwitchClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var WB_PORTFOLIO_CHAT = ${portfolio ? "true" : "false"};

  async function loadActiveProjectSelect(selectedId) {
    if (!WB_PORTFOLIO_CHAT) return;
    var sel = document.getElementById('activeProjectSelect');
    if (!sel) return;
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;
      var cards = (data.cards || []).filter(function (c) {
        return String(c.projectId || '') !== '__unassigned__';
      });
      var cur = String(selectedId || sel.value || '').trim();
      sel.innerHTML = '<option value="">未选择</option>' + cards.map(function (c) {
        return '<option value="' + escapeHtml(c.projectId) + '">' + escapeHtml(c.name) + '</option>';
      }).join('');
      if (cur) sel.value = cur;
      var hint = document.getElementById('activeProjectHint');
      if (hint) {
        var opt = sel.selectedOptions && sel.selectedOptions[0];
        hint.textContent = opt && opt.value ? ('规划默认归属：' + opt.textContent) : '';
      }
    } catch (e) {}
  }
  async function saveActiveProject(projectId) {
    if (!WB_PORTFOLIO_CHAT) return;
    await fetch('/api/workbench/manager/active-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projectId || '' })
    });
    await loadActiveProjectSelect(projectId);
  }
  if (WB_PORTFOLIO_CHAT) {
    var activeProjectSelect = document.getElementById('activeProjectSelect');
    if (activeProjectSelect) {
      activeProjectSelect.addEventListener('change', function () {
        void saveActiveProject(String(activeProjectSelect.value || '').trim());
      });
    }
    var clearActiveProjectBtn = document.getElementById('clearActiveProjectBtn');
    if (clearActiveProjectBtn) {
      clearActiveProjectBtn.addEventListener('click', function () {
        void saveActiveProject('');
      });
    }
    void loadActiveProjectSelect('');
  }

  var activeThreadId = ${JSON.stringify(initialThreadId)};
  var activeThreadKind = ${JSON.stringify(initialKind)};
  var activeHasDraft = false;
  var pendingOpenDraftEditor = ${JSON.stringify(initialOpenDraftEditor)};
  var sendInFlight = false;
  var loadSeq = 0;
  var pendingElapsedTimer = null;
  var publishFlowState = 'idle';
  var cachedDraftSummary = { count: 0, unassigned: 0, nearestDue: '' };
  var PUBLISH_PREPARE_MSG = '请对当前草案做发放预检并展示预览';
  var PUBLISH_CONFIRM_MSG = '确认发放';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function setComposerStatus(msg, kind) {
    var el = document.getElementById('sendFeedback');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'composer-status muted';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'composer-status ' + (kind || 'muted');
  }
  function roleClass(role) {
    var normalized = String(role || '').toLowerCase();
    if (normalized === 'user') return 'msg-bubble--user';
    if (normalized === 'assistant') return 'msg-bubble--assistant';
    return 'msg-bubble--system';
  }
  function scrollMessageStreamToBottom() {
    var stream = document.getElementById('chatStream');
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }
  var msgInput = document.getElementById('msgInput');
  function focusComposer() {
    if (!msgInput) return;
    requestAnimationFrame(function () {
      msgInput.focus();
      var composer = document.querySelector('.chat-composer-wrap');
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
  function messagesQuery() {
    if (activeThreadKind === 'side' && activeThreadId && activeThreadId !== 'main') {
      return '/api/workbench/conversation/messages?thread=side&threadId=' + encodeURIComponent(activeThreadId);
    }
    return '/api/workbench/conversation/messages?thread=main';
  }
  function draftQuery() {
    if (activeThreadKind === 'side' && activeThreadId && activeThreadId !== 'main') {
      return '/api/workbench/conversation/draft?thread=side&threadId=' + encodeURIComponent(activeThreadId);
    }
    return '/api/workbench/conversation/draft?thread=main';
  }
  function threadUrl(threadId, kind) {
    if (kind === 'side' && threadId && threadId !== 'main') {
      return '/workbench/manager/chat?thread=side&threadId=' + encodeURIComponent(threadId);
    }
    return '/workbench/manager/chat?thread=main';
  }
  function updatePaneHeader(meta) {
    document.getElementById('paneTitle').textContent = meta.title || '智能规划助手';
    document.getElementById('paneBadge').textContent = meta.badge || (meta.kind === 'main' ? '主线程' : '侧会话');
    var sub = document.getElementById('paneSub');
    if (sub) {
      if (meta.hasDraft) {
        sub.textContent = '草案未发布 · 可继续对话或编辑表格';
        sub.classList.remove('chat-pane-sub--hidden');
      } else {
        sub.classList.add('chat-pane-sub--hidden');
      }
    }
  }
  function openPublishModal(overlayId) {
    var el = document.getElementById(overlayId);
    if (el) el.setAttribute('data-open', 'true');
  }
  function closePublishModal(overlayId) {
    var el = document.getElementById(overlayId);
    if (el) el.setAttribute('data-open', 'false');
  }
  function closeAllPublishModals() {
    closePublishModal('publishPrepareModalOverlay');
    closePublishModal('publishConfirmModalOverlay');
  }
  function resetPublishFlow() {
    publishFlowState = 'idle';
    closeAllPublishModals();
    updatePublishBtnUi();
  }
  function updatePublishBtnUi() {
    var btn = document.getElementById('publishDraftBtnPanel');
    if (!btn) return;
    btn.disabled = sendInFlight || !activeHasDraft;
    var label = (sendInFlight && publishFlowState === 'preparing') ? '预检中…' : '发放任务';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>' + label;
  }
  function openPublishPrepareModal() {
    if (!activeHasDraft || sendInFlight) return;
    var sumEl = document.getElementById('publishPrepareSummary');
    var warnEl = document.getElementById('publishPrepareWarn');
    var s = cachedDraftSummary;
    var line = s.count + ' 条子任务 · ' + s.unassigned + ' 条未指派';
    if (s.nearestDue) line += ' · 最近截止 ' + s.nearestDue;
    if (sumEl) sumEl.textContent = line;
    if (warnEl) warnEl.style.display = s.unassigned > 0 ? 'block' : 'none';
    openPublishModal('publishPrepareModalOverlay');
  }
  function applyDraftPanelUi(hasDraft) {
    activeHasDraft = hasDraft;
    var btn = document.getElementById('editDraftBtnPanel');
    var pubBtn = document.getElementById('publishDraftBtnPanel');
    if (btn) btn.hidden = !hasDraft;
    if (pubBtn) pubBtn.hidden = !hasDraft;
    var panel = document.getElementById('draftContextPanel');
    var emptyWrap = document.getElementById('draftPanelEmptyWrap');
    var emptyHint = document.getElementById('draftPanelEmpty');
    var body = document.getElementById('draftPanelBody');
    if (panel) {
      panel.classList.toggle('draft-context-panel--empty', !hasDraft);
      if (!hasDraft) panel.setAttribute('data-state', 'empty');
    }
    if (emptyWrap) emptyWrap.hidden = hasDraft;
    if (emptyHint) emptyHint.hidden = false;
    if (body) body.hidden = !hasDraft;
    if (!hasDraft) resetPublishFlow();
    updatePublishBtnUi();
  }
  function resetDraftPanelForThreadSwitch() {
    resetPublishFlow();
    applyDraftPanelUi(false);
    updateDraftContext({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
  }
  function parseAssigneeCell(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var m = s.match(/^(.+?)\\s*\\([^)]+\\)\\s*$/);
    return m ? m[1].trim() : s;
  }
  function assigneeInitial(name) {
    var n = String(name || '').trim();
    if (!n) return '?';
    return n.charAt(0);
  }
  function avatarTone(userId) {
    var h = 0;
    var s = String(userId || 'x');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'draft-avatar--tone-' + (Math.abs(h) % 4);
  }
  function renderDraftTaskRow(item) {
    var pending = !item.assigned;
    var rowClass = 'draft-task-row' + (pending ? ' draft-task-row--pending' : '');
    var assigneeHtml;
    if (pending) {
      assigneeHtml = '<div class="draft-assignee"><span class="draft-avatar draft-avatar--pending">?</span></div>';
    } else {
      var init = escapeHtml(assigneeInitial(item.assigneeName));
      var tone = avatarTone(item.userId || item.assigneeName);
      var nameHtml = item.assigneeName
        ? '<span class="draft-assignee__name">' + escapeHtml(item.assigneeName) + '</span>'
        : '';
      assigneeHtml = '<div class="draft-assignee"><span class="draft-avatar ' + tone + '">' + init + '</span>' + nameHtml + '</div>';
    }
    var subHtml = pending ? '<div class="draft-task-row__sub">待指派</div>' : '';
    return '<div class="' + rowClass + '" role="listitem">'
      + '<span class="draft-task-row__dot" aria-hidden="true"></span>'
      + '<div class="draft-task-row__body"><div class="draft-task-row__title">' + escapeHtml(item.title) + '</div>' + subHtml + '</div>'
      + assigneeHtml
      + '</div>';
  }
  function computeDraftSummary(draftData) {
    var rows = draftData.rows || [];
    var tasks = (draftData.draft && draftData.draft.tasks) || [];
    var count = rows.length || tasks.length;
    var assignments = (draftData.assignment && draftData.assignment.assignments) || [];
    var byTask = {};
    var nameByTask = {};
    assignments.forEach(function (a) {
      var tid = String(a.taskId || '').trim();
      var primary = a.primary || {};
      var uid = primary && String(primary.userId || '').trim();
      var name = primary && String(primary.displayName || '').trim();
      if (tid && uid) {
        byTask[tid] = uid;
        if (name) nameByTask[tid] = name;
      }
    });
    var unassigned = 0;
    var items = rows.length ? rows : tasks.map(function (t, i) {
      return { taskId: t.id, title: t.title, dueAt: (t.timeNode && t.timeNode.dueAt) || t.dueAt || '' };
    });
    items.forEach(function (r, idx) {
      var tid = String(r.taskId || r.id || ('task_' + (idx + 1))).trim();
      if (!byTask[tid]) unassigned += 1;
    });
    var dues = [];
    items.forEach(function (r) {
      var d = String(r.dueAt || '').trim();
      if (d && d !== '待确认' && /^\\d{4}-\\d{2}-\\d{2}/.test(d)) dues.push(d.slice(0, 10));
    });
    dues.sort();
    var preview = items.slice(0, 8).map(function (r, idx) {
      var tid = String(r.taskId || r.id || ('task_' + (idx + 1))).trim();
      var title = String(r.title || tid || '子任务').trim();
      var assigned = Boolean(byTask[tid]);
      var assigneeName = nameByTask[tid] || '';
      if (!assigneeName && assigned && r.assignee) assigneeName = parseAssigneeCell(r.assignee);
      return {
        title: title,
        assigned: assigned,
        assigneeName: assigneeName,
        userId: byTask[tid] || ''
      };
    });
    return {
      count: count,
      unassigned: unassigned,
      assigned: count - unassigned,
      nearestDue: dues[0] || '',
      preview: preview
    };
  }
  function paintDraftPanelSummary(summary, hasDraft) {
    var panel = document.getElementById('draftContextPanel');
    var fill = document.getElementById('draftProgressFill');
    var label = document.getElementById('draftProgressLabel');
    var dueRow = document.getElementById('draftDueRow');
    var d = document.getElementById('draftStatDue');
    var c = document.getElementById('draftStatCount');
    var list = document.getElementById('draftPreviewList');
    var cap = document.getElementById('draftFootCaption');
    var assigned = summary.assigned != null ? summary.assigned : Math.max(0, summary.count - summary.unassigned);
    var pct = summary.count > 0 ? Math.round((assigned / summary.count) * 100) : 0;
    if (panel && hasDraft) {
      panel.setAttribute('data-state', summary.unassigned > 0 ? 'warn' : 'ready');
      panel.style.setProperty('--draft-pct', pct + '%');
    }
    if (c) c.textContent = String(summary.count);
    if (fill) fill.style.width = pct + '%';
    if (label) label.innerHTML = '<em>' + assigned + '/' + summary.count + '</em> 已指派';
    if (dueRow) dueRow.hidden = !summary.nearestDue;
    if (d) d.textContent = summary.nearestDue || '—';
    if (list) {
      list.innerHTML = (summary.preview || []).map(renderDraftTaskRow).join('');
    }
    if (cap) {
      cap.textContent = summary.unassigned > 0
        ? '仍有 ' + summary.unassigned + ' 条未指派，预检时会提示补全'
        : '将弹窗确认，预检与预览在对话区展示';
    }
  }
  function updateDraftContext(summary, hasDraft) {
    var bar = document.getElementById('draftContextBar');
    var text = document.getElementById('draftContextText');
    if (!hasDraft) {
      if (bar) { bar.classList.add('is-muted'); bar.hidden = false; }
      if (text) text.textContent = '暂无草案';
      paintDraftPanelSummary({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
      var emptyHint = document.getElementById('draftPanelEmpty');
      if (emptyHint) {
        emptyHint.textContent = activeThreadKind === 'side'
          ? '本侧会话暂无草案，在下方输入任务开始规划。'
          : '本会话暂无草案，在下方输入任务开始规划。';
      }
      applyDraftPanelUi(false);
      return;
    }
    applyDraftPanelUi(true);
    cachedDraftSummary = summary;
    var line = summary.count + ' 条子任务 · ' + summary.unassigned + ' 条未指派';
    if (summary.nearestDue) line += ' · 最近截止 ' + summary.nearestDue;
    if (bar) { bar.classList.remove('is-muted'); bar.hidden = false; }
    if (text) text.textContent = line;
    paintDraftPanelSummary(summary, true);
  }
  function renderSkeleton() {
    var box = document.getElementById('msgList');
    var stream = document.getElementById('chatStream');
    if (stream) stream.setAttribute('aria-busy', 'true');
    if (box) {
      box.innerHTML = '<li class="chat-skeleton-msg"></li><li class="chat-skeleton-msg"></li><li class="chat-skeleton-msg"></li>';
    }
  }
  function renderEmptyState() {
    var box = document.getElementById('msgList');
    if (!box) return;
    box.innerHTML = '<li class="chat-welcome-wrap"><div class="chat-welcome">'
      + '<div class="chat-welcome__icon" aria-hidden="true">✦</div>'
      + '<h3 class="chat-welcome__title">开始规划</h3>'
      + '<p class="chat-welcome__lead">在下方描述任务目标或粘贴需求，助手将协助拆解 WBS、点将与发布预览。</p>'
      + '<div class="chat-welcome__steps">'
      + '<div class="chat-welcome__step"><span class="chat-welcome__step-num">1</span><span class="chat-welcome__step-text">说清楚背景、对象、时间与交付物</span></div>'
      + '<div class="chat-welcome__step"><span class="chat-welcome__step-num">2</span><span class="chat-welcome__step-text">确认草案后用「编辑草案表格」批量改字段</span></div>'
      + '<div class="chat-welcome__step"><span class="chat-welcome__step-num">3</span><span class="chat-welcome__step-text">点将齐全后再发布到工作台</span></div>'
      + '</div>'
      + '<p class="chat-welcome__hint"><kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</p>'
      + '</div></li>';
  }
  function renderThreadLostState() {
    var box = document.getElementById('msgList');
    if (!box) return;
    box.innerHTML = '<li class="chat-thread-lost-wrap"><div class="chat-thread-lost">'
      + '<div class="chat-thread-lost__icon" aria-hidden="true">⚠</div>'
      + '<h3>找不到该会话</h3>'
      + '<p>可能因本地数据已重置，或会话记录已过期。请返回主线程继续规划，或新建侧会话。</p>'
      + '<div class="chat-thread-lost__actions">'
      + '<button type="button" class="btn btn-primary btn-sm" id="threadLostGoMainBtn">返回主线程</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="threadLostNewBtn">新建规划会话</button>'
      + '</div></div></li>';
    var goMain = document.getElementById('threadLostGoMainBtn');
    if (goMain) goMain.addEventListener('click', function () { void switchToMainThread(); });
    var goNew = document.getElementById('threadLostNewBtn');
    if (goNew) goNew.addEventListener('click', function () {
      var btn = document.getElementById('newThreadBtn');
      if (btn) btn.click();
    });
  }
  function isThreadNotFoundError(err) {
    var msg = String(err && err.message ? err.message : err);
    return msg.indexOf('No session found for thread') >= 0;
  }
  async function switchToMainThread() {
    loadSeq += 1;
    var mySeq = loadSeq;
    activeThreadId = 'main';
    activeThreadKind = 'main';
    history.replaceState(null, '', threadUrl('main', 'main'));
    resetDraftPanelForThreadSwitch();
    var list = document.getElementById('threadList');
    if (list) {
      list.querySelectorAll('.chat-thread-item').forEach(function (x) {
        x.classList.toggle('active', (x.getAttribute('data-thread-id') || '') === 'main');
      });
    }
    setComposerStatus('', 'muted');
    await loadThreads('main');
    await loadMessages(mySeq);
    focusComposer();
  }
  function renderMessageRows(msgs) {
    var box = document.getElementById('msgList');
    if (!box) return;
    if (!msgs.length) {
      renderEmptyState();
      return;
    }
    box.innerHTML = msgs.map(function (m) {
      var role = String(m.role || 'system');
      var rl = roleLabel(role);
      var rowClass = role === 'user' ? 'msg-row msg-row--user' : 'msg-row msg-row--assistant';
      var bubbleClass = 'msg-bubble ' + roleClass(role);
      var tm = formatMsgTime(m.at);
      var metaLine = '<div class="msg-meta">' + escapeHtml(rl) + (tm ? ' · ' + escapeHtml(tm) : '') + '</div>';
      var body = (role === 'assistant' && m.html)
        ? '<div class="msg-body msg-body--assistant">' + m.html + '</div>'
        : '<div class="msg-body">' + escapeHtml(m.content || '') + '</div>';
      return '<li class="' + rowClass + '"><div class="' + bubbleClass + '">' + metaLine + body + '</div></li>';
    }).join('');
  }
  function appendPendingBubble(startedAt) {
    var box = document.getElementById('msgList');
    if (!box) return;
    var li = document.createElement('li');
    li.className = 'msg-row msg-row--assistant';
    li.id = 'pendingAssistantMsg';
    li.innerHTML = '<div class="msg-bubble msg-bubble--pending">'
      + '<div class="msg-meta">规划助手</div>'
      + '<div class="msg-body"><span class="typing-dots"><span></span><span></span><span></span></span>正在处理…'
      + '<div class="msg-elapsed" id="pendingElapsed">已等待 0 秒</div></div></div>';
    box.appendChild(li);
    scrollMessageStreamToBottom();
    if (pendingElapsedTimer) clearInterval(pendingElapsedTimer);
    pendingElapsedTimer = setInterval(function () {
      var el = document.getElementById('pendingElapsed');
      if (!el) return;
      var sec = Math.floor((Date.now() - startedAt) / 1000);
      el.textContent = '已等待 ' + sec + ' 秒';
    }, 1000);
  }
  function clearPendingBubble() {
    if (pendingElapsedTimer) { clearInterval(pendingElapsedTimer); pendingElapsedTimer = null; }
    var pending = document.getElementById('pendingAssistantMsg');
    if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
  }
  function openDraftEditorModal() {
    if (!activeHasDraft) {
      setComposerStatus('当前会话没有可编辑的草案', 'err');
      return;
    }
    var grid = window.WorkbenchDraftGrid;
    if (!grid || typeof grid.openDraftExcelModal !== 'function') {
      setComposerStatus('表格编辑器未加载，请刷新页面或联系管理员', 'err');
      return;
    }
    setComposerStatus('', 'muted');
    grid.openDraftExcelModal({
      threadId: activeThreadId,
      threadKind: activeThreadKind,
      onRevised: function () { return loadMessages(); }
    }).catch(function (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    });
  }
  function stripOpenDraftEditorParam() {
    try {
      var u = new URL(window.location.href);
      if (!u.searchParams.has('openDraftEditor')) return;
      u.searchParams.delete('openDraftEditor');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* ignore */ }
  }
  function maybeOpenDraftEditorFromUrl() {
    if (!pendingOpenDraftEditor || !activeHasDraft) return;
    pendingOpenDraftEditor = false;
    stripOpenDraftEditorParam();
    openDraftEditorModal();
  }
  async function loadDraftSummary(expectedSeq) {
    if (expectedSeq === undefined) expectedSeq = loadSeq;
    var threadAtStart = activeThreadId;
    if (!activeHasDraft) {
      if (expectedSeq === loadSeq) {
        updateDraftContext({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
      }
      return;
    }
    try {
      var res = await fetch(draftQuery());
      var data = await res.json().catch(function () { return {}; });
      if (expectedSeq !== loadSeq || activeThreadId !== threadAtStart) return;
      if (!res.ok || !data.ok) return;
      updateDraftContext(computeDraftSummary(data), true);
    } catch (e) { /* ignore */ }
  }
  function closeAllThreadMenus() {
    document.querySelectorAll('.chat-thread-item.menu-open').forEach(function (el) {
      el.classList.remove('menu-open');
      var dd = el.querySelector('.chat-thread-dropdown');
      if (dd) dd.hidden = true;
    });
  }
  async function renameSideThread(threadId, currentTitle) {
    var next = window.prompt('重命名会话（1–40 字）', currentTitle || '');
    if (next === null) return;
    next = String(next).trim();
    if (!next) {
      setComposerStatus('名称不能为空', 'err');
      return;
    }
    if (next.length > 40) {
      setComposerStatus('名称最多 40 字', 'err');
      return;
    }
    try {
      var res = await fetch('/api/workbench/conversation/thread', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: threadId, threadKind: 'side', threadLabel: next })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setComposerStatus('', 'muted');
      await loadThreads(activeThreadId);
      if (String(activeThreadId) === String(threadId) && data.title) {
        document.getElementById('paneTitle').textContent = data.title;
      }
    } catch (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    }
  }
  async function deleteSideThread(threadId, hasDraft) {
    var msg = hasDraft
      ? '确定删除该侧会话？未发布草案将一并丢失，且不可恢复。'
      : '确定删除该侧会话？不可恢复。';
    if (!window.confirm(msg)) return;
    try {
      var res = await fetch(
        '/api/workbench/conversation/thread?thread=side&threadId=' + encodeURIComponent(threadId),
        { method: 'DELETE' }
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setComposerStatus('', 'muted');
      if (String(activeThreadId) === String(threadId)) {
        await switchToMainThread();
      } else {
        await loadThreads(activeThreadId);
      }
    } catch (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    }
  }
  async function loadThreads(selectId) {
    var list = document.getElementById('threadList');
    try {
      var res = await fetch('/api/workbench/conversation/threads');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var threads = data.threads || [];
      if (!threads.length) {
        list.innerHTML = '<li class="muted" style="padding:8px;">暂无会话</li>';
        return;
      }
      var pick = selectId || activeThreadId;
      list.innerHTML = threads.map(function (t) {
        var cls = 'chat-thread-item' + (t.pinned ? ' pinned' : '') + (String(t.threadId) === String(pick) ? ' active' : '');
        var menuBtn = t.kind === 'side'
          ? '<button type="button" class="chat-thread-menu-btn" aria-label="会话操作" data-thread-id="' + escapeHtml(t.threadId) + '" data-thread-title="' + escapeHtml(t.title) + '" data-has-draft="' + (t.hasDraft ? '1' : '0') + '">⋯</button>'
          + '<div class="chat-thread-dropdown" hidden role="menu">'
          + '<button type="button" class="chat-thread-dropdown-item" data-action="rename">重命名</button>'
          + '<button type="button" class="chat-thread-dropdown-item chat-thread-dropdown-item--danger" data-action="delete">删除</button>'
          + '</div>'
          : '';
        return '<li class="' + cls + '" data-thread-id="' + escapeHtml(t.threadId) + '" data-kind="' + escapeHtml(t.kind) + '">'
          + '<div class="chat-thread-title-row"><span class="chat-thread-title">' + (t.pinned ? '📌 ' : '') + escapeHtml(t.title) + '</span>'
          + '<span class="chat-thread-badge">' + escapeHtml(t.badge || '') + '</span></div>'
          + '<div class="chat-thread-preview">' + escapeHtml(t.preview || '') + '</div>'
          + menuBtn + '</li>';
      }).join('');
      list.querySelectorAll('.chat-thread-item').forEach(function (el) {
        el.addEventListener('click', function (ev) {
          if (ev.target.closest('.chat-thread-menu-btn, .chat-thread-dropdown')) return;
          closeAllThreadMenus();
          var tid = el.getAttribute('data-thread-id') || 'main';
          var kind = el.getAttribute('data-kind') || 'main';
          if (tid === activeThreadId && kind === activeThreadKind) return;
          loadSeq += 1;
          var mySeq = loadSeq;
          activeThreadId = tid;
          activeThreadKind = kind;
          history.replaceState(null, '', threadUrl(tid, kind));
          list.querySelectorAll('.chat-thread-item').forEach(function (x) { x.classList.remove('active'); });
          el.classList.add('active');
          resetDraftPanelForThreadSwitch();
          void loadMessages(mySeq);
        });
        var menuBtn = el.querySelector('.chat-thread-menu-btn');
        if (menuBtn) {
          menuBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var wasOpen = el.classList.contains('menu-open');
            closeAllThreadMenus();
            if (!wasOpen) {
              el.classList.add('menu-open');
              var dd = el.querySelector('.chat-thread-dropdown');
              if (dd) dd.hidden = false;
            }
          });
        }
        el.querySelectorAll('.chat-thread-dropdown-item').forEach(function (btn) {
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            closeAllThreadMenus();
            var tid = el.getAttribute('data-thread-id') || '';
            var action = btn.getAttribute('data-action');
            var title = menuBtn ? (menuBtn.getAttribute('data-thread-title') || '') : '';
            var hasDraft = menuBtn && menuBtn.getAttribute('data-has-draft') === '1';
            if (action === 'rename') void renameSideThread(tid, title);
            else if (action === 'delete') void deleteSideThread(tid, hasDraft);
          });
        });
      });
    } catch (e) {
      list.innerHTML = '<li class="chat-sidebar-error">加载会话失败</li>'
        + '<li style="padding:8px;"><button type="button" class="btn btn-ghost btn-sm" id="retryThreadsBtn">重试</button></li>';
      var retry = document.getElementById('retryThreadsBtn');
      if (retry) retry.addEventListener('click', function () { void loadThreads(selectId); });
    }
  }
  async function loadMessages(expectedSeq) {
    if (expectedSeq === undefined) expectedSeq = loadSeq;
    renderSkeleton();
    var stream = document.getElementById('chatStream');
    try {
      var res = await fetch(messagesQuery());
      var data = await res.json().catch(function () { return {}; });
      if (expectedSeq !== loadSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var hasDraft = !!data.hasDraft;
      updatePaneHeader({ title: data.title, badge: data.badge, kind: data.kind, hasDraft: hasDraft });
      applyDraftPanelUi(hasDraft);
      renderMessageRows(data.messages || []);
      if (WB_PORTFOLIO_CHAT) {
        await loadActiveProjectSelect(data.activeProjectId || '');
      }
      await loadDraftSummary(expectedSeq);
      if (expectedSeq !== loadSeq) return;
      maybeOpenDraftEditorFromUrl();
      scrollMessageStreamToBottom();
    } catch (e) {
      if (expectedSeq !== loadSeq) return;
      if (activeThreadKind === 'side' && isThreadNotFoundError(e)) {
        renderThreadLostState();
        setComposerStatus('会话不存在或已过期', 'err');
      } else {
        var box = document.getElementById('msgList');
        if (box) {
          box.innerHTML = '<li class="msg-bubble msg-bubble--error" style="list-style:none;">加载消息失败：'
            + escapeHtml(String(e && e.message ? e.message : e)) + '</li>';
        }
      }
    } finally {
      if (stream) stream.setAttribute('aria-busy', 'false');
    }
  }
  async function sendChatMessage(opts) {
    opts = opts || {};
    if (sendInFlight) return { ok: false, reason: 'busy' };
    var sendBtn = document.getElementById('sendBtn');
    var inputEl = document.getElementById('msgInput');
    var fromComposer = opts.fromComposer !== false && opts.message == null;
    var message = String(opts.message != null ? opts.message : (inputEl ? inputEl.value : '') || '').trim();
    if (!message) {
      if (fromComposer) setComposerStatus('请输入消息内容', 'err');
      return { ok: false, reason: 'empty' };
    }
    sendInFlight = true;
    updatePublishBtnUi();
    if (fromComposer) {
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中…'; }
      setComposerStatus('处理中，请稍候…', 'busy');
    }
    var startedAt = Date.now();
    var box = document.getElementById('msgList');
    if (box) {
      var emptyCard = box.querySelector('.chat-welcome, .chat-empty-state');
      if (emptyCard) emptyCard.closest('li').remove();
      var userLi = document.createElement('li');
      userLi.className = 'msg-row msg-row--user';
      userLi.innerHTML = '<div class="msg-bubble msg-bubble--user"><div class="msg-meta">我</div><div class="msg-body">' + escapeHtml(message) + '</div></div>';
      box.appendChild(userLi);
    }
    appendPendingBubble(startedAt);
    if (fromComposer && inputEl) inputEl.value = '';
    var prepareAfter = publishFlowState === 'preparing';
    try {
      var res = await fetch('/api/workbench/conversation/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          threadKind: activeThreadKind,
          message: message
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      if (fromComposer) setComposerStatus('', 'muted');
      if (data.threadId) activeThreadId = data.threadId;
      if (data.kind) activeThreadKind = data.kind;
      clearPendingBubble();
      await loadThreads(activeThreadId);
      await loadMessages();
      if (fromComposer) focusComposer();
      if (prepareAfter) {
        publishFlowState = 'awaitConfirmPopup';
        openPublishModal('publishConfirmModalOverlay');
      }
      return { ok: true };
    } catch (e) {
      clearPendingBubble();
      var errLi = document.createElement('li');
      errLi.className = 'msg-row msg-row--assistant';
      errLi.innerHTML = '<div class="msg-bubble msg-bubble--error"><div class="msg-meta">系统</div><div class="msg-body">发送失败：' + escapeHtml(String(e && e.message ? e.message : e)) + '。请重试。</div></div>';
      if (box) box.appendChild(errLi);
      if (fromComposer) setComposerStatus('发送失败，请重试', 'err');
      else setComposerStatus(String(e && e.message ? e.message : e), 'err');
      scrollMessageStreamToBottom();
      if (prepareAfter) resetPublishFlow();
      return { ok: false, reason: 'error' };
    } finally {
      sendInFlight = false;
      if (fromComposer && sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送'; }
      updatePublishBtnUi();
    }
  }
  var sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', function () { void sendChatMessage({ fromComposer: true }); });
  }
  if (msgInput) {
    msgInput.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
      ev.preventDefault();
      void sendChatMessage({ fromComposer: true });
    });
  }
  var publishDraftBtn = document.getElementById('publishDraftBtnPanel');
  if (publishDraftBtn) {
    publishDraftBtn.addEventListener('click', function () { openPublishPrepareModal(); });
  }
  function bindPublishModalDismiss(overlayId, onDismiss) {
    var overlay = document.getElementById(overlayId);
    if (!overlay) return;
    overlay.querySelectorAll('.wb-modal__close, .btn-secondary[id$="CancelBtn"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePublishModal(overlayId);
        if (onDismiss) onDismiss();
      });
    });
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) {
        closePublishModal(overlayId);
        if (onDismiss) onDismiss();
      }
    });
  }
  bindPublishModalDismiss('publishPrepareModalOverlay', function () { if (publishFlowState === 'idle') resetPublishFlow(); });
  bindPublishModalDismiss('publishConfirmModalOverlay', function () {
    if (publishFlowState === 'awaitConfirmPopup') publishFlowState = 'idle';
    updatePublishBtnUi();
  });
  var publishPrepareContinueBtn = document.getElementById('publishPrepareContinueBtn');
  if (publishPrepareContinueBtn) {
    publishPrepareContinueBtn.addEventListener('click', function () {
      if (!activeHasDraft || sendInFlight) return;
      closePublishModal('publishPrepareModalOverlay');
      publishFlowState = 'preparing';
      updatePublishBtnUi();
      void sendChatMessage({ message: PUBLISH_PREPARE_MSG, fromComposer: false });
    });
  }
  var publishConfirmOkBtn = document.getElementById('publishConfirmOkBtn');
  if (publishConfirmOkBtn) {
    publishConfirmOkBtn.addEventListener('click', function () {
      if (sendInFlight) return;
      closePublishModal('publishConfirmModalOverlay');
      publishFlowState = 'idle';
      void sendChatMessage({ message: PUBLISH_CONFIRM_MSG, fromComposer: false }).then(function () {
        resetPublishFlow();
      });
    });
  }
  var newThreadBtn = document.getElementById('newThreadBtn');
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', async function () {
      newThreadBtn.disabled = true;
      try {
        var res = await fetch('/api/workbench/conversation/new', { method: 'POST' });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        loadSeq += 1;
        var mySeq = loadSeq;
        activeThreadId = data.threadId;
        activeThreadKind = 'side';
        history.replaceState(null, '', threadUrl(activeThreadId, 'side'));
        resetDraftPanelForThreadSwitch();
        updatePaneHeader({
          title: data.title || '新规划会话',
          badge: data.badge || '侧会话',
          kind: 'side',
          hasDraft: false
        });
        await loadThreads(activeThreadId);
        await loadMessages(mySeq);
        focusComposer();
      } catch (e) {
        setComposerStatus(String(e && e.message ? e.message : e), 'err');
      } finally {
        newThreadBtn.disabled = false;
      }
    });
  }
  var rosterInput = document.getElementById('rosterFileInput');
  var rosterStatusEl = document.getElementById('rosterStatus');
  if (rosterInput) {
    rosterInput.addEventListener('change', async function () {
      var file = rosterInput.files && rosterInput.files[0];
      if (!file) return;
      rosterStatusEl.textContent = '上传中…';
      rosterStatusEl.style.color = '';
      try {
        var fd = new FormData();
        fd.append('threadId', activeThreadId);
        fd.append('threadKind', activeThreadKind);
        fd.append('file', file, file.name);
        var res = await fetch('/api/workbench/manager/upload-roster', { method: 'POST', body: fd });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        rosterStatusEl.textContent =
          '已上传 ' + escapeHtml(data.filename || file.name) +
          '（' + (data.kind || '') + '，' + (data.chars || 0) + ' 字符）';
        rosterStatusEl.style.color = '#0f766e';
      } catch (err) {
        rosterStatusEl.textContent = '上传失败';
        rosterStatusEl.style.color = '#dc2626';
      } finally {
        rosterInput.value = '';
      }
    });
  }
  var editDraftPanelBtn = document.getElementById('editDraftBtnPanel');
  if (editDraftPanelBtn) editDraftPanelBtn.addEventListener('click', openDraftEditorModal);

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('.chat-thread-item')) closeAllThreadMenus();
  });
  void loadThreads(activeThreadId).then(function () { return loadMessages(); });
})();
</script>
</body>
</html>`;
}
