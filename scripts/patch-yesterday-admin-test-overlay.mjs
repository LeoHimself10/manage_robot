import { readFileSync, writeFileSync } from "node:fs";

const appRoot = process.env.ADMIN_TEST_OVERLAY_ROOT || "/app";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`[admin-test-overlay] expected exactly one ${label} anchor`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceAllChecked(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count < 1) throw new Error(`[admin-test-overlay] expected at least one ${label} anchor`);
  return source.split(before).join(after);
}

function replaceRangeOnce(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const secondStart = source.indexOf(start, startIndex + start.length);
  if (startIndex < 0 || secondStart >= 0) {
    throw new Error(`[admin-test-overlay] expected exactly one ${label} start anchor`);
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`[admin-test-overlay] missing ${label} end anchor`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

function patchFile(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`[admin-test-overlay] ${path} was not changed`);
  writeFileSync(path, after, "utf8");
}

patchFile(`${appRoot}/src/web/assignment-workbench.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { createPeopleDirectoryStore } from "../infra/people-directory-store";\n',
    'import { createPeopleDirectoryStore } from "../infra/people-directory-store";\n'
      + 'import { getAdminTestActor } from "../testing/admin-test-actors";\n',
    "assignment import",
  );
  next = replaceOnce(
    next,
    "        const redirectTo = defaultPathForRole(next.role, next.userId);",
    "        const testActor = getAdminTestActor(next.userId);\n"
      + "        const redirectTo = testActor && testActor.impersonationKind !== \"employee\"\n"
      + '          ? "/workbench/quality"\n'
      + "          : defaultPathForRole(next.role, next.userId);",
    "assignment redirect",
  );
  next = replaceAllChecked(next, "进行中", "执行中", "assignment in-progress copy");
  return next;
});

patchFile(`${appRoot}/src/quality/source/quality-source-sync.ts`, (source) => replaceOnce(
  source,
  '          "SELECT source_key FROM quality_source_rows WHERE state <> \'DELETED\'",',
  '          "SELECT source_key FROM quality_source_rows WHERE state <> \'DELETED\' AND sheet_id <> \'QUALITY_TEST_ISOLATED\'",',
  "quality source-sync isolated-row ownership",
));

patchFile(`${appRoot}/src/web/quality-tracking-page.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from\n  "../quality/ai-original-assessment/historical-feedback-taxonomy-v0";\n',
    'import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from\n  "../quality/ai-original-assessment/historical-feedback-taxonomy-v0";\n'
      + 'import { renderQualityRoleMetricGroups, resolveQualityMetricRole } from\n'
      + '  "../quality/presentation/quality-role-metrics";\n'
      + 'import { getAdminTestActor } from "../testing/admin-test-actors";\n',
    "quality metric imports",
  );
  next = replaceOnce(
    next,
    "  const planningMode = params.planningMode === true;\n  const selectedManager",
    "  const planningMode = params.planningMode === true;\n"
      + "  const adminTestActor = getAdminTestActor(params.userId);\n"
      + "  const metricRole = adminTestActor?.impersonationKind === \"manager\"\n"
      + "    ? \"supervisor\"\n"
      + "    : resolveQualityMetricRole({ canReport, isSpecialist, planningMode, isBusinessReadOnly });\n"
      + "  const selectedManager",
    "quality metric role",
  );
  next = replaceOnce(
    next,
    'data-manager-user-id="${escapeHtml(params.selectedManagerUserId ?? "")}">',
    'data-manager-user-id="${escapeHtml(params.selectedManagerUserId ?? "")}" data-metric-role="${metricRole}">',
    "quality metric role data",
  );
  next = replaceRangeOnce(
    next,
    '    <div class="qpc-metrics" id="qualityMetrics">\n',
    '    </div>\n    <section class="qpc-panel" aria-labelledby="qualityListTitle">',
    '    <div class="qpc-metrics" id="qualityMetrics">${renderQualityRoleMetricGroups(metricRole)}</div>\n'
      + '    <section class="qpc-panel" aria-labelledby="qualityListTitle">',
    "quality metric markup",
  );
  next = replaceOnce(
    next,
    "  var managerUserId = root.getAttribute('data-manager-user-id') || '';\n",
    "  var managerUserId = root.getAttribute('data-manager-user-id') || '';\n"
      + "  var metricRole = root.getAttribute('data-metric-role') || 'overview';\n",
    "quality metric client role",
  );
  next = replaceOnce(
    next,
    "  var state = { listType: canViewSources ? 'feedback' : 'event', page: 1, pageSize: 25, rows: [],",
    "  var state = { listType: canViewSources ? 'feedback' : 'event', metricSourceStatus: '', metricStatuses: '', metricManagerStage: '', page: 1, pageSize: 25, rows: [],",
    "quality metric filter state",
  );
  next = replaceOnce(
    next,
    "  var statusLabels = { DRAFT: '通报草稿', PENDING_ANALYSIS: '待质量初析', PENDING_ASSIGNMENT: planningMode ? '待我分配' : '待分配', PENDING_ACCEPTANCE: '待承接', IN_PROGRESS: '处理中', PENDING_PRIMARY_REVIEW: '待原主责确认', PENDING_QUALITY_REVIEW: '待终验', CLOSED: '已关闭' };",
    `  var statusLabels = ${JSON.stringify({
      DRAFT: "通报草稿",
      PENDING_ANALYSIS: "待质量初析",
      PENDING_ASSIGNMENT: "待任务分配",
      PENDING_ACCEPTANCE: "待主管承接",
      IN_PROGRESS: "执行中",
      PENDING_PRIMARY_REVIEW: "待主管验收",
      PENDING_QUALITY_REVIEW: "待质量终验",
      CLOSED: "已关闭",
    })};`,
    "quality unified status labels",
  );
  next = replaceOnce(
    next,
    "  function setStatusOptions() { var select = document.getElementById('qualityStatusFilter'), previous = select.value; clear(select); var options = state.listType === 'feedback' ? [['', '全部状态'], ['PENDING', '待研判'], ['REVIEWED', '已保存研判'], ['REPORTED', '已通报']] : [['', '全部状态'], ['DRAFT', '通报草稿'], ['PENDING_ANALYSIS', '待质量初析'], ['PENDING_ASSIGNMENT', '待分配'], ['PENDING_ACCEPTANCE', '待承接'], ['IN_PROGRESS', '处理中'], ['PENDING_PRIMARY_REVIEW', '待原主责确认'], ['PENDING_QUALITY_REVIEW', '待终验'], ['CLOSED', '已关闭']]; options.forEach(function (item) { select.appendChild(new Option(item[1], item[0])); }); if (options.some(function (item) { return item[0] === previous; })) select.value = previous; }",
    "  function setStatusOptions() { var select = document.getElementById('qualityStatusFilter'), previous = select.value; clear(select); var options = state.listType === 'feedback' ? [['', '全部状态'], ['ACTION_REQUIRED', '待研判'], ['COMPLETED', '已完成研判'], ['REPORTED', '已通报']] : [['', '全部状态'], ['DRAFT', '通报草稿'], ['PENDING_ANALYSIS', '待质量初析'], ['PENDING_ASSIGNMENT', '待任务分配'], ['PENDING_ACCEPTANCE', '待主管承接'], ['IN_PROGRESS', '执行中'], ['PENDING_PRIMARY_REVIEW', '待主管验收'], ['PENDING_QUALITY_REVIEW', '待质量终验'], ['CLOSED', '已关闭']]; options.forEach(function (item) { select.appendChild(new Option(item[1], item[0])); }); if (options.some(function (item) { return item[0] === previous; })) select.value = previous; }",
    "quality unified status options",
  );
  next = replaceOnce(
    next,
    "  function defaultListStatus() { if (state.listType === 'feedback') return 'PENDING'; if (isSpecialist) return 'PENDING_ANALYSIS'; if (planningMode) return 'PENDING_ASSIGNMENT'; return ''; }",
    "  function defaultListStatus() { if (state.listType === 'feedback') return 'ACTION_REQUIRED'; if (isSpecialist) return 'PENDING_ANALYSIS'; return ''; }",
    "quality default status",
  );
  next = replaceOnce(
    next,
    "    var path; if (state.listType === 'feedback') { if (status) params.set('reviewStatus', status); path = '/api/workbench/quality/source?' + params.toString(); } else { if (status) params.set('status', status); path = '/api/workbench/quality/events?' + params.toString(); }",
    "    var path; if (state.listType === 'feedback') { if (state.metricSourceStatus) params.set('reviewStatus', state.metricSourceStatus); else if (status) params.set('reviewStatus', status); path = '/api/workbench/quality/source?' + params.toString(); } else { if (state.metricStatuses) params.set('statuses', state.metricStatuses); else if (status) params.set('status', status); if (state.metricManagerStage) params.set('managerStage', state.metricManagerStage); path = '/api/workbench/quality/events?' + params.toString(); }",
    "quality grouped list filters",
  );
  next = replaceAllChecked(next, "if (row.reportedEvent) return statusLabels[row.reportedEvent.status] || '已通报';", "if (row.reportedEvent && row.reportedEvent.status !== 'DRAFT') return '已通报';", "quality reported source label");
  next = replaceOnce(
    next,
    "if (data.reportEvent) return statusLabels[data.reportEvent.status] || '已通报';",
    "if (data.reportEvent && data.reportEvent.status !== 'DRAFT') return '已通报';",
    "quality reported source workspace label",
  );
  next = replaceOnce(
    next,
    "item.reportedEvent ? 'blue' : item.review && !item.sourceUpdatedSinceDecision ? 'green' : 'orange'",
    "item.reportedEvent && item.reportedEvent.status !== 'DRAFT' ? 'blue' : item.review && !item.sourceUpdatedSinceDecision ? 'green' : 'orange'",
    "quality draft source status tone",
  );
  next = replaceOnce(
    next,
    "  async function loadMetrics() { var eventBase = '/api/workbench/quality/events?page=1&pageSize=1'; var first = isSpecialist ? count(eventBase + '&status=PENDING_ANALYSIS') : planningMode ? count(eventBase + '&status=PENDING_ASSIGNMENT') : canReport ? count('/api/workbench/quality/source?page=1&pageSize=1&reviewStatus=PENDING') : Promise.resolve('—'); var second = isSpecialist ? count(eventBase + '&status=PENDING_ASSIGNMENT') : planningMode ? count(eventBase) : canReport ? count('/api/workbench/quality/source?page=1&pageSize=1&reviewStatus=REVIEWED') : Promise.resolve('—'); var values = await Promise.all([first, second, count(eventBase), count(eventBase + '&status=IN_PROGRESS'), count(eventBase + '&status=PENDING_QUALITY_REVIEW'), count(eventBase + '&status=CLOSED')]); ['qualityMetricPending','qualityMetricReviewed','qualityMetricEvents','qualityMetricProgress','qualityMetricFinal','qualityMetricClosed'].forEach(function (id, index) { document.getElementById(id).textContent = String(values[index]); }); }",
    "  async function loadMetrics() { var buttons = Array.from(document.querySelectorAll('[data-metric-count-path]')); var values = await Promise.all(buttons.map(function (button) { return count(button.getAttribute('data-metric-count-path')); })); buttons.forEach(function (button, index) { var valueNode = button.querySelector('[data-metric-value]'); if (valueNode) valueNode.textContent = String(values[index]); }); }",
    "quality generic metric counts",
  );
  next = replaceOnce(
    next,
    "state.listType = view; state.page = 1; activateListTab(); closeWorkspace(false); setUrl('', '', false); document.getElementById('qualityStatusFilter').value = button.getAttribute('data-metric-status') || '';",
    "state.listType = view; state.page = 1; state.metricSourceStatus = button.getAttribute('data-metric-source-status') || ''; state.metricStatuses = button.getAttribute('data-metric-statuses') || ''; state.metricManagerStage = button.getAttribute('data-metric-manager-stage') || ''; document.querySelectorAll('[data-metric-view]').forEach(function (item) { item.classList.toggle('is-active', item === button); }); activateListTab(); closeWorkspace(false); setUrl('', '', false); document.getElementById('qualityStatusFilter').value = '';",
    "quality metric click filters",
  );
  next = replaceOnce(
    next,
    "document.getElementById('qualityListFilters').addEventListener('submit', function (event) { event.preventDefault(); state.page = 1; void loadList(); });",
    "document.getElementById('qualityListFilters').addEventListener('submit', function (event) { event.preventDefault(); state.page = 1; state.metricSourceStatus = ''; state.metricStatuses = ''; state.metricManagerStage = ''; document.querySelectorAll('[data-metric-view]').forEach(function (item) { item.classList.remove('is-active'); }); void loadList(); });",
    "quality manual filters clear metrics",
  );
  next = replaceOnce(
    next,
    "function switchList(type, updateUrl) { if (type === 'feedback' && !canViewSources) return; state.listType = type; state.page = 1; document.getElementById('qualityRiskFilter').value = '';",
    "function switchList(type, updateUrl) { if (type === 'feedback' && !canViewSources) return; state.listType = type; state.page = 1; state.metricSourceStatus = ''; state.metricStatuses = ''; state.metricManagerStage = ''; document.querySelectorAll('[data-metric-view]').forEach(function (item) { item.classList.remove('is-active'); }); document.getElementById('qualityRiskFilter').value = '';",
    "quality list tab clears metric filters",
  );
  return next;
});

