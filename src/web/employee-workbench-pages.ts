import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";

/** Single-page employee workbench: `?view=new|current|history|profile` */
export function renderEmployeeWorkbenchPage(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>员工工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div>
      <div class="brand">员工工作台</div>
      <h1 class="page-title" id="empPageTitle">工作台</h1>
      <p class="page-desc" id="empPageDesc">在下方切换视图。</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="员工导航">
        <a id="navNew" href="/workbench/employee?view=new">新任务</a>
        <a id="navCur" href="/workbench/employee?view=current">进行中</a>
        <a id="navHist" href="/workbench/employee?view=history">已完成</a>
        <a id="navProf" href="/workbench/employee?view=profile">能力画像</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <section class="kpis" id="empKpis" style="display:none;">
    <div class="kpi"><div class="lbl" id="kpiL1">—</div><div class="val" id="kpiV1">—</div></div>
    <div class="kpi"><div class="lbl" id="kpiL2">—</div><div class="val" id="kpiV2">—</div></div>
    <div class="kpi"><div class="lbl" id="kpiL3">—</div><div class="val" id="kpiV3" style="font-size:15px;font-weight:600;line-height:1.35;margin-top:8px;color:#64748b;">—</div></div>
  </section>

  <div id="panelNew" hidden>
    <div id="cardsNew"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbNew"></div>
  </div>

  <div id="panelCur" hidden>
    <div id="cardsCur"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbCur"></div>
  </div>

  <div id="panelHist" hidden>
    <div id="cardsHist"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbHist"></div>
  </div>

  <div id="panelProf" hidden>
    <div class="card">
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
        <button type="button" class="btn btn-secondary" id="saveProfileBtn">保存能力画像</button>
        <div class="feedback muted" id="profileFeedback"></div>
      </div>
    </div>
  </div>

  <div class="card" id="actionPanel" style="display:none;">
    <h3 id="actionTitle">补充说明</h3>
    <div class="form-stack">
      <div id="assistKindRow" class="form-stack" style="display:none;">
        <span class="muted" style="font-size:13px;">请选择协助类型</span>
        <label style="display:flex;gap:8px;align-items:flex-start;">
          <input type="radio" name="assistKind" value="customize" checked />
          <span>仅补充说明（不改变承接结论）</span>
        </label>
        <label style="display:flex;gap:8px;align-items:flex-start;">
          <input type="radio" name="assistKind" value="request_changes" />
          <span>申请调整范围、截止或分工</span>
        </label>
      </div>
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

  <div class="card" id="progressPanel" style="display:none;">
    <h3>填写进度</h3>
    <div class="form-stack">
      <label>进度状态
        <select id="progStatus">
          <option value="IN_PROGRESS">执行中</option>
          <option value="BLOCKED">阻塞</option>
          <option value="DONE">已完成</option>
        </select>
      </label>
      <label>说明（必填）
        <textarea id="progNote" placeholder="本阶段进展、风险与下一步计划"></textarea>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary" id="progSubmitBtn">提交</button>
        <button type="button" class="btn btn-secondary" id="progCancelBtn">取消</button>
      </div>
      <div class="feedback muted" id="progPanelFb"></div>
    </div>
  </div>
</div>
<script>
(function () {
  function newIdempotencyKey() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) {}
    return 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function clipStr(s, n) {
    s = String(s || '').trim();
    if (!s) return '';
    return s.length <= n ? s : (s.slice(0, n) + '…');
  }
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function getView() {
    try {
      var v = (new URLSearchParams(location.search).get('view') || 'new').toLowerCase();
      if (v === 'current' || v === 'history' || v === 'profile') return v;
      return 'new';
    } catch (e) { return 'new'; }
  }
  function navTo(view) {
    var u = '/workbench/employee?view=' + encodeURIComponent(view);
    try { history.replaceState({}, '', u); } catch (e2) { location.href = u; }
    showView(view);
  }
  function showView(view) {
    closeProgress();
    closePanel();
    document.querySelectorAll('.nav-pills a').forEach(function (a) { a.classList.remove('active'); });
    var map = { new: 'navNew', current: 'navCur', history: 'navHist', profile: 'navProf' };
    var nid = map[view] || 'navNew';
    var na = document.getElementById(nid);
    if (na) na.classList.add('active');
    document.getElementById('panelNew').hidden = view !== 'new';
    document.getElementById('panelCur').hidden = view !== 'current';
    document.getElementById('panelHist').hidden = view !== 'history';
    document.getElementById('panelProf').hidden = view !== 'profile';
    var kpis = document.getElementById('empKpis');
    if (kpis) kpis.style.display = (view === 'new' || view === 'current') ? 'grid' : 'none';
    var titles = {
      new: ['新分配的任务', '主管发布后的正式子任务。请在接受前核对标题与说明；拒绝或需要主管协助时请填写说明。'],
      current: ['进行中的任务', '执行中或阻塞的子任务。可在卡片上直接填写进度。'],
      history: ['已完成', '历史已完成的子任务。'],
      profile: ['能力画像', '补充你的技能与协作偏好，便于主管分配合适任务。']
    };
    var pair = titles[view] || titles.new;
    document.getElementById('empPageTitle').textContent = pair[0];
    document.getElementById('empPageDesc').textContent = pair[1];
    if (view === 'new') void loadNew();
    if (view === 'current') void loadCurrent();
    if (view === 'history') void loadHistory();
    if (view === 'profile') void loadProfile();
  }

  function badgeClass(st) {
    if (st === 'BLOCKED') return 'blocked';
    if (st === 'DONE') return 'done';
    if (st === 'ASSIGNED') return 'assigned';
    if (st === 'CHANGES_REQUESTED') return 'pending';
    if (st === 'REJECTED') return 'rejected';
    return 'progress';
  }
  function formatDue(t) {
    if (!t.dueAt) return '<p class="meta">截止：未设置</p>';
    var bar = '';
    if (t.dueProgress != null && t.status !== 'DONE') {
      var pct = Math.min(100, Math.round(Number(t.dueProgress) * 100));
      var st = esc(t.dueBarState || 'normal');
      bar = '<div class="due-bar" data-state="'+st+'"><div class="due-bar-fill" style="width:'+pct+'%"></div></div>';
    } else if (t.status === 'DONE') {
      bar = '<div class="due-bar" data-state="done"><div class="due-bar-fill" style="width:100%"></div></div>';
    }
    return '<p class="meta">截止：'+esc(String(t.dueAt).slice(0,10))+'</p>'+bar+'<p class="due-meta muted">'+esc(t.dueLabel||'')+'</p>';
  }
  function taskCardHtml(t, actionsHtml, extraCardClass) {
    var cardCls = 'task-card' + (extraCardClass ? (' ' + extraCardClass) : '');
    var stRaw = String(t.status||'');
    var st = '';
    if (stRaw === 'REJECTED') {
      st = '<span class="badge rejected">已拒绝 · 已通知主管</span>';
    } else if (t.status === 'CHANGES_REQUESTED') {
      st = '<span class="badge pending">待确认</span>';
    } else {
      st = '<span class="badge '+badgeClass(t.status)+'">'+esc(t.statusLabel||t.status)+'</span>';
    }
    var mgr = (t.managerDisplayName || '').trim();
    var mgrLine = mgr ? (' · 主管 ' + esc(mgr)) : '';
    var td = String(t.taskDescription || '').trim();
    var descLine = td ? ('<p class="meta task-card-desc">'+esc(clipStr(td, 140))+'</p>') : '';
    var tn = String(t.taskNo || '').trim();
    var detailLink = tn ? ('<p class="meta"><a class="task-detail-readonly-link" href="/workbench/employee/task?taskNo='+encodeURIComponent(tn)+'">查看背景与分工（只读）</a></p>') : '';
    var actions = actionsHtml || '';
    return '<article class="'+cardCls+'" data-plan-id="'+esc(t.planId)+'" data-subtask-id="'+esc(t.subtaskId||'')+'">'
      + '<div class="head"><div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+st+'</div>'
      + '<p class="title">'+esc(t.title||t.taskNo||'子任务')+'</p>'
      + '<p class="meta">业务编号 <code>'+esc(t.taskNo||'—')+'</code>'+mgrLine+'</p>'
      + descLine + detailLink
      + formatDue(t)
      + '</div></div>'+actions+'</article>';
  }

  async function loadNew() {
    setFb('fbNew', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/new', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var pend = tasks.filter(function (t) { return t.status === 'CHANGES_REQUESTED'; }).length;
      document.getElementById('kpiL1').textContent = '待处理数量';
      document.getElementById('kpiV1').textContent = String(tasks.length);
      document.getElementById('kpiL2').textContent = '待确认';
      document.getElementById('kpiV2').textContent = String(pend);
      document.getElementById('kpiL3').textContent = '提示';
      document.getElementById('kpiV3').textContent = '优先处理阻塞风险';
      var mount = document.getElementById('cardsNew');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无新任务。可到「进行中」查看执行中的工作。</div>';
        setFb('fbNew', '', 'muted');
        return;
      }
      mount.innerHTML = '<div class="task-cards">' + tasks.map(function (t) {
        var act = '<div class="actions">'
          +'<button type="button" class="btn btn-primary" data-act="accept">接受</button>'
          +'<button type="button" class="btn btn-danger" data-act="reject">拒绝</button>'
          +'<button type="button" class="btn btn-secondary" data-act="assist">需要主管协助</button>'
          +'</div>';
        return taskCardHtml(t, act);
      }).join('') + '</div>';
      mount.querySelectorAll('.task-card').forEach(function (card) {
        card.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var planId = card.getAttribute('data-plan-id') || '';
            var subtaskId = card.getAttribute('data-subtask-id') || '';
            var act = btn.getAttribute('data-act') || '';
            if (act === 'accept') {
              void submitDirect(planId, subtaskId, 'accept', '', { goView: 'current' }).catch(function (e) {
                setFb('fbNew', String(e && e.message ? e.message : e), 'err');
              });
              return;
            }
            openPanel(planId, subtaskId, act);
          });
        });
      });
      setFb('fbNew', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsNew').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbNew', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadCurrent() {
    setFb('fbCur', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/current', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var blocked = tasks.filter(function (t) { return t.status === 'BLOCKED'; }).length;
      var doing = tasks.filter(function (t) { return t.status === 'IN_PROGRESS'; }).length;
      var rejected = tasks.filter(function (t) { return t.status === 'REJECTED'; }).length;
      document.getElementById('kpiL1').textContent = '执行中';
      document.getElementById('kpiV1').textContent = String(doing);
      document.getElementById('kpiL2').textContent = '阻塞 / 已拒绝';
      document.getElementById('kpiV2').textContent = String(blocked) + ' / ' + String(rejected);
      document.getElementById('kpiL3').textContent = '提示';
      document.getElementById('kpiV3').textContent = '及时更新进度便于主管掌握风险';
      var mount = document.getElementById('cardsCur');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无进行中的任务。请先到「新任务」承接分配。</div>';
        setFb('fbCur', '', 'muted');
        return;
      }
      mount.innerHTML = '<div class="task-cards">' + tasks.map(function (t) {
        var act = '';
        if (t.status === 'REJECTED') {
          act = '<p class="muted emp-rejected-wait" style="margin:10px 0 0;font-size:13px;">已通知主管，请等待改派或确认。</p>';
        } else {
          act = '<div class="actions" style="justify-content:space-between;">'
            +'<span></span><button type="button" class="btn btn-secondary" data-prog="1">填写进度</button></div>';
        }
        return taskCardHtml(t, act, t.status === 'REJECTED' ? 'is-rejected' : '');
      }).join('') + '</div>';
      mount.querySelectorAll('.task-card').forEach(function (card) {
        var btn = card.querySelector('button[data-prog]');
        if (btn) btn.addEventListener('click', function () {
          openProgress(card.getAttribute('data-subtask-id') || '');
        });
      });
      setFb('fbCur', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsCur').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbCur', String(e && e.message ? e.message : e), 'err');
    }
  }

  async function loadHistory() {
    setFb('fbHist', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/history', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var mount = document.getElementById('cardsHist');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无已完成记录。</div>';
        setFb('fbHist', '', 'muted');
        return;
      }
      mount.innerHTML = '<div class="task-cards">' + tasks.map(function (t) {
        return taskCardHtml(t, '');
      }).join('') + '</div>';
      setFb('fbHist', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsHist').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbHist', String(e && e.message ? e.message : e), 'err');
    }
  }

  var pending = null;
  var progressSubtaskId = '';
  function openPanel(planId, subtaskId, action) {
    pending = { planId: planId, subtaskId: subtaskId, action: action };
    document.getElementById('actionNote').value = '';
    document.getElementById('actionPanel').style.display = 'block';
    var assistRow = document.getElementById('assistKindRow');
    if (action === 'assist') {
      if (assistRow) assistRow.style.display = 'grid';
      document.getElementById('actionTitle').textContent = '需要主管协助';
      var r0 = document.querySelector('input[name="assistKind"][value="customize"]');
      if (r0) r0.checked = true;
    } else {
      if (assistRow) assistRow.style.display = 'none';
      var titles = { reject: '拒绝任务（需填写理由）' };
      document.getElementById('actionTitle').textContent = titles[action] || '说明';
    }
    setFb('actionFeedback', '', 'muted');
    document.getElementById('actionNote').focus();
  }
  function closePanel() {
    pending = null;
    document.getElementById('actionPanel').style.display = 'none';
  }
  function openProgress(subtaskId) {
    progressSubtaskId = subtaskId;
    document.getElementById('progNote').value = '';
    document.getElementById('progStatus').value = 'IN_PROGRESS';
    document.getElementById('progressPanel').style.display = 'block';
    setFb('progPanelFb', '', 'muted');
    document.getElementById('progNote').focus();
  }
  function closeProgress() {
    progressSubtaskId = '';
    document.getElementById('progressPanel').style.display = 'none';
  }

  async function submitDirect(planId, subtaskId, action, note, opts) {
    var res = await fetch('/api/workbench/employee/subtasks/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ planId: planId, subtaskId: subtaskId, action: action, note: note, idempotencyKey: newIdempotencyKey() })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (opts && opts.goView === 'current') {
      location.href = '/workbench/employee?view=current&_=' + Date.now();
      return;
    }
    await loadNew();
  }

  document.getElementById('confirmActionBtn').addEventListener('click', async function () {
    if (!pending) return;
    var note = (document.getElementById('actionNote').value || '').trim();
    if (!note) { setFb('actionFeedback', '请填写说明', 'err'); return; }
    var action = pending.action;
    if (action === 'assist') {
      var sel = document.querySelector('input[name="assistKind"]:checked');
      action = sel ? sel.value : 'customize';
    }
    setFb('actionFeedback', '提交中…', 'muted');
    try {
      var go = (action === 'reject') ? { goView: 'current' } : undefined;
      await submitDirect(pending.planId, pending.subtaskId, action, note, go);
      closePanel();
      if (!go) await loadNew();
    } catch (e) {
      setFb('actionFeedback', String(e && e.message ? e.message : e), 'err');
    }
  });
  document.getElementById('cancelActionBtn').addEventListener('click', closePanel);

  document.getElementById('progSubmitBtn').addEventListener('click', async function () {
    if (!progressSubtaskId) { setFb('progPanelFb', '缺少子任务', 'err'); return; }
    var progressStatus = (document.getElementById('progStatus').value || '').trim();
    var note = (document.getElementById('progNote').value || '').trim();
    if (!note) { setFb('progPanelFb', '请填写说明', 'err'); return; }
    var btn = document.getElementById('progSubmitBtn');
    btn.disabled = true;
    setFb('progPanelFb', '提交中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/subtasks/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ subtaskId: progressSubtaskId, progressStatus: progressStatus, note: note, idempotencyKey: newIdempotencyKey() })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      closeProgress();
      await loadCurrent();
      setFb('progPanelFb', '', 'muted');
    } catch (e) {
      setFb('progPanelFb', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('progCancelBtn').addEventListener('click', closeProgress);

  function splitTokens(raw) {
    return String(raw || '').split(/[，,\\n]/g).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  async function loadProfile() {
    try {
      var res = await fetch('/api/workbench/employee/profile', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var profile = data.profile || {};
      document.getElementById('pfSkillTags').value = (profile.skillTags || []).join(', ');
      document.getElementById('pfStrengths').value = (profile.strengths || []).join(', ');
      document.getElementById('pfBoundaries').value = (profile.boundaries || []).join(', ');
      document.getElementById('pfTools').value = (profile.tools || []).join(', ');
      document.getElementById('pfBackground').value = profile.background || '';
    } catch (e) {
      setFb('profileFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }
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
        background: (document.getElementById('pfBackground').value || '')
      };
      var res = await fetch('/api/workbench/employee/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
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
    await fetch('/api/workbench/logout', { method: 'POST', cache: 'no-store' });
    window.location.href = '/workbench';
  });

  document.querySelectorAll('.nav-pills a[href*="view="]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      try {
        var u = new URL(a.getAttribute('href'), window.location.origin);
        navTo(u.searchParams.get('view') || 'new');
      } catch (e) { location.href = a.getAttribute('href'); }
    });
  });

  window.addEventListener('popstate', function () { showView(getView()); });
  showView(getView());
})();
</script>
</body>
</html>`;
}
