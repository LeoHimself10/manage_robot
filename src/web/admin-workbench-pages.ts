import { renderWorkbenchPage } from "./workbench-shell";

export const ADMIN_PERMISSIONS_CSS = `
.admin-perm-hub {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.admin-perm-hero {
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.07) 0%, rgba(255, 255, 255, 0) 52%),
    linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.admin-perm-hero h2 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
}
.admin-perm-hero p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
  max-width: 62ch;
}
.admin-perm-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .admin-perm-grid { grid-template-columns: 1fr; }
}
.admin-perm-panel {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.admin-perm-panel__head {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border);
  background: #fbfdff;
}
.admin-perm-panel__head h3 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.admin-perm-panel__head p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
.admin-perm-panel__body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.admin-perm-search {
  display: grid;
  gap: 10px;
}
.admin-perm-search label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.admin-perm-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 640px) {
  .admin-perm-actions { grid-template-columns: 1fr; }
}
.admin-perm-action {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #fff;
}
.admin-perm-action.is-portfolio {
  border-color: rgba(15, 118, 110, 0.22);
  background: linear-gradient(180deg, rgba(15, 118, 110, 0.04), #fff 72%);
}
.admin-perm-action__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.admin-perm-action__hint {
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
  min-height: 2.9em;
}
.admin-perm-lists {
  display: grid;
  gap: 14px;
}
.admin-perm-list-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  overflow: hidden;
}
.admin-perm-list-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: #fbfdff;
}
.admin-perm-list-card__head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
}
.admin-perm-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--muted);
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f7;
}
.admin-perm-list-card__body {
  padding: 8px 14px 12px;
  max-height: 320px;
  overflow: auto;
}
.admin-perm-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.admin-perm-row:last-child { border-bottom: none; }
.admin-perm-av {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--admin-soft);
  color: var(--admin);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
}
.admin-perm-av.is-portfolio {
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
}
.admin-perm-row__name {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}
.admin-perm-row__id {
  font-size: 11px;
  color: var(--muted);
  word-break: break-all;
}
.admin-perm-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 3px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.admin-perm-tag.is-dynamic {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.admin-perm-tag.is-env {
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}
.admin-perm-footnote {
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  padding: 0 2px;
}
`;

function buildAdminPermissionsClientJs(): string {
  return `<script>
(function () {
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function permInitial(name) {
    var t = String(name || '').trim();
    return t ? t.slice(0, 1) : '—';
  }
  function renderRows(mountId, countId, rows, emptyText, avClass) {
    var mount = document.getElementById(mountId);
    var countEl = document.getElementById(countId);
    if (!mount) return;
    if (countEl) countEl.textContent = String(rows.length);
    if (!rows.length) {
      mount.innerHTML = '<div class="empty-state" style="padding:12px 0;margin:0;">' + esc(emptyText) + '</div>';
      return;
    }
    mount.innerHTML = rows.map(function (row) {
      var name = row.name ? esc(row.name) : '—';
      var tag = row.source === 'env'
        ? '<span class="admin-perm-tag is-env">环境变量</span>'
        : '<span class="admin-perm-tag is-dynamic">动态</span>';
      return '<div class="admin-perm-row">'
        + '<span class="admin-perm-av ' + (avClass || '') + '">' + esc(permInitial(name)) + '</span>'
        + '<div><div class="admin-perm-row__name">' + name + '</div><div class="admin-perm-row__id">' + esc(row.userId) + '</div></div>'
        + tag
        + '</div>';
    }).join('');
  }

  async function searchEmployees() {
    var keyword = (document.getElementById('employeeKeyword').value || '').trim();
    try {
      var res = await fetch('/api/workbench/admin/employees?keyword=' + encodeURIComponent(keyword));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var list = data.employees || [];
      var sel = document.getElementById('employeeSelect');
      if (!list.length) {
        sel.innerHTML = '<option value="">未找到员工</option>';
        return;
      }
      sel.innerHTML = '<option value="">请选择员工</option>' + list.map(function (e) {
        var tags = [];
        if (e.isManager) tags.push('主管');
        if (e.isPortfolioManager) tags.push('项目管理主管');
        var suffix = tags.length ? '（' + tags.join('、') + '）' : '';
        return '<option value="' + esc(e.userId) + '">' + esc(e.name || e.userId) + ' · ' + esc(e.departmentName || '-') + suffix + '</option>';
      }).join('');
    } catch (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadManagers() {
    var res = await fetch('/api/workbench/admin/managers');
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var dynamicIds = new Set((data.dynamicManagers || []).map(function (row) { return row.userId; }));
    var nameById = {};
    (data.dynamicManagers || []).forEach(function (row) { nameById[row.userId] = row.name || ''; });
    var rows = (data.effectiveManagers || []).map(function (id) {
      return {
        userId: id,
        name: nameById[id] || '',
        source: dynamicIds.has(id) ? 'dynamic' : 'env',
      };
    });
    renderRows('managerListMount', 'managerCount', rows, '暂无主管', '');
  }

  async function loadPortfolioManagers() {
    var res = await fetch('/api/workbench/admin/portfolio-managers');
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    var dynamicIds = new Set((data.dynamicPortfolioManagers || []).map(function (r) { return r.userId; }));
    var rows = (data.effectivePortfolioManagers || []).map(function (row) {
      return {
        userId: row.userId,
        name: row.name || '',
        source: dynamicIds.has(row.userId) ? 'dynamic' : 'env',
      };
    });
    renderRows('portfolioListMount', 'portfolioCount', rows, '暂无项目管理主管', 'is-portfolio');
  }

  async function savePermission(kind, enabled) {
    var userId = (document.getElementById('employeeSelect').value || '').trim();
    if (!userId) {
      setFb('permFeedback', '请先从列表中选择一位员工', 'err');
      return;
    }
    var url = kind === 'portfolio' ? '/api/workbench/admin/portfolio-managers' : '/api/workbench/admin/managers';
    setFb('permFeedback', '保存中…', 'muted');
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId, enabled: enabled })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    setFb('permFeedback', '已更新权限', 'ok');
    document.getElementById('employeeSelect').value = '';
    await Promise.all([loadManagers(), loadPortfolioManagers(), searchEmployees()]);
  }

  document.getElementById('searchEmployeeBtn').addEventListener('click', function () {
    void searchEmployees();
  });
  document.getElementById('grantManagerBtn').addEventListener('click', function () {
    void savePermission('manager', true).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('revokeManagerBtn').addEventListener('click', function () {
    void savePermission('manager', false).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('grantPortfolioBtn').addEventListener('click', function () {
    void savePermission('portfolio', true).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('revokePortfolioBtn').addEventListener('click', function () {
    void savePermission('portfolio', false).catch(function (e) {
      setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
    });
  });
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  void Promise.all([loadManagers(), loadPortfolioManagers(), searchEmployees()]).catch(function (e) {
    setFb('permFeedback', String(e && e.message ? e.message : e), 'err');
  });
})();
</script>`;
}