patchFile(`${appRoot}/src/web/quality-tracking-styles.ts`, (source) => {
  let next = replaceOnce(
    source,
    ".qpc-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }\n",
    ".qpc-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }\n"
      + ".qpc-metric-group { min-width: 0; padding: 12px; border: 1px solid var(--qpc-line); border-radius: 11px; background: #f7f9fb; }\n"
      + ".qpc-metric-group > header { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }\n"
      + ".qpc-metric-group > header strong { color: var(--qpc-ink); font-size: 14px; }\n"
      + ".qpc-metric-group > header span { color: var(--qpc-muted); font-size: 12px; }\n"
      + ".qpc-metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; }\n"
      + ".qpc-metric-group:only-child { grid-column: 1 / -1; }\n"
      + ".qpc-metric-group:only-child .qpc-metric-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }\n",
    "quality metric group styles",
  );
  next = replaceOnce(next, "  .qpc-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }", "  .qpc-metrics { grid-template-columns: 1fr; }\n  .qpc-metric-grid, .qpc-metric-group:only-child .qpc-metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }", "quality metric tablet styles");
  next = replaceOnce(next, "  .qpc-metrics, .qpc-fact-grid, .qpc-ai-grid { grid-template-columns: 1fr; }", "  .qpc-metrics, .qpc-metric-grid, .qpc-metric-group:only-child .qpc-metric-grid, .qpc-fact-grid, .qpc-ai-grid { grid-template-columns: 1fr; }", "quality metric mobile styles");
  return next;
});

