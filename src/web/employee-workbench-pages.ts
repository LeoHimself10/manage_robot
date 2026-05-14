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
      <p class="page-desc">主管发布后的正式子任务（来自 SQLite 正式任务库）。请在接受前核对标题与说明；拒绝或申请修改必须填写理由。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="员工导航">
        <a class="active" href="/workbench/employee/new">新任务</a>
        <a href="/workbench/employee/current">当前任务</a>
        <a href="/workbench/employee/current?tab=progress">提交进度</a>
        <a href="/workbench/employee/current?tab=profile">能力画像</a>
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
  function setActiveTab(targetId) {
    document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
      var active = btn.getAttribute('data-tab-target') === targetId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel[id^="empPanel"]').forEach(function (panel) {
      panel.hidden = panel.id !== targetId;
    });
  }
  document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setActiveTab(btn.getAttribute('data-tab-target') || 'empPanelTasks');
    });
  });

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
        return '<article class="task-card" data-plan-id="' + escapeHtml(t.planId) + '" data-subtask-id="' + escapeHtml(t.subtaskId || '') + '">'
          + '<div class="head"><div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + st + '</div>'
          + '<p class="title">' + escapeHtml(t.title || t.taskNo || t.planId) + '</p>'
          + '<p class="meta">任务编号 <code>' + escapeHtml(t.taskNo || '—') + '</code> · 子任务 <code>' + escapeHtml(t.subtaskId || '—') + '</code></p></div></div>'
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
            var subtaskId = card.getAttribute('data-subtask-id') || '';
            var act = btn.getAttribute('data-act') || '';
            if (act === 'accept') {
              void submitDirect(planId, subtaskId, 'accept', '', { redirect: 'current' });
              return;
            }
            openPanel(planId, subtaskId, act);
          });
        });
      });
      setFb('listFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsMount').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('listFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  function openPanel(planId, subtaskId, action) {
    pending = { planId: planId, subtaskId: subtaskId, action: action };
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

  async function submitDirect(planId, subtaskId, action, note, opts) {
    try {
      var res = await fetch('/api/workbench/employee/subtasks/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: planId, subtaskId: subtaskId, action: action, note: note })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      if (opts && opts.redirect === 'current') {
        window.location.href = '/workbench/employee/current';
        return;
      }
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
      await submitDirect(pending.planId, pending.subtaskId, pending.action, note);
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
      <p class="page-desc">这里展示您在 SQLite 正式任务库中的在执行子任务，不会重复生成任务。提交进度后主管可查看最新动态。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="员工导航">
        <a href="/workbench/employee/new">新任务</a>
        <a href="/workbench/employee/current" data-nav-tab="empPanelTasks">当前任务</a>
        <a href="/workbench/employee/current?tab=progress" data-nav-tab="empPanelProgress">提交进度</a>
        <a href="/workbench/employee/current?tab=profile" data-nav-tab="empPanelProfile">能力画像</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <div class="card">
    <div class="tabs" role="tablist" aria-label="当前任务操作">
      <button type="button" class="tabs-btn" role="tab" aria-selected="true" aria-controls="empPanelTasks" id="empTabTasks" data-tab-target="empPanelTasks">进行中的任务</button>
      <button type="button" class="tabs-btn" role="tab" aria-selected="false" aria-controls="empPanelProgress" id="empTabProgress" data-tab-target="empPanelProgress">提交进度</button>
      <button type="button" class="tabs-btn" role="tab" aria-selected="false" aria-controls="empPanelProfile" id="empTabProfile" data-tab-target="empPanelProfile">能力画像</button>
    </div>

    <section class="tab-panel panel-stack" id="empPanelTasks" role="tabpanel" aria-labelledby="empTabTasks">
      <section class="kpis">
        <div class="kpi"><div class="lbl">进行中</div><div class="val" id="kpiDoing">—</div></div>
        <div class="kpi"><div class="lbl">阻塞</div><div class="val" id="kpiBlocked">—</div></div>
        <div class="kpi"><div class="lbl">已接受待开工</div><div class="val" id="kpiAccepted">—</div></div>
      </section>
      <div id="cardsMount"><div class="empty-state">加载中…</div></div>
      <div class="feedback muted" id="listFeedback"></div>
    </section>

    <section class="tab-panel" id="empPanelProgress" role="tabpanel" aria-labelledby="empTabProgress" hidden>
      <h2>提交进度</h2>
      <p class="page-desc" style="margin:0 0 14px;">请选择任务、更新状态并填写说明（必填）。</p>
      <div class="form-stack">
        <label>任务
          <select id="progPlanId"><option value="">请先加载当前任务</option></select>
        </label>
        <label>进度状态
          <select id="progStatus">
            <option value="IN_PROGRESS">执行中</option>
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
    </section>

    <section class="tab-panel" id="empPanelProfile" role="tabpanel" aria-labelledby="empTabProfile" hidden>
      <h2>更新我的能力画像</h2>
      <p class="page-desc" style="margin:0 0 14px;">仅更新本地能力画像，不会改钉钉通讯录身份信息。多个标签用中文逗号或英文逗号分隔。</p>
      <div class="form-stack">
        <label>技能标签
          <textarea id="pfSkillTags" placeholder="例如 Python, SPC, 8D"></textarea>
        </label>
        <label>优势
          <textarea id="pfStrengths" placeholder="例如 沟通协同, 根因分析"></textarea>
        </label>
        <label>能力边界
          <textarea id="pfBoundaries" placeholder="例如 不做供应商审核"></textarea>
        </label>
        <label>常用工具
          <textarea id="pfTools" placeholder="例如 Minitab, Jira"></textarea>
        </label>
        <label>职业背景与协作偏好（自填）
          <textarea id="pfBackground" rows="5" placeholder="例如 从业经历、擅长领域补充、希望如何协作等"></textarea>
        </label>
        <label>系统沉淀案例（只读，来自已完成任务）
          <div id="pfCasesReadonly" class="muted" style="white-space:pre-wrap;border:1px solid #ddd;border-radius:6px;padding:10px;min-height:48px;background:#fafafa;">暂无</div>
        </label>
        <label>容量提示
          <input id="pfCapacityHint" type="text" placeholder="例如 正常 / 忙碌 / 满载" />
        </label>
        <button type="button" class="btn btn-secondary" id="saveProfileBtn">保存能力画像</button>
        <div class="feedback muted" id="profileFeedback"></div>
      </div>
    </section>
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
  function setActiveTab(targetId) {
    document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
      var active = btn.getAttribute('data-tab-target') === targetId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel[id^="empPanel"]').forEach(function (panel) {
      panel.hidden = panel.id !== targetId;
    });
    document.querySelectorAll('.nav-pills a[data-nav-tab]').forEach(function (link) {
      if (link.getAttribute('data-nav-tab') === targetId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }
  document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setActiveTab(btn.getAttribute('data-tab-target') || 'empPanelTasks');
    });
  });

  function initialTabFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var t = (params.get('tab') || '').toLowerCase();
      if (t === 'progress') return 'empPanelProgress';
      if (t === 'profile') return 'empPanelProfile';
    } catch (e) {}
    return 'empPanelTasks';
  }
  setActiveTab(initialTabFromQuery());

  function splitTokens(raw) {
    return String(raw || '')
      .split(/[，,\\n]/g)
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item.length > 0; });
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
        return '<article class="task-card task-card-clickable" data-subtask-id="' + escapeHtml(t.subtaskId || '') + '">'
          + '<span class="badge ' + bc + '">' + escapeHtml(t.statusLabel || t.status) + '</span>'
          + '<p class="title">' + escapeHtml(t.title || t.taskNo || t.planId) + '</p>'
          + '<p class="meta">任务编号 <code>' + escapeHtml(t.taskNo || '—') + '</code> · 子任务 <code>' + escapeHtml(t.subtaskId || '—') + '</code>'
          + (t.progressNote ? '<br>最近进度：' + escapeHtml(t.progressNote) : '')
          + '</p></article>';
      }).join('') + '</div>';
      mount.querySelectorAll('.task-card[data-subtask-id]').forEach(function (card) {
        card.addEventListener('click', function () {
          var subtaskId = card.getAttribute('data-subtask-id') || '';
          if (!subtaskId) return;
          document.getElementById('progPlanId').value = subtaskId;
          setActiveTab('empPanelProgress');
          setFb('progFeedback', '已带入任务，可直接填写进度说明。', 'muted');
          document.getElementById('progNote').focus();
        });
      });

      sel.innerHTML = '<option value="">请选择任务</option>' + tasks.map(function (t) {
        return '<option value="' + escapeHtml(t.subtaskId || '') + '">' + escapeHtml(t.taskNo || t.planId) + ' · ' + escapeHtml(t.statusLabel || t.status) + '</option>';
      }).join('');
      setFb('listFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsMount').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('listFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadProfile() {
    try {
      var res = await fetch('/api/workbench/employee/profile');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var profile = data.profile || {};
      document.getElementById('pfSkillTags').value = (profile.skillTags || []).join(', ');
      document.getElementById('pfStrengths').value = (profile.strengths || []).join(', ');
      document.getElementById('pfBoundaries').value = (profile.boundaries || []).join(', ');
      document.getElementById('pfTools').value = (profile.tools || []).join(', ');
      document.getElementById('pfCapacityHint').value = (profile.availability && profile.availability.capacityHint) || '';
      document.getElementById('pfBackground').value = profile.background || '';
      var cases = profile.cases || [];
      var casesEl = document.getElementById('pfCasesReadonly');
      if (!cases.length) {
        casesEl.textContent = '暂无';
      } else {
        casesEl.textContent = cases.map(function (c) {
          var line = '[' + (c.taskType || '') + '] ' + (c.outcome || '');
          if (c.deliverable) line += '\n  交付物: ' + c.deliverable;
          if (c.contribution) line += '\n  贡献: ' + c.contribution;
          return line;
        }).join('\n\n');
      }
    } catch (e) {
      setFb('profileFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('progBtn').addEventListener('click', async function () {
    var subtaskId = (document.getElementById('progPlanId').value || '').trim();
    var progressStatus = (document.getElementById('progStatus').value || '').trim();
    var note = (document.getElementById('progNote').value || '').trim();
    if (!subtaskId) { setFb('progFeedback', '请选择任务', 'err'); return; }
    if (!note) { setFb('progFeedback', '请填写说明', 'err'); return; }
    var btn = document.getElementById('progBtn');
    btn.disabled = true;
    setFb('progFeedback', '提交中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/subtasks/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtaskId: subtaskId, progressStatus: progressStatus, note: note })
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

  document.getElementById('saveProfileBtn').addEventListener('click', async function () {
    var btn = document.getElementById('saveProfileBtn');
    btn.disabled = true;
    setFb('profileFeedback', '保存中…', 'muted');
    try {
      var payload = {
        skillTags: splitTokens(document.getElementById('pfSkillTags').value),
        strengths: splitTokens(document.getElementById('pfStrengths').value),
        boundaries: splitTokens(document.getElementById('pfBoundaries').value),
        tools: splitTokens(document.getElementById('pfTools').value),
        background: (document.getElementById('pfBackground').value || ''),
        availability: {
          capacityHint: (document.getElementById('pfCapacityHint').value || '').trim() || undefined
        }
      };
      var res = await fetch('/api/workbench/employee/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('profileFeedback', '已保存', 'ok');
    } catch (e) {
      setFb('profileFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await fetch('/api/workbench/logout', { method: 'POST' });
    window.location.href = '/workbench';
  });

  void loadCurrent();
  void loadProfile();
})();
</script>
</body>
</html>`;
}