export function renderAdminPermissionsPage(params: { userLabel?: string }): string {
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-perms",
    title: "权限中心",
    pageTitle: "权限中心",
    description: "维护主管与项目管理主管身份；动态名单与环境变量合并生效。",
    userLabel: params.userLabel,
    extraCss: ADMIN_PERMISSIONS_CSS,
    mainHtml: `
  <div class="admin-perm-hub">
    <section class="admin-perm-hero">
      <h2>权限中心</h2>
      <p>在此授予或移除<strong>主管</strong>与<strong>项目管理主管</strong>身份。动态变更立即生效；环境变量名单需运维更新后重建容器。</p>
    </section>

    <div class="admin-perm-grid">
      <section class="admin-perm-panel">
        <div class="admin-perm-panel__head">
          <h3>添加或调整权限</h3>
          <p>先搜索并选择员工，再选择要授予或移除的权限类型。</p>
        </div>
        <div class="admin-perm-panel__body">
          <div class="admin-perm-search">
            <label>搜索员工
              <input id="employeeKeyword" placeholder="姓名、部门关键词" />
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-secondary btn-sm" id="searchEmployeeBtn" type="button">查询员工</button>
            </div>
            <label>选择员工
              <select id="employeeSelect"><option value="">请选择员工</option></select>
            </label>
          </div>
          <div class="admin-perm-actions">
            <div class="admin-perm-action">
              <div class="admin-perm-action__title">主管权限</div>
              <div class="admin-perm-action__hint">可使用主管工作台、任务规划与发放。</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" id="grantManagerBtn" type="button">授予主管</button>
                <button class="btn btn-ghost btn-sm" id="revokeManagerBtn" type="button">移除主管</button>
              </div>
            </div>
            <div class="admin-perm-action is-portfolio">
              <div class="admin-perm-action__title">项目管理主管</div>
              <div class="admin-perm-action__hint">可使用项目总览、会议入库与大项目归档能力。</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" id="grantPortfolioBtn" type="button">授予项目管理主管</button>
                <button class="btn btn-ghost btn-sm" id="revokePortfolioBtn" type="button">移除项目管理主管</button>
              </div>
            </div>
          </div>
          <div class="feedback muted" id="permFeedback"></div>
        </div>
      </section>

      <div class="admin-perm-lists">
        <section class="admin-perm-list-card">
          <div class="admin-perm-list-card__head">
            <h4>主管名单</h4>
            <span class="admin-perm-count" id="managerCount">0</span>
          </div>
          <div class="admin-perm-list-card__body" id="managerListMount">加载中…</div>
        </section>
        <section class="admin-perm-list-card">
          <div class="admin-perm-list-card__head">
            <h4>项目管理主管</h4>
            <span class="admin-perm-count" id="portfolioCount">0</span>
          </div>
          <div class="admin-perm-list-card__body" id="portfolioListMount">加载中…</div>
        </section>
      </div>
    </div>

    <p class="admin-perm-footnote">标签「环境变量」表示来自服务器配置，无法在此页移除；「动态」表示通过本页或 Agent 维护，可在此页撤销。</p>
  </div>`,
    scriptHtml: buildAdminPermissionsClientJs(),
  });
}