patchFile(`${appRoot}/src/security/quality-capabilities.ts`, (source) => {
  let next = replaceOnce(
    source,
    '} from "./workbench-role-resolver";\n',
    '} from "./workbench-role-resolver";\n'
      + 'import { getAdminTestActor } from "../testing/admin-test-actors";\n',
    "quality capability import",
  );
  next = replaceOnce(
    next,
    "  if (!normalized) return [];\n  const configuredSpecialists",
    "  if (!normalized) return [];\n"
      + '  if (getAdminTestActor(normalized)?.userId === "QUALITY_TEST_AFTERSALES_001") {\n'
      + '    return ["QUALITY_TEST_SPECIALIST_001"];\n'
      + "  }\n"
      + "  const configuredSpecialists",
    "quality report relationship",
  );
  next = replaceOnce(
    next,
    '    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),\n',
    '    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),\n'
      + '    ...(getAdminTestActor("QUALITY_TEST_SPECIALIST_001")\n'
      + '      ? ["QUALITY_TEST_SPECIALIST_001"]\n'
      + "      : []),\n",
    "quality specialist list",
  );
  next = replaceOnce(
    next,
    "  }\n\n  const aftersalesManagers = envUserIds",
    "  }\n\n"
      + "  const testActor = getAdminTestActor(normalized);\n"
      + "  if (testActor) {\n"
      + '    const isAftersales = testActor.userId === "QUALITY_TEST_AFTERSALES_001";\n'
      + '    const isQualitySpecialist = testActor.userId === "QUALITY_TEST_SPECIALIST_001";\n'
      + "    return {\n"
      + "      baseRole,\n"
      + '      roles: isAftersales ? ["aftersales_manager"] : isQualitySpecialist ? ["quality_specialist"] : [],\n'
      + "      canAccessTracking: true,\n"
      + "      canAccessOpinions: false,\n"
      + "      canReportQuality: isAftersales,\n"
      + "      canAnalyzeQuality: isQualitySpecialist,\n"
      + "      isBusinessReadOnly: false,\n"
      + "      hasQualityManagement: isQualitySpecialist,\n"
      + "      isProjectManager: isAftersales,\n"
      + "      isQualitySpecialist,\n"
      + '      specialistUserIds: isAftersales ? ["QUALITY_TEST_SPECIALIST_001"] : [],\n'
      + "    };\n"
      + "  }\n\n"
      + "  const aftersalesManagers = envUserIds",
    "quality actor capabilities",
  );
  return next;
});

