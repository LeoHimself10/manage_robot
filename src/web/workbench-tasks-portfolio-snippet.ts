/** Portfolio manager tasks page: grouped view, bulk assign, scope chips (role A). */

export const WORKBENCH_TASKS_PORTFOLIO_CSS = `
.wb-tasks-view-mode { display: inline-flex; padding: 3px; background: #e2e8f0; border-radius: 999px; }
.wb-tasks-view-mode button {
  border: none; background: transparent; padding: 7px 14px; border-radius: 999px;
  font-size: 12px; font-weight: 650; cursor: pointer; font-family: inherit; color: #334155;
}
.wb-tasks-view-mode button[aria-pressed="true"] {
  background: #fff; color: #1d4ed8; box-shadow: 0 1px 2px rgba(0,0,0,.08);
}
.wb-bulk-bar {
  display: none; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px; margin-bottom: 10px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #2563eb;
  border-radius: 10px; color: #334155;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.wb-bulk-bar.show { display: flex; }
.wb-bulk-bar__left { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.wb-bulk-bar__badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 24px; padding: 0 7px; border-radius: 999px;
  background: #2563eb; color: #fff; font-size: 12px; font-weight: 700;
}
.wb-bulk-bar__title { font-weight: 600; color: #475569; }
.wb-bulk-bar__actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.wb-bulk-bar__actions .btn-ghost { color: #64748b; }
.wb-has-selection .btn-row-assign { opacity: 0.35; pointer-events: none; }
.wb-project-groups { display: flex; flex-direction: column; gap: 8px; min-width: 0; max-width: 100%; }
.wb-project-group { min-width: 0; max-width: 100%; }
.wb-proj-header {
  display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(0, auto); gap: 10px; align-items: center;
  padding: 12px 14px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  cursor: pointer; user-select: none; min-width: 0; max-width: 100%;
}
.wb-proj-header:hover { background: #f8fafc; }
.wb-proj-header[aria-expanded="true"] { border-color: #93c5fd; background: #eff6ff; }
.wb-proj-header--unassigned { border-style: dashed; }
.wb-proj-chev {
  width: 24px; height: 24px; border-radius: 6px; background: #f1f5f9;
  display: flex; align-items: center; justify-content: center; font-size: 11px;
}
.wb-proj-header[aria-expanded="true"] .wb-proj-chev { transform: rotate(90deg); background: #dbeafe; }
.wb-proj-body { border: 1px solid #f1f5f9; border-top: none; border-radius: 0 0 8px 8px; margin-top: -4px; overflow: hidden; }
.wb-proj-body[hidden] { display: none; }
.wb-proj-body .table-wrap { border: none; border-radius: 0; }
.col-check { width: 36px; text-align: center; vertical-align: middle; }
.col-check input { width: 16px; height: 16px; accent-color: #2563eb; }
.col-actions { vertical-align: middle; min-width: 11rem; }
.wb-cell-time { display: block; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
.wb-row-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wb-row-actions .btn { white-space: nowrap; }
`;

