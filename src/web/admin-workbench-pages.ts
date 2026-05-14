import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";

export function renderAdminWorkbenchPage(params: { userLabel?: string }): string {
  const who = params.userLabel ? params.userLabel : "管理员";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>管理员工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">管理员工作台</div>
      <h1 class="page-title">任务总览与权限配置</h1>
      <p class="page-desc">查看全公司正式任务、关键看板，并维护动态主管权限（不覆盖静态名单）。</p>
    </div>
    <div class="top-actions">
      <span class="btn btn-secondary">${who}</span>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <section class="kpis" aria-live="polite">
    <div class="kpi"><div class="lbl">正式任务总数</div><div class="val" id="kpiTotal">—</div></div>
    <div class="kpi"><div class="lbl">进行中主任务</div><div class="val" id="kpiActive">—</div></div>
    <div class="kpi"><div class="lbl">阻塞子任务</div><div class="val" id="kpiBlocked">—</div></div>
  </section>

  <div class="grid-2">
    <section class="card">
      <h2>任务筛选</h2>
      <div class="form-stack">
        <label>业务编号
          <input id="taskNoFilter" placeholder="例如 TASK-20260512-0001" />
        </label>
        <label>状态
          <select id="statusFilter">
            <option value="">全部</option>
            <option value="ASSIGNED">待处理</option>
            <option value="CHANGES_REQUESTED">待修改</option>
            <option value="ACCEPTED">已接受</option>
            <option value="IN_PROGRESS">进行中</option>
            <option value="BLOCKED">阻塞</option>
            <option value="DONE">已完成</option>
            <option value="REJECTED">已拒绝</option>
          </select>
        </label>
        <label>发起部门
          <input id="deptFilter" placeholder="例如 研发部" />
        </label>
        <label>负责人（姓名或账号关键词）
          <input id="assigneeFilter" placeholder="输入姓名的一部分" />
        </label>
        <label>标题关键词
          <input id="keywordFilter" placeholder="任务标题中的关键词" />
        </label>
        <div>
          <button class="btn btn-primary" id="queryBtn" type="button">查询任务</button>
        </div>
      </div>
      <div class="feedback muted" id="taskFeedback"></div>
      <div id="taskTableMount" class="empty-state" style="margin-top:10px;">暂无数据</div>
    </section>

    <section class="card">
      <h2>主管权限维护</h2>
      <div class="form-stack">
        <label>搜索员工
          <input id="employeeKeyword" placeholder="姓名、部门关键词" />
        </label>
        <div>
          <button class="btn btn-secondary" id="searchEmployeeBtn" type="button">查询员工</button>
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
          <button class="btn btn-primary" id="saveManagerBtn" type="button">保存</button>
        </div>
      </div>
      <div class="feedback muted" id="managerFeedback"></div>
      <div id="managerListMount" class="empty-state" style="margin-top:10px;">加载中…</div>
    </section>
  </div>
</div>

<script>
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
        var detail = '<a href="/workbench/admin/task?taskNo=' + encodeURIComponent(t.taskNo || '') + '">详情</a>';
        var mgr = (t.managerDisplayName || '').trim();
        var mgrCell = mgr ? esc(mgr) : esc('—');
        return '<tr>'
          + '<td><code>' + esc(t.taskNo || '—') + '</code></td>'
          + '<td>' + esc(t.title) + '</td>'
          + '<td>' + mgrCell + '</td>'
          + '<td>' + esc(t.initiatorDepartment || '未配置部门') + '</td>'
          + '<td>' + esc(t.statusLabel || t.status) + '</td>'
          + '<td>' + esc(t.updatedAt || '') + '<br>' + detail + '</td>'
          + '</tr>';
      }).join('');
      document.getElementById('taskTableMount').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>业务编号</th><th>标题</th><th>主管</th><th>发起部门</th><th>状态</th><th>更新时间</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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
        return '<tr><td>' + nameCell + (id ? '<br><span class="muted">' + esc(id) + '</span>' : '') + '</td></tr>';
      }).join('');
      document.getElementById('managerListMount').innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>动态主管</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadMetrics();
  void loadTasks();
  void loadManagers();
  void searchEmployees();
})();
</script>
</body>
</html>`;
}