patchFile(`${appRoot}/src/quality/queries/quality-event-query.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { resolveQualityCapabilities } from "../../security/quality-capabilities";\n',
    'import { resolveQualityCapabilities } from "../../security/quality-capabilities";\n'
      + 'import { isAdminTestDataVisibleToViewer } from "../../testing/admin-test-actors";\n',
    "quality event query import",
  );
  next = replaceOnce(
    next,
    "    const row = loadEvent(input.eventId);\n    if (!row) return null;\n    const event = eventFromRow(row);",
    "    const row = loadEvent(input.eventId);\n"
      + "    if (!row) return null;\n"
      + "    if (!isAdminTestDataVisibleToViewer(input.viewerUserId, Number(row.is_test ?? 0) === 1)) return null;\n"
      + "    const event = eventFromRow(row);",
    "quality event detail scope",
  );
  next = replaceOnce(
    next,
    "    return rows.map((row) => {\n      const event = eventFromRow(row) as QualityEventListItem;",
    "    return rows\n"
      + "      .filter((row) => isAdminTestDataVisibleToViewer(input.viewerUserId, Number(row.is_test ?? 0) === 1))\n"
      + "      .map((row) => {\n"
      + "      const event = eventFromRow(row) as QualityEventListItem;",
    "quality event list scope",
  );
  return next;
});

patchFile(`${appRoot}/src/quality/infra/quality-read-store.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";\n',
    'import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";\n'
      + 'import { isAdminTestDataVisibleToViewer } from "../../testing/admin-test-actors";\n',
    "quality read store import",
  );
  next = replaceOnce(
    next,
    "  function listSourceRows(input: {\n    q?: string;",
    "  function listSourceRows(input: {\n"
      + "    viewerUserId?: string;\n"
      + "    q?: string;",
    "quality source viewer input",
  );
  next = replaceOnce(
    next,
    '    reviewStatus?: "PENDING" | "REVIEWED" | "REPORTED";\n',
    '    reviewStatus?: "PENDING" | "REVIEWED" | "REPORTED" | "ACTION_REQUIRED" | "COMPLETED";\n',
    "quality source review-status type",
  );
  next = replaceOnce(
    next,
    "    const filtered = rawRows.filter((row) => {\n      if (input.reported === true",
    "    const filtered = rawRows.filter((row) => {\n"
      + "      if (input.viewerUserId && !isAdminTestDataVisibleToViewer(\n"
      + "        input.viewerUserId,\n"
      + '        String(row.sheet_id ?? "") === "QUALITY_TEST_ISOLATED",\n'
      + "      )) return false;\n"
      + "      if (input.reported === true",
    "quality source list scope",
  );
  next = replaceOnce(
    next,
    "      const assessmentCurrent = row.assessment_version != null\n"
      + "        && Number(row.assessment_source_version) === Number(row.source_version);\n"
      + "      if (input.reviewStatus === \"PENDING\"\n"
      + "        && (assessmentCurrent || row.reported_event_id != null)) return false;\n"
      + "      if (input.reviewStatus === \"REVIEWED\" && !assessmentCurrent) return false;\n"
      + "      if (input.reviewStatus === \"REPORTED\" && row.reported_event_id == null) return false;",
    "      const assessmentCurrent = row.assessment_version != null\n"
      + "        && Number(row.assessment_source_version) === Number(row.source_version);\n"
      + "      const reviewCurrent = row.review_status != null\n"
      + "        && String(row.review_source_content_hash ?? \"\") === String(row.content_hash ?? \"\");\n"
      + "      const linkedToSubmittedEvent = row.reported_event_id != null\n"
      + "        && String(row.reported_event_status ?? \"\") !== \"DRAFT\";\n"
      + "      if (input.reviewStatus === \"PENDING\"\n"
      + "        && (assessmentCurrent || row.reported_event_id != null)) return false;\n"
      + "      if (input.reviewStatus === \"REVIEWED\" && !assessmentCurrent) return false;\n"
      + "      if (input.reviewStatus === \"REPORTED\" && !linkedToSubmittedEvent) return false;\n"
      + "      if (input.reviewStatus === \"ACTION_REQUIRED\"\n"
      + "        && (linkedToSubmittedEvent\n"
      + "          || (reviewCurrent && String(row.review_status) === \"ORDINARY\"))) return false;\n"
      + "      if (input.reviewStatus === \"COMPLETED\"\n"
      + "        && !(linkedToSubmittedEvent\n"
      + "          || (reviewCurrent && String(row.review_status) === \"ORDINARY\"))) return false;",
    "quality source action/completed filters",
  );
  return next;
});

