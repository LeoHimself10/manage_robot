import type { WorkbenchShellRole } from "./workbench-shell";
import { renderWorkbenchPage } from "./workbench-shell";
import { QUALITY_TRACKING_STYLES } from "./quality-tracking-styles";

export function renderQualityTrackingPage(params: {
  role: WorkbenchShellRole;
  userId: string;
  userLabel?: string;
  canReport?: boolean;
  isSpecialist?: boolean;
}): string {
  const hasAftersales = params.canReport !== false;
  const hasSpecialist = params.isSpecialist === true;
  const defaultMode = hasAftersales ? "aftersales" : "specialist";
  const sourceSection = "";
  const modeSwitch = hasAftersales && hasSpecialist ? `<div class="qt-mode-switch" role="group" aria-label="质量追踪工作模式">
    <button class="qt-tab is-on" type="button" data-quality-mode-switch="aftersales">售后主管</button>
    <button class="qt-tab" type="button" data-quality-mode-switch="specialist">质量专员</button>
  </div>` : "";
  const firstTab = "events";
  return renderWorkbenchPage({
    role: params.role,
    activeNav: "quality-tracking",
    title: "质量追踪",
    pageTitle: "质量追踪",
    description: defaultMode === "aftersales"
      ? "从客户问题反馈中发现、通报并持续追踪质量异常。"
      : "查看全部已通报质量事件及其处理记录。",
    userLabel: params.userLabel,
    sessionUserId: params.userId,
    extraCss: QUALITY_TRACKING_STYLES,
    mainHtml: `<main class="qt-grid" id="qualityTrackingRoot" data-can-report="${hasAftersales ? "1" : "0"}" data-is-specialist="${hasSpecialist ? "1" : "0"}" data-quality-mode="${defaultMode}" data-first-tab="${firstTab}">
  <section class="qt-card qt-hero">
    <div><span class="qt-pill">独立质量流程</span><h2>质量异常工作台</h2><p class="qt-muted">${defaultMode === "aftersales" ? "集中查看我通报的质量事件；来源反馈请在独立研判工作台处理。" : "查看全部已通报质量事件，推进分派、验收与闭环。"}</p></div>
    <div class="qt-actions">${modeSwitch}${hasAftersales ? `<a class="btn btn-secondary" href="/workbench/quality/review" target="_blank" rel="noopener noreferrer" data-quality-mode-only="aftersales">打开研判工作台</a><button class="btn btn-primary" type="button" id="qualityNewEvent" data-quality-mode-only="aftersales">新建质量异常</button>` : ""}</div>
  </section>
  ${sourceSection}
  <section class="qt-card">
    ${hasSpecialist ? `<div class="qt-state-groups" data-quality-mode-only="specialist" aria-label="质量事件状态分组"${defaultMode === "specialist" ? "" : " hidden"}><span>待分配</span><span>待承接</span><span>处理中</span><span>待原主责确认</span><span>待终验</span><span>已关闭</span></div>` : ""}
    <div class="qt-tabs" role="tablist" aria-label="质量事件视图">
      ${hasAftersales ? `<span data-quality-mode-only="aftersales"><button class="qt-tab${defaultMode === "aftersales" ? " is-on" : ""}" type="button" data-quality-tab="events">我通报的事件</button></span>` : ""}
      ${hasSpecialist ? `<span data-quality-mode-only="specialist"${defaultMode === "specialist" ? "" : " hidden"}><button class="qt-tab${defaultMode === "specialist" ? " is-on" : ""}" type="button" data-quality-tab="events">全部质量事件</button></span>` : ""}
    </div>
    <div id="qualitySourceRows"><div class="qt-list" id="qualityMainList" aria-live="polite"><div class="qt-empty">正在加载…</div></div></div>
    <div class="qt-pagination" id="qualityPagination"></div>
  </section>
</main>
<dialog class="qt-dialog" id="qualityEventDialog" aria-labelledby="qualityDialogTitle">
  <div class="qt-dialog-body">
    <div class="qt-dialog-head"><div><h2 id="qualityDialogTitle">新建质量异常</h2><p class="qt-muted">售后主管可编辑通报内容，来源快照始终只读。</p></div><button class="qt-close" type="button" id="qualityDialogClose" aria-label="关闭">×</button></div>
    <form id="qualityEventForm">
      <h3>来源快照</h3><div class="qt-snapshots" id="qualitySourceSnapshots"><div class="qt-empty">手动新建，无关联来源。</div></div>
      <div class="qt-form-grid">
        <label class="qt-field is-wide">事件标题<input class="qt-input" name="title" required maxlength="200"></label>
        <label class="qt-field is-wide">质量事件现状<textarea class="qt-textarea" name="currentSituation" required maxlength="10000"></textarea></label>
        <label class="qt-field">发生或反馈时间<input class="qt-input" name="occurredAt" maxlength="64"></label>
        <label class="qt-field">反馈人<input class="qt-input" name="reporter" maxlength="100"></label>
        <label class="qt-field">设备型号<input class="qt-input" name="deviceModel" maxlength="200"></label>
        <label class="qt-field">设备序列号<input class="qt-input" name="serialNo" maxlength="200"></label>
        <label class="qt-field">导管批次<input class="qt-input" name="catheterBatch" maxlength="200"></label>
        <label class="qt-field">问题分类<input class="qt-input" name="category" maxlength="200"></label>
        <label class="qt-field">紧急程度<select class="qt-select" name="urgency"><option value="LOW">低</option><option value="MEDIUM" selected>中</option><option value="HIGH">高</option><option value="CRITICAL">紧急</option></select></label>
        <label class="qt-field">术者是否可感知<input class="qt-input" name="clinicianAware" maxlength="500"></label>
        <label class="qt-field is-wide">影响<textarea class="qt-textarea" name="impact" maxlength="2000"></textarea></label>
        <label class="qt-field is-wide">补充说明<textarea class="qt-textarea" name="notes" maxlength="10000"></textarea></label>
        <label class="qt-field is-wide">附件证据（单个文件不超过 20 MB）<input class="qt-input" id="qualityFileInput" type="file"></label>
      </div>
      <div class="qt-form-feedback" id="qualityFormFeedback" role="status"></div>
      <div class="qt-dialog-actions"><button class="btn btn-secondary" type="button" id="qualitySaveDraft">保存草稿</button><button class="btn btn-primary" type="submit" id="qualitySubmitEvent">通报质量异常</button></div>
    </form>
    <section class="qt-detail" id="qualityFullDetail" hidden>
      <div class="qt-detail-actions" id="qualityDetailActions" aria-label="可执行操作">
        <button class="btn btn-primary btn-sm" type="button" data-quality-action="分配原主责">分配原主责</button>
        <button class="btn btn-secondary btn-sm" type="button" data-quality-action="调整总期限">调整总期限</button>
        <button class="btn btn-secondary btn-sm" type="button" data-quality-action="指定节点退回">指定节点退回</button>
        <button class="btn btn-primary btn-sm" type="button" data-quality-action="关闭质量事件">关闭质量事件</button>
        <button class="btn btn-secondary btn-sm" type="button" data-quality-action="重开质量事件">重开质量事件</button>
        <button class="btn btn-secondary btn-sm" type="button" data-quality-action="补充情况">补充情况</button>
        <button class="btn btn-secondary btn-sm" type="button" data-quality-action="更正信息">更正信息</button>
      </div>
      <section class="qt-detail-section"><h3>原始通报</h3><div id="qualityOriginalReport"></div></section>
      <section class="qt-detail-section"><h3>来源快照</h3><div id="qualityDetailSources"></div></section>
      <section class="qt-detail-section"><h3>相关事件</h3><div id="qualityRelatedEvents"></div></section>
      <section class="qt-detail-section"><h3>分配链路</h3><div class="qt-tree" id="qualityAssignmentTree"></div></section>
      <section class="qt-detail-section"><h3>证据与验收</h3><div id="qualityEvidenceReviews"></div></section>
      <section class="qt-detail-section"><h3>通知记录</h3><div id="qualityNotifications"></div></section>
      <section class="qt-detail-section"><h3>公开审计</h3><div id="qualityPublicAudit"></div></section>
    </section>
  </div>
</dialog>
<dialog class="qt-dialog qt-candidate-dialog" id="qualityCandidateDetailDialog" aria-labelledby="qualityCandidateDetailTitle">
  <div class="qt-dialog-body qt-candidate-detail">
    <div class="qt-dialog-head"><div><h2 id="qualityCandidateDetailTitle">异常候选详情</h2><p class="qt-muted">确认关联反馈与触发依据后，再创建可编辑的通报草稿。</p></div><button class="qt-close" type="button" id="qualityCandidateDetailClose" aria-label="关闭">×</button></div>
    <section class="qt-detail-section"><h3>异常依据</h3><div id="qualityCandidateFacts"></div></section>
    <section class="qt-detail-section"><h3>关联反馈</h3><div id="qualityCandidateSources"></div></section>
    <div class="qt-dialog-actions"><button class="btn btn-secondary" type="button" id="qualityCandidateDetailCancel">返回</button><button class="btn btn-primary" type="button" id="qualityCandidateDetailEdit">查看详情并编辑通报</button></div>
  </div>
</dialog>`,
    scriptHtml: `<script>${buildQualityTrackingClientScript()}</script>`,
  });
}

