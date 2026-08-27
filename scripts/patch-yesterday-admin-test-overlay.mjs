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
      + 'import { isAdminTestActorUserId } from "../testing/admin-test-actors";\n',
    "assignment import",
  );
  next = replaceOnce(
    next,
    "        const redirectTo = defaultPathForRole(next.role, next.userId);",
    "        const redirectTo = isAdminTestActorUserId(next.userId)\n"
      + '          ? "/workbench/quality"\n'
      + "          : defaultPathForRole(next.role, next.userId);",
    "assignment redirect",
  );
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
    "    const filtered = rawRows.filter((row) => {\n      if (input.reported === true",
    "    const filtered = rawRows.filter((row) => {\n"
      + "      if (input.viewerUserId && !isAdminTestDataVisibleToViewer(\n"
      + "        input.viewerUserId,\n"
      + '        String(row.sheet_id ?? "") === "QUALITY_TEST_ISOLATED",\n'
      + "      )) return false;\n"
      + "      if (input.reported === true",
    "quality source list scope",
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
      + '} from "../testing/admin-test-actors";\n',
    "quality http test boundary imports",
  );
  next = replaceOnce(
    next,
    "}\n\nasync function readJsonBody(req: IncomingMessage",
    "}\n\n"
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
    "      if (!listWorkbenchManagerIds().has(session.userId)) {",
    "      if (!listWorkbenchManagerIds().has(session.userId)\n"
      + "        && !isAdminTestActorUserId(session.userId)) {",
    "quality test manager access",
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