patchFile(`${appRoot}/src/quality/queries/quality-review-query.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";\n',
    'import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";\n'
      + 'import { isAdminTestDataVisibleToViewer } from "../../testing/admin-test-actors";\n',
    "quality review query import",
  );
  next = replaceOnce(
    next,
    "  function list(input?: {\n    scope?: QualityReviewScope;",
    "  function list(input?: {\n"
      + "    viewerUserId?: string;\n"
      + "    scope?: QualityReviewScope;",
    "quality review viewer input",
  );
  next = replaceOnce(
    next,
    "    const eligible = rows.flatMap((row) => {\n      const normalized",
    "    const eligible = rows.flatMap((row) => {\n"
      + "      if (input?.viewerUserId && !isAdminTestDataVisibleToViewer(\n"
      + "        input.viewerUserId,\n"
      + '        String(row.sheet_id ?? "") === "QUALITY_TEST_ISOLATED",\n'
      + "      )) return [];\n"
      + "      const normalized",
    "quality review list scope",
  );
  return next;
});

patchFile(`${appRoot}/src/quality/assignments/quality-assignment-service.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import { listWorkbenchManagerIds } from "../../security/workbench-manager-whitelist";\n',
    'import { listWorkbenchManagerIds } from "../../security/workbench-manager-whitelist";\n'
      + 'import { getAdminTestActor } from "../../testing/admin-test-actors";\n',
    "quality assignment test manager import",
  );
  next = replaceOnce(
    next,
    '    if (!managerIds().has(userId)) throw new Error("目标人员不在主管名单中");',
    '    if (!managerIds().has(userId) && getAdminTestActor(userId)?.workbenchRole !== "manager") {\n'
      + '      throw new Error("目标人员不在主管名单中");\n'
      + "    }",
    "quality assignment test manager gate",
  );
  return next;
});

