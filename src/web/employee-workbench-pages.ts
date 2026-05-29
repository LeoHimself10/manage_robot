import { renderWorkbenchPage } from "./workbench-shell";
import { buildSubtaskPlanningFieldsClientJs } from "./workbench-subtask-fields-snippet";
import { buildWorkbenchEmployeeAuthClientJs } from "./workbench-employee-auth-snippet";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";

/** Single-page employee workbench: `?view=new|current|history|profile|security` */
export function renderEmployeeWorkbenchPage(): string {
  return renderWorkbenchPage({
    role: "employee",
    activeNav: "emp-new",
    title: "待承接",
    pageTitle: "员工工作台",
    description: "主管发布后的正式子任务。请在接受前核对执行要点。",
    mainHtml: `
  <div id="panelNew">
    <p class="page-desc" id="empPageDescNew">主管发布后的正式子任务。请在接受前核对下方六项要点；拒绝或需要主管协助时请填写说明。</p>
    <section class="kpis kpis--2" aria-live="polite">
      <div class="kpi"><div class="lbl">待您处理</div><div class="val" id="kpiNewActionable">—</div></div>
      <div class="kpi"><div class="lbl">已处理 · 等主管</div><div class="val" id="kpiNewWaiting">—</div></div>
    </section>
    <div class="emp-list-toolbar">
      <input id="searchNew" type="search" placeholder="搜索任务标题 / 编号 / 说明" autocomplete="off" />
    </div>
    <div id="cardsNew"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbNew"></div>
  </div>

  <div id="panelCur" hidden>
    <p class="page-desc" id="empPageDescCur">执行中或阻塞的子任务。可在卡片上直接填写进度。</p>
    <section class="kpis kpis--2" aria-live="polite">
      <div class="kpi"><div class="lbl">执行中</div><div class="val" id="kpiCurDoing">—</div></div>
      <div class="kpi"><div class="lbl">阻塞</div><div class="val" id="kpiCurBlocked">—</div></div>
    </section>
    <div class="emp-list-toolbar">
      <input id="searchCur" type="search" placeholder="搜索任务标题 / 编号 / 说明" autocomplete="off" />
    </div>
    <div id="cardsCur"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbCur"></div>
  </div>

  <div id="panelHist" hidden>
    <p class="page-desc">历史已完成的子任务。</p>
    <div class="emp-list-toolbar">
      <input id="searchHist" type="search" placeholder="搜索任务标题 / 编号 / 说明" autocomplete="off" />
    </div>
    <div id="cardsHist"><div class="empty-state">加载中…</div></div>
    <div class="feedback muted" id="fbHist"></div>
  </div>

  <div id="panelProf" hidden>
    <p class="page-desc">补充你的技能与协作偏好，便于主管分配合适任务。</p>
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

  <div id="panelSecurity" hidden>
    <p class="page-desc">在这里修改你的登录密码。</p>
    <div class="account-strip account-strip--loading" id="secAccountStrip" aria-label="当前账号" aria-busy="true">
      <div>
        <div class="account-strip__who" id="secAccountWho">加载账号信息…</div>
        <div class="account-strip__meta" id="secAccountMeta">&nbsp;</div>
      </div>
    </div>
    <div class="status-banner status-banner--success" id="pwdSuccessBanner" hidden role="status">
      <span>密码已更新。下次请用<strong>新密码</strong>从 <a href="/workbench/external/login">外部登录页</a> 登录。</span>
      <button type="button" class="status-banner__close" id="pwdSuccessDismiss" aria-label="关闭提示">关闭</button>
    </div>
    <div class="info-banner" role="note">提示：修改成功后请用新密码从 <a href="/workbench/external/login">外部登录页</a> 登录；当前会话不会自动退出。</div>
    <div class="card security-form-card">
      <div class="form-stack security-form">
        <label id="pwdCurrentLabel">当前密码
          <div class="pwd-field">
            <input id="pwdCurrent" type="password" autocomplete="current-password" placeholder="请输入当前密码" aria-describedby="pwdRules passwordFeedback" />
            <button type="button" class="pwd-field__toggle" id="pwdCurrentToggle" aria-pressed="false" aria-label="显示当前密码">显示</button>
          </div>
        </label>
        <label id="pwdNewLabel">新密码
          <div class="pwd-field">
            <input id="pwdNew" type="password" autocomplete="new-password" placeholder="至少 8 位，建议字母与数字组合" aria-describedby="pwdRules" />
            <button type="button" class="pwd-field__toggle" id="pwdNewToggle" aria-pressed="false" aria-label="显示新密码">显示</button>
          </div>
        </label>
        <label id="pwdConfirmLabel">确认新密码
          <div class="pwd-field">
            <input id="pwdConfirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" aria-describedby="pwdRules" />
            <button type="button" class="pwd-field__toggle" id="pwdConfirmToggle" aria-pressed="false" aria-label="显示确认密码">显示</button>
          </div>
        </label>
      </div>
      <div class="pwd-rules" id="pwdRules" aria-live="polite">
        <div id="pwdRuleLen">○ 至少 8 个字符</div>
        <div id="pwdRuleMatch">○ 两次输入一致</div>
        <div id="pwdRuleDiff">○ 新密码不能与当前密码相同</div>
      </div>
      <button type="button" class="btn btn-primary" id="changePasswordBtn">确认修改密码</button>
      <div class="feedback muted" id="passwordFeedback" role="alert"></div>
    </div>
  </div>

<!-- 弹窗：协助/拒绝 -->
<div class="wb-modal-overlay" id="actionModalOverlay" role="dialog" aria-modal="true" aria-labelledby="actionModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="actionModalTitle">补充说明</h3>
      <button type="button" class="wb-modal__close" id="actionModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <div id="assistKindRow" class="wb-modal__radio-row" style="display:none;">
        <label data-assist-radio>
          <input type="radio" name="assistKind" value="customize" checked />
          <span class="wb-modal__radio-text"><strong>仅补充说明</strong><span class="muted">不改变承接状态，主管会收到说明。</span></span>
        </label>
        <label data-assist-radio>
          <input type="radio" name="assistKind" value="request_changes" />
          <span class="wb-modal__radio-text"><strong>申请调整范围、截止或分工</strong><span class="muted">正式调整诉求，主管可驳回；未接受前可能保持待承接。</span></span>
        </label>
      </div>
      <div class="form-stack">
        <label>说明（必填）
          <textarea id="actionNote" rows="4" placeholder="请填写拒绝理由、补充信息或修改诉求"></textarea>
        </label>
      </div>
    </div>
    <div class="wb-modal__foot">
      <div class="feedback muted" id="actionFeedback" role="status" aria-live="polite"></div>
      <button type="button" class="btn btn-secondary" id="cancelActionBtn">取消</button>
      <button type="button" class="btn btn-primary" id="confirmActionBtn">提交</button>
    </div>
  </div>
</div>

<!-- 弹窗：填写进度 -->
<div class="wb-modal-overlay" id="progressModalOverlay" role="dialog" aria-modal="true" aria-labelledby="progressModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="progressModalTitle">填写进度</h3>
      <button type="button" class="wb-modal__close" id="progressModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <div class="form-stack">
        <label>进度状态
          <select id="progStatus">
            <option value="IN_PROGRESS">执行中</option>
            <option value="BLOCKED">阻塞</option>
            <option value="DONE">已完成</option>
          </select>
        </label>
        <label>说明（必填）
          <textarea id="progNote" rows="4" placeholder="本阶段进展、风险与下一步计划"></textarea>
        </label>
      </div>
    </div>
    <div class="wb-modal__foot">
      <div class="feedback muted" id="progPanelFb" role="status" aria-live="polite"></div>
      <button type="button" class="btn btn-secondary" id="progCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="progSubmitBtn">提交</button>
    </div>
  </div>
</div>

<!-- 弹窗：查看说明（已处理 · 等主管 卡片用） -->
<div class="wb-modal-overlay" id="noteModalOverlay" role="dialog" aria-modal="true" aria-labelledby="noteModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="noteModalTitle">说明详情</h3>
      <button type="button" class="wb-modal__close" id="noteModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p id="noteModalBody" style="white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.6;color:#334155;margin:0;">—</p>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="noteModalOkBtn">关闭</button>
    </div>
  </div>
</div>`,
    scriptHtml: `<script>
(function () {
  ${buildWorkbenchEmployeeAuthClientJs()}
  ${buildWorkbenchViewSwitchClientJs()}
  function applyExternalSecurityUi(data) {
    if (!data || !data.ok || data.loginSource !== 'external_password') {
      if (getView() === 'security') navTo('new');
      return;
    }
    var nav = document.getElementById('navSecurity');
    if (nav) nav.hidden = false;
    var strip = document.getElementById('secAccountStrip');
    if (strip) {
      strip.classList.remove('account-strip--loading');
      strip.removeAttribute('aria-busy');
    }
    var who = document.getElementById('secAccountWho');
    var meta = document.getElementById('secAccountMeta');
    var displayName = (data.dingUser && data.dingUser.name) || (data.externalAccount && data.externalAccount.displayName) || data.userId || '外部用户';
    var username = (data.externalAccount && data.externalAccount.username) || data.userId || '—';
    if (who) who.textContent = displayName;
    if (meta) meta.textContent = '登录名 ' + username + ' · 账号密码登录';
  }
  function mapPasswordChangeError(msg) {
    var m = String(msg || '').trim();
    if (m === 'Current password is incorrect' || m === '当前密码不正确') return '当前密码不正确，请重新输入';
    if (m === '新密码不能与当前密码相同') return m;
    if (m === '新密码至少 8 位') return m;
    if (m === 'currentPassword and newPassword are required') return '请填写当前密码和新密码';
    if (m === 'newPassword must be at least 8 characters') return '新密码至少 8 位';
    return m || '修改失败，请稍后重试';
  }
  function clearPasswordFieldErrors() {
    ['pwdCurrentLabel', 'pwdNewLabel', 'pwdConfirmLabel'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('is-field-error');
    });
  }
  function setPasswordFieldError(labelId) {
    clearPasswordFieldErrors();
    var el = document.getElementById(labelId);
    if (el) el.classList.add('is-field-error');
    var input = el && el.querySelector('input');
    if (input) {
      try { input.focus(); } catch (e) {}
    }
  }
  function bindPasswordToggle(toggleId, inputId) {
    var btn = document.getElementById(toggleId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '隐藏' : '显示';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', (show ? '隐藏' : '显示') + input.getAttribute('placeholder'));
    });
  }
  function hidePasswordSuccessBanner() {
    var banner = document.getElementById('pwdSuccessBanner');
    if (banner) banner.hidden = true;
  }
  function showPasswordSuccessBanner() {
    var banner = document.getElementById('pwdSuccessBanner');
    if (banner) banner.hidden = false;
  }
  function updatePwdRules() {
    var cur = (document.getElementById('pwdCurrent').value || '');
    var np = (document.getElementById('pwdNew').value || '').trim();
    var cp = (document.getElementById('pwdConfirm').value || '').trim();
    var lenEl = document.getElementById('pwdRuleLen');
    var matchEl = document.getElementById('pwdRuleMatch');
    var diffEl = document.getElementById('pwdRuleDiff');
    if (lenEl) {
      lenEl.textContent = (np.length >= 8 ? '✓' : '○') + ' 至少 8 个字符';
      lenEl.className = np.length >= 8 ? 'is-ok' : '';
    }
    if (matchEl) {
      var matched = !!(np && cp && np === cp);
      matchEl.textContent = (matched ? '✓' : '○') + ' 两次输入一致';
      matchEl.className = matched ? 'is-ok' : '';
    }
    if (diffEl) {
      var diffOk = !cur || !np || cur !== np;
      diffEl.textContent = (diffOk && np ? '✓' : '○') + ' 新密码不能与当前密码相同';
      if (cur && np && cur === np) diffEl.className = 'is-invalid';
      else if (diffOk && np) diffEl.className = 'is-ok';
      else diffEl.className = '';
    }
  }
  void fetch('/api/workbench/me', { cache: 'no-store' }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { res: res, data: data };
    });
  }).then(function (payload) {
    if (!payload) return;
    if (wbCheckAuthResponse(payload.res, payload.data)) return;
    var data = payload.data;
    wbRememberLoginSource(data);
    if (data.ok && data.canExecuteAsManager) {
      var mgrNav = document.getElementById('navManager');
      if (mgrNav) {
        mgrNav.hidden = false;
        wbBindViewSwitchLink('navManager', 'manager', '/workbench/manager/tasks');
      }
    }
    applyExternalSecurityUi(data);
  }).catch(function () {});
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

  /* ---------- 弹窗工具 ---------- */
  var lastFocus = null;
  function openModal(id) {
    var ov = document.getElementById(id);
    if (!ov) return;
    lastFocus = document.activeElement;
    ov.setAttribute('data-open', 'true');
    var firstFocusable = ov.querySelector('textarea, input, button:not(.wb-modal__close)');
    if (firstFocusable) {
      try { firstFocusable.focus(); } catch (e) {}
    }
  }
  function closeModal(id) {
    var ov = document.getElementById(id);
    if (!ov) return;
    ov.removeAttribute('data-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (e) {}
    }
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      ['actionModalOverlay', 'progressModalOverlay', 'noteModalOverlay'].forEach(function (id) {
        var ov = document.getElementById(id);
        if (ov && ov.getAttribute('data-open') === 'true') closeModal(id);
      });
    }
  });
  ['actionModalOverlay', 'progressModalOverlay', 'noteModalOverlay'].forEach(function (id) {
    var ov = document.getElementById(id);
    if (!ov) return;
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov) closeModal(id);
    });
  });
  document.querySelectorAll('[data-assist-radio]').forEach(function (lbl) {
    lbl.addEventListener('change', function () {
      document.querySelectorAll('[data-assist-radio]').forEach(function (l) {
        var input = l.querySelector('input[type="radio"]');
        l.classList.toggle('is-checked', !!(input && input.checked));
      });
    });
  });

  /* ---------- 视图切换 ---------- */
  function getView() {
    try {
      var v = (new URLSearchParams(location.search).get('view') || 'new').toLowerCase();
      if (v === 'current' || v === 'history' || v === 'profile' || v === 'security') return v;
      return 'new';
    } catch (e) { return 'new'; }
  }
  function navTo(view) {
    var u = '/workbench/employee?view=' + encodeURIComponent(view);
    try { history.replaceState({}, '', u); } catch (e2) { location.href = u; }
    showView(view);
  }
  function showView(view) {
    closeModal('actionModalOverlay');
    closeModal('progressModalOverlay');
    closeModal('noteModalOverlay');
    if (view === 'security') {
      var navSec = document.querySelector('.wb-rail-link[data-wb-nav="emp-security"]');
      if (navSec && navSec.hidden) view = 'new';
    }
    document.querySelectorAll('.wb-rail-link[data-wb-nav]').forEach(function (a) { a.classList.remove('is-on-emp'); });
    var map = { new: 'emp-new', current: 'emp-cur', history: 'emp-hist', profile: 'emp-prof', security: 'emp-security' };
    var navKey = map[view] || 'emp-new';
    var na = document.querySelector('.wb-rail-link[data-wb-nav="' + navKey + '"]');
    if (na) na.classList.add('is-on-emp');
    document.getElementById('panelNew').hidden = view !== 'new';
    document.getElementById('panelCur').hidden = view !== 'current';
    document.getElementById('panelHist').hidden = view !== 'history';
    document.getElementById('panelProf').hidden = view !== 'profile';
    document.getElementById('panelSecurity').hidden = view !== 'security';
    var titles = {
      new: '待承接',
      current: '进行中的任务',
      history: '已完成',
      profile: '能力画像',
      security: '账号安全'
    };
    document.getElementById('empPageTitle').textContent = titles[view] || titles.new;
    if (view === 'new') void loadNew();
    if (view === 'current') void loadCurrent();
    if (view === 'history') void loadHistory();
    if (view === 'profile') void loadProfile();
  }

  /* ---------- 卡片渲染 ---------- */
  function badgeClass(st) {
    if (st === 'BLOCKED') return 'blocked';
    if (st === 'DONE') return 'done';
    if (st === 'ASSIGNED') return 'assigned';
    if (st === 'CHANGES_REQUESTED') return 'pending';
    if (st === 'REJECTED') return 'rejected';
    return 'progress';
  }
  ${buildSubtaskPlanningFieldsClientJs()}
  function depTitles(subs, depIds) {
    if (!depIds || !depIds.length) return '—';
    return depIds.map(function (id) {
      var sid = String(id);
      for (var i = 0; i < subs.length; i++) {
        if (String(subs[i].sourceTaskKey || '') === sid) return subs[i].title || sid;
      }
      return sid;
    }).join('；');
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
  function pickEmployeeBadge(t) {
    var stRaw = String(t.status || '');
    if (stRaw === 'REJECTED') return '<span class="badge rejected">已拒绝 · 等主管处理</span>';
    if (t.openSignal === 'changes') return '<span class="badge pending">已申请调整 · 等主管回复</span>';
    if (t.openSignal === 'rejected') return '<span class="badge rejected">已拒绝 · 等主管处理</span>';
    return '<span class="badge '+badgeClass(stRaw)+'">'+esc(t.statusLabel||stRaw)+'</span>';
  }
  function taskCardHtml(t, actionsHtml, extraCardClass) {
    var cardCls = 'task-card' + (extraCardClass ? (' ' + extraCardClass) : '');
    var st = pickEmployeeBadge(t);
    var mgr = (t.managerDisplayName || '').trim();
    var mgrLine = mgr ? (' · 主管 ' + esc(mgr)) : '';
    var td = String(t.taskDescription || '').trim();
    var descLine = td ? ('<p class="meta task-card-desc">'+esc(clipStr(td, 140))+'</p>') : '';
    var tn = String(t.taskNo || '').trim();
    var fromView = getView();
    var detailLink = tn ? ('<p class="meta"><a class="task-detail-readonly-link" href="/workbench/employee/task?taskNo='+encodeURIComponent(tn)+'&fromView='+encodeURIComponent(fromView)+'">完整背景与分工</a></p>') : '';
    var coreLines = subtaskCardCoreLines(t, [t]);
    var actions = actionsHtml || '';
    return '<article class="'+cardCls+'" data-plan-id="'+esc(t.planId)+'" data-subtask-id="'+esc(t.subtaskId||'')+'" data-search-key="'+esc(((t.title||'')+' '+(t.taskNo||'')+' '+(t.taskDescription||'')).toLowerCase())+'">'
      + '<div class="head"><div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+st+'</div>'
      + '<p class="title">'+esc(t.title||t.taskNo||'子任务')+'</p>'
      + '<p class="meta">业务编号 <code>'+esc(t.taskNo||'—')+'</code>'+mgrLine+'</p>'
      + descLine + coreLines + detailLink
      + formatDue(t)
      + '</div></div>'+actions+'</article>';
  }

  /* ---------- 任务级分组 ---------- */
  function groupByTaskNo(tasks) {
    var byNo = {};
    var orderNo = [];
    tasks.forEach(function (t) {
      var key = String(t.taskNo || t.planId || '').trim() || '__unnamed';
      if (!byNo[key]) {
        byNo[key] = { taskNo: t.taskNo, planId: t.planId, title: t.title, items: [] };
        orderNo.push(key);
      }
      byNo[key].items.push(t);
    });
    return orderNo.map(function (k) { return byNo[k]; });
  }
  function shouldGroup(tasks) {
    if (!tasks || tasks.length < 4) return false;
    var byNo = {};
    var maxCnt = 0;
    tasks.forEach(function (t) {
      var k = String(t.taskNo || t.planId || '').trim();
      byNo[k] = (byNo[k] || 0) + 1;
      if (byNo[k] > maxCnt) maxCnt = byNo[k];
    });
    return maxCnt >= 2;
  }
  function renderTaskCardList(tasks, renderActions) {
    if (!tasks.length) return '';
    if (!shouldGroup(tasks)) {
      return '<div class="task-cards">' + tasks.map(function (t) {
        return taskCardHtml(t, renderActions(t), tasks._extraClassFor ? tasks._extraClassFor(t) : '');
      }).join('') + '</div>';
    }
    var groups = groupByTaskNo(tasks);
    return groups.map(function (g) {
      var head = '<div class="emp-task-group__head">'
        + '<span class="emp-task-group__title">'+esc(g.title || g.taskNo || '任务')+'</span>'
        + '<span class="emp-task-group__no">'+esc(g.taskNo || '—')+'</span>'
        + '<span class="emp-task-group__count">'+g.items.length+' 个子任务</span>'
        + '</div>';
      var body = '<div class="emp-task-group__body">' + g.items.map(function (t) {
        return taskCardHtml(t, renderActions(t), tasks._extraClassFor ? tasks._extraClassFor(t) : '');
      }).join('') + '</div>';
      return '<div class="emp-task-group">'+head+body+'</div>';
    }).join('');
  }

  /* ---------- 关键词筛选 ---------- */
  function bindSearch(inputId, mountId) {
    var input = document.getElementById(inputId);
    var mount = document.getElementById(mountId);
    if (!input || !mount) return;
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('input', function () {
      var q = String(input.value || '').trim().toLowerCase();
      mount.querySelectorAll('.task-card').forEach(function (card) {
        var key = card.getAttribute('data-search-key') || '';
        card.style.display = (!q || key.indexOf(q) >= 0) ? '' : 'none';
      });
    });
  }

  /* ---------- 待承接（actionable + waiting） ---------- */
  async function loadNew() {
    setFb('fbNew', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/new', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var actionable = data.actionable || [];
      var waiting = data.waiting || [];
      document.getElementById('kpiNewActionable').textContent = String(actionable.length);
      document.getElementById('kpiNewWaiting').textContent = String(waiting.length);
      var mount = document.getElementById('cardsNew');
      if (!actionable.length && !waiting.length) {
        mount.innerHTML = '<div class="empty-state">暂无新任务。可到「进行中」查看执行中的工作。</div>';
        setFb('fbNew', '', 'muted');
        return;
      }
      var html = '';
      if (actionable.length) {
        html += '<h3 class="emp-section-h">待您处理 <span class="emp-section-count">'+actionable.length+'</span></h3>';
        html += '<p class="emp-section-hint">主管刚发布的子任务，请尽快接受、拒绝或申请协助。</p>';
        html += renderTaskCardList(actionable, function (t) {
          return '<div class="actions">'
            +'<button type="button" class="btn btn-primary" data-act="accept">接受</button>'
            +'<button type="button" class="btn btn-danger" data-act="reject">拒绝</button>'
            +'<button type="button" class="btn btn-secondary" data-act="assist">需要主管协助</button>'
            +'</div>';
        });
      }
      if (waiting.length) {
        var wList = waiting.slice();
        wList._extraClassFor = function () { return 'is-waiting-mgr'; };
        html += '<h3 class="emp-section-h" style="margin-top:24px;">已处理 · 等主管 <span class="emp-section-count">'+waiting.length+'</span></h3>';
        html += '<p class="emp-section-hint">已提交您的回复，等待主管处理；可查看说明或主管最新回复。</p>';
        html += renderTaskCardList(wList, function (t) {
          var noteRaw = String(t.progressNote || '').trim();
          var noteAttr = noteRaw ? ' data-note="'+esc(noteRaw)+'"' : '';
          var btnLabel = t.openSignal === 'changes' ? '查看我的申请' : (String(t.status||'') === 'REJECTED' ? '查看我的拒绝' : '查看说明');
          return '<div class="actions"><button type="button" class="btn btn-secondary" data-act="view-note"'+noteAttr+'>'+btnLabel+'</button></div>';
        });
      }
      mount.innerHTML = html;
      mount.querySelectorAll('.task-card').forEach(function (card) {
        card.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var planId = card.getAttribute('data-plan-id') || '';
            var subtaskId = card.getAttribute('data-subtask-id') || '';
            var act = btn.getAttribute('data-act') || '';
            if (act === 'accept') {
              btn.disabled = true;
              void submitDirect(planId, subtaskId, 'accept', '', { goView: 'current' }).catch(function (e) {
                btn.disabled = false;
                setFb('fbNew', String(e && e.message ? e.message : e), 'err');
              });
              return;
            }
            if (act === 'view-note') {
              var note = btn.getAttribute('data-note') || '（暂无说明记录，可点击「完整背景与分工」查看事件历史。）';
              document.getElementById('noteModalBody').textContent = note;
              openModal('noteModalOverlay');
              return;
            }
            openActionModal(planId, subtaskId, act);
          });
        });
      });
      bindSearch('searchNew', 'cardsNew');
      setFb('fbNew', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsNew').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbNew', String(e && e.message ? e.message : e), 'err');
    }
  }

  /* ---------- 进行中（不含 REJECTED） ---------- */
  async function loadCurrent() {
    setFb('fbCur', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/current', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = (data.tasks || []).filter(function (t) { return String(t.status || '') !== 'REJECTED'; });
      var blocked = tasks.filter(function (t) { return t.status === 'BLOCKED'; }).length;
      var doing = tasks.filter(function (t) { return t.status === 'IN_PROGRESS'; }).length;
      document.getElementById('kpiCurDoing').textContent = String(doing);
      document.getElementById('kpiCurBlocked').textContent = String(blocked);
      var mount = document.getElementById('cardsCur');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无进行中的任务。请先到「待承接」承接分配。</div>';
        setFb('fbCur', '', 'muted');
        return;
      }
      mount.innerHTML = renderTaskCardList(tasks, function (t) {
        return '<div class="actions" style="justify-content:space-between;">'
          +'<span></span><button type="button" class="btn btn-secondary" data-prog="1">填写进度</button></div>';
      });
      mount.querySelectorAll('.task-card').forEach(function (card) {
        var btn = card.querySelector('button[data-prog]');
        if (btn) btn.addEventListener('click', function () {
          openProgressModal(card.getAttribute('data-subtask-id') || '');
        });
      });
      bindSearch('searchCur', 'cardsCur');
      setFb('fbCur', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsCur').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbCur', String(e && e.message ? e.message : e), 'err');
    }
  }

  /* ---------- 已完成 ---------- */
  async function loadHistory() {
    setFb('fbHist', '加载中…', 'muted');
    try {
      var res = await fetch('/api/workbench/employee/tasks/history', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var tasks = data.tasks || [];
      var mount = document.getElementById('cardsHist');
      if (!tasks.length) {
        mount.innerHTML = '<div class="empty-state">暂无已完成记录。</div>';
        setFb('fbHist', '', 'muted');
        return;
      }
      mount.innerHTML = renderTaskCardList(tasks, function (t) { return ''; });
      bindSearch('searchHist', 'cardsHist');
      setFb('fbHist', '已更新', 'ok');
    } catch (e) {
      document.getElementById('cardsHist').innerHTML = '<div class="empty-state">加载失败</div>';
      setFb('fbHist', String(e && e.message ? e.message : e), 'err');
    }
  }

  /* ---------- 弹窗：拒绝 / 协助 ---------- */
  var pending = null;
  var progressSubtaskId = '';
  function openActionModal(planId, subtaskId, action) {
    pending = { planId: planId, subtaskId: subtaskId, action: action };
    document.getElementById('actionNote').value = '';
    var assistRow = document.getElementById('assistKindRow');
    if (action === 'assist') {
      assistRow.style.display = 'grid';
      document.getElementById('actionModalTitle').textContent = '需要主管协助';
      var r0 = document.querySelector('input[name="assistKind"][value="customize"]');
      if (r0) {
        r0.checked = true;
        r0.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      assistRow.style.display = 'none';
      document.getElementById('actionModalTitle').textContent = action === 'reject' ? '拒绝任务（需填写理由）' : '说明';
    }
    setFb('actionFeedback', '', 'muted');
    openModal('actionModalOverlay');
  }
  function openProgressModal(subtaskId) {
    progressSubtaskId = subtaskId;
    document.getElementById('progNote').value = '';
    document.getElementById('progStatus').value = 'IN_PROGRESS';
    setFb('progPanelFb', '', 'muted');
    openModal('progressModalOverlay');
  }

  document.getElementById('actionModalClose').addEventListener('click', function () { closeModal('actionModalOverlay'); });
  document.getElementById('cancelActionBtn').addEventListener('click', function () { closeModal('actionModalOverlay'); });
  document.getElementById('progressModalClose').addEventListener('click', function () { closeModal('progressModalOverlay'); });
  document.getElementById('progCancelBtn').addEventListener('click', function () { closeModal('progressModalOverlay'); });
  document.getElementById('noteModalClose').addEventListener('click', function () { closeModal('noteModalOverlay'); });
  document.getElementById('noteModalOkBtn').addEventListener('click', function () { closeModal('noteModalOverlay'); });

  async function submitDirect(planId, subtaskId, action, note, opts) {
    var res = await fetch('/api/workbench/employee/subtasks/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ planId: planId, subtaskId: subtaskId, action: action, note: note, idempotencyKey: newIdempotencyKey() })
    });
    var data = await res.json().catch(function () { return {}; });
    if (wbCheckAuthResponse(res, data)) return;
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
    var confirmBtn = document.getElementById('confirmActionBtn');
    confirmBtn.disabled = true;
    setFb('actionFeedback', '提交中…', 'muted');
    try {
      await submitDirect(pending.planId, pending.subtaskId, action, note);
      closeModal('actionModalOverlay');
      await loadNew();
    } catch (e) {
      setFb('actionFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      confirmBtn.disabled = false;
    }
  });

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
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      closeModal('progressModalOverlay');
      await loadCurrent();
      setFb('progPanelFb', '', 'muted');
    } catch (e) {
      setFb('progPanelFb', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------- 能力画像 ---------- */
  function splitTokens(raw) {
    return String(raw || '').split(/[，,\\n]/g).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  async function loadProfile() {
    try {
      var res = await fetch('/api/workbench/employee/profile', { cache: 'no-store' });
      var data = await res.json().catch(function () { return {}; });
      if (wbCheckAuthResponse(res, data)) return;
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
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('profileFeedback', '已保存', 'ok');
    } catch (e) {
      setFb('profileFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('changePasswordBtn').addEventListener('click', async function () {
    var btn = document.getElementById('changePasswordBtn');
    var btnLabel = btn.textContent || '确认修改密码';
    var currentPassword = (document.getElementById('pwdCurrent').value || '');
    var newPassword = (document.getElementById('pwdNew').value || '').trim();
    var confirmPassword = (document.getElementById('pwdConfirm').value || '').trim();
    hidePasswordSuccessBanner();
    clearPasswordFieldErrors();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setFb('passwordFeedback', '请填写全部密码字段', 'err');
      if (!currentPassword) setPasswordFieldError('pwdCurrentLabel');
      else if (!newPassword) setPasswordFieldError('pwdNewLabel');
      else setPasswordFieldError('pwdConfirmLabel');
      return;
    }
    if (newPassword.length < 8) {
      setFb('passwordFeedback', '新密码至少 8 位', 'err');
      setPasswordFieldError('pwdNewLabel');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFb('passwordFeedback', '两次输入的新密码不一致', 'err');
      setPasswordFieldError('pwdConfirmLabel');
      return;
    }
    if (currentPassword === newPassword) {
      setFb('passwordFeedback', '新密码不能与当前密码相同', 'err');
      setPasswordFieldError('pwdNewLabel');
      return;
    }
    if (!window.confirm('确认修改登录密码？修改后下次登录需使用新密码。')) return;
    btn.disabled = true;
    btn.textContent = '提交中…';
    btn.setAttribute('aria-busy', 'true');
    setFb('passwordFeedback', '', 'muted');
    try {
      var res = await fetch('/api/workbench/external/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword })
      });
      var data = await res.json().catch(function () { return {}; });
      if (wbCheckAuthResponse(res, data)) return;
      if (!res.ok || !data.ok) {
        var errText = mapPasswordChangeError(data.error || ('HTTP ' + res.status));
        if (String(data.error || '').indexOf('当前密码') >= 0 || data.error === 'Current password is incorrect') {
          setPasswordFieldError('pwdCurrentLabel');
        } else if (String(data.error || '').indexOf('不能与当前') >= 0) {
          setPasswordFieldError('pwdNewLabel');
        }
        throw new Error(errText);
      }
      document.getElementById('pwdCurrent').value = '';
      document.getElementById('pwdNew').value = '';
      document.getElementById('pwdConfirm').value = '';
      updatePwdRules();
      showPasswordSuccessBanner();
      setFb('passwordFeedback', '', 'muted');
    } catch (e) {
      setFb('passwordFeedback', mapPasswordChangeError(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = btnLabel;
      btn.removeAttribute('aria-busy');
    }
  });

  var pwdCurrentEl = document.getElementById('pwdCurrent');
  var pwdNewEl = document.getElementById('pwdNew');
  var pwdConfirmEl = document.getElementById('pwdConfirm');
  if (pwdCurrentEl) pwdCurrentEl.addEventListener('input', function () { hidePasswordSuccessBanner(); clearPasswordFieldErrors(); updatePwdRules(); });
  if (pwdNewEl) pwdNewEl.addEventListener('input', function () { hidePasswordSuccessBanner(); updatePwdRules(); });
  if (pwdConfirmEl) pwdConfirmEl.addEventListener('input', function () { hidePasswordSuccessBanner(); updatePwdRules(); });
  bindPasswordToggle('pwdCurrentToggle', 'pwdCurrent');
  bindPasswordToggle('pwdNewToggle', 'pwdNew');
  bindPasswordToggle('pwdConfirmToggle', 'pwdConfirm');
  var pwdSuccessDismiss = document.getElementById('pwdSuccessDismiss');
  if (pwdSuccessDismiss) pwdSuccessDismiss.addEventListener('click', hidePasswordSuccessBanner);

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST', cache: 'no-store' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  document.querySelectorAll('.wb-rail-link[href*="view="]').forEach(function (a) {
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
</script>`,
  });
}