function buildQualityTrackingClientScript(): string {
  return String.raw`(function () {
  var root = document.getElementById('qualityTrackingRoot');
  if (!root) return;
  var canReport = root.getAttribute('data-can-report') === '1';
  var isSpecialist = root.getAttribute('data-is-specialist') === '1';
  var currentMode = root.getAttribute('data-quality-mode') || (canReport ? 'aftersales' : 'specialist');
  var currentTab = root.getAttribute('data-first-tab') || 'events';
  var page = 1;
  var pageSize = 50;
  var currentEvent = null;
  var currentDetail = null;
  var correctionReason = '';
  var currentSnapshots = [];
  var list = document.getElementById('qualityMainList');
  var pagination = document.getElementById('qualityPagination');
  var dialog = document.getElementById('qualityEventDialog');
  var candidateDialog = document.getElementById('qualityCandidateDetailDialog');
  var form = document.getElementById('qualityEventForm');
  var feedback = document.getElementById('qualityFormFeedback');
  var dialogTrigger = null;
  var candidateDialogTrigger = null;
  var currentCandidate = null;
  var statusLabels = { DRAFT: '草稿', PENDING_ASSIGNMENT: '待分配', PENDING_ACCEPTANCE: '待承接', IN_PROGRESS: '处理中', PENDING_PRIMARY_REVIEW: '待原主责确认', PENDING_QUALITY_REVIEW: '待终验', CLOSED: '已关闭' };
  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }
  function clear(element) { if (element) element.replaceChildren(); }
  function modeForElement(element) {
    var panel = element && element.closest ? element.closest('[data-quality-mode-only]') : null;
    return panel ? panel.getAttribute('data-quality-mode-only') : null;
  }
  function activateTab(tab) {
    currentTab = tab;
    document.querySelectorAll('[data-quality-tab]').forEach(function (button) {
      button.classList.toggle('is-on', button.getAttribute('data-quality-tab') === currentTab && modeForElement(button) === currentMode);
    });
  }
  function applyMode(mode) {
    if (mode !== 'aftersales' && mode !== 'specialist') return;
    if (mode === 'aftersales' && !canReport) return;
    if (mode === 'specialist' && !isSpecialist) return;
    currentMode = mode;
    root.setAttribute('data-quality-mode', mode);
    document.querySelectorAll('[data-quality-mode-only]').forEach(function (element) {
      element.hidden = element.getAttribute('data-quality-mode-only') !== mode;
    });
    document.querySelectorAll('[data-quality-mode-switch]').forEach(function (button) {
      button.classList.toggle('is-on', button.getAttribute('data-quality-mode-switch') === mode);
    });
    page = 1;
    activateTab('events');
    void loadCurrent();
  }
  function candidateTriggers(item) {
    var decision = item && item.explanation && item.explanation.decision ? item.explanation.decision : {};
    return Array.isArray(decision.triggers) ? decision.triggers : [];
  }
  function formatFacts(facts) {
    return Object.keys(facts || {}).filter(function (key) { return facts[key] !== '' && facts[key] != null; }).map(function (key) { return key + '：' + facts[key]; });
  }
  function renderCandidateFacts(item) {
    var mount = document.getElementById('qualityCandidateFacts');
    clear(mount);
    var triggers = candidateTriggers(item);
    if (!triggers.length) { mount.appendChild(node('div', 'qt-muted', '系统未提供额外触发依据。')); return; }
    triggers.forEach(function (trigger) {
      var card = node('article', 'qt-mini-card');
      card.appendChild(node('strong', '', trigger.label || ruleLabel(trigger.code || '')));
      var facts = formatFacts(trigger.facts);
      card.appendChild(node('div', 'qt-row-meta', facts.length ? facts.join(' · ') : '无额外命中事实'));
      mount.appendChild(card);
    });
  }
  function renderCandidateSources(item) {
    var mount = document.getElementById('qualityCandidateSources');
    clear(mount);
    var sourceRows = Array.isArray(item && item.sourceRows) ? item.sourceRows : [];
    if (!sourceRows.length) { mount.appendChild(node('div', 'qt-muted', '未找到关联反馈摘要。')); return; }
    sourceRows.forEach(function (source) {
      var card = node('article', 'qt-mini-card');
      card.appendChild(node('div', 'qt-row-title', (source.feedbackNo ? source.feedbackNo + ' · ' : '') + (source.issueDescription || '待补充问题描述')));
      card.appendChild(node('div', 'qt-row-meta', [source.deviceModel, source.category, source.sourceKey].filter(Boolean).join(' · ')));
      mount.appendChild(card);
    });
  }
  function closeCandidateDialog() {
    if (!candidateDialog) return;
    if (typeof candidateDialog.close === 'function') candidateDialog.close(); else candidateDialog.removeAttribute('open');
  }
  function openCandidateDetail(item) {
    currentCandidate = item;
    renderCandidateFacts(item);
    renderCandidateSources(item);
    candidateDialogTrigger = document.activeElement;
    if (!candidateDialog) return;
    if (typeof candidateDialog.showModal === 'function') candidateDialog.showModal(); else candidateDialog.setAttribute('open', '');
  }
  function showEmpty(text, isError) {
    clear(list);
    var empty = node('div', 'qt-empty' + (isError ? ' qt-error' : ''), text);
    list.appendChild(empty);
  }
  async function api(path, options) {
    var response = await fetch(path, options || {});
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || !payload.ok) {
      var error = new Error(payload.error || ('请求失败（' + response.status + '）'));
      error.payload = payload;
      error.status = response.status;
      throw error;
    }
    return payload.data || {};
  }
  function jsonOptions(method, body) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
  function uid() { return crypto.randomUUID(); }
  function formatTime(value) {
    if (!value) return '暂无';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }
  function field(name) { return form ? form.elements.namedItem(name) : null; }
  function fieldValue(name) { var el = field(name); return el ? String(el.value || '').trim() : ''; }
  function setField(name, value) { var el = field(name); if (el) el.value = value == null ? '' : String(value); }
  function draftFromForm() {
    return { title: fieldValue('title'), currentSituation: fieldValue('currentSituation'), occurredAt: fieldValue('occurredAt') || undefined, reporter: fieldValue('reporter') || undefined, deviceModel: fieldValue('deviceModel') || undefined, serialNo: fieldValue('serialNo') || undefined, catheterBatch: fieldValue('catheterBatch') || undefined, clinicianAware: fieldValue('clinicianAware') || undefined, impact: fieldValue('impact') || undefined, category: fieldValue('category') || undefined, urgency: fieldValue('urgency') || 'MEDIUM', notes: fieldValue('notes') || undefined };
  }
  function renderSnapshots(items) {
    var mount = document.getElementById('qualitySourceSnapshots');
    clear(mount);
    if (!items || items.length === 0) { mount.appendChild(node('div', 'qt-empty', '手动新建，无关联来源。')); return; }
    items.forEach(function (item) {
      var card = node('section', 'qt-snapshot');
      card.appendChild(node('div', 'qt-snapshot-title', '来源：' + (item.sourceKey || '未知')));
      var grid = node('div', 'qt-snapshot-grid');
      var snapshot = item.snapshot || item.rawSnapshot || {};
      Object.keys(snapshot).filter(function (key) { return String(snapshot[key] || '').trim(); }).forEach(function (key) {
        grid.appendChild(node('div', '', key + '：' + String(snapshot[key])));
      });
      card.appendChild(grid);
      mount.appendChild(card);
    });
  }
  function mountText(id, text) { var mount = document.getElementById(id); if (!mount) return; clear(mount); mount.appendChild(node('div', 'qt-detail-text', text || '暂无记录')); }
  function renderFullDetail(detail) {
    currentDetail = detail || null;
    var wrap = document.getElementById('qualityFullDetail');
    if (!wrap) return;
    wrap.hidden = !detail || !detail.event || detail.event.status === 'DRAFT';
    if (wrap.hidden) return;
    var event = detail.event;
    mountText('qualityOriginalReport', event.problemStatus + '\n事件编号：' + event.eventNo + '\n原主责：' + ((detail.assignmentTree || []).find(function (item) { return item.isPrimary; }) || {}).assigneeUserId + '\n总期限：' + formatTime(event.overallDueAt));
    var sources = document.getElementById('qualityDetailSources'); clear(sources); if (!(detail.sourceSnapshots || []).length) sources.appendChild(node('div', 'qt-muted', '手动创建，无来源快照。')); else (detail.sourceSnapshots || []).forEach(function (item) { var box = node('div', 'qt-mini-card'); box.appendChild(node('strong', '', item.sourceKey)); box.appendChild(node('div', 'qt-row-desc', JSON.stringify(item.snapshot || {}, null, 2))); sources.appendChild(box); });
    var related = document.getElementById('qualityRelatedEvents'); clear(related); if (!(detail.relatedEvents || []).length) related.appendChild(node('div', 'qt-muted', '暂无相关事件。')); else (detail.relatedEvents || []).forEach(function (item) { related.appendChild(node('div', 'qt-mini-card', (item.relatedEventNo || item.relatedSourceKey || '相关记录') + ' · ' + (item.relatedEventTitle || item.relationType || ''))); });
    var tree = document.getElementById('qualityAssignmentTree'); clear(tree); if (!(detail.assignmentTree || []).length) tree.appendChild(node('div', 'qt-muted', '尚未分配原主责。')); else (detail.assignmentTree || []).forEach(function (item) { var box = node('article', 'qt-tree-node'); box.style.marginLeft = Math.min(Number(item.depth || 0) * 22, 88) + 'px'; box.appendChild(node('div', 'qt-row-title', (item.isPrimary ? '原主责 · ' : '') + item.assigneeUserId + ' · ' + (item.departmentName || '未填写部门'))); box.appendChild(node('div', 'qt-row-meta', '父节点：' + (item.parentNodeId || '无') + ' · 状态：' + (statusLabels[item.status] || item.status) + ' · 期限：' + formatTime(item.dueAt) + ' · 正式任务：' + (item.taskNo || item.taskId || '待生成'))); box.appendChild(node('div', 'qt-row-desc', '任务要求：' + item.requirement)); tree.appendChild(box); });
    var packs = document.getElementById('qualityEvidenceReviews'); clear(packs); if (!(detail.evidence || []).length && !(detail.reviews || []).length) packs.appendChild(node('div', 'qt-muted', '暂无证据或验收记录。')); (detail.evidence || []).forEach(function (item) { var link = node('a', 'qt-file-link', '第 ' + item.evidenceVersion + ' 版 · ' + item.originalName + ' · ' + (item.summary || '无摘要')); link.href = '/api/workbench/quality/evidence/' + encodeURIComponent(item.evidenceId); packs.appendChild(link); }); (detail.reviews || []).forEach(function (item) { packs.appendChild(node('div', 'qt-mini-card', (item.decision === 'APPROVE' ? '通过' : '退回') + ' · ' + item.reviewerUserId + (item.reason ? ' · ' + item.reason : '') + ' · ' + formatTime(item.createdAt))); });
    var notifications = document.getElementById('qualityNotifications'); clear(notifications); if (!(detail.notifications || []).length) notifications.appendChild(node('div', 'qt-muted', '暂无通知记录。')); else (detail.notifications || []).forEach(function (item) { var statusName=({PENDING:'待发送',SENDING:'发送中',RETRY:'重试中',SENT:'已发送',DEAD:'人工处理'})[item.status]||item.status;var card=node('div','qt-mini-card');card.appendChild(node('div','',item.eventType+' · '+item.recipientUserId+' · '+statusName));card.appendChild(node('div','qt-row-meta','尝试 '+item.attempts+' 次 · 最后更新 '+formatTime(item.updatedAt)+(item.lastError?' · 安全错误摘要：'+item.lastError:'')));if(item.canRetry){var retry=node('button','btn btn-secondary btn-sm','重新入队');retry.type='button';retry.addEventListener('click',function(){retry.disabled=true;void api('/api/workbench/quality/notifications/'+encodeURIComponent(item.id)+'/retry',jsonOptions('POST',{requestId:uid()})).then(function(){return openEvent(currentEvent.eventId);}).catch(showActionError).finally(function(){retry.disabled=false;});});card.appendChild(retry);}notifications.appendChild(card); });
    var audit = document.getElementById('qualityPublicAudit'); clear(audit); (detail.publicAudit || []).forEach(function (item) { audit.appendChild(node('div', 'qt-audit-row', formatTime(item.occurredAt) + ' · ' + item.actorUserId + ' · ' + item.action + (item.reason ? ' · ' + item.reason : ''))); }); if (!(detail.publicAudit || []).length) audit.appendChild(node('div', 'qt-muted', '暂无公开审计记录。'));
    document.querySelectorAll('[data-quality-action]').forEach(function (button) { button.hidden = (detail.allowedActions || []).indexOf(button.getAttribute('data-quality-action')) < 0; });
  }
  function applyEvent(event, snapshots, detail) {
    currentEvent = event || null;
    currentDetail = detail || null;
    currentSnapshots = snapshots || [];
    setField('title', event && event.title);
    setField('currentSituation', event && event.problemStatus);
    setField('occurredAt', event && (event.occurredAt || event.feedbackAt));
    setField('reporter', event && event.feedbackName);
    setField('deviceModel', event && event.deviceModel);
    setField('serialNo', event && event.deviceSerial);
    setField('catheterBatch', event && event.catheterBatch);
    setField('clinicianAware', event && event.clinicianAware);
    setField('impact', event && event.impact);
    setField('category', event && event.initialCategory);
    setField('urgency', event && event.urgency ? event.urgency : 'MEDIUM');
    setField('notes', event && event.supplement);
    renderSnapshots(currentSnapshots);
    var title = document.getElementById('qualityDialogTitle');
    if (title) title.textContent = event ? (event.status === 'DRAFT' ? '编辑质量异常草稿' : '质量事件详情') : '新建质量异常';
    var editable = canReport && currentMode === 'aftersales' && (!event || event.status === 'DRAFT');
    if (form) Array.prototype.forEach.call(form.elements, function (element) { if (element.name || element.id === 'qualityFileInput') element.disabled = !editable; });
    var saveButton = document.getElementById('qualitySaveDraft');
    var submitButton = document.getElementById('qualitySubmitEvent');
    if (saveButton) saveButton.hidden = !editable;
    if (submitButton) submitButton.hidden = !editable;
    renderFullDetail(detail || null);
  }
  function openDialog() {
    feedback.textContent = '';
    if (dialog.open) return;
    dialogTrigger = document.activeElement;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  async function createDraftFromSources(keys) {
    var data = await api('/api/workbench/quality/events/drafts', jsonOptions('POST', { sourceKeys: keys, requestId: uid() }));
    applyEvent(data.event, data.sourceSnapshots);
    openDialog();
  }
  async function openEvent(eventId) {
    var data = await api('/api/workbench/quality/events/' + encodeURIComponent(eventId));
    applyEvent(data.event, data.sourceSnapshots, data);
    openDialog();
  }
  function renderSourceRow(item) {
    var row = node('article', 'qt-row');
    var check = node('input', 'qt-checkbox');
    check.type = 'checkbox'; check.value = item.sourceKey; check.setAttribute('aria-label', '选择这条反馈');
    if (item.reportedEvent) check.disabled = true;
    row.appendChild(check);
    var main = node('div', 'qt-row-main');
    main.appendChild(node('div', 'qt-row-title', (item.feedbackNo ? item.feedbackNo + ' · ' : '') + (item.issueDescription || '待补充问题描述')));
    main.appendChild(node('div', 'qt-row-meta', [item.feedbackAt, item.deviceModel, item.serialNo, item.catheterBatch, item.category].filter(Boolean).join(' · ') || '无其他信息'));
    if (item.reportedEvent) main.appendChild(node('div', 'qt-row-meta', '已通报：' + item.reportedEvent.eventNo + ' · ' + (statusLabels[item.reportedEvent.status] || item.reportedEvent.status)));
    row.appendChild(main);
    var actions = node('div', 'qt-actions');
    var button = node('button', 'btn btn-secondary btn-sm', item.reportedEvent ? '查看事件' : '通报');
    button.type = 'button';
    button.addEventListener('click', function () { void (item.reportedEvent ? openEvent(item.reportedEvent.eventId) : createDraftFromSources([item.sourceKey])).catch(showActionError); });
    actions.appendChild(button); row.appendChild(actions);
    return row;
  }
  function renderPagination(meta) {
    clear(pagination);
    if (!meta || meta.total === 0) return;
    var previous = node('button', 'btn btn-secondary btn-sm', '上一页'); previous.type = 'button'; previous.disabled = meta.page <= 1;
    var next = node('button', 'btn btn-secondary btn-sm', '下一页'); next.type = 'button'; next.disabled = meta.page >= meta.pageCount;
    previous.addEventListener('click', function () { page -= 1; void loadCurrent(); });
    next.addEventListener('click', function () { page += 1; void loadCurrent(); });
    pagination.append(previous, node('span', 'qt-page-label', '第 ' + meta.page + ' / ' + Math.max(meta.pageCount, 1) + ' 页，共 ' + meta.total + ' 条'), next);
  }
  function showSync(sync) {
    var mount = document.getElementById('qualitySyncStatus');
    if (!mount) return;
    mount.classList.toggle('is-failed', Boolean(sync && sync.status === 'FAILED'));
    if (!sync) { mount.textContent = '尚未同步，可点击“立即同步”读取原表。'; return; }
    if (sync.status === 'FAILED') { mount.textContent = '最近同步失败：' + (sync.lastError || '未知原因') + '。正在使用最近成功数据（' + formatTime(sync.lastSucceededAt) + '）。'; return; }
    if (sync.status === 'RUNNING') { mount.textContent = '正在同步原表，当前页面仍可使用上次成功数据。'; return; }
    mount.textContent = '最近成功同步：' + formatTime(sync.lastSucceededAt) + '。';
  }
  async function loadSource(reported) {
    showEmpty('正在加载来源反馈…');
    var q = document.getElementById('qualitySearchInput');
    var params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q: q ? q.value.trim() : '' });
    if (reported !== undefined) params.set('reported', reported ? '1' : '0');
    var data = await api('/api/workbench/quality/source?' + params.toString());
    showSync(data.sync); clear(list);
    var count = document.getElementById('qualitySourceCount'); if (count) count.textContent = '共 ' + data.pagination.total + ' 条反馈';
    if (!data.rows.length) showEmpty('未找到符合条件的反馈。'); else data.rows.forEach(function (item) { list.appendChild(renderSourceRow(item)); });
    renderPagination(data.pagination);
  }
  function ruleLabel(code) { return ({ BATCH_REPEAT: '同批次相似问题重复出现', MODEL_CATEGORY_REPEAT: '同型号同类问题重复出现', HIGH_RISK_KEYWORD: '包含高风险词', HISTORY_SIMILAR: '与历史质量事件相似', DATA_INCOMPLETE: '来源数据待完善' })[code] || code; }
  async function loadCandidates() {
    showEmpty('正在检查异常候选…');
    var data = await api('/api/workbench/quality/candidates?page=' + page + '&pageSize=' + pageSize + '&status=OPEN'); clear(list);
    if (!data.candidates.length) showEmpty('暂无需要处理的异常候选。');
    data.candidates.forEach(function (item) {
      var row = node('article', 'qt-row'); row.appendChild(node('span', 'qt-status' + (item.candidateType === 'DATA_INCOMPLETE' ? ' is-warn' : ''), item.candidateType === 'DATA_INCOMPLETE' ? '待完善' : '异常建议'));
      var main = node('div', 'qt-row-main');
      var triggers = candidateTriggers(item);
      main.appendChild(node('div', 'qt-row-title', triggers.length ? triggers.map(function (trigger) { return trigger.label || ruleLabel(trigger.code || ''); }).join('、') : item.ruleCodes.map(ruleLabel).join('、')));
      var firstFacts = triggers.length ? formatFacts(triggers[0].facts) : [];
      if (firstFacts.length) main.appendChild(node('div', 'qt-row-desc qt-candidate-facts', firstFacts.join(' · ')));
      main.appendChild(node('div', 'qt-row-meta', '关联 ' + item.sourceKeys.length + ' 条反馈 · 发现于 ' + formatTime(item.detectedAt))); row.appendChild(main);
      var actions = node('div', 'qt-actions'); var inspect = node('button', 'btn btn-primary btn-sm', '查看详情并编辑通报'); inspect.type = 'button'; inspect.addEventListener('click', function () { openCandidateDetail(item); });
      var dismiss = node('button', 'btn btn-secondary btn-sm', '忽略'); dismiss.type = 'button'; dismiss.addEventListener('click', function () { var reason = window.prompt('请输入忽略原因'); if (!reason) return; void api('/api/workbench/quality/candidates/' + encodeURIComponent(item.id) + '/dismiss', jsonOptions('POST', { expectedVersion: item.version, reason: reason })).then(loadCandidates).catch(showActionError); }); actions.append(inspect, dismiss); row.appendChild(actions); list.appendChild(row);
    }); renderPagination(data.pagination);
  }
  async function loadEvents() {
    showEmpty('正在加载质量事件…'); var data = await api('/api/workbench/quality/events?page=' + page + '&pageSize=' + pageSize); clear(list);
    var aftersalesMode = currentMode === 'aftersales';
    if (!data.events.length) showEmpty(aftersalesMode ? '你还没有通报质量事件。' : '暂无已提交质量事件。');
    function eventRow(event) { var row = node('article', 'qt-row'); row.appendChild(node('span', 'qt-status' + (event.status === 'CLOSED' ? ' is-ok' : ''), statusLabels[event.status] || event.status)); var main = node('div', 'qt-row-main'); main.appendChild(node('div', 'qt-row-title', event.eventNo + ' · ' + event.title)); main.appendChild(node('div', 'qt-row-desc', event.problemStatus)); main.appendChild(node('div', 'qt-row-meta', '更新于 ' + formatTime(event.updatedAt))); row.appendChild(main); var actions = node('div', 'qt-actions'); var view = node('button', 'btn btn-secondary btn-sm', '查看'); view.type = 'button'; view.addEventListener('click', function () { void openEvent(event.eventId).catch(showActionError); }); actions.appendChild(view); row.appendChild(actions); return row; }
    if (aftersalesMode) data.events.forEach(function (event) { list.appendChild(eventRow(event)); });
    else [['PENDING_ASSIGNMENT','待分配'],['PENDING_ACCEPTANCE','待承接'],['IN_PROGRESS','处理中'],['PENDING_PRIMARY_REVIEW','待原主责确认'],['PENDING_QUALITY_REVIEW','待终验'],['CLOSED','已关闭']].forEach(function (group) { var items = data.events.filter(function (event) { return event.status === group[0]; }); if (!items.length) return; var section = node('section', 'qt-event-group'); section.appendChild(node('h3', 'qt-group-title', group[1] + '（' + items.length + '）')); items.forEach(function (event) { section.appendChild(eventRow(event)); }); list.appendChild(section); });
    renderPagination(data.pagination);
  }
  async function loadCurrent() { try { if (currentTab === 'candidates') await loadCandidates(); else if (currentTab === 'source') await loadSource(); else if (currentTab === 'reported') await loadSource(true); else await loadEvents(); } catch (error) { showActionError(error); } }
  function showActionError(error) { var message = error && error.message ? error.message : String(error); if (feedback && dialog && dialog.open) feedback.textContent = message; else showEmpty(message, true); }
  async function saveDraft() {
    var draft = draftFromForm();
    var data;
    if (!currentEvent) data = await api('/api/workbench/quality/events/drafts', jsonOptions('POST', { requestId: uid(), draft: draft }));
    else if (currentEvent.status !== 'DRAFT') throw new Error('已提交事件不能无痕修改，请使用更正或补充。');
    else data = await api('/api/workbench/quality/events/' + encodeURIComponent(currentEvent.eventId) + '/draft', jsonOptions('PATCH', { expectedVersion: currentEvent.version, requestId: uid(), patch: draft }));
    applyEvent(data.event, data.sourceSnapshots || currentSnapshots);
    var fileInput = document.getElementById('qualityFileInput');
    if (fileInput && fileInput.files && fileInput.files[0]) { var formData = new FormData(); formData.append('file', fileInput.files[0]); formData.append('requestId', uid()); var uploadData = await api('/api/workbench/quality/events/' + encodeURIComponent(currentEvent.eventId) + '/files', { method: 'POST', body: formData }); if (uploadData.event) currentEvent = uploadData.event; fileInput.value = ''; }
    feedback.textContent = '草稿已保存。'; return currentEvent;
  }
  function chooseNode(message) {
    var nodes = currentDetail && currentDetail.assignmentTree ? currentDetail.assignmentTree : [];
    if (!nodes.length) return null;
    var menu = nodes.map(function (item, index) { return (index + 1) + '：' + item.assigneeUserId + ' / ' + (item.departmentName || '未填写部门') + ' / ' + item.requirement; }).join('\n');
    var selected = window.prompt(message + '\n' + menu + '\n请输入序号');
    var index = Number(selected) - 1;
    return Number.isInteger(index) && nodes[index] ? nodes[index] : null;
  }
  function affectedUpstream(nodeItem) {
    var nodes = currentDetail.assignmentTree || []; var names = []; var current = nodeItem;
    while (current) { names.push(current.assigneeUserId + '（' + (current.departmentName || '未填写部门') + '）'); current = nodes.find(function (item) { return item.nodeId === current.parentNodeId; }); }
    return names;
  }
  async function runDetailAction(action) {
    if (!currentEvent || !currentDetail) return;
    var path = '/api/workbench/quality/events/' + encodeURIComponent(currentEvent.eventId);
    var body = { expectedVersion: currentEvent.version, requestId: uid() };
    if (action === '分配原主责') { var manager = window.prompt('请输入原主责部门主管的用户编号'); if (!manager) return; var due = window.prompt('请输入总期限（例如 2026-08-10 18:00）'); if (!due) return; var requirement = window.prompt('请输入质量任务要求'); if (!requirement) return; body.primaryManagerUserId = manager; body.dueAt = due; body.taskRequirement = requirement; path += '/assign-primary'; }
    else if (action === '调整总期限') { var newDue = window.prompt('请输入新的总期限', currentEvent.overallDueAt || ''); if (!newDue) return; var dueReason = window.prompt('请输入改期原因'); if (!dueReason) return; body.dueAt = newDue; body.reason = dueReason; path += '/due'; }
    else if (action === '指定节点退回' || action === '重开质量事件') { var selected = chooseNode(action === '指定节点退回' ? '请选择要退回的节点' : '请选择从哪个节点重开'); if (!selected) return; var reason = window.prompt(action === '指定节点退回' ? '请输入退回原因' : '请输入重开原因'); if (!reason) return; var impact = affectedUpstream(selected); if (!window.confirm('将影响以下上游节点：\n' + impact.join(' → ') + '\n确认继续吗？')) return; body.nodeId = selected.nodeId; body.reason = reason; path += action === '指定节点退回' ? '/return-node' : '/reopen'; }
    else if (action === '关闭质量事件') { var conclusion = window.prompt('请输入终验结论'); if (!conclusion) return; if (!window.confirm('关闭后事件将进入只读状态，确认关闭吗？')) return; body.conclusion = conclusion; path += '/close'; }
    else if (action === '补充情况') { var content = window.prompt('请输入需要补充的质量事件现状'); if (!content) return; body.content = content; path += '/supplements'; }
    else if (action === '更正信息') {
      if (!correctionReason) { correctionReason = window.prompt('请输入更正原因') || ''; if (!correctionReason) return; Array.prototype.forEach.call(form.elements, function (element) { if (element.name) element.disabled = false; }); feedback.textContent = '请在上方修改通报字段，然后再次点击“更正信息”提交。'; return; }
      body.reason = correctionReason; body.patch = draftFromForm(); path += '/corrections'; correctionReason = '';
    } else return;
    feedback.textContent = '正在处理…';
    await api(path, jsonOptions('POST', body));
    await openEvent(currentEvent.eventId);
    await loadEvents();
    feedback.textContent = '操作已完成。';
  }
  document.querySelectorAll('[data-quality-tab]').forEach(function (button) { button.addEventListener('click', function () { if (modeForElement(button) !== currentMode) return; page = 1; activateTab(button.getAttribute('data-quality-tab') || 'events'); void loadCurrent(); }); });
  document.querySelectorAll('[data-quality-mode-switch]').forEach(function (button) { button.addEventListener('click', function () { applyMode(button.getAttribute('data-quality-mode-switch')); }); });
  var newButton = document.getElementById('qualityNewEvent'); if (newButton) newButton.addEventListener('click', function () { if (form) form.reset(); applyEvent(null, []); openDialog(); });
  var closeButton = document.getElementById('qualityDialogClose'); if (closeButton) closeButton.addEventListener('click', function () { dialog.close(); });
  if (dialog) dialog.addEventListener('close', function () { if (dialogTrigger && typeof dialogTrigger.focus === 'function') dialogTrigger.focus(); dialogTrigger = null; });
  var candidateClose = document.getElementById('qualityCandidateDetailClose'); if (candidateClose) candidateClose.addEventListener('click', closeCandidateDialog);
  var candidateCancel = document.getElementById('qualityCandidateDetailCancel'); if (candidateCancel) candidateCancel.addEventListener('click', closeCandidateDialog);
  if (candidateDialog) candidateDialog.addEventListener('close', function () { if (candidateDialogTrigger && typeof candidateDialogTrigger.focus === 'function') candidateDialogTrigger.focus(); candidateDialogTrigger = null; });
  var candidateEdit = document.getElementById('qualityCandidateDetailEdit'); if (candidateEdit) candidateEdit.addEventListener('click', function () { if (!currentCandidate) return; candidateEdit.disabled = true; void createDraftFromSources(currentCandidate.sourceKeys).then(closeCandidateDialog).catch(showActionError).finally(function () { candidateEdit.disabled = false; }); });
  var saveButton = document.getElementById('qualitySaveDraft'); if (saveButton) saveButton.addEventListener('click', function () { feedback.textContent = '正在保存…'; void saveDraft().catch(showActionError); });
  document.querySelectorAll('[data-quality-action]').forEach(function (button) { button.addEventListener('click', function () { void runDetailAction(button.getAttribute('data-quality-action')).catch(showActionError); }); });
  if (form) form.addEventListener('submit', function (event) { event.preventDefault(); feedback.textContent = '正在通报…'; void saveDraft().then(function (saved) { return api('/api/workbench/quality/events/' + encodeURIComponent(saved.eventId) + '/submit', jsonOptions('POST', { expectedVersion: saved.version, requestId: uid() })); }).then(function () { dialog.close(); page = 1; activateTab('events'); return loadCurrent(); }).catch(showActionError); });
  var search = document.getElementById('qualitySourceSearch'); if (search) search.addEventListener('submit', function (event) { event.preventDefault(); page = 1; activateTab('source'); void loadSource(); });
  var syncButton = document.getElementById('qualitySyncNow'); if (syncButton) syncButton.addEventListener('click', function () { syncButton.disabled = true; syncButton.textContent = '同步中…'; void api('/api/workbench/quality/source/sync', { method: 'POST' }).then(function () { return loadCurrent(); }).catch(showActionError).finally(function () { syncButton.disabled = false; syncButton.textContent = '立即同步'; }); });
  void loadCurrent();
})();`;
}