patchFile(`${appRoot}/src/web/quality-http.ts`, (source) => {
  let next = replaceOnce(
    source,
    'import type { IncomingMessage, ServerResponse } from "node:http";\n',
    'import type { IncomingMessage, ServerResponse } from "node:http";\n'
      + 'import { DatabaseSync } from "node:sqlite";\n',
    "quality http sqlite import",
  );
  next = replaceOnce(
    next,
    'import { resolveQualityCapabilities } from "../security/quality-capabilities";\n',
    'import { resolveQualityCapabilities } from "../security/quality-capabilities";\n'
      + 'import { resolveWorkbenchSqlitePath } from "../infra/workbench-db-path";\n'
      + "import {\n"
      + "  isAdminTestActorUserId,\n"
      + "  isAdminTestDataVisibleToViewer,\n"
      + "  isAdminTestSourceKey,\n"
      + "  isAdminTestSystemEnabled,\n"
      + "  getAdminTestActor,\n"
      + '} from "../testing/admin-test-actors";\n',
    "quality http test boundary imports",
  );
  next = replaceOnce(
    next,
    "}\n\nasync function readJsonBody(req: IncomingMessage",
    "}\n\n"
      + "type QualityManagerMetricStage = \"ACCEPT\" | \"DELEGATE\" | \"EXECUTION\" | \"REVIEW\" | \"CLOSED\";\n\n"
      + "function qualityManagerMetricStage(input: { db: DatabaseSync; eventId: string; eventStatus: string; managerUserId: string }): QualityManagerMetricStage | null {\n"
      + "  const own = input.db.prepare(`SELECT node_id,parent_node_id,status FROM quality_assignment_nodes WHERE event_id=? AND assignee_user_id=? AND status NOT IN ('REJECTED','CANCELLED') ORDER BY CASE WHEN parent_node_id IS NULL THEN 0 ELSE 1 END,depth,created_at,node_id LIMIT 1`).get(input.eventId,input.managerUserId) as Record<string,unknown> | undefined;\n"
      + "  if (!own) return null;\n"
      + "  if (input.eventStatus === \"CLOSED\") return \"CLOSED\";\n"
      + "  if (String(own.status) === \"PENDING_ACCEPTANCE\") return \"ACCEPT\";\n"
      + "  const children = input.db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='PENDING_PARENT_REVIEW' THEN 1 ELSE 0 END) AS pending_review FROM quality_assignment_nodes WHERE parent_node_id=? AND status NOT IN ('REJECTED','CANCELLED')`).get(String(own.node_id)) as Record<string,unknown>;\n"
      + "  if (Number(children.pending_review ?? 0) > 0 || (input.eventStatus === \"PENDING_PRIMARY_REVIEW\" && own.parent_node_id == null)) return \"REVIEW\";\n"
      + "  if (Number(children.total ?? 0) === 0 && [\"IN_PROGRESS\",\"RETURNED\"].includes(String(own.status))) return \"DELEGATE\";\n"
      + "  return \"EXECUTION\";\n"
      + "}\n\n"
      + "function qualityResourceIsTest(kind: string, resourceId: string): boolean | undefined {\n"
      + "  const db = new DatabaseSync(resolveWorkbenchSqlitePath(), { readOnly: true });\n"
      + "  try {\n"
      + "    let row: Record<string, unknown> | undefined;\n"
      + '    if (kind === "event") row = db.prepare("SELECT is_test FROM quality_events WHERE id=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + '    else if (kind === "source") row = db.prepare("SELECT CASE WHEN sheet_id=\'QUALITY_TEST_ISOLATED\' THEN 1 ELSE 0 END AS is_test FROM quality_source_rows WHERE source_key=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + '    else if (kind === "node") row = db.prepare("SELECT e.is_test FROM quality_assignment_nodes n JOIN quality_events e ON e.id=n.event_id WHERE n.node_id=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + '    else if (kind === "evidence") row = db.prepare("SELECT e.is_test FROM quality_evidence x JOIN quality_events e ON e.id=x.event_id WHERE x.evidence_id=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + '    else if (kind === "file") row = db.prepare("SELECT e.is_test FROM quality_report_files f JOIN quality_events e ON e.id=f.event_id WHERE f.id=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + '    else if (kind === "notification") row = db.prepare("SELECT e.is_test FROM quality_notification_outbox o JOIN quality_events e ON e.id=o.event_id WHERE o.notification_id=?").get(resourceId) as Record<string, unknown> | undefined;\n'
      + "    return row == null ? undefined : Number(row.is_test ?? 0) === 1;\n"
      + "  } finally {\n"
      + "    db.close();\n"
      + "  }\n"
      + "}\n\n"
      + "function assertAdminTestResourceScope(userId: string, pathname: string): void {\n"
      + "  if (!isAdminTestSystemEnabled()) return;\n"
      + "  const testViewer = isAdminTestActorUserId(userId);\n"
      + "  if (testViewer && (pathname === \"/api/workbench/quality/source/sync\"\n"
      + "    || pathname.startsWith(\"/api/workbench/quality/candidates\")\n"
      + "    || pathname.startsWith(\"/api/workbench/quality/notifications/\"))) {\n"
      + '    throw new Error("隔离测试身份不能操作真实同步、候选或通知重试");\n'
      + "  }\n"
      + "  const checks: Array<{ kind: string; id: string }> = [];\n"
      + "  const event = pathname.match(/^\\/api\\/workbench\\/quality\\/events\\/([^/]+)/);\n"
      + "  if (event && event[1] !== \"drafts\") checks.push({ kind: \"event\", id: decodeURIComponent(event[1]!) });\n"
      + "  const assessment = pathname.match(/^\\/api\\/workbench\\/quality\\/assessments\\/([^/]+)/);\n"
      + "  if (assessment) checks.push({ kind: \"source\", id: decodeURIComponent(assessment[1]!) });\n"
      + "  const sourcePath = pathname.match(/^\\/api\\/workbench\\/quality\\/source\\/([^/]+)/);\n"
      + "  if (sourcePath && sourcePath[1] !== \"sync\") checks.push({ kind: \"source\", id: decodeURIComponent(sourcePath[1]!) });\n"
      + "  const node = pathname.match(/^\\/api\\/workbench\\/(?:manager\\/quality-nodes|quality\\/nodes)\\/([^/]+)/);\n"
      + "  if (node) checks.push({ kind: \"node\", id: decodeURIComponent(node[1]!) });\n"
      + "  const evidence = pathname.match(/^\\/api\\/workbench\\/quality\\/evidence\\/([^/]+)/);\n"
      + "  if (evidence) checks.push({ kind: \"evidence\", id: decodeURIComponent(evidence[1]!) });\n"
      + "  const file = pathname.match(/^\\/api\\/workbench\\/quality\\/files\\/([^/]+)/);\n"
      + "  if (file) checks.push({ kind: \"file\", id: decodeURIComponent(file[1]!) });\n"
      + "  for (const check of checks) {\n"
      + "    const isTestRecord = qualityResourceIsTest(check.kind, check.id);\n"
      + "    if (isTestRecord != null && !isAdminTestDataVisibleToViewer(userId, isTestRecord)) {\n"
      + '      throw new Error("隔离测试数据不可跨范围访问");\n'
      + "    }\n"
      + "  }\n"
      + "}\n\n"
      + "async function readJsonBody(req: IncomingMessage",
    "quality http resource scope helpers",
  );
  next = replaceOnce(
    next,
    "    return directory.listManagerPerspectives();",
    "    return directory.listManagerPerspectives()\n"
      + "      .filter((item) => !isAdminTestActorUserId(item.managerUserId));",
    "quality manager perspective isolation",
  );
  next = replaceOnce(
    next,
    "    const caps = resolveQualityCapabilities(session.userId);\n    const aftersales",
    "    const caps = resolveQualityCapabilities(session.userId);\n"
      + "    assertAdminTestResourceScope(session.userId, url.pathname);\n"
      + "    const aftersales",
    "quality http scope entry",
  );
  next = replaceAllChecked(
    next,
    "const planningManager = caps.baseRole === \"manager\"\n      && hasQualityPlanningHandoff(session.userId);",
    "const planningManager = caps.baseRole === \"manager\"\n"
      + "      && (hasQualityPlanningHandoff(session.userId)\n"
      + "        || getAdminTestActor(session.userId)?.impersonationKind === \"manager\");",
    "quality test supervisor planning mode",
  );
  next = replaceOnce(
    next,
    "        const data = query.list({\n          scope:",
    "        const data = query.list({\n"
      + "          viewerUserId: session.userId,\n"
      + "          scope:",
    "quality review query viewer",
  );
  next = replaceOnce(
    next,
    "          data: store.listSourceRows({\n            q:",
    "          data: store.listSourceRows({\n"
      + "            viewerUserId: session.userId,\n"
      + "            q:",
    "quality source query viewer",
  );
  next = replaceOnce(
    next,
    '            reviewStatus: z.enum(["PENDING", "REVIEWED", "REPORTED"])\n',
    '            reviewStatus: z.enum(["PENDING", "REVIEWED", "REPORTED", "ACTION_REQUIRED", "COMPLETED"])\n',
    "quality source review-status api",
  );
  next = replaceOnce(
    next,
    "      if (!listWorkbenchManagerIds().has(session.userId)) {",
    "      if (!listWorkbenchManagerIds().has(session.userId)\n"
      + "        && !isAdminTestActorUserId(session.userId)) {",
    "quality test manager access",
  );
  next = replaceOnce(
    next,
    "        const status = url.searchParams.get(\"status\")?.trim().toUpperCase();\n"
      + "        const riskLevel = url.searchParams.get(\"riskLevel\")?.trim().toUpperCase();\n"
      + "        const events = store.listEvents({ viewerUserId }).filter((event) => {\n"
      + "          if (status && event.status !== status) return false;\n"
      + "          if (riskLevel && (riskLevel === \"HIGH\"\n"
      + "            ? ![\"HIGH\", \"CRITICAL\"].includes(event.urgency ?? \"\")\n"
      + "            : event.urgency !== riskLevel)) return false;\n"
      + "          if (!query) return true;\n"
      + "          return [\n"
      + "            event.eventNo,\n"
      + "            event.title,\n"
      + "            event.problemStatus,\n"
      + "            event.deviceModel,\n"
      + "            event.deviceSerial,\n"
      + "            event.catheterBatch,\n"
      + "            event.initialCategory,\n"
      + "          ].some((value) => String(value ?? \"\").toLocaleLowerCase(\"zh-CN\").includes(query));\n"
      + "        });",
    "        const status = url.searchParams.get(\"status\")?.trim().toUpperCase();\n"
      + "        const statuses = new Set(String(url.searchParams.get(\"statuses\") ?? \"\").split(\",\").map((item) => item.trim().toUpperCase()).filter(Boolean));\n"
      + "        const managerStage = String(url.searchParams.get(\"managerStage\") ?? \"\").trim().toUpperCase() as QualityManagerMetricStage | \"\";\n"
      + "        const riskLevel = url.searchParams.get(\"riskLevel\")?.trim().toUpperCase();\n"
      + "        const stageDb = managerStage ? new DatabaseSync(resolveWorkbenchSqlitePath(), { readOnly: true }) : null;\n"
      + "        let events;\n"
      + "        try {\n"
      + "          events = store.listEvents({ viewerUserId }).filter((event) => {\n"
      + "            if (status && event.status !== status) return false;\n"
      + "            if (statuses.size > 0 && !statuses.has(event.status)) return false;\n"
      + "            if (managerStage && stageDb && qualityManagerMetricStage({ db: stageDb, eventId: event.eventId, eventStatus: event.status, managerUserId: viewerUserId }) !== managerStage) return false;\n"
      + "            if (riskLevel && (riskLevel === \"HIGH\"\n"
      + "              ? ![\"HIGH\", \"CRITICAL\"].includes(event.urgency ?? \"\")\n"
      + "              : event.urgency !== riskLevel)) return false;\n"
      + "            if (!query) return true;\n"
      + "            return [event.eventNo,event.title,event.problemStatus,event.deviceModel,event.deviceSerial,event.catheterBatch,event.initialCategory]\n"
      + "              .some((value) => String(value ?? \"\").toLocaleLowerCase(\"zh-CN\").includes(query));\n"
      + "          });\n"
      + "        } finally {\n"
      + "          stageDb?.close();\n"
      + "        }",
    "quality event grouped filters",
  );
  next = replaceOnce(
    next,
    "          ? sourceKeys(body.sourceKeys)\n          : [];\n        result = keys.length > 0",
    "          ? sourceKeys(body.sourceKeys)\n"
      + "          : [];\n"
      + "        if (isAdminTestSystemEnabled()) {\n"
      + "          if (keys.some((key) => !isAdminTestDataVisibleToViewer(session.userId, isAdminTestSourceKey(key)))) {\n"
      + '            throw new Error("隔离测试来源不可跨范围创建事件");\n'
      + "          }\n"
      + "          if (isAdminTestActorUserId(session.userId) && keys.length === 0) {\n"
      + '            throw new Error("隔离测试身份不能创建无来源手工事件");\n'
      + "          }\n"
      + "        }\n"
      + "        result = keys.length > 0",
    "quality draft source scope",
  );
  next = replaceOnce(
    next,
    "          if (action === \"assign-primary\") {\n            const result = await service.assignPrimary({",
    "          if (action === \"assign-primary\") {\n"
      + "            const managerUserId = z.string().trim().min(1).max(200).parse(body.primaryManagerUserId);\n"
      + "            if (isAdminTestSystemEnabled()\n"
      + "              && !isAdminTestDataVisibleToViewer(session.userId, isAdminTestActorUserId(managerUserId))) {\n"
      + '              throw new Error("隔离测试主管不可跨范围选择");\n'
      + "            }\n"
      + "            const result = await service.assignPrimary({",
    "quality primary manager scope",
  );
  next = replaceOnce(
    next,
    "              primaryManagerUserId: z.string().trim().min(1).max(200).parse(body.primaryManagerUserId),",
    "              primaryManagerUserId: managerUserId,",
    "quality primary manager parsed value",
  );
  next = replaceOnce(
    next,
    "        if (req.method === \"POST\" && nodeAction?.[2] === \"delegate\") {\n          const result = await service.delegateNode({",
    "        if (req.method === \"POST\" && nodeAction?.[2] === \"delegate\") {\n"
      + "          const assigneeUserId = z.string().trim().min(1).max(200).parse(body.assigneeUserId);\n"
      + "          if (isAdminTestSystemEnabled()\n"
      + "            && !isAdminTestDataVisibleToViewer(session.userId, isAdminTestActorUserId(assigneeUserId))) {\n"
      + '            throw new Error("隔离测试执行人不可跨范围选择");\n'
      + "          }\n"
      + "          const result = await service.delegateNode({",
    "quality delegate scope",
  );
  next = replaceOnce(
    next,
    "            assigneeUserId: z.string().trim().min(1).max(200).parse(body.assigneeUserId),",
    "            assigneeUserId,",
    "quality delegate parsed value",
  );
  return next;
});

console.log("[admin-test-overlay] exact yesterday sources patched successfully");