export function buildWorkbenchTasksPortfolioClientJs(opts: {
  initialProjectId: string;
  initialView: "group" | "flat";
}): string {
  const initialProjectId = opts.initialProjectId.replace(/'/g, "");
  const initialView = opts.initialView === "flat" ? "flat" : "group";
  return `
  var WB_UNASSIGNED = '__unassigned__';
  var WB_SCOPE = 'all';
  var WB_VIEW_MODE = '${initialView}';
  var WB_EXPAND_PROJECT_ID = '${initialProjectId}';
  var WB_PROJECT_CARDS = [];
  var WB_ASSIGN_PENDING = [];

  function wbReadViewFromUrl() {
    try {
      var usp = new URLSearchParams(window.location.search || '');
      var v = String(usp.get('view') || '').trim().toLowerCase();
      if (v === 'flat' || v === 'group') WB_VIEW_MODE = v;
      var pid = String(usp.get('projectId') || '').trim();
      if (pid) {
        WB_EXPAND_PROJECT_ID = pid;
        if (pid === WB_UNASSIGNED) WB_SCOPE = 'unassigned';
        else WB_SCOPE = pid;
      }
      var expandedPid = String(usp.get('expandedProjectId') || '').trim();
      if (expandedPid) WB_EXPAND_PROJECT_ID = expandedPid;
      var scope = String(usp.get('scope') || '').trim();
      if (scope === 'unassigned') WB_SCOPE = 'unassigned';
      else if (scope) {
        WB_SCOPE = scope;
        if (!WB_EXPAND_PROJECT_ID) WB_EXPAND_PROJECT_ID = scope;
      }
    } catch (e0) {}
  }

  function wbSetExpandedProjectId(projectId) {
    WB_EXPAND_PROJECT_ID = String(projectId || '').trim();
    if (typeof wbPersistListStateToUrl === 'function') wbPersistListStateToUrl();
  }

  function wbPersistViewMode() {
    try { localStorage.setItem('wb_tasks_view', WB_VIEW_MODE); } catch (e1) {}
  }

  function wbLoadViewPreference() {
    wbReadViewFromUrl();
    if (!window.location.search || window.location.search.indexOf('view=') < 0) {
      try {
        var saved = localStorage.getItem('wb_tasks_view');
        if (saved === 'flat' || saved === 'group') WB_VIEW_MODE = saved;
      } catch (e2) {}
    }
  }

  function wbSyncViewToggleUi() {
    document.querySelectorAll('[data-wb-view-mode]').forEach(function (btn) {
      var m = btn.getAttribute('data-wb-view-mode') || '';
      btn.setAttribute('aria-pressed', m === WB_VIEW_MODE ? 'true' : 'false');
    });
  }

  function wbSyncFilterProjectFromScope() {
    var sel = document.getElementById('filterProject');
    if (!sel) return;
    if (WB_VIEW_MODE === 'flat') {
      sel.value = WB_FILTER_PROJECT_ID || '';
      return;
    }
    if (WB_SCOPE === 'all') sel.value = '';
    else if (WB_SCOPE === 'unassigned') sel.value = WB_UNASSIGNED;
    else sel.value = WB_SCOPE;
  }

  function wbApplyFilterProjectChange() {
    var sel = document.getElementById('filterProject');
    if (!sel) return;
    var v = String(sel.value || '').trim();
    if (WB_VIEW_MODE === 'flat') {
      WB_FILTER_PROJECT_ID = v;
      WB_SCOPE = 'all';
      if (typeof wbPersistListStateToUrl === 'function') wbPersistListStateToUrl();
      loadTasks();
      return;
    }
    if (!v) WB_SCOPE = 'all';
    else if (v === WB_UNASSIGNED) WB_SCOPE = 'unassigned';
    else {
      WB_SCOPE = v;
      wbSetExpandedProjectId(v);
    }
    if (typeof wbPersistListStateToUrl === 'function') wbPersistListStateToUrl();
    applyFiltersAndSort();
  }

  function wbTaskProjectKey(t) {
    var pid = String(t.projectId || '').trim();
    return pid || WB_UNASSIGNED;
  }

  function wbScopeFilterTask(t) {
    if (WB_VIEW_MODE !== 'group') return true;
    if (WB_SCOPE === 'all') return true;
    if (WB_SCOPE === 'unassigned') return wbTaskProjectKey(t) === WB_UNASSIGNED;
    return wbTaskProjectKey(t) === WB_SCOPE;
  }

  function wbUpdateBulkBar() {
    var bar = document.getElementById('bulkAssignBar');
    var cnt = document.getElementById('bulkAssignCount');
    var root = document.getElementById('taskTableMount');
    if (!bar) return;
    var n = document.querySelectorAll('.task-cb:checked').length;
    bar.classList.toggle('show', n > 0);
    if (cnt) cnt.textContent = String(n);
    if (root) root.classList.toggle('wb-has-selection', n > 0);
  }

  function wbBindTaskCheckboxes(root) {
    if (!root) return;
    root.querySelectorAll('.task-cb').forEach(function (cb) {
      if (cb.dataset.bound) return;
      cb.dataset.bound = '1';
      cb.addEventListener('change', wbUpdateBulkBar);
    });
    wbUpdateBulkBar();
  }

  function wbBindGroupSelectAll(root) {
    if (!root) return;
    root.querySelectorAll('.wb-project-group').forEach(function (group) {
      var selectAll = group.querySelector('.wb-group-select-all');
      var tbody = group.querySelector('tbody');
      if (!selectAll || !tbody) return;
      function syncHeaderFromRows() {
        var boxes = tbody.querySelectorAll('.task-cb');
        var n = boxes.length;
        var checked = 0;
        boxes.forEach(function (cb) { if (cb.checked) checked++; });
        selectAll.checked = n > 0 && checked === n;
        selectAll.indeterminate = checked > 0 && checked < n;
      }
      if (!selectAll.dataset.groupBound) {
        selectAll.dataset.groupBound = '1';
        selectAll.addEventListener('change', function () {
          var on = selectAll.checked;
          selectAll.indeterminate = false;
          tbody.querySelectorAll('.task-cb').forEach(function (cb) { cb.checked = on; });
          wbUpdateBulkBar();
        });
      }
      tbody.querySelectorAll('.task-cb').forEach(function (cb) {
        if (cb.dataset.groupRowBound) return;
        cb.dataset.groupRowBound = '1';
        cb.addEventListener('change', function () {
          syncHeaderFromRows();
          wbUpdateBulkBar();
        });
      });
      syncHeaderFromRows();
    });
  }

  function wbRowAssignBtn(t) {
    var pid = wbTaskProjectKey(t);
    var label = pid === WB_UNASSIGNED ? '归入项目' : '更换项目';
    var cls = pid === WB_UNASSIGNED ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    return '<button type="button" class="' + cls + ' btn-row-assign" data-assign-task-no="'
      + escapeHtml(t.taskNo || '') + '" data-assign-title="' + escapeHtml(t.title || '') + '">'
      + escapeHtml(label) + '</button>';
  }

  function wbRenderActionsCell(t) {
    var detailHref = typeof wbBuildTaskDetailHref === 'function'
      ? wbBuildTaskDetailHref(t.taskNo || '')
      : ('/workbench/manager/task?taskNo=' + encodeURIComponent(t.taskNo || ''));
    return '<td class="col-actions">'
      + '<time class="wb-cell-time">' + escapeHtml(fmtTime(t.updatedAt)) + '</time>'
      + '<div class="wb-row-actions">'
      + '<a class="btn btn-secondary btn-sm" href="' + detailHref + '">查看详情</a>'
      + wbRowAssignBtn(t)
      + '</div></td>';
  }

  function wbRenderTaskRows(tasks, withCheckbox) {
    return tasks.map(function (t) {
      var bucket = String(t.attentionBucket || '');
      var hint = String(t.attentionHint || '').trim();
      var stHtml = '<span class="badge ' + badgeClassForBucket(bucket) + '">' + escapeHtml(t.attentionLabel || t.statusLabel || '—') + '</span>';
      if (hint) stHtml += ' <span class="muted" style="font-size:12px;">' + escapeHtml(hint) + '</span>';
      var cb = withCheckbox
        ? '<td class="col-check"><input type="checkbox" class="task-cb" data-task-no="' + escapeHtml(t.taskNo || '') + '" /></td>'
        : '';
      return '<tr>'
        + cb
        + '<td><code>' + escapeHtml(t.taskNo || '—') + '</code></td>'
        + '<td>' + escapeHtml(t.title || '—') + '</td>'
        + '<td>' + escapeHtml(t.assigneeSummary || '—') + '</td>'
        + '<td>' + escapeHtml(String(t.subtasksCount || 0)) + '（阻塞 ' + escapeHtml(String(t.blockedCount || 0)) + '）</td>'
        + '<td>' + stHtml + '</td>'
        + wbRenderActionsCell(t)
        + '</tr>';
    }).join('');
  }

  function wbGroupedHeaders(withCheckbox) {
    var cb = withCheckbox ? '<th class="col-check"><input type="checkbox" title="全选本组" class="wb-group-select-all" /></th>' : '';
    return cb + '<th>业务编号</th><th>标题</th><th>负责人</th><th>子任务</th><th>关注状态</th><th>更新时间</th>';
  }

  function wbRenderTaskTableGrouped(filteredTasks) {
    var mount = document.getElementById('taskTableMount');
    var meta = document.getElementById('filterResultMeta');
    var total = allTasksCache.length;
    var groups = {};
    filteredTasks.forEach(function (t) {
      var k = wbTaskProjectKey(t);
      if (!groups[k]) groups[k] = [];
      groups[k].push(t);
    });
    var cardById = {};
    WB_PROJECT_CARDS.forEach(function (c) { cardById[String(c.projectId)] = c; });

    var order = WB_PROJECT_CARDS.map(function (c) { return String(c.projectId); }).filter(function (id) {
      return groups[id] && groups[id].length;
    });
    if (groups[WB_UNASSIGNED] && groups[WB_UNASSIGNED].length && order.indexOf(WB_UNASSIGNED) < 0) {
      order.push(WB_UNASSIGNED);
    }
    Object.keys(groups).forEach(function (k) {
      if (order.indexOf(k) < 0) order.push(k);
    });

    if (!filteredTasks.length) {
      mount.innerHTML = '<div class="empty-state">' + (total ? '无匹配任务。<button type="button" class="btn btn-ghost btn-sm" id="filterClearInline">清除筛选</button>' : '暂无任务。请到钉钉与机器人发起规划并发布。') + '</div>';
      var clr = document.getElementById('filterClearInline');
      if (clr) clr.addEventListener('click', clearFilters);
      if (meta) meta.textContent = '共 ' + total + ' 条 · 当前显示 0 条';
      return;
    }

    function filterGroupLabel(n) {
      var sel = document.getElementById('filterAttention');
      var v = sel ? String(sel.value || '').trim() : '';
      if (!v) return '';
      var opt = sel.options && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
      var label = opt ? String(opt.textContent || '').trim() : v;
      return label ? (label + ' ' + n) : '';
    }
    var html = '<div class="wb-project-groups">';
    order.forEach(function (pid) {
      var tasks = groups[pid] || [];
      if (!tasks.length) return;
      var card = cardById[pid];
      var name = card ? card.name : (pid === WB_UNASSIGNED ? '未归入项目' : pid);
      var expanded = WB_EXPAND_PROJECT_ID === pid || pid === WB_UNASSIGNED && !WB_EXPAND_PROJECT_ID;
      if (WB_EXPAND_PROJECT_ID && WB_EXPAND_PROJECT_ID === pid) expanded = true;
      if (!WB_EXPAND_PROJECT_ID && pid === WB_UNASSIGNED) expanded = true;
      var bodyId = 'wb-proj-body-' + pid.replace(/[^a-zA-Z0-9_-]/g, '_');
      var hdrClass = 'wb-proj-header' + (pid === WB_UNASSIGNED ? ' wb-proj-header--unassigned' : '');
      html += '<div class="wb-project-group" data-project-id="' + escapeHtml(pid) + '">'
        + '<div class="' + hdrClass + '" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '" data-wb-toggle="' + bodyId + '">'
        + '<span class="wb-proj-chev">▶</span>'
        + '<div><div style="font-weight:650;">' + escapeHtml(name) + '</div>'
        + '<div class="muted" style="font-size:12px;margin-top:2px;">' + tasks.length + ' 条任务</div></div>'
        + '<div style="text-align:right;font-size:12px;">' + escapeHtml(filterGroupLabel(tasks.length) || (card && card.attentionLabel ? card.attentionLabel : '')) + '</div>'
        + '</div>'
        + '<div class="wb-proj-body" id="' + bodyId + '"' + (expanded ? '' : ' hidden') + '>'
        + '<div class="table-wrap"><table class="data"><thead><tr>' + wbGroupedHeaders(true) + '</tr></thead><tbody>'
        + wbRenderTaskRows(tasks, true)
        + '</tbody></table></div></div></div>';
    });
    html += '</div>';
    mount.innerHTML = html;
    if (meta) meta.textContent = '共 ' + total + ' 条 · 当前显示 ' + filteredTasks.length + ' 条 · ' + order.length + ' 个项目组';

    mount.querySelectorAll('[data-wb-toggle]').forEach(function (hdr) {
      function toggle() {
        var bid = hdr.getAttribute('data-wb-toggle');
        var body = document.getElementById(bid);
        if (!body) return;
        var open = body.hidden;
        body.hidden = !open;
        hdr.setAttribute('aria-expanded', open ? 'true' : 'false');
        var group = hdr.closest('.wb-project-group');
        var pid = group ? String(group.getAttribute('data-project-id') || '').trim() : '';
        if (pid) {
          if (open) wbSetExpandedProjectId(pid);
          else if (WB_EXPAND_PROJECT_ID === pid) wbSetExpandedProjectId('');
        }
      }
      hdr.addEventListener('click', toggle);
      hdr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
    wbBindTaskCheckboxes(mount);
    wbBindGroupSelectAll(mount);
    mount.querySelectorAll('[data-assign-task-no]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        wbOpenAssignDialog([{
          taskNo: btn.getAttribute('data-assign-task-no'),
          title: btn.getAttribute('data-assign-title')
        }]);
      });
    });
  }

  var _applyFiltersAndSortBase = applyFiltersAndSort;
  applyFiltersAndSort = function () {
    var att = String(document.getElementById('filterAttention')?.value || '').trim();
    var kw = String(document.getElementById('filterKeyword')?.value || '').trim().toLowerCase();
    var asg = String(document.getElementById('filterAssignee')?.value || '').trim().toLowerCase();
    var sort = String(document.getElementById('filterSort')?.value || 'updated_desc');
    var list = allTasksCache.slice();
    list = list.filter(function (t) {
      if (!wbScopeFilterTask(t)) return false;
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
    if (WB_VIEW_MODE === 'group') {
      wbRenderTaskTableGrouped(list);
    } else {
      renderTaskTable(list);
      var mount = document.getElementById('taskTableMount');
      if (mount) {
        var wrap = mount.querySelector('.table-wrap');
        if (wrap) {
          var table = wrap.querySelector('table.data');
          if (table && !table.querySelector('.col-check')) {
            var thead = table.querySelector('thead tr');
            if (thead) thead.innerHTML = '<th class="col-check"></th>' + thead.innerHTML;
            table.querySelectorAll('tbody tr').forEach(function (tr, idx) {
              var t = list[idx];
              if (!t) return;
              var td = document.createElement('td');
              td.className = 'col-check';
              td.innerHTML = '<input type="checkbox" class="task-cb" data-task-no="' + escapeHtml(t.taskNo || '') + '" />';
              tr.insertBefore(td, tr.firstChild);
              var last = tr.querySelector('td:last-child');
              if (last) {
                var tmp = document.createElement('tbody');
                tmp.innerHTML = '<tr>' + wbRenderActionsCell(t) + '</tr>';
                var newTd = tmp.querySelector('td');
                if (newTd) last.replaceWith(newTd);
              }
            });
          }
        }
        wbBindTaskCheckboxes(mount);
        mount.querySelectorAll('[data-assign-task-no]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            wbOpenAssignDialog([{
              taskNo: btn.getAttribute('data-assign-task-no'),
              title: btn.getAttribute('data-assign-title')
            }]);
          });
        });
      }
    }
  };

  function wbOpenAssignDialog(items) {
    WB_ASSIGN_PENDING = items || [];
    var dlg = document.getElementById('assignProjectDialog');
    var line = document.getElementById('assignProjectTaskLine');
    var title = document.getElementById('assignProjectDialogTitle');
    if (!dlg) return;
    if (title) {
      title.textContent = WB_ASSIGN_PENDING.length > 1
        ? '将所选任务归入到项目'
        : (WB_ASSIGN_PENDING[0] && String(WB_ASSIGN_PENDING[0].title || '').indexOf('归入') >= 0 ? '归入项目' : '更换所属项目');
    }
    if (line) {
      line.textContent = WB_ASSIGN_PENDING.length > 1
        ? ('已选 ' + WB_ASSIGN_PENDING.length + ' 条任务（批量操作）')
        : ('任务：' + (WB_ASSIGN_PENDING[0] ? WB_ASSIGN_PENDING[0].title : '—'));
    }
    dlg.showModal();
  }

  async function wbSaveAssignProject() {
    var sel = document.getElementById('assignProjectSelect');
    var fb = document.getElementById('assignProjectFeedback');
    var saveBtn = document.getElementById('assignProjectSaveBtn');
    if (!sel || !WB_ASSIGN_PENDING.length) return;
    var projectId = String(sel.value || '').trim();
    var bodyPid = projectId === '__clear__' ? null : projectId;
    if (saveBtn) saveBtn.disabled = true;
    if (fb) fb.textContent = '保存中…';
    var errors = [];
    for (var i = 0; i < WB_ASSIGN_PENDING.length; i++) {
      var item = WB_ASSIGN_PENDING[i];
      var taskNo = String(item.taskNo || '').trim();
      if (!taskNo) continue;
      try {
        var res = await fetch('/api/workbench/manager/tasks/' + encodeURIComponent(taskNo) + '/project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: bodyPid })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      } catch (e) {
        errors.push(taskNo + ': ' + String(e && e.message ? e.message : e));
      }
    }
    if (fb) {
      fb.textContent = errors.length ? errors.join('；') : '已保存';
      fb.className = 'feedback ' + (errors.length ? 'err' : 'ok');
    }
    if (saveBtn) saveBtn.disabled = false;
    if (!errors.length) {
      var dlg = document.getElementById('assignProjectDialog');
      if (dlg) dlg.close();
      document.querySelectorAll('.task-cb:checked').forEach(function (c) { c.checked = false; });
      wbUpdateBulkBar();
      await loadTasks();
    }
  }

  async function wbLoadProjectCards() {
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) return;
      WB_PROJECT_CARDS = data.cards || [];
      var sel = document.getElementById('assignProjectSelect');
      if (sel) {
        sel.innerHTML = '<option value="__clear__">— 移出项目（变为未归类）—</option>'
          + WB_PROJECT_CARDS.filter(function (c) {
            return String(c.projectId) !== WB_UNASSIGNED;
          }).map(function (c) {
            return '<option value="' + escapeHtml(c.projectId) + '">' + escapeHtml(c.name) + '</option>';
          }).join('');
      }
      wbPopulateFilterProjectSelect();
    } catch (e) {}
  }

  function wbPopulateFilterProjectSelect() {
    var sel = document.getElementById('filterProject');
    if (!sel) return;
    var opts = '<option value="">全部项目</option><option value="' + WB_UNASSIGNED + '">仅未归入项目</option>';
    WB_PROJECT_CARDS.filter(function (c) {
      return String(c.projectId) !== WB_UNASSIGNED;
    }).forEach(function (c) {
      opts += '<option value="' + escapeHtml(c.projectId) + '">' + escapeHtml(c.name) + '</option>';
    });
    sel.innerHTML = opts;
    wbSyncFilterProjectFromScope();
  }

  async function loadTasksPortfolio() {
    setFb('tableFeedback', '加载中…', 'muted');
    try {
      var tasksUrl = '/api/workbench/manager/tasks';
      if (WB_VIEW_MODE === 'flat' && WB_FILTER_PROJECT_ID) {
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
        if (typeof wbPopulateReassignPlanPicker === 'function') wbPopulateReassignPlanPicker([]);
        else if (sel) sel.innerHTML = '<option value="">暂无任务</option>';
        setFb('tableFeedback', '', 'muted');
        return;
      }
      applyFiltersAndSort();
      var reassignTasks = typeof wbReassignEligibleTasks === 'function'
        ? wbReassignEligibleTasks(allTasksCache)
        : allTasksCache.filter(function (t) {
          var b = String(t.attentionBucket || '');
          var st = String(t.status || '').toUpperCase();
          return b !== 'stopped' && st !== 'STOPPED';
        });
      if (typeof wbPopulateReassignPlanPicker === 'function') {
        wbPopulateReassignPlanPicker(reassignTasks);
      } else if (sel) {
        sel.innerHTML = '<option value="">请选择任务</option>' + reassignTasks.map(function (t) {
          return '<option value="' + escapeHtml(t.planId) + '" data-task-no="' + escapeHtml(t.taskNo || '') + '">'
            + escapeHtml(t.taskNo || '任务') + ' · ' + escapeHtml(t.title || '') + ' · ' + escapeHtml(t.statusLabel || t.status) + '</option>';
        }).join('');
      }
      setFb('tableFeedback', '', 'muted');
    } catch (e) {
      document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">加载失败，请稍后重试。</div>';
      setFb('tableFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  function wbInitPortfolioTasksUi() {
    wbLoadViewPreference();
    wbSyncViewToggleUi();
    document.querySelectorAll('[data-wb-view-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        WB_VIEW_MODE = btn.getAttribute('data-wb-view-mode') || 'group';
        wbPersistViewMode();
        wbSyncViewToggleUi();
        if (typeof wbPersistListStateToUrl === 'function') wbPersistListStateToUrl();
        applyFiltersAndSort();
      });
    });
    var bulkBtn = document.getElementById('bulkAssignBtn');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', function () {
        var items = [];
        document.querySelectorAll('.task-cb:checked').forEach(function (cb) {
          var tr = cb.closest('tr');
          var title = tr ? (tr.querySelector('td:nth-child(3)')?.textContent || '') : '';
          items.push({ taskNo: cb.getAttribute('data-task-no'), title: title });
        });
        wbOpenAssignDialog(items);
      });
    }
    var bulkClr = document.getElementById('bulkAssignClearBtn');
    if (bulkClr) {
      bulkClr.addEventListener('click', function () {
        document.querySelectorAll('.task-cb:checked').forEach(function (c) { c.checked = false; });
        wbUpdateBulkBar();
      });
    }
    var saveAssign = document.getElementById('assignProjectSaveBtn');
    if (saveAssign) saveAssign.addEventListener('click', function () { void wbSaveAssignProject(); });
    var cancelAssign = document.getElementById('assignProjectCancelBtn');
    if (cancelAssign) cancelAssign.addEventListener('click', function () {
      document.getElementById('assignProjectDialog')?.close();
    });
    var filterProjectEl = document.getElementById('filterProject');
    if (filterProjectEl) {
      filterProjectEl.addEventListener('change', function () {
        wbApplyFilterProjectChange();
      });
    }
    void (async function () {
      await wbLoadProjectCards();
      wbSyncFilterProjectFromScope();
      await loadTasksPortfolio();
    })();
  }

  loadTasks = loadTasksPortfolio;
  wbInitPortfolioTasksUi();
  `;
}
