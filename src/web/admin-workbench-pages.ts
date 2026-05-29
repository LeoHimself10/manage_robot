import { renderWorkbenchPage } from "./workbench-shell";

export function renderAdminWorkbenchPage(params: { userLabel?: string }): string {
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-tasks",
    title: "全公司正式任务",
    pageTitle: "管理员工作台",
    description: "跨部门检索 · 只读审计 · 动态主管权限不覆盖静态 env 名单",
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
  </div>

  <section id="permissions" class="card" style="margin-top:20px;">
    <h2 style="margin:0 0 8px;font-size:15px;font-weight:700;">主管权限维护</h2>
    <p class="page-desc" style="margin:0 0 14px;">动态授予 / 移除主管权限，与 env 静态名单合并生效。</p>
    <div class="admin-perm-split">
      <div>
        <div class="form-stack">
          <label>搜索员工
            <input id="employeeKeyword" placeholder="姓名、部门关键词" />
          </label>
          <div>
            <button class="btn btn-secondary btn-sm" id="searchEmployeeBtn" type="button">查询员工</button>
          </div>
          <label>选择员工
            <select id="employeeSelect"><option value="">请选择员工</option></select>
          </label>
          <label>操作
            <select id="managerEnabled">
              <option value="1">授予主管权限</option>
              <option value="0">移除主管权限</option>
            </select>
          </label>
          <div>
            <button class="btn btn-primary btn-sm" id="saveManagerBtn" type="button">保存</button>
          </div>
        </div>
        <div class="feedback muted" id="managerFeedback"></div>
      </div>
      <div class="admin-perm-list card" style="padding:14px 16px;">
        <h3 style="margin:0 0 8px;font-size:14px;font-weight:700;">动态主管名单</h3>
        <div id="managerListMount" class="empty-state" style="margin:0;padding:0;">加载中…</div>
      </div>
    </div>
  </section>`,
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
  function permInitial(name) {
    var t = String(name || '').trim();
    return t ? t.slice(0, 1) : '—';
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

  async function loadManagers() {
    try {
      var res = await fetch('/api/workbench/admin/managers');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var ids = data.dynamicManagers || [];
      if (!ids.length) {
        document.getElementById('managerListMount').innerHTML = '暂无动态主管';
        return;
      }
      var rows = ids.map(function (row) {
        var id = typeof row === 'string' ? row : (row && row.userId ? row.userId : '');
        var name = typeof row === 'object' && row && row.name ? row.name : '';
        var nameCell = name ? esc(name) : esc('—');
        return '<div class="perm-row"><span class="admin-perm-av">' + esc(permInitial(nameCell)) + '</span><div><b>' + nameCell + '</b><br><small class="muted">' + esc(id) + '</small></div></div>';
      }).join('');
      document.getElementById('managerListMount').innerHTML = rows;
    } catch (e) {
      setFb('managerFeedback', String(e && e.message ? e.message : e), 'err');
    }
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
        return '<option value="' + esc(e.userId) + '">' + esc(e.name || e.userId) + ' · ' + esc(e.departmentName || '-') + (e.isManager ? '（已是主管）' : '') + '</option>';
      }).join('');
    } catch (e) {
      setFb('managerFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('queryBtn').addEventListener('click', function () {
    void loadTasks();
  });
  document.getElementById('searchEmployeeBtn').addEventListener('click', function () {
    void searchEmployees();
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
  document.getElementById('saveManagerBtn').addEventListener('click', async function () {
    var userId = (document.getElementById('employeeSelect').value || '').trim();
    var enabled = document.getElementById('managerEnabled').value === '1';
    if (!userId) {
      setFb('managerFeedback', '请先从列表中选择一位员工', 'err');
      return;
    }
    setFb('managerFeedback', '保存中…', 'muted');
    try {
      var res = await fetch('/api/workbench/admin/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, enabled: enabled })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('managerFeedback', '保存成功', 'ok');
      document.getElementById('employeeSelect').value = '';
      await loadManagers();
    } catch (e) {
      setFb('managerFeedback', String(e && e.message ? e.message : e), 'err');
    }
  });
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  if (location.hash === '#permissions') {
    var permNav = document.querySelector('.wb-rail-link[data-wb-nav="adm-perms"]');
    if (permNav) {
      document.querySelectorAll('.wb-rail-link.is-on-adm').forEach(function (a) { a.classList.remove('is-on-adm'); });
      permNav.classList.add('is-on-adm');
    }
    var permSection = document.getElementById('permissions');
    if (permSection) permSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  void loadMetrics();
  void loadTasks();
  void loadManagers();
  void searchEmployees();
})();
</script>`,
  });
}