export function renderAdminWorkbenchPage(params: { userLabel?: string }): string {
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-tasks",
    title: "全公司正式任务",
    pageTitle: "管理员工作台",
    description: "跨部门检索 · 只读审计 · 权限维护请前往「权限中心」",
    userLabel: params.userLabel,
    mainHtml: `
  <section class="kpis kpis--3" aria-live="polite" style="max-width:480px;margin-bottom:16px;">
    <div class="kpi"><div class="lbl">正式任务总数</div><div class="val" id="kpiTotal">—</div></div>
    <div class="kpi"><div class="lbl">进行中主任务</div><div class="val" id="kpiActive">—</div></div>
    <div class="kpi"><div class="lbl">阻塞子任务</div><div class="val" id="kpiBlocked">—</div></div>
  </section>

  <div class="card mgr-list-toolbar form-stack" role="search" aria-label="任务筛选">
    <label>业务编号<input id="taskNoFilter" placeholder="例如 TASK-20260512-0001" /></label>
    <label>状态
      <select id="statusFilter">
        <option value="">全部</option>
        <option value="ASSIGNED">待处理</option>
        <option value="CHANGES_REQUESTED">待修改</option>
        <option value="IN_PROGRESS">进行中</option>
        <option value="BLOCKED">阻塞</option>
        <option value="DONE">已完成</option>
        <option value="REJECTED">已拒绝</option>
      </select>
    </label>
    <label>发起部门<input id="deptFilter" placeholder="例如 研发部" /></label>
    <label>负责人<input id="assigneeFilter" placeholder="输入姓名的一部分" /></label>
    <label>标题关键词<input id="keywordFilter" placeholder="任务标题中的关键词" /></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" id="queryBtn" type="button">查询任务</button>
      <button class="btn btn-ghost btn-sm" type="button" id="adminClearFilters">清除</button>
    </div>
  </div>
  <div class="feedback muted" id="taskFeedback"></div>
  <div class="card" style="overflow:hidden;margin-top:14px;">
    <div id="taskTableMount" class="empty-state" style="padding:16px;">暂无数据</div>
  </div>`,
    scriptHtml: `<script>
(function () {
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function loadMetrics() {
    try {
      var res = await fetch('/api/workbench/admin/metrics');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var m = data.metrics || {};
      setText('kpiTotal', m.totalTasks || 0);
      setText('kpiActive', m.activeTasks || 0);
      setText('kpiBlocked', m.blockedSubtasks || 0);
    } catch (e) {
      setFb('taskFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadTasks() {
    setFb('taskFeedback', '加载中…', 'muted');
    try {
      var status = (document.getElementById('statusFilter').value || '').trim();
      var department = (document.getElementById('deptFilter').value || '').trim();
      var taskNo = (document.getElementById('taskNoFilter').value || '').trim();
      var assignee = (document.getElementById('assigneeFilter').value || '').trim();
      var keyword = (document.getElementById('keywordFilter').value || '').trim();
      var url = '/api/workbench/admin/tasks?status=' + encodeURIComponent(status)
        + '&department=' + encodeURIComponent(department)
        + '&taskNo=' + encodeURIComponent(taskNo)
        + '&assignee=' + encodeURIComponent(assignee)
        + '&keyword=' + encodeURIComponent(keyword);
      var res = await fetch(url);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      if (!tasks.length) {
        document.getElementById('taskTableMount').innerHTML = '暂无匹配任务';
        setFb('taskFeedback', '无匹配结果', 'muted');
        return;
      }
      var rows = tasks.map(function (t) {
        var detail = '<a class="btn btn-ghost btn-sm" href="/workbench/admin/task?taskNo=' + encodeURIComponent(t.taskNo || '') + '">详情</a>';
        var mgr = (t.managerDisplayName || '').trim();
        var mgrCell = mgr ? esc(mgr) : esc('—');
        return '<tr>'
          + '<td><code>' + esc(t.taskNo || '—') + '</code></td>'
          + '<td>' + esc(t.title) + '</td>'
          + '<td>' + mgrCell + '</td>'
          + '<td>' + esc(t.initiatorDepartment || '未配置部门') + '</td>'
          + '<td>' + esc(t.statusLabel || t.status) + '</td>'
          + '<td>' + esc(t.updatedAt || '') + '</td>'
          + '<td>' + detail + '</td>'
          + '</tr>';
      }).join('');
      document.getElementById('taskTableMount').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>业务编号</th><th>标题</th><th>主管</th><th>发起部门</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      setFb('taskFeedback', '已更新', 'ok');
    } catch (e) {
      setFb('taskFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('queryBtn').addEventListener('click', function () {
    void loadTasks();
  });
  var clearBtn = document.getElementById('adminClearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      ['taskNoFilter','deptFilter','assigneeFilter','keywordFilter'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
      var st = document.getElementById('statusFilter');
      if (st) st.value = '';
      void loadTasks();
    });
  }
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  void loadMetrics();
  void loadTasks();
})();
</script>`,
  });
}
