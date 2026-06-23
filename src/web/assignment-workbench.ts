import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAssignmentDraftDir,
  resolveEmployeeProfileDir,
} from "../infra/assignment-env";
import {
  createPlanSessionStore,
  hashChatKey,
  resolvePlanSessionDir,
  type PlanSession,
} from "../infra/plan-session-store";
import {
  createWorkbenchFormalTaskStore,
  type SubtaskOpenDeclineKind,
  type WorkbenchTaskStatus,
} from "../infra/workbench-formal-task-store";
import { presentDueBarState, presentDueLabel, presentDueProgress } from "../infra/due-present";
import { buildSubtaskLabelResolver, presentWorkbenchTaskEvent } from "../infra/workbench-event-present";
import {
  buildThreadListItem,
  draftHasTasks,
  planSessionHasDraft,
  inferConversationTitleFromSession,
  truncateConversationPreview,
} from "../infra/conversation-present";
import { buildWorkbenchTurnDisplay } from "../agent/workbench/conversation-turn-display";
import { runWorkbenchDraftRevision } from "../agent/workbench/draft-revision";
import { prevalidateWorkbenchDraftRevision } from "../agent/workbench/draft-revise-prevalidate";
import { normalizeDraftTasksForSession } from "../agent/draft-person-fields";
import {
  applyDraftScalarsFromForm,
  draftToExcelRows,
} from "./draft-excel-grid";
import { resolveMessageDisplayContent } from "../view/resolve-message-display-content";
import { buildManagerChatDeepLink } from "../view/workbench-chat-link";
import {
  createSideThreadSession,
  deleteSideThreadSession,
  findMainThreadSession,
  listManagerConversationSessions,
  loadAllPlanSessions,
  isSideThreadSession,
  preserveThreadIdentityOnSave,
  renameSideThreadSession,
  resolveConversationThread,
} from "./conversation-thread-resolver";
import { formatWorkbenchAssistantHtml } from "./workbench-markdown-lite";
import { loadQwenPlannerConfigFromEnv } from "../agent/demo/qwen-planner";
import {
  buildManagerQwenClientConfig,
  runManagerOrchestratorTurn,
} from "../agent/manager-orchestrator-turn";
import type { KnownFactsStore } from "../agent/tools/update-known-facts";
import {
  DingTalkAuthError,
  type DingTalkAuthClient,
  createDingTalkAuthClient,
} from "../integrations/dingtalk/dingtalk-auth";
import { buildWorkbenchJsapiConfig } from "../integrations/dingtalk/dingtalk-jsapi-config";
import {
  createWorkbenchPublishNotifier,
  type WorkbenchPublishNotifier,
} from "../integrations/dingtalk/workbench-notify";
import { notifyManagerOfEmployeeActionAfterUpdate } from "../integrations/dingtalk/manager-notify-on-employee-action";
import { notifyEmployeeOfManagerActionAfterUpdate } from "../integrations/dingtalk/employee-notify-on-manager-action";
import { notifyEmployeeTodoOnAcceptAfterUpdate } from "../integrations/dingtalk/employee-todo-on-accept";
import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createDingTalkContactSyncService } from "../infra/dingtalk-contact-sync";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { executeReassignWithSideEffects } from "../agent/workbench/reassign-with-side-effects";
import { voidFireReassignAssigneeNotify } from "../agent/workbench/reassign-notify-side-effect";
import {
  appendMemoryEvents,
  loadMemoryContextForPlan,
} from "../infra/workbench-memory-store";
import { listDynamicWorkbenchManagers, setDynamicWorkbenchManager } from "../security/workbench-manager-directory";
import {
  listDynamicWorkbenchPortfolioManagers,
  setDynamicWorkbenchPortfolioManager,
} from "../security/workbench-portfolio-directory";
import { listWorkbenchProjectPortfolioUserIds } from "../security/workbench-project-portfolio";
import { listWorkbenchManagerIds } from "../security/workbench-manager-whitelist";
import {
  allowsEmployeeSession,
  allowsManagerSession,
  defaultLoginViewRole,
  defaultRedirectForView,
  normalizeWorkbenchSession,
  refreshSessionFromWhitelist,
  resolveWorkbenchCapabilities,
} from "../security/workbench-capabilities";
import { isWorkbenchProjectPortfolioEnabled } from "../security/workbench-project-portfolio";
import { resolveWorkbenchRole, type WorkbenchRole } from "../security/workbench-role-resolver";
import { verifyAssignmentEntry } from "../security/web-entry-token";
import { parseRosterFile } from "../agent/assignment/roster-parser";
import { readMultipartSingleFile } from "./multipart-single-file";
import { renderAdminPermissionsPage, renderAdminWorkbenchPage } from "./admin-workbench-pages";
import { renderAdminOpsDashboardPage } from "./admin-ops-dashboard-page";
import { handleOpsDashboardApi } from "./ops-dashboard-api";
import {
  buildRecentContextFromHistory,
  recordAgentTurnMetricsAsync,
} from "../agent/online-eval/record-turn-metrics";
import { publishResultSucceeded } from "../agent/publish-helpers";
import {
  renderManagerChatPage,
  renderManagerTasksPage,
} from "./manager-workbench-pages";
import { renderManagerProjectsPage } from "./manager-projects-pages";
import { renderManagerDashboardPage } from "./manager-dashboard-page";
import { renderPerformanceDashboardPage } from "./performance-dashboard-page";
import { renderDailyReportsPage } from "./daily-reports-page";
import { buildDailyReportsHttpPayload, parseDailyReportsViewParam } from "./daily-reports-api";
import {
  addToRoster,
  getRosterView,
  removeFromRoster,
  searchOrgCandidates,
} from "./daily-reports-roster";
import {
  listProjectGroupMembers,
  updateProjectGroupAssignments,
} from "./daily-reports-project-groups";
import {
  canManageProjectViewRoster,
  canSearchProjectViewOrgContacts,
  getProjectViewRosterPayload,
  mutateProjectViewRoster,
  parseDailyReportsProjectViewDiscoverPath,
  parseDailyReportsProjectViewRosterPath,
  rediscoverProjectViewRoster,
} from "./daily-reports-project-view-roster";
import { loadDailyReportDigestConfig, configHasLegacyDailyReportEmployees } from "../agent/daily-report-digest/daily-report-config";
import { isDailyReportsPageEnabled } from "../agent/daily-report-digest/daily-reports-page-flag";
import {
  buildPerformanceDashboardPayload,
  buildPerformanceEmployeeDetailPayload,
  isPerformanceDashboardEnabled,
  parsePerformanceConversationHistory,
  resolvePerformanceScopeFromSession,
  parsePerformanceQueryInput,
} from "./performance-dashboard-api";
import { runPerformanceAgentTurn } from "../agent/performance-agent-turn";
import {
  buildCompetencyEvalClientConfig,
  runCompetencyEvalTurn,
} from "../agent/competency-eval/competency-eval-agent-turn";
import {
  buildCompetencyEvalRubricsPayload,
  buildCompetencyEvalSessionsPayload,
  handleCompetencyEvalRubricDelete,
  handleCompetencyEvalRubricUpload,
  handleCompetencyEvalSessionActivate,
  handleCompetencyEvalSessionCreate,
  handleCompetencyEvalSessionDelete,
  handleCompetencyEvalSessionGet,
  handleCompetencyEvalSessionSave,
  isCompetencyEvalPageEnabled,
  parseCompetencyEvalConversationHistory,
  parseCompetencyEvalRubricIdFromPath,
  parseCompetencyEvalSessionActivatePath,
  requireCompetencyEvalSession,
} from "./competency-eval-api";
import { parseCompEvalSessionIdFromPath } from "../agent/competency-eval/competency-eval-session-store";
import { renderCompetencyEvalPage } from "./competency-eval-page";
import { isCompetencyEvalUser } from "../agent/competency-eval/competency-eval-access";
import { renderManagerMeetingImportPage } from "./manager-meeting-import-page";
import {
  handleMeetingImportAnalyze,
  handleMeetingImportCommit,
  handleMeetingImportParse,
} from "./meeting-import-api";
import { renderManagerTaskIntakePage } from "./manager-task-intake-page";
import { handleTaskIntakeAppend, handleTaskIntakeCommit, handleTaskIntakePreview } from "./task-intake-api";
import { isTaskIntakeEnabled } from "../agent/task-intake/task-intake-flag";
import { isMeetingImportEnabled } from "../agent/meeting-import/meeting-import-flag";
import {
  buildWeeklyAdvisorHttpPayload,
  buildWeeklyDashboardHttpPayload,
} from "./weekly-dashboard-api";
import {
  buildManagerProjectDetailResponse,
  buildManagerProjectsListResponse,
  enrichManagerTasksForApi,
} from "./workbench-project-api";
import { renderEmployeeWorkbenchPage } from "./employee-workbench-pages";
import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { renderWorkbenchPage } from "./workbench-shell";
import { logStructured } from "../infra/logger";
import {
  recordWorkbenchApiActivityAsync,
  recordWorkbenchUsageAsync,
  resolveWorkbenchSurfaceFromPath,
  resolveWorkbenchSurfaceFromRole,
} from "../infra/record-workbench-activity";
import { sendSubtaskReminder } from "../agent/reminders/reminder-send";
import {
  attentionBadgeClass,
  deriveManagerAttentionLabel,
  EMPLOYEE_KEY_EVENT_TYPES,
  type SubtaskAttentionInput,
} from "./workbench-attention";
import { buildWorkbenchFmtTimeClientJs } from "./workbench-datetime";
import { buildWorkbenchContactComboClientJs } from "./workbench-contact-combo-snippet";
import { buildSubtaskPlanningFieldsClientJs } from "./workbench-subtask-fields-snippet";
import type { WorkbenchSession } from "./assignment-workbench-session-types";
import {
  checkExternalLoginRateLimit,
  EXTERNAL_WORKBENCH_LOGIN_PATH,
  buildExternalLoginUrl,
  externalLoginRateLimitKey,
  isExternalPasswordSession,
  isWorkbenchExternalLoginEnabled,
  readExternalLoginNextFromUrl,
  renderExternalLoginHtml,
  resetExternalLoginRateLimit,
  resolveWorkbenchLogoutRedirect,
  sanitizeWorkbenchNextPath,
  shouldUseSecureWorkbenchCookies,
} from "./external-workbench-login";
import { renderWorkbenchDingTalkEntryHtml } from "./workbench-login-shell";

const WORKBENCH_LOGIN_PATH = "/workbench";

const MANAGER_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/manager/projects",
  "/workbench/manager/tasks",
  "/workbench/manager/dashboard",
  "/workbench/manager/performance",
  "/workbench/manager/daily-reports",
  "/workbench/manager/chat",
  "/workbench/manager/meeting-import",
  "/workbench/manager/task-intake",
  "/workbench/manager/competency-eval",
  "/workbench/manager/task",
  "/workbench/manager/task/events",
]);

const EMPLOYEE_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/employee",
  "/workbench/employee/new",
  "/workbench/employee/current",
  "/workbench/employee/daily-reports",
  "/workbench/employee/task",
  "/workbench/employee/task/events",
]);
const ADMIN_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/admin",
  "/workbench/admin/ops",
  "/workbench/admin/performance",
  "/workbench/admin/daily-reports",
  "/workbench/admin/permissions",
  "/workbench/admin/task",
  "/workbench/admin/task/events",
]);

/** Legacy bookmarks → canonical paths (302 after session + role check). */
const LEGACY_WORKBENCH_REDIRECTS: Record<string, string> = {
  "/workbench/manager": "/workbench/manager/tasks",
  "/workbench/in-progress": "/workbench/manager/tasks",
  "/workbench/conversation": "/workbench/manager/chat",
  "/workbench/admin#permissions": "/workbench/admin/permissions",
};

function legacyRedirectRequiresManager(fromPath: string): boolean {
  return (
    fromPath === "/workbench/manager" ||
    fromPath === "/workbench/in-progress" ||
    fromPath === "/workbench/conversation"
  );
}

function isWorkbenchHtmlPath(pathname: string): boolean {
  return (
    pathname === "/workbench/daily-reports" ||
    MANAGER_WORKBENCH_PAGE_PATHS.has(pathname) ||
    EMPLOYEE_WORKBENCH_PAGE_PATHS.has(pathname) ||
    ADMIN_WORKBENCH_PAGE_PATHS.has(pathname) ||
    pathname in LEGACY_WORKBENCH_REDIRECTS
  );
}

function isEmployeeWorkbenchHtmlPath(pathname: string): boolean {
  return EMPLOYEE_WORKBENCH_PAGE_PATHS.has(pathname);
}

function resolveUnauthenticatedWorkbenchLoginRedirect(
  pathname: string,
  search: string,
): string {
  if (isEmployeeWorkbenchHtmlPath(pathname) && isWorkbenchExternalLoginEnabled()) {
    return buildExternalLoginUrl(`${pathname}${search}`);
  }
  return WORKBENCH_LOGIN_PATH;
}

interface PlanSummary {
  planId: string;
  generatedAt?: string;
  assignmentsCount: number;
  promptVersion?: string;
  modelName?: string;
}

interface SessionSummary {
  planId: string;
  updatedAt?: string;
  senderStaffId?: string;
  knownFactsCount: number;
  conversationTurns: number;
}

const WORKBENCH_COOKIE_NAME = "wb_session";
const WORKBENCH_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ACTION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const seenActionKeys = new Map<string, { action: string; at: number }>();

const assignmentWorkbenchDir = dirname(fileURLToPath(import.meta.url));

function resolveWorkbenchDdLoginBundlePath(): string {
  return join(assignmentWorkbenchDir, "..", "..", "dist", "workbench-dd-login.js");
}

function resolveWorkbenchDraftGridBundlePath(): string {
  return join(assignmentWorkbenchDir, "..", "..", "dist", "workbench-draft-grid.js");
}

function resolvePerformanceChatMarkdownBundlePath(): string {
  return join(assignmentWorkbenchDir, "..", "..", "dist", "performance-chat-markdown.js");
}

export const WORKBENCH_DRAFT_REVISE_HISTORY_USER = "[工作台] 已提交草案表格编辑";

const planSessionStore = createPlanSessionStore();
const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
const qwenConfig = loadQwenPlannerConfigFromEnv();
let formalTaskStore: ReturnType<typeof createWorkbenchFormalTaskStore> | undefined;
let dingtalkAuthClient: DingTalkAuthClient = createDingTalkAuthClient();
let workbenchPublishNotifier: WorkbenchPublishNotifier = createWorkbenchPublishNotifier();
function withPeopleDirectoryStore<T>(fn: (store: ReturnType<typeof createPeopleDirectoryStore>) => T): T {
  const store = createPeopleDirectoryStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function getFormalTaskStore(): ReturnType<typeof createWorkbenchFormalTaskStore> {
  formalTaskStore = formalTaskStore ?? createWorkbenchFormalTaskStore();
  return formalTaskStore;
}

export function __setDingTalkAuthClientForTest(client?: DingTalkAuthClient): void {
  dingtalkAuthClient = client ?? createDingTalkAuthClient();
}

export function __setWorkbenchPublishNotifierForTest(notifier?: WorkbenchPublishNotifier): void {
  workbenchPublishNotifier = notifier ?? createWorkbenchPublishNotifier();
}

export function __resetWorkbenchStoresForTest(): void {
  formalTaskStore = undefined;
  workbenchPublishNotifier = createWorkbenchPublishNotifier();
}

function getWorkbenchSessionSecret(): string {
  const explicit = process.env.WORKBENCH_SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const fallback = process.env.ASSIGNMENT_WEB_SECRET?.trim();
  if (fallback) return fallback;
  throw new Error("WORKBENCH_SESSION_SECRET or ASSIGNMENT_WEB_SECRET is required");
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

function fromBase64Url(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getWorkbenchSessionSecret())
    .update(payloadB64)
    .digest("hex");
}

function buildSessionCookie(session: WorkbenchSession): string {
  const payloadB64 = toBase64Url(JSON.stringify(session));
  const sig = signPayload(payloadB64);
  const token = `${payloadB64}.${sig}`;
  const secure = shouldUseSecureWorkbenchCookies() ? "; Secure" : "";
  return `${WORKBENCH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WORKBENCH_SESSION_TTL_SECONDS}${secure}`;
}

function clearSessionCookie(): string {
  const secure = shouldUseSecureWorkbenchCookies() ? "; Secure" : "";
  return `${WORKBENCH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(existing), cookie]);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  raw.split(";").forEach((chunk) => {
    const [k, ...rest] = chunk.trim().split("=");
    if (!k) return;
    out[k] = rest.join("=");
  });
  return out;
}

function getSessionFromRequest(req: IncomingMessage): WorkbenchSession | undefined {
  try {
    const cookies = parseCookies(req);
    const token = cookies[WORKBENCH_COOKIE_NAME];
    if (!token || !token.includes(".")) return undefined;
    const [payloadB64, sig] = token.split(".", 2);
    const expected = signPayload(payloadB64);
    if (expected.length !== sig.length) return undefined;
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return undefined;
    const parsed = JSON.parse(fromBase64Url(payloadB64)) as WorkbenchSession;
    if (!parsed?.userId || !parsed?.role || !parsed?.exp) return undefined;
    if (Date.now() > parsed.exp * 1000) return undefined;
    if (parsed.role !== "admin" && parsed.role !== "manager" && parsed.role !== "employee") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function resolveRoleForUser(userId: string): WorkbenchRole {
  return resolveWorkbenchRole(userId);
}

function syncSessionCookieIfChanged(
  req: IncomingMessage,
  res: ServerResponse,
  before: WorkbenchSession,
  after: WorkbenchSession,
): void {
  if (
    before.role === after.role
    && before.primaryRole === after.primaryRole
    && before.primaryRole !== undefined
  ) {
    return;
  }
  appendSetCookie(res, buildSessionCookie(after));
  logStructured({
    event: "workbench_session_role_refreshed",
    path: req.url ?? "",
    userId: before.userId,
    fromRole: before.role,
    toRole: after.role,
    fromPrimaryRole: before.primaryRole,
    toPrimaryRole: after.primaryRole,
    loginSource: before.loginSource,
  });
}

/**
 * Read session cookie and refresh primaryRole from whitelist.
 * Preserves manager employee-view (`role=employee`) when still whitelisted.
 */
function resolveEffectiveSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = getSessionFromRequest(req);
  if (!session) return undefined;
  if (isWorkbenchTestEntrySession(session)) {
    return normalizeWorkbenchSession(session);
  }
  if (isExternalPasswordSession(session)) {
    return normalizeWorkbenchSession({
      ...session,
      role: "employee",
      primaryRole: "employee",
    });
  }
  const { session: refreshed, changed } = refreshSessionFromWhitelist(session);
  if (changed) {
    syncSessionCookieIfChanged(req, res, session, refreshed);
  }
  return refreshed;
}

function emitWorkbenchPageView(session: WorkbenchSession, pathname: string): void {
  recordWorkbenchUsageAsync({
    userId: session.userId,
    surface: resolveWorkbenchSurfaceFromPath(pathname),
    path: pathname,
    kind: "page_view",
  });
}

function emitWorkbenchAgentTurn(session: WorkbenchSession, traceId: string): void {
  recordWorkbenchUsageAsync({
    userId: session.userId,
    surface: resolveWorkbenchSurfaceFromRole(session.role),
    path: `/workbench/agent-turn/${traceId}`,
    kind: "agent_turn",
  });
}

function emitWorkbenchApiActivity(session: WorkbenchSession, apiPath: string): void {
  recordWorkbenchApiActivityAsync({
    userId: session.userId,
    role: session.role,
    path: apiPath,
  });
}

function createWorkbenchSession(params: {
  userId: string;
  role: WorkbenchRole;
  loginSource: WorkbenchSession["loginSource"];
  dingUser?: WorkbenchSession["dingUser"];
}): WorkbenchSession {
  const now = Math.floor(Date.now() / 1000);
  if (params.loginSource === "external_password") {
    return normalizeWorkbenchSession({
      sid: randomBytes(8).toString("hex"),
      userId: params.userId,
      role: "employee",
      primaryRole: "employee",
      loginSource: "external_password",
      dingUser: params.dingUser,
      iat: now,
      exp: now + WORKBENCH_SESSION_TTL_SECONDS,
    });
  }
  const primaryRole = resolveRoleForUser(params.userId);
  const caps = resolveWorkbenchCapabilities(params.userId);
  let role = params.role;
  if (primaryRole === "manager") {
    role = params.role === "employee" ? "employee" : "manager";
  } else if (primaryRole === "admin" && caps.alsoManager) {
    role =
      params.role === "manager" || params.role === "employee" ? params.role : "admin";
  } else {
    role = primaryRole;
  }
  return normalizeWorkbenchSession({
    sid: randomBytes(8).toString("hex"),
    userId: params.userId,
    role,
    primaryRole,
    loginSource: params.loginSource,
    dingUser: params.dingUser,
    iat: now,
    exp: now + WORKBENCH_SESSION_TTL_SECONDS,
  });
}

function sessionSatisfiesExpectedRole(
  session: WorkbenchSession,
  expectedRole: WorkbenchRole,
): boolean {
  if (expectedRole === "admin") {
    return resolveRoleForUser(session.userId) === "admin" && session.role === "admin";
  }
  if (expectedRole === "manager") {
    return allowsManagerSession(session);
  }
  if (expectedRole === "employee") {
    return allowsEmployeeSession(session);
  }
  return false;
}

function ensureManagerEmployeeViewForDeepLink(
  req: IncomingMessage,
  res: ServerResponse,
  session: WorkbenchSession,
): WorkbenchSession {
  const caps = resolveWorkbenchCapabilities(session.userId);
  if (!caps.canExecuteAsManager || session.role === "employee") {
    return session;
  }
  const switched: WorkbenchSession = {
    ...normalizeWorkbenchSession(session),
    primaryRole: "manager",
    role: "employee",
  };
  syncSessionCookieIfChanged(req, res, session, switched);
  return switched;
}

type WorkbenchView =
  | "home"
  | "manager"
  | "employee"
  | "conversation"
  | "in-progress";

function resolveWorkbenchView(path: string): WorkbenchView {
  if (path === "/workbench/manager/projects") {
    return "manager";
  }
  if (path === "/workbench/manager/tasks" || path === "/workbench/manager") {
    return "manager";
  }
  if (path === "/workbench/manager/chat" || path === "/workbench/conversation") {
    return "conversation";
  }
  if (path === "/workbench/in-progress") return "in-progress";
  if (path === "/workbench/employee/new" || path === "/workbench/employee") {
    return "employee";
  }
  if (path === "/workbench/employee/current") return "in-progress";
  return "home";
}

function safeReadRecentPlans(limit = 20): PlanSummary[] {
  try {
    const dir = resolveAssignmentDraftDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".assignment.json"))
      .map((name) => ({
        name,
        mtimeMs: statSync(join(dir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);

    const out: PlanSummary[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(join(dir, file.name), "utf8"),
        ) as Record<string, unknown>;
        out.push({
          planId: String(raw.planId ?? file.name.replace(".assignment.json", "")),
          generatedAt:
            typeof raw.generatedAt === "string" ? raw.generatedAt : undefined,
          assignmentsCount: Array.isArray(raw.assignments)
            ? raw.assignments.length
            : 0,
          promptVersion:
            typeof raw.promptVersion === "string" ? raw.promptVersion : undefined,
          modelName: typeof raw.modelName === "string" ? raw.modelName : undefined,
        });
      } catch {
        // skip malformed files
      }
    }
    return out;
  } catch {
    return [];
  }
}

function safeReadRecentSessions(limit = 20): SessionSummary[] {
  try {
    const dir = resolvePlanSessionDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((name) => ({
        name,
        mtimeMs: statSync(join(dir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);

    const out: SessionSummary[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(join(dir, file.name), "utf8"),
        ) as Record<string, unknown>;
        const knownFacts = Array.isArray(raw.knownFacts) ? raw.knownFacts : [];
        const history = Array.isArray(raw.conversationHistory)
          ? raw.conversationHistory
          : [];
        out.push({
          planId: String(raw.planId ?? "unknown"),
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
          senderStaffId:
            typeof raw.senderStaffId === "string" ? raw.senderStaffId : undefined,
          knownFactsCount: knownFacts.length,
          conversationTurns: history.length,
        });
      } catch {
        // skip malformed files
      }
    }
    return out;
  } catch {
    return [];
  }
}

function loadAllSessions(): Array<PlanSession & { chatKeyHash: string }> {
  return loadAllPlanSessions();
}

function findLatestSessionByPlanId(
  planId: string,
): (PlanSession & { chatKeyHash: string }) | undefined {
  const sessions = loadAllPlanSessions().filter((s) => s.planId === planId);
  sessions.sort((a, b) => {
    const ta = Date.parse(a.updatedAt ?? "") || 0;
    const tb = Date.parse(b.updatedAt ?? "") || 0;
    return tb - ta;
  });
  return sessions[0];
}

function findLatestSessionForManager(
  userId: string,
): (PlanSession & { chatKeyHash: string }) | undefined {
  return findMainThreadSession(userId);
}

function parseConversationThreadQuery(url: URL): {
  threadId?: string;
  threadKind?: "main" | "side";
  planId?: string;
} {
  const thread = String(url.searchParams.get("thread") ?? "").trim().toLowerCase();
  const threadId = String(url.searchParams.get("threadId") ?? "").trim();
  const planId = String(url.searchParams.get("planId") ?? "").trim();
  if (thread === "main") {
    return { threadKind: "main", threadId: "main", planId: planId || undefined };
  }
  if (thread === "side" && threadId) {
    return { threadKind: "side", threadId, planId: planId || undefined };
  }
  if (threadId === "main") {
    return { threadKind: "main", threadId: "main", planId: planId || undefined };
  }
  return { threadId: threadId || undefined, planId: planId || undefined };
}

function resolveConversationThreadFromBody(body: Record<string, unknown>): {
  threadId?: string;
  threadKind?: "main" | "side";
  planId?: string;
} {
  const threadId = String(body.threadId ?? "").trim();
  const threadKindRaw = String(body.threadKind ?? "").trim().toLowerCase();
  const planId = String(body.planId ?? "").trim();
  const threadKind =
    threadKindRaw === "main" || threadKindRaw === "side"
      ? threadKindRaw
      : threadId === "main"
        ? "main"
        : threadId
          ? "side"
          : undefined;
  return {
    threadId: threadId || (threadKind === "main" ? "main" : undefined),
    threadKind,
    planId: planId || undefined,
  };
}

function buildOverviewPayload(view: WorkbenchView, userId?: string) {
  const plans = safeReadRecentPlans();
  const sessions = safeReadRecentSessions();
  const allTasks = getFormalTaskStore().listAdminTasks();
  const normalizedUserId = userId?.trim() || undefined;

  let filteredSessions = sessions;
  let filteredTasks: Array<{ planId: string; status: WorkbenchTaskStatus }> = allTasks;
  if (view === "employee") {
    filteredSessions = normalizedUserId
      ? sessions.filter((s) => s.senderStaffId === normalizedUserId)
      : sessions.filter((s) => Boolean(s.senderStaffId));
    filteredTasks = normalizedUserId
      ? getFormalTaskStore().listEmployeeSubtasks(normalizedUserId)
      : [];
  } else if (view === "in-progress") {
    filteredSessions = sessions.filter((s) => s.conversationTurns > 0);
    filteredTasks = normalizedUserId
      ? getFormalTaskStore()
          .listEmployeeSubtasks(normalizedUserId)
          .filter((t) => t.status === "IN_PROGRESS" || t.status === "BLOCKED")
      : allTasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "BLOCKED");
  } else if (view === "conversation") {
    filteredSessions = [...sessions].sort(
      (a, b) => b.conversationTurns - a.conversationTurns,
    );
    filteredTasks = normalizedUserId
      ? allTasks.filter((t) => t.managerUserId === normalizedUserId)
      : allTasks;
  } else if (view === "manager") {
    filteredTasks = normalizedUserId
      ? allTasks.filter((t) => t.managerUserId === normalizedUserId)
      : allTasks;
  }

  const planIds = new Set(filteredSessions.map((s) => s.planId));
  filteredTasks.forEach((t) => planIds.add(t.planId));
  const filteredPlans =
    view === "manager" || view === "home"
      ? plans
      : plans.filter((p) => planIds.has(p.planId));

  return {
    generatedAt: new Date().toISOString(),
    view,
    userId: normalizedUserId ?? null,
    tasks: filteredTasks.map((t) => ({
      ...t,
      statusLabel: taskStatusLabel(t.status),
    })),
    plans: filteredPlans,
    sessions: filteredSessions,
    metrics: {
      plansCount: filteredTasks.length || filteredPlans.length,
      sessionsCount: filteredSessions.length,
      activeSessions:
        filteredTasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "BLOCKED").length ||
        filteredSessions.filter((s) => s.conversationTurns > 0).length,
      knownFactsTotal: filteredSessions.reduce(
        (acc, s) => acc + s.knownFactsCount,
        0,
      ),
    },
  };
}

function buildSessionMemorySummary(session: PlanSession): string {
  const lines: string[] = [`planId=${session.planId}`];
  if (session.lastTraceId) lines.push(`lastTraceId=${session.lastTraceId}`);
  if ((session.revisionEvents?.length ?? 0) > 0) {
    lines.push(`revisionEvents=${session.revisionEvents?.length ?? 0}`);
  }
  return lines.join("; ");
}

function isExplicitSearchRequest(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  return /联网|搜索|查最新|外部资料|行业资料|外部案例|web search|search web|latest/i.test(text);
}

function taskStatusLabel(status: string): string {
  const s = String(status ?? "");
  if (s === "ASSIGNED") return "待处理";
  if (s === "CHANGES_REQUESTED") return "待修改";
  if (s === "ACCEPTED") return "进行中";
  if (s === "IN_PROGRESS") return "进行中";
  if (s === "BLOCKED") return "阻塞中";
  if (s === "DONE") return "已完成";
  if (s === "STOPPED") return "已停止";
  if (s === "REJECTED") return "已拒绝";
  return "—";
}

/** Test-only export for status label mapping (legacy ACCEPTED → 进行中). */
export const __taskStatusLabelForTest = taskStatusLabel;

type FormalTaskDetail = NonNullable<ReturnType<ReturnType<typeof createWorkbenchFormalTaskStore>["getTaskDetail"]>>;

const REASSIGN_NOTIFY_EVENT_TYPES = new Set(["REASSIGN_NOTIFY_OK", "REASSIGN_NOTIFY_FAILED"]);

function enrichWorkbenchTaskDetail(
  detail: FormalTaskDetail,
  opts?: {
    omitReassignNotifyEvents?: boolean;
    presentEventCtx?: { showManagerReassignPayload?: boolean };
  },
): {
  task: FormalTaskDetail["task"] & { statusLabel: string };
  subtasks: Array<
    FormalTaskDetail["subtasks"][number] & {
      orderIndex: number;
      assigneeDisplayName: string;
      statusLabel: string;
    }
  >;
  events: Array<
    ReturnType<typeof presentWorkbenchTaskEvent> & { subtaskId: string; eventRowId: number }
  >;
} {
  const nameCache = new Map<string, string>();
  const resolveName = (userId: string): string => {
    if (!userId) return "";
    const cached = nameCache.get(userId);
    if (cached !== undefined) return cached;
    const n = withPeopleDirectoryStore((st) => st.getContact(userId)?.name?.trim()) ?? "";
    nameCache.set(userId, n);
    return n;
  };
  const task = {
    ...detail.task,
    statusLabel: taskStatusLabel(detail.task.status),
  };
  const subtasks = detail.subtasks.map((s, idx) => ({
    ...s,
    orderIndex: idx + 1,
    assigneeDisplayName: resolveName(s.assigneeUserId) || s.assigneeUserId,
    statusLabel: taskStatusLabel(s.status),
  }));
  const rawEvents = detail.events as Array<Record<string, unknown>>;
  const filtered = opts?.omitReassignNotifyEvents
    ? rawEvents.filter((row) => !REASSIGN_NOTIFY_EVENT_TYPES.has(String(row.event_type ?? "").trim()))
    : rawEvents;
  const resolveSubtaskLabel = buildSubtaskLabelResolver(subtasks);
  const presentCtx = {
    resolveActorName: resolveName,
    resolveSubtaskLabel,
    ...(opts?.presentEventCtx ?? {}),
  };
  const events = filtered.map((row) => {
    const presented = presentWorkbenchTaskEvent(row, presentCtx);
    return {
      ...presented,
      subtaskId: String(row.subtask_id ?? "").trim(),
      eventRowId: Number(row.id ?? 0) || 0,
    };
  });
  return { task, subtasks, events };
}

function attachSubtaskOpenDeclineHints<T extends { subtaskId: string }>(
  subtasks: T[],
): Array<T & { openDeclineKind: SubtaskOpenDeclineKind | null }> {
  const store = getFormalTaskStore();
  return subtasks.map((s) => ({
    ...s,
    openDeclineKind: store.getSubtaskOpenDeclineKind(s.subtaskId),
  }));
}

function mapEmployeeSubtaskForApi(
  t: ReturnType<ReturnType<typeof createWorkbenchFormalTaskStore>["listEmployeeSubtasks"]>[number],
) {
  const now = new Date();
  const mgr =
    withPeopleDirectoryStore((st) => st.getContact(t.managerUserId)?.name?.trim()) ?? "";
  const dueProgress =
    t.status === "DONE" ? 1 : presentDueProgress(t.createdAt, t.dueAt, now);
  const openSignal = getFormalTaskStore().getSubtaskOpenDeclineKind(t.subtaskId);
  return {
    ...t,
    statusLabel: taskStatusLabel(t.status),
    managerDisplayName: mgr || "",
    dueExpectation: t.dueExpectation ?? "",
    dueLabel: presentDueLabel(t.dueAt, now),
    dueProgress,
    dueBarState: presentDueBarState(t.dueAt, now, t.status),
    openSignal,
  };
}

function requirePortfolioManager(
  session: WorkbenchSession,
  res: ServerResponse,
): boolean {
  if (!isWorkbenchProjectPortfolioEnabled(session.userId)) {
    writeJson(res, 404, { ok: false, error: "project_portfolio_not_enabled" });
    return false;
  }
  return true;
}

function resolveLegacyWorkbenchRedirect(pathname: string, userId: string): string | undefined {
  const base = LEGACY_WORKBENCH_REDIRECTS[pathname];
  if (!base) return undefined;
  if (
    pathname === "/workbench/manager"
    && isWorkbenchProjectPortfolioEnabled(userId)
  ) {
    return "/workbench/manager/projects";
  }
  return base;
}

/** Keep session.latestAssignment.assignments[0].primary.userId aligned after manager reassign. */
function patchLatestAssignmentAssignee(
  latest: Record<string, unknown> | undefined,
  assigneeUserId: string,
): Record<string, unknown> {
  const base =
    latest && typeof latest === "object" && !Array.isArray(latest) ? { ...latest } : {};
  const assignments = Array.isArray(base.assignments) ? [...base.assignments] : [{}];
  const firstRaw = assignments[0];
  const first =
    typeof firstRaw === "object" && firstRaw !== null && !Array.isArray(firstRaw)
      ? { ...(firstRaw as Record<string, unknown>) }
      : {};
  const primaryRaw = first.primary;
  const primary =
    typeof primaryRaw === "object" && primaryRaw !== null && !Array.isArray(primaryRaw)
      ? { ...(primaryRaw as Record<string, unknown>) }
      : {};
  primary.userId = assigneeUserId;
  first.primary = primary;
  assignments[0] = first;
  return { ...base, assignments };
}

function defaultPathForRole(role: WorkbenchRole, userId?: string): string {
  if (role === "manager" && userId && isWorkbenchProjectPortfolioEnabled(userId)) {
    return "/workbench/manager/projects";
  }
  return defaultRedirectForView(role);
}

function rememberActionKey(action: string, key: string): boolean {
  const normalized = key.trim();
  if (!normalized) return true;
  const now = Date.now();
  for (const [k, v] of seenActionKeys.entries()) {
    if (now - v.at > ACTION_IDEMPOTENCY_TTL_MS) seenActionKeys.delete(k);
  }
  const hit = seenActionKeys.get(normalized);
  if (hit && hit.action === action) return false;
  seenActionKeys.set(normalized, { action, at: now });
  return true;
}

function shouldEnforceActionGuards(): boolean {
  /** When true, manager publish / reassign and employee action & progress require `idempotencyKey` (see employee-workbench-pages.ts). */
  const raw = String(process.env.WORKBENCH_ENFORCE_ACTION_GUARDS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseRichStringListFromBody(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const items = value.map((x) => String(x ?? "").trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  const text = String(value).trim();
  if (!text) return undefined;
  const items = text
    .split(/[\n;；]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function resolveClientIp(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function isWorkbenchTestLoginEnabled(): boolean {
  const raw = String(process.env.WORKBENCH_TEST_LOGIN_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function isWorkbenchTestEntrySession(session: WorkbenchSession): boolean {
  return isWorkbenchTestLoginEnabled() && session.loginSource === "entry";
}

function renderWorkbenchEntryLoginHtml(): string {
  return renderWorkbenchDingTalkEntryHtml();
}

export function renderTaskEventsPage(params: {
  roleLabel: "employee" | "manager" | "admin";
  backPath: string;
  detailPath: string;
}): string {
  const shellRole =
    params.roleLabel === "admin" ? "admin" : params.roleLabel === "employee" ? "employee" : "manager";
  const activeNav =
    params.roleLabel === "admin"
      ? "adm-tasks"
      : params.roleLabel === "employee"
        ? "emp-new"
        : "mgr-tasks";
  return renderWorkbenchPage({
    role: shellRole,
    activeNav,
    title: "全部事件记录",
    pageTitle: "全部事件记录",
    description: "含系统通知、待办投递等完整日志。",
    breadcrumbHtml: `<a href="${params.detailPath}">任务详情</a> › 全部事件`,
    headToolbarHtml: `<a class="btn btn-ghost btn-sm" href="${params.detailPath}">← 返回详情</a> <a class="btn btn-ghost btn-sm" href="${params.backPath}">返回列表</a>`,
    mainBodyClass: "wb-main-body--detail",
    mainHtml: `
  <div class="card" id="taskMount">加载中…</div>
  <div class="card">
    <div id="eventsMount" class="muted">加载中…</div>
  </div>`,
    scriptHtml: `<script>
(function(){
  ${buildWorkbenchFmtTimeClientJs()}
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  async function load(){
    var taskNo = new URLSearchParams(location.search).get('taskNo') || '';
    if(!taskNo){ document.getElementById('taskMount').textContent='缺少 taskNo'; return; }
    var debugQ = new URLSearchParams(location.search).get('debug') === '1' ? '&debug=1' : '';
    var res = await fetch('/api/workbench/tasks/detail?taskNo='+encodeURIComponent(taskNo)+debugQ);
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok || !data.ok){ document.getElementById('taskMount').textContent = data.error || ('HTTP '+res.status); return; }
    var t = data.task || {};
    document.getElementById('taskMount').innerHTML = '<h2 style="margin:0;font-size:18px;">'+esc(t.title||'—')+'</h2><p class="muted" style="margin:6px 0 0;">业务编号 <code>'+esc(t.taskNo||taskNo)+'</code></p>';
    var crumb = document.getElementById('detailBreadcrumbTitle');
    if (crumb) crumb.textContent = t.title || taskNo;
    var events = data.events || [];
    if(!events.length){ document.getElementById('eventsMount').textContent='暂无事件'; return; }
    document.getElementById('eventsMount').innerHTML = '<ul class="event-list">'+events.map(function(e){
      var sev = esc(e.severity||'info');
      var when = fmtTime(e.occurredAt || e.occurred_at || '');
      var title = esc(e.title || e.type || '');
      var sum = esc(e.summary || '');
      var det = e.detail ? '<details><summary>查看原始信息</summary><pre>'+esc(e.detail)+'</pre></details>' : '';
      return '<li class="event '+sev+'"><div class="event-row"><span class="event-time">'+when+'</span><span class="event-title">'+title+'</span><span class="event-summary">'+sum+'</span></div>'+det+'</li>';
    }).join('')+'</ul>';
  }
  void load();
})();
</script>`,
  });
}

export function renderTaskDetailPage(params: {
  roleLabel: "admin" | "manager" | "employee";
  backPath: string;
  enforceActionGuards: boolean;
  eventsPagePath?: string;
}): string {
  const employeeActionBar =
    params.roleLabel === "employee"
      ? `<div class="emp-detail-action-bar wb-sticky-foot" id="empDetailActionBar" role="navigation" aria-label="返回列表操作">
    <a class="btn btn-secondary" id="empBackListLink" href="${params.backPath}">返回列表继续操作</a>
    <a class="btn btn-primary" id="empPrimaryActionLink" href="${params.backPath}" style="display:none;">—</a>
  </div>`
      : "";
  const shellRole =
    params.roleLabel === "admin" ? "admin" : params.roleLabel === "employee" ? "employee" : "manager";
  const activeNav =
    params.roleLabel === "admin"
      ? "adm-tasks"
      : params.roleLabel === "employee"
        ? "emp-new"
        : "mgr-tasks";
  const backCrumbLabel =
    params.roleLabel === "employee"
      ? "待承接"
      : params.roleLabel === "admin"
        ? "任务总览"
        : "历史任务";
  const infoBar =
    params.roleLabel === "employee"
      ? '<div class="wb-info-bar wb-info-bar--emp" role="note">接受、拒绝、进度等操作请在「待承接 / 进行中」列表完成；本页仅供查看完整背景与团队分工。</div>'
      : params.roleLabel === "admin"
        ? '<div class="wb-info-bar wb-info-bar--adm" role="note">管理员视图：可改派与停止任务，不含规划助手入口。</div>'
        : "";
  const toolbarHtml = `<a class="btn btn-ghost btn-sm" href="${params.backPath}">← 返回列表</a>`;
  return renderWorkbenchPage({
    role: shellRole,
    activeNav,
    title: "任务详情",
    pageTitle: "任务详情",
    breadcrumbHtml: `<a href="${params.backPath}">${backCrumbLabel}</a> › <span id="detailBreadcrumbTitle">加载中…</span>`,
    headToolbarHtml: toolbarHtml,
    mainBodyClass: params.roleLabel === "employee" ? "wb-main-body--detail-emp" : "wb-main-body--detail",
    mainHtml: `${infoBar}
  <div class="card" id="focusContextBanner" style="display:none;" role="status"></div>
  <div class="card" id="taskMount">加载中…</div>
  <div class="card" id="reassignCard" style="display:none;">
    <h3 style="margin:0 0 8px;">改派</h3>
    <p class="muted" style="font-size:13px;margin:0 0 12px;">从通知直达时已预选子任务；搜索并选择新负责人后保存。</p>
    <div class="form-stack">
      <label>子任务
        <select id="detailReassignSubtask"><option value="">整单未完成子任务（全部改派）</option></select>
      </label>
      <label>新负责人
        <div class="combo" style="position:relative;">
        <input id="detailReassignAssigneeInput" type="search" autocomplete="off" placeholder="输入姓名或部门（1 字起搜）" style="width:100%;" />
        <input id="detailReassignAssigneeUserId" type="hidden" value="" />
        <ul id="detailReassignAssigneeOptions" class="combo-options" hidden></ul>
        </div>
      </label>
      <label>说明
        <textarea id="detailReassignNote" rows="2" placeholder="简要说明改派原因（可选）"></textarea>
      </label>
      <div class="wb-confirm-bar" id="detailReassignConfirmWrap" hidden>
        <div class="wb-confirm-bar__row">
          <input type="checkbox" id="detailReassignConfirm" />
          <label for="detailReassignConfirm">确认执行改派</label>
        </div>
      </div>
      <button type="button" class="btn btn-primary" id="detailReassignBtn">保存改派</button>
      <div class="feedback muted" id="detailReassignFeedback"></div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 10px;">子任务</h3>
    <div id="subtasksMount" class="muted">加载中…</div>
  </div>
  <div class="card" id="addSubtaskCard" style="display:none;">
    <h3 style="margin:0 0 8px;">新增子任务</h3>
    <p class="muted" style="font-size:13px;margin:0 0 12px;">向已发布任务追加子任务并通知新负责人。执行要点与发布草案字段一致。</p>
    <div class="form-stack">
      <label>标题<span class="mgr-req">（必填）</span>
        <input id="addSubtaskTitle" type="text" maxlength="200" placeholder="子任务做什么" style="width:100%;" />
      </label>
      <label>负责人<span class="mgr-req">（必填）</span>
        <div class="combo" style="position:relative;">
        <input id="addSubtaskAssigneeInput" type="search" autocomplete="off" placeholder="输入姓名或部门（1 字起搜）" style="width:100%;" />
        <input id="addSubtaskAssigneeUserId" type="hidden" value="" />
        <ul id="addSubtaskAssigneeOptions" class="combo-options" hidden></ul>
        </div>
      </label>
      <h4 class="subs-section-h" style="margin:12px 0 6px;font-size:13px;">执行要点</h4>
      <label>目标<span class="mgr-req">（必填）</span>
        <textarea id="addSubtaskObjective" rows="2" placeholder="这条子任务要达成什么"></textarea>
      </label>
      <label>交付物<span class="mgr-req">（必填）</span>
        <textarea id="addSubtaskDeliverables" rows="2" placeholder="产出什么文件/结果"></textarea>
      </label>
      <label>完成标准<span class="mgr-req">（必填）</span>
        <textarea id="addSubtaskCriteria" rows="2" placeholder="如何验收完成"></textarea>
      </label>
      <label>截止日期<span class="mgr-req">（必填）</span>
        <input id="addSubtaskDueAt" type="date" style="width:100%;" />
      </label>
      <label>执行动作（可选，每行一条或分号分隔）
        <textarea id="addSubtaskActions" rows="2" placeholder="具体执行步骤"></textarea>
      </label>
      <div class="add-subtask-depends-field">
        <span class="add-subtask-depends-label">前置依赖<span class="mgr-opt">（可选，可多选）</span></span>
        <div id="addSubtaskDependsOn" class="add-subtask-depends-list" role="group" aria-label="前置依赖">
          <p class="add-subtask-depends-empty muted">暂无可选子任务</p>
        </div>
        <p class="add-subtask-depends-hint muted">选择须先完成的子任务；不选表示无前置依赖</p>
      </div>
      <div class="wb-confirm-bar" id="addSubtaskConfirmWrap" hidden>
        <div class="wb-confirm-bar__row">
          <input type="checkbox" id="addSubtaskConfirm" />
          <label for="addSubtaskConfirm">确认新增子任务</label>
        </div>
      </div>
      <button type="button" class="btn btn-primary" id="addSubtaskBtn">保存子任务</button>
      <div class="feedback muted" id="addSubtaskFeedback"></div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 10px;">${params.roleLabel === "employee" ? "关键节点" : "事件"}</h3>
    <div id="eventsMount" class="muted">加载中…</div>
    <p id="eventsMoreLink" style="margin:12px 0 0;display:none;"><a id="eventsFullPageLink" href="#">查看全部事件记录 →</a></p>
  </div>
  ${employeeActionBar}`,
    scriptHtml: `<script>
(function(){
  var ROLE = ${JSON.stringify(params.roleLabel)};
  var ENFORCE_GUARDS = ${params.enforceActionGuards ? "true" : "false"};
  var EVENTS_PAGE_BASE = ${JSON.stringify(params.eventsPagePath ?? "")};
  var KEY_EVENT_TYPES = ${JSON.stringify([...EMPLOYEE_KEY_EVENT_TYPES])};
  var lastLoadedPlanId = '';
  var detailReassignComboBound = false;
  var addSubtaskComboBound = false;
  var addSubtaskSubmitting = false;
  var addSubtaskJustSucceeded = false;
  var addSubtaskClientRequestId = '';
  var addSubtaskClickTimer = null;
  var mgrRowHandlersBound = false;
  var taskActionHandlersBound = false;
  var lastSubsForReassign = [];
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function cssEscAttr(v){
    var s = String(v||'');
    try {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    } catch (e0) {}
    /* 外层是 TS 模板字符串：这里必须写成 \\\\ 才能在生成的 HTML 里得到 \\，浏览器里的脚本才是合法的 split('\\\\') 等。 */
    return s.split('\\\\').join('\\\\\\\\').split('"').join('\\\\"');
  }
  ${buildWorkbenchFmtTimeClientJs()}
  ${buildWorkbenchContactComboClientJs()}
  ${buildSubtaskPlanningFieldsClientJs()}
  function subBadgeClass(st){
    if (st === 'BLOCKED') return 'blocked';
    if (st === 'DONE') return 'done';
    if (st === 'STOPPED') return 'stopped';
    if (st === 'ASSIGNED') return 'assigned';
    if (st === 'CHANGES_REQUESTED') return 'pending';
    if (st === 'REJECTED') return 'rejected';
    return 'progress';
  }
  function clipStr(s, n) {
    s = String(s || '').trim();
    if (!s) return '';
    return s.length <= n ? s : (s.slice(0, n) + '…');
  }
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
  function setDetailReassignFb(msg, cls) {
    var el = document.getElementById('detailReassignFeedback');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (cls || 'muted');
  }
  wbAttachContactCombo({
    input: 'detailReassignAssigneeInput',
    hiddenUserId: 'detailReassignAssigneeUserId',
    optionsList: 'detailReassignAssigneeOptions',
    minLength: 1,
    resultKey: ROLE === 'admin' ? 'employees' : 'contacts',
    searchUrl: function (kw) {
      return ROLE === 'admin'
        ? '/api/workbench/admin/employees?keyword=' + encodeURIComponent(kw)
        : '/api/workbench/manager/contacts?keyword=' + encodeURIComponent(kw);
    },
    onFeedback: function (msg, kind) { setDetailReassignFb(msg, kind); },
    onSelect: function () { setDetailReassignFb('已选择负责人', 'ok'); }
  });
  function initDetailReassign(subs, presetSubId) {
    var card = document.getElementById('reassignCard');
    if (!card) return;
    card.style.display = 'block';
    var sel = document.getElementById('detailReassignSubtask');
    if (!sel) return;
    sel.innerHTML = '<option value="">整单未完成子任务（全部改派）</option>';
    (subs || []).forEach(function (s) {
      if (String(s.status || '') === 'DONE') return;
      if (String(s.status || '') === 'STOPPED') return;
      var o = document.createElement('option');
      o.value = s.subtaskId || '';
      o.textContent = (s.orderIndex ? ('#' + s.orderIndex + ' ') : '') + (s.title || s.subtaskId || '');
      sel.appendChild(o);
    });
    if (presetSubId) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (String(sel.options[i].value) === String(presetSubId)) {
          sel.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        var ox = document.createElement('option');
        ox.value = presetSubId;
        ox.textContent = '通知子任务';
        sel.appendChild(ox);
        sel.value = presetSubId;
      }
    }
    var inp = document.getElementById('detailReassignAssigneeInput');
    var hid = document.getElementById('detailReassignAssigneeUserId');
    if (inp) inp.value = '';
    if (hid) hid.value = '';
    var note = document.getElementById('detailReassignNote');
    if (note) note.value = '';
    var cw = document.getElementById('detailReassignConfirmWrap');
    var confirmCb = document.getElementById('detailReassignConfirm');
    if (ENFORCE_GUARDS) {
      if (cw) cw.removeAttribute('hidden');
      if (confirmCb) confirmCb.checked = false;
    } else {
      if (cw) cw.setAttribute('hidden', '');
    }
    setDetailReassignFb('', 'muted');
    try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e0) {}
    if (!detailReassignComboBound) {
      detailReassignComboBound = true;
      var input = document.getElementById('detailReassignAssigneeInput');
      var hid2 = document.getElementById('detailReassignAssigneeUserId');
      var btn = document.getElementById('detailReassignBtn');
      if (btn) {
        btn.addEventListener('click', async function () {
          var planId = (lastLoadedPlanId || '').trim();
          var assigneeUserId = (hid2 && hid2.value || '').trim();
          var subPick = document.getElementById('detailReassignSubtask');
          var subtaskId = subPick ? String(subPick.value || '').trim() : '';
          var noteTxt = (document.getElementById('detailReassignNote') && document.getElementById('detailReassignNote').value || '').trim();
          if (!planId) { setDetailReassignFb('缺少 planId', 'err'); return; }
          if (!assigneeUserId) { setDetailReassignFb('请先搜索并选择新负责人', 'err'); return; }
          if (ENFORCE_GUARDS) {
            var c = document.getElementById('detailReassignConfirm');
            if (!c || !c.checked) { setDetailReassignFb('请勾选确认执行改派', 'err'); return; }
          }
          var payload = { planId: planId, assigneeUserId: assigneeUserId, note: noteTxt };
          if (subtaskId) payload.subtaskId = subtaskId;
          if (ENFORCE_GUARDS) {
            payload.confirm = true;
            try {
              payload.idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('reassign-' + Date.now() + '-' + Math.random().toString(36).slice(2));
            } catch (e1) {
              payload.idempotencyKey = 'reassign-' + Date.now();
            }
          }
          btn.disabled = true;
          setDetailReassignFb('保存中…', 'muted');
          try {
            var res = await fetch('/api/workbench/manager/reassign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
            setDetailReassignFb('改派已保存，正在刷新…', 'ok');
            if (input) input.value = '';
            if (hid2) hid2.value = '';
            if (note) note.value = '';
            await load();
          } catch (e2) {
            setDetailReassignFb(String(e2 && e2.message ? e2.message : e2), 'err');
          } finally {
            btn.disabled = false;
          }
        });
      }
    }
  }
  function setAddSubtaskFb(msg, cls) {
    var el = document.getElementById('addSubtaskFeedback');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (cls || 'muted');
  }
  function parseLinesToArray(raw) {
    return String(raw || '').split(/[\\n;；]/).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  }
  function syncAddSubtaskDependsOn(subs) {
    var box = document.getElementById('addSubtaskDependsOn');
    if (!box) return;
    var prev = getSelectedAddSubtaskDependsOn();
    var list = subs || [];
    var items = list.map(function (s) {
      var key = String(s.sourceTaskKey || s.source_task_key || '').trim();
      if (!key) return '';
      var label = String(s.title || key);
      var checked = prev.indexOf(key) >= 0;
      var rowCls = 'add-subtask-depends-item' + (checked ? ' is-selected' : '');
      return '<label class="' + rowCls + '">'
        + '<input type="checkbox" name="addSubtaskDependsOn" value="' + esc(key) + '"' + (checked ? ' checked' : '') + ' />'
        + '<span class="add-subtask-depends-item-body">'
        + (s.orderIndex ? '<span class="add-subtask-depends-ord">#' + esc(String(s.orderIndex)) + '</span>' : '')
        + '<span class="add-subtask-depends-title">' + esc(label) + '</span>'
        + '</span></label>';
    }).filter(Boolean);
    if (!items.length) {
      box.innerHTML = '<p class="add-subtask-depends-empty muted">暂无可选子任务</p>';
    } else {
      box.innerHTML = items.join('');
    }
  }
  function getSelectedAddSubtaskDependsOn() {
    var box = document.getElementById('addSubtaskDependsOn');
    if (!box) return [];
    return Array.prototype.slice.call(
      box.querySelectorAll('input[type="checkbox"][name="addSubtaskDependsOn"]:checked'),
    ).map(function (cb) { return String(cb.value || '').trim(); }).filter(Boolean);
  }
  function clearAddSubtaskDependsOn() {
    var box = document.getElementById('addSubtaskDependsOn');
    if (!box) return;
    box.querySelectorAll('input[type="checkbox"][name="addSubtaskDependsOn"]').forEach(function (cb) {
      cb.checked = false;
      var row = cb.closest('.add-subtask-depends-item');
      if (row) row.classList.remove('is-selected');
    });
  }
  function clearAddSubtaskFormFields() {
    var ids = [
      'addSubtaskTitle', 'addSubtaskAssigneeInput', 'addSubtaskObjective', 'addSubtaskDeliverables',
      'addSubtaskCriteria', 'addSubtaskDueAt', 'addSubtaskActions'
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var hid = document.getElementById('addSubtaskAssigneeUserId');
    if (hid) hid.value = '';
    clearAddSubtaskDependsOn();
    var confirmCb = document.getElementById('addSubtaskConfirm');
    if (confirmCb) confirmCb.checked = false;
    addSubtaskClientRequestId = '';
  }
  function releaseAddSubtaskSubmit(btn) {
    addSubtaskSubmitting = false;
    if (btn) btn.disabled = false;
  }
  function bindAddSubtaskHandlersOnce() {
    if (addSubtaskComboBound) return;
    addSubtaskComboBound = true;
    wbAttachContactCombo({
      input: 'addSubtaskAssigneeInput',
      hiddenUserId: 'addSubtaskAssigneeUserId',
      optionsList: 'addSubtaskAssigneeOptions',
      minLength: 1,
      resultKey: ROLE === 'admin' ? 'employees' : 'contacts',
      searchUrl: function (kw) {
        return ROLE === 'admin'
          ? '/api/workbench/admin/employees?keyword=' + encodeURIComponent(kw)
          : '/api/workbench/manager/contacts?keyword=' + encodeURIComponent(kw);
      }
    });
    var depBox = document.getElementById('addSubtaskDependsOn');
    if (depBox && !depBox.dataset.changeBound) {
      depBox.dataset.changeBound = '1';
      depBox.addEventListener('change', function (ev) {
        var t = ev.target;
        if (!t || t.type !== 'checkbox' || t.name !== 'addSubtaskDependsOn') return;
        var row = t.closest('.add-subtask-depends-item');
        if (row) row.classList.toggle('is-selected', t.checked);
      });
    }
    var btn = document.getElementById('addSubtaskBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (addSubtaskSubmitting) return;
      if (addSubtaskClickTimer) return;
      addSubtaskClickTimer = setTimeout(function () {
        addSubtaskClickTimer = null;
        void (async function () {
        if (addSubtaskSubmitting) return;
        addSubtaskSubmitting = true;
        btn.disabled = true;
        var title = String(document.getElementById('addSubtaskTitle')?.value || '').trim();
        var assigneeUserId = String(document.getElementById('addSubtaskAssigneeUserId')?.value || '').trim();
        var dueAt = String(document.getElementById('addSubtaskDueAt')?.value || '').trim();
        var completionCriteria = String(document.getElementById('addSubtaskCriteria')?.value || '').trim();
        var objective = String(document.getElementById('addSubtaskObjective')?.value || '').trim();
        var deliverables = String(document.getElementById('addSubtaskDeliverables')?.value || '').trim();
        if (!lastLoadedPlanId) { setAddSubtaskFb('缺少 planId', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!title) { setAddSubtaskFb('请填写标题', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!assigneeUserId) { setAddSubtaskFb('请选择负责人', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!objective) { setAddSubtaskFb('请填写目标', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!deliverables) { setAddSubtaskFb('请填写交付物', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!completionCriteria) { setAddSubtaskFb('请填写完成标准', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (!dueAt) { setAddSubtaskFb('请选择截止日期', 'err'); releaseAddSubtaskSubmit(btn); return; }
        if (ENFORCE_GUARDS && !document.getElementById('addSubtaskConfirm')?.checked) {
          setAddSubtaskFb('请勾选确认', 'err'); releaseAddSubtaskSubmit(btn); return;
        }
        var payload = {
          planId: lastLoadedPlanId,
          title: title,
          assigneeUserId: assigneeUserId,
          objective: objective,
          deliverables: deliverables,
          completionCriteria: completionCriteria,
          dueAt: dueAt,
        };
        var actions = parseLinesToArray(document.getElementById('addSubtaskActions')?.value);
        if (actions.length) payload.actions = actions;
        var deps = getSelectedAddSubtaskDependsOn();
        if (deps.length) payload.dependsOn = deps;
        if (!addSubtaskClientRequestId) {
          try {
            addSubtaskClientRequestId = (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : ('add-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2));
          } catch (eCid) {
            addSubtaskClientRequestId = 'add-sub-' + Date.now() + '-' + Math.random().toString(36).slice(2);
          }
        }
        payload.clientRequestId = addSubtaskClientRequestId;
        if (ENFORCE_GUARDS) {
          payload.confirm = true;
          payload.idempotencyKey = addSubtaskClientRequestId;
        }
        setAddSubtaskFb('提交中…', 'muted');
        try {
          var res = await fetch('/api/workbench/manager/subtasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
          addSubtaskJustSucceeded = true;
          clearAddSubtaskFormFields();
          setAddSubtaskFb(data.duplicated ? '子任务已存在（未重复添加）' : '子任务已添加', 'ok');
          await load();
          if (addSubtaskJustSucceeded) {
            setAddSubtaskFb(data.duplicated ? '子任务已存在（未重复添加）' : '子任务已添加', 'ok');
            addSubtaskJustSucceeded = false;
          }
        } catch (eAdd) {
          setAddSubtaskFb(String(eAdd && eAdd.message ? eAdd.message : eAdd), 'err');
        } finally {
          releaseAddSubtaskSubmit(btn);
        }
      })();
      }, 300);
    });
  }
  function prepareAddSubtaskFormUi(subs) {
    var cw = document.getElementById('addSubtaskConfirmWrap');
    var confirmCb = document.getElementById('addSubtaskConfirm');
    if (ENFORCE_GUARDS) {
      if (cw) cw.removeAttribute('hidden');
      if (confirmCb && !addSubtaskJustSucceeded) confirmCb.checked = false;
    } else if (cw) {
      cw.setAttribute('hidden', '');
    }
    if (!addSubtaskJustSucceeded) setAddSubtaskFb('', 'muted');
    syncAddSubtaskDependsOn(subs || []);
    bindAddSubtaskHandlersOnce();
  }
  function ensureTaskActionHandlers() {
    if (taskActionHandlersBound) return;
    taskActionHandlersBound = true;
    document.body.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      var stopToggle = el.closest('[data-task-stop-toggle]');
      if (stopToggle) {
        ev.preventDefault();
        var panel = document.querySelector('[data-task-panel="stop"]');
        if (panel) panel.hidden = !panel.hidden;
        return;
      }
      var stopCancel = el.closest('[data-task-stop-cancel]');
      if (stopCancel) {
        ev.preventDefault();
        var panelC = document.querySelector('[data-task-panel="stop"]');
        if (panelC) panelC.hidden = true;
        return;
      }
      var stopSubmit = el.closest('[data-task-stop-submit]');
      if (stopSubmit) {
        ev.preventDefault();
        void (async function () {
          if (!lastLoadedPlanId) return;
          var noteEl = document.querySelector('[data-task-field="stop-note"]');
          var note = noteEl ? String(noteEl.value || '').trim() : '';
          if (!note) {
            var fb = document.querySelector('[data-task-fb="stop"]');
            if (fb) { fb.textContent = '请填写停止原因'; fb.className = 'feedback err'; }
            return;
          }
          if (ENFORCE_GUARDS) {
            var cb = document.querySelector('[data-task-field="stop-confirm"]');
            if (cb && !cb.checked) {
              var fb2 = document.querySelector('[data-task-fb="stop"]');
              if (fb2) { fb2.textContent = '请勾选确认'; fb2.className = 'feedback err'; }
              return;
            }
          }
          stopSubmit.disabled = true;
          var fb3 = document.querySelector('[data-task-fb="stop"]');
          if (fb3) { fb3.textContent = '提交中…'; fb3.className = 'feedback muted'; }
          try {
            var payload = { planId: lastLoadedPlanId, note: note };
            if (ENFORCE_GUARDS) { payload.confirm = true; payload.idempotencyKey = newMgrIdem(); }
            var res = await fetch('/api/workbench/manager/tasks/stop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
            if (fb3) { fb3.textContent = data.alreadyStopped ? '任务已无进行中的子任务' : '任务已停止'; fb3.className = 'feedback ok'; }
            await load();
          } catch (eStop) {
            if (fb3) { fb3.textContent = String(eStop && eStop.message ? eStop.message : eStop); fb3.className = 'feedback err'; }
          } finally {
            stopSubmit.disabled = false;
          }
        })();
      }
    });
  }
  function newMgrIdem() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e0) {}
    return 'mgr-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function setRowMgrFb(row, which, msg, cls) {
    var fb = row.querySelector('[data-mgr-fb="' + which + '"]');
    if (!fb) return;
    fb.textContent = msg || '';
    fb.className = 'feedback ' + (cls || 'muted');
  }
  function ensureMgrRowHandlers() {
    if (mgrRowHandlersBound) return;
    mgrRowHandlersBound = true;
    document.body.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      var openRs = el.closest('[data-mgr-open-reassign-sub]');
      if (openRs) {
        ev.preventDefault();
        ev.stopPropagation();
        var sid0 = String(openRs.getAttribute('data-mgr-open-reassign-sub') || '').trim();
        if (lastLoadedPlanId) initDetailReassign(lastSubsForReassign, sid0);
        return;
      }
      var remindBtn = el.closest('[data-mgr-remind-sub]');
      if (remindBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        var rowR = remindBtn.closest('details.sub-row-mgr');
        if (!rowR) return;
        var sidR = String(rowR.getAttribute('data-subtask-id') || '').trim();
        if (!sidR) return;
        remindBtn.disabled = true;
        setRowMgrFb(rowR, 'remind', '发送中…', 'muted');
        void (async function () {
          try {
            var payloadR = { subtaskId: sidR, tone: 'polite' };
            if (ENFORCE_GUARDS) {
              payloadR.confirm = true;
              payloadR.idempotencyKey = 'remind-' + sidR;
            }
            var resR = await fetch('/api/workbench/manager/subtasks/remind', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadR),
            });
            var dataR = await resR.json().catch(function () { return {}; });
            if (!resR.ok || !dataR.ok) throw new Error(dataR.error || dataR.skipped || ('HTTP ' + resR.status));
            var ch = (dataR.channels && dataR.channels.length) ? dataR.channels.join('+') : '已发送';
            setRowMgrFb(rowR, 'remind', '催办成功（' + ch + '）', 'ok');
          } catch (erR) {
            setRowMgrFb(rowR, 'remind', String(erR && erR.message ? erR.message : erR), 'err');
          } finally {
            remindBtn.disabled = false;
          }
        })();
        return;
      }
      var adminA = el.closest('[data-admin-open-reassign]');
      if (adminA) {
        ev.preventDefault();
        if (lastLoadedPlanId) initDetailReassign(lastSubsForReassign, '');
        return;
      }
      var toggle = el.closest('[data-mgr-toggle]');
      if (toggle) {
        ev.preventDefault();
        ev.stopPropagation();
        var row = toggle.closest('details.sub-row-mgr');
        if (!row) return;
        var kind = toggle.getAttribute('data-mgr-toggle');
        var pDecl = row.querySelector('[data-mgr-panel="decline"]');
        var pAck = row.querySelector('[data-mgr-panel="ack"]');
        var pAckRej = row.querySelector('[data-mgr-panel="ack-rejection"]');
        var pStop = row.querySelector('[data-mgr-panel="stop"]');
        var pDue = row.querySelector('[data-mgr-panel="set-due"]');
        if (kind === 'decline' && pDecl) {
          var showD = pDecl.hidden;
          if (pAck) pAck.hidden = true;
          if (pAckRej) pAckRej.hidden = true;
          if (pStop) pStop.hidden = true;
          if (pDue) pDue.hidden = true;
          pDecl.hidden = !showD;
          if (showD) {
            row.open = true;
            setRowMgrFb(row, 'decline', '', 'muted');
          }
        } else if (kind === 'ack' && pAck) {
          var showA = pAck.hidden;
          if (pDecl) pDecl.hidden = true;
          if (pAckRej) pAckRej.hidden = true;
          if (pStop) pStop.hidden = true;
          if (pDue) pDue.hidden = true;
          pAck.hidden = !showA;
          if (showA) {
            row.open = true;
            setRowMgrFb(row, 'ack', '', 'muted');
          }
        } else if (kind === 'ack-rejection' && pAckRej) {
          var showR = pAckRej.hidden;
          if (pDecl) pDecl.hidden = true;
          if (pAck) pAck.hidden = true;
          if (pStop) pStop.hidden = true;
          if (pDue) pDue.hidden = true;
          pAckRej.hidden = !showR;
          if (showR) {
            row.open = true;
            setRowMgrFb(row, 'ack-rejection', '', 'muted');
          }
        } else if (kind === 'stop' && pStop) {
          var showS = pStop.hidden;
          if (pDecl) pDecl.hidden = true;
          if (pAck) pAck.hidden = true;
          if (pAckRej) pAckRej.hidden = true;
          if (pDue) pDue.hidden = true;
          pStop.hidden = !showS;
          if (showS) {
            row.open = true;
            setRowMgrFb(row, 'stop', '', 'muted');
          }
        } else if (kind === 'set-due' && pDue) {
          var showDue = pDue.hidden;
          if (pDecl) pDecl.hidden = true;
          if (pAck) pAck.hidden = true;
          if (pAckRej) pAckRej.hidden = true;
          if (pStop) pStop.hidden = true;
          pDue.hidden = !showDue;
          if (showDue) {
            row.open = true;
            setRowMgrFb(row, 'set-due', '', 'muted');
          }
        }
        return;
      }
      var cancel = el.closest('[data-mgr-cancel]');
      if (cancel) {
        ev.preventDefault();
        ev.stopPropagation();
        var row2 = cancel.closest('details.sub-row-mgr');
        if (!row2) return;
        var which = cancel.getAttribute('data-mgr-cancel') || '';
        var pan = row2.querySelector('[data-mgr-panel="' + which + '"]');
        if (pan) pan.hidden = true;
        return;
      }
      var subm = el.closest('[data-mgr-submit]');
      if (!subm) return;
      ev.preventDefault();
      ev.stopPropagation();
      var row3 = subm.closest('details.sub-row-mgr');
      if (!row3) return;
      var submitKind = subm.getAttribute('data-mgr-submit') || '';
      void (async function () {
        var planId = (lastLoadedPlanId || '').trim();
        var sid = String(row3.getAttribute('data-subtask-id') || '').trim();
        if (!planId) {
          setRowMgrFb(
            row3,
            submitKind === 'decline'
              ? 'decline'
              : submitKind === 'stop'
                ? 'stop'
                : submitKind === 'set-due'
                  ? 'set-due'
                  : 'ack',
            '缺少 planId',
            'err',
          );
          return;
        }
        if (submitKind === 'decline') {
          var pnl = row3.querySelector('[data-mgr-panel="decline"]');
          var noteEl = pnl ? pnl.querySelector('textarea[data-field="note"]') : null;
          var note = noteEl ? String(noteEl.value || '').trim() : '';
          if (!sid) {
            setRowMgrFb(row3, 'decline', '缺少子任务', 'err');
            return;
          }
          if (!note) {
            setRowMgrFb(row3, 'decline', '请填写驳回理由', 'err');
            return;
          }
          if (ENFORCE_GUARDS) {
            var cx = pnl ? pnl.querySelector('input[data-field="confirm"]') : null;
            if (!cx || !cx.checked) {
              setRowMgrFb(row3, 'decline', '请勾选确认执行驳回', 'err');
              return;
            }
          }
          var payload = { planId: planId, subtaskId: sid, note: note };
          if (ENFORCE_GUARDS) {
            payload.confirm = true;
            payload.idempotencyKey = 'decline-' + sid;
          }
          subm.disabled = true;
          setRowMgrFb(row3, 'decline', '提交中…', 'muted');
          try {
            var res = await fetch('/api/workbench/manager/decline-changes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
            setRowMgrFb(row3, 'decline', '已驳回', 'ok');
            if (noteEl) noteEl.value = '';
            if (pnl) pnl.hidden = true;
            await load();
          } catch (er) {
            setRowMgrFb(row3, 'decline', String(er && er.message ? er.message : er), 'err');
          } finally {
            subm.disabled = false;
          }
        } else if (submitKind === 'ack') {
          var pnlA = row3.querySelector('[data-mgr-panel="ack"]');
          var sigEl = pnlA ? pnlA.querySelector('select[data-field="signal"]') : null;
          var sig = sigEl ? String(sigEl.value || 'done').trim() : 'done';
          var nEl = pnlA ? pnlA.querySelector('textarea[data-field="ack-note"]') : null;
          var noteA = nEl ? String(nEl.value || '').trim() : '';
          var payloadA = { planId: planId, signal: sig, note: noteA };
          if (sid) payloadA.subtaskId = sid;
          if (ENFORCE_GUARDS) payloadA.idempotencyKey = 'ack-' + (sid || planId) + '-' + sig;
          subm.disabled = true;
          setRowMgrFb(row3, 'ack', '提交中…', 'muted');
          try {
            var resA = await fetch('/api/workbench/manager/ack-signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadA),
            });
            var dataA = await resA.json().catch(function () { return {}; });
            if (!resA.ok || !dataA.ok) throw new Error(dataA.error || ('HTTP ' + resA.status));
            setRowMgrFb(row3, 'ack', '已记录', 'ok');
            if (pnlA) pnlA.hidden = true;
            await load();
          } catch (er2) {
            setRowMgrFb(row3, 'ack', String(er2 && er2.message ? er2.message : er2), 'err');
          } finally {
            subm.disabled = false;
          }
        } else if (submitKind === 'ack-rejection') {
          var pnlR = row3.querySelector('[data-mgr-panel="ack-rejection"]');
          var rEl = pnlR ? pnlR.querySelector('textarea[data-field="ack-rejection-note"]') : null;
          var noteR = rEl ? String(rEl.value || '').trim() : '';
          var payloadR = { planId: planId, signal: 'ack_rejection', note: noteR };
          if (sid) payloadR.subtaskId = sid;
          if (ENFORCE_GUARDS) payloadR.idempotencyKey = 'ack-rejection-' + (sid || planId);
          subm.disabled = true;
          setRowMgrFb(row3, 'ack-rejection', '提交中…', 'muted');
          try {
            var resR = await fetch('/api/workbench/manager/ack-signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadR),
            });
            var dataR = await resR.json().catch(function () { return {}; });
            if (!resR.ok || !dataR.ok) throw new Error(dataR.error || ('HTTP ' + resR.status));
            setRowMgrFb(row3, 'ack-rejection', '已确认 · 已通知员工', 'ok');
            if (pnlR) pnlR.hidden = true;
            await load();
          } catch (er3) {
            setRowMgrFb(row3, 'ack-rejection', String(er3 && er3.message ? er3.message : er3), 'err');
          } finally {
            subm.disabled = false;
          }
        } else if (submitKind === 'stop') {
          var pnlS = row3.querySelector('[data-mgr-panel="stop"]');
          var noteElS = pnlS ? pnlS.querySelector('textarea[data-field="stop-note"]') : null;
          var noteS = noteElS ? String(noteElS.value || '').trim() : '';
          if (!sid) {
            setRowMgrFb(row3, 'stop', '缺少子任务', 'err');
            return;
          }
          if (!noteS) {
            setRowMgrFb(row3, 'stop', '请填写停止原因', 'err');
            return;
          }
          if (ENFORCE_GUARDS) {
            var cxS = pnlS ? pnlS.querySelector('input[data-field="stop-confirm"]') : null;
            if (!cxS || !cxS.checked) {
              setRowMgrFb(row3, 'stop', '请勾选确认停止', 'err');
              return;
            }
          }
          var payloadS = { planId: planId, subtaskId: sid, note: noteS };
          if (ENFORCE_GUARDS) {
            payloadS.confirm = true;
            payloadS.idempotencyKey = 'stop-' + sid;
          }
          subm.disabled = true;
          setRowMgrFb(row3, 'stop', '提交中…', 'muted');
          try {
            var resS = await fetch('/api/workbench/manager/subtasks/stop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadS),
            });
            var dataS = await resS.json().catch(function () { return {}; });
            if (!resS.ok || !dataS.ok) throw new Error(dataS.error || ('HTTP ' + resS.status));
            setRowMgrFb(row3, 'stop', dataS.alreadyStopped ? '子任务已停止' : '已停止', 'ok');
            if (noteElS) noteElS.value = '';
            if (pnlS) pnlS.hidden = true;
            await load();
          } catch (erS) {
            setRowMgrFb(row3, 'stop', String(erS && erS.message ? erS.message : erS), 'err');
          } finally {
            subm.disabled = false;
          }
        } else if (submitKind === 'set-due') {
          var pnlDue = row3.querySelector('[data-mgr-panel="set-due"]');
          var dueInput = pnlDue ? pnlDue.querySelector('input[data-field="due-at"]') : null;
          var noteInputDue = pnlDue ? pnlDue.querySelector('textarea[data-field="due-note"]') : null;
          var dueVal = dueInput ? String(dueInput.value || '').trim() : '';
          var noteDue = noteInputDue ? String(noteInputDue.value || '').trim() : '';
          if (!sid) {
            setRowMgrFb(row3, 'set-due', '缺少子任务', 'err');
            return;
          }
          if (!dueVal) {
            setRowMgrFb(row3, 'set-due', '请填写新截止日期', 'err');
            return;
          }
          var payloadDue = { subtaskId: sid, dueAt: dueVal, note: noteDue };
          subm.disabled = true;
          setRowMgrFb(row3, 'set-due', '提交中…', 'muted');
          try {
            var resDue = await fetch('/api/workbench/manager/subtasks/due', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadDue),
            });
            var dataDue = await resDue.json().catch(function () { return {}; });
            if (!resDue.ok || !dataDue.ok) throw new Error(dataDue.error || ('HTTP ' + resDue.status));
            setRowMgrFb(row3, 'set-due', '已更新截止日期', 'ok');
            if (pnlDue) pnlDue.hidden = true;
            await load();
          } catch (erDue) {
            setRowMgrFb(row3, 'set-due', String(erDue && erDue.message ? erDue.message : erDue), 'err');
          } finally {
            subm.disabled = false;
          }
        }
      })();
    });
  }
  function normSubStatus(st) {
    var s = String(st || '');
    if (s === 'ACCEPTED') return 'IN_PROGRESS';
    if (s === 'CHANGES_REQUESTED') return 'ASSIGNED';
    return s;
  }
  function rowBucketForSubtask(s) {
    var st = normSubStatus(s.status);
    if (st === 'DONE') return 'done';
    if (st === 'STOPPED') return 'stopped';
    var dk = String(s.openDeclineKind || '').trim();
    if (st === 'REJECTED' || dk === 'changes' || dk === 'rejected') return 'needs_manager';
    if (st === 'ASSIGNED') return 'waiting_employee';
    return 'in_progress';
  }
  function rowBucketsForSubtask(s) {
    return ['all', rowBucketForSubtask(s)];
  }
  function applyMgrSubtaskFilter(mountEl, f) {
    if (!mountEl) return;
    var key = String(f || 'all').trim() || 'all';
    mountEl.querySelectorAll('.mgr-sub-filter-chip[data-mgr-bucket]').forEach(function (b) {
      var bf = String(b.getAttribute('data-mgr-bucket') || '').trim();
      b.setAttribute('aria-pressed', bf === key ? 'true' : 'false');
    });
    mountEl.querySelectorAll('details.sub-row-mgr').forEach(function (row) {
      var st = String(row.getAttribute('data-status') || '');
      var dk = String(row.getAttribute('data-decline-kind') || '').trim();
      var bucket = rowBucketForSubtask({ status: st, openDeclineKind: dk || null });
      var match = key === 'all' || bucket === key;
      row.classList.toggle('mgr-sub-row--hidden', !match);
    });
  }
  function formatSubEventsMiniForRow(eventsArr, subId) {
    var picked = [];
    var sid = String(subId || '').trim();
    for (var ei = 0; ei < (eventsArr || []).length; ei++) {
      var e = eventsArr[ei];
      var esid = String(e.subtaskId || e.subtask_id || '').trim();
      if (esid !== sid) continue;
      if (picked.length >= 5) break;
      picked.push(e);
    }
    if (!picked.length) return '<p class="muted mgr-events-empty">暂无关联事件</p>';
    return (
      '<div class="mgr-events-mini">' +
      picked
        .map(function (e) {
          var when = fmtTime(e.occurredAt || e.occurred_at || '');
          var title = esc(e.title || e.type || '');
          var sum = esc(clipStr(e.summary || '', 220));
          return '<div class="mgr-ev"><time class="muted">' + when + '</time><div>' + title + ' · ' + sum + '</div></div>';
        })
        .join('') +
      '</div>'
    );
  }
  async function load(){
    var pageQs = new URLSearchParams(location.search);
    var taskNo = pageQs.get('taskNo') || '';
    var urlFocus = (pageQs.get('focus') || '').trim();
    var urlSubtaskId = (pageQs.get('subtaskId') || '').trim();
    var debugQ = pageQs.get('debug') === '1' ? '&debug=1' : '';
    if(!taskNo){ document.getElementById('taskMount').textContent='缺少 taskNo 参数'; return; }
    var res = await fetch('/api/workbench/tasks/detail?taskNo='+encodeURIComponent(taskNo)+debugQ);
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok || !data.ok){ document.getElementById('taskMount').textContent = data.error || ('HTTP '+res.status); return; }
    var t=data.task||{};
    var subsEarly = data.subtasks || [];
    function deriveTaskAttnLabel(subList) {
      var needs = 0, wait = 0, blocked = 0, done = 0, total = subList.length;
      subList.forEach(function(s) {
        var b = rowBucketForSubtask(s);
        if (b === 'needs_manager') needs++;
        if (b === 'waiting_employee') wait++;
        if (b === 'in_progress' && String(s.status||'') === 'BLOCKED') blocked++;
        if (b === 'done') done++;
      });
      if (total > 0 && done === total) return { label: '已完成', cls: 'done' };
      var stoppedOnly = subList.length > 0 && subList.every(function(s) {
        var st = normSubStatus(s.status);
        return st === 'DONE' || st === 'STOPPED';
      }) && subList.some(function(s) { return normSubStatus(s.status) === 'STOPPED'; });
      if (stoppedOnly) return { label: '已停止', cls: 'stopped' };
      if (blocked > 0 || subList.some(function(s){ return String(s.status||'')==='BLOCKED'; })) return { label: '阻塞中', cls: 'blocked' };
      if (needs > 0) return { label: '待您处理', cls: 'pending' };
      if (wait > 0) return { label: '待员工承接', cls: 'assigned' };
      return { label: '员工执行中', cls: 'progress' };
    }
    var attnTop = (ROLE === 'manager' || ROLE === 'admin') ? deriveTaskAttnLabel(subsEarly) : null;
    var stLabel = attnTop ? esc(attnTop.label) : esc(t.statusLabel || t.status || '—');
    var stBadgeCls = attnTop ? attnTop.cls : subBadgeClass(t.status);
    var planOpen = ROLE === 'admin' ? ' open' : '';
    var desc = String(t.description || '').trim();
    var descBlock = desc
      ? '<section class="task-desc"><h3 style="margin:12px 0 6px;font-size:15px;">任务背景</h3><div class="task-desc-body">'+esc(desc)+'</div></section>'
      : '<section class="task-desc muted"><p style="margin:10px 0 0;font-size:14px;">主管未填写任务整体背景。</p></section>';
    var mgrTop =
      ROLE === 'manager'
        ? '<p class="muted mgr-task-tools" style="margin:12px 0 0;font-size:13px;">'
          + '<a class="btn btn-secondary btn-sm" href="/workbench/manager/tasks?planId='
          + encodeURIComponent(String(t.planId || ''))
          + '&focus=reassign">前往改派页</a> <span class="muted">在「调整分配」中自动定位本任务并加载未完成子任务</span></p>'
        : ROLE === 'admin'
          ? '<p class="muted mgr-task-tools" style="margin:12px 0 0;font-size:13px;">'
            + '<button type="button" class="btn btn-secondary btn-sm" data-admin-open-reassign>打开改派</button>'
            + ' <span class="muted">使用本页下方改派卡片</span></p>'
          : '';
    function canStopTask(subList) {
      return subList.some(function (s) {
        var st = normSubStatus(s.status);
        return st !== 'DONE' && st !== 'STOPPED';
      });
    }
    var stopBlock = '';
    if ((ROLE === 'manager' || ROLE === 'admin') && canStopTask(subsEarly)) {
      stopBlock =
        '<div class="mgr-stop-wrap" style="margin:12px 0 0;">'
        + '<button type="button" class="btn btn-danger btn-sm" data-task-stop-toggle>停止全部未完成</button>'
        + '<p class="muted" style="margin:6px 0 0;font-size:12px;">将停止所有未完成的子任务（已完成子任务保留）；也可在下方对单条子任务停止。员工会收到通知。</p>'
        + '<div class="mgr-inline-panel mgr-inline-panel--danger" hidden data-task-panel="stop" style="margin-top:10px;">'
        + '<h4 class="mgr-inline-h">确认停止全部未完成</h4>'
        + '<label class="mgr-inline-label">停止原因<span class="mgr-req">（必填）</span>'
        + '<textarea data-task-field="stop-note" rows="3" maxlength="800" placeholder="简述停止原因，便于审计与通知员工。"></textarea></label>'
        + (ENFORCE_GUARDS
          ? '<label class="mgr-inline-confirm"><input type="checkbox" data-task-field="stop-confirm" /> 确认停止全部未完成</label>'
          : '')
        + '<div class="mgr-inline-actions">'
        + '<button type="button" class="btn btn-ghost btn-sm" data-task-stop-cancel>取消</button>'
        + '<button type="button" class="btn btn-danger btn-sm" data-task-stop-submit>确认停止</button></div>'
        + '<div class="feedback muted" data-task-fb="stop"></div></div></div>';
    }
    document.getElementById('taskMount').innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">'
      +'<h2 style="margin:0;font-size:20px;flex:1 1 200px;">'+esc(t.title||'—')+'</h2>'
      +'<span class="badge '+stBadgeCls+'">'+stLabel+'</span></div>'
      +'<p class="muted" style="margin:8px 0 0;">业务编号 <code>'+esc(t.taskNo||taskNo)+'</code></p>'
      + mgrTop
      + stopBlock
      + descBlock
      +'<details'+planOpen+' style="margin-top:10px;"><summary>内部编号（排障）</summary>'
      +'<p class="muted" style="margin:6px 0 0;">planId <code>'+esc(t.planId||'—')+'</code></p></details>';
    var crumbTitle = document.getElementById('detailBreadcrumbTitle');
    if (crumbTitle) crumbTitle.textContent = t.title || taskNo;
    var mainTitle = document.querySelector('.wb-main-title');
    if (mainTitle) mainTitle.textContent = t.title || '任务详情';
    var subs = data.subtasks || [];
    var events = data.events || [];
    function eventTs(ev) {
      var x = String(ev.occurredAt || ev.occurred_at || '').trim();
      var t = Date.parse(x);
      return isNaN(t) ? 0 : t;
    }
    function getOpenDeclineKindForSubtask(subId) {
      var sid = String(subId || '').trim();
      if (!sid) return null;
      var mine = [];
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        var esid = String(e.subtaskId || e.subtask_id || '').trim();
        if (esid !== sid) continue;
        mine.push(e);
      }
      mine.sort(function (a, b) {
        var da = eventTs(a);
        var db = eventTs(b);
        if (da !== db) return da - db;
        var ia = Number(a.eventRowId || a.id || a.eventId || 0) || 0;
        var ib = Number(b.eventRowId || b.id || b.eventId || 0) || 0;
        return ia - ib;
      });
      var bucket = 'none';
      for (var j = 0; j < mine.length; j++) {
        var et = String(mine[j].type || mine[j].eventType || mine[j].event_type || '').trim();
        if (et === 'SUBTASK_CHANGES_REQUESTED' || et === 'SUBTASK_CUSTOMIZE_NOTE') bucket = 'changes';
        else if (et === 'SUBTASK_REJECTED') bucket = 'rejected';
        else if (et === 'MANAGER_DECLINE_CHANGES') bucket = 'none';
        else if (et === 'MANAGER_REASSIGN') bucket = 'none';
        else if (bucket === 'changes' && et === 'SUBTASK_ACCEPTED') bucket = 'none';
        else if (bucket === 'rejected' && et === 'SUBTASK_ACCEPTED') bucket = 'none';
      }
      if (bucket === 'none') return null;
      return bucket;
    }
    lastSubsForReassign = subs;
    ensureMgrRowHandlers();
    ensureTaskActionHandlers();
    if(!subs.length){ document.getElementById('subtasksMount').textContent='暂无子任务'; }
    else if (ROLE === 'employee') {
      function empBucketFor(s) {
        var st = String(s.status || '');
        if (st === 'DONE') return 'done';
        if (st === 'REJECTED') return 'waiting';
        if (st === 'BLOCKED') return 'blocked';
        if (st === 'IN_PROGRESS') return 'in_progress';
        return 'assigned';
      }
      var mine = subs.filter(function (s) { return s.mine; });
      var sibs = subs.filter(function (s) { return !s.mine; });
      var parts = [];
      if (mine.length > 1) {
        function empCount(b) {
          return mine.filter(function (s) { return b === 'all' ? true : empBucketFor(s) === b; }).length;
        }
        var empChip = function (key, label, cnt) {
          return '<button type="button" data-emp-bucket="'+esc(key)+'" aria-pressed="false">'+esc(label)+' <span class="mgr-sub-filter-count">'+esc(String(cnt))+'</span></button>';
        };
        parts.push(
          '<div class="mgr-sub-filter-label muted" style="font-size:12px;margin:0 0 6px;font-weight:600;letter-spacing:.04em;">按状态筛选我的子任务</div>'
          + '<div class="emp-sub-filter" role="tablist" aria-label="我的子任务筛选">'
          + '<button type="button" data-emp-bucket="all" aria-pressed="true">全部 <span class="mgr-sub-filter-count">'+empCount('all')+'</span></button>'
          + empChip('assigned', '待承接', empCount('assigned'))
          + empChip('in_progress', '进行中', empCount('in_progress'))
          + empChip('blocked', '阻塞', empCount('blocked'))
          + empChip('waiting', '已拒绝 · 等主管', empCount('waiting'))
          + empChip('done', '已完成', empCount('done'))
          + '</div>'
        );
      }
      if (mine.length) {
        parts.push('<h4 class="subs-section-h">我的子任务</h4>');
        mine.forEach(function (s) {
          var cardCls = 'subtask-detail-card' + (String(s.status||'') === 'REJECTED' ? ' is-rejected-sub' : '');
          parts.push('<div class="'+cardCls+'" data-sub-highlight="'+esc(String(s.subtaskId||''))+'" data-emp-row-bucket="'+esc(empBucketFor(s))+'"><h4 style="margin:0 0 8px;font-size:16px;">'+esc(s.title||'—')+'</h4>');
          parts.push(subtaskPlanningBlock(s, subs));
          if (String(s.status||'') === 'REJECTED') {
            parts.push('<p class="muted subtask-rejected-hint" style="margin:10px 0 0;font-size:13px;">您已拒绝该子任务；主管已收到通知，请等待主管改派或确认。</p>');
          }
          parts.push('</div>');
        });
      }
      if (sibs.length) {
        parts.push('<h4 class="subs-section-h" style="margin-top:18px;">团队分工</h4>');
        parts.push('<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>子任务</th><th>负责人</th><th>状态</th></tr></thead><tbody>');
        sibs.forEach(function (s) {
          var bc = subBadgeClass(s.status);
          var who = esc(s.assigneeDisplayName || s.assigneeUserId || '—');
          var st = esc(s.statusLabel || s.status || '—');
          parts.push('<tr data-sub-highlight="'+esc(String(s.subtaskId||''))+'"><td>'+esc(String(s.orderIndex||''))+'</td><td>'+esc(s.title||'—')+'</td><td>'+who+'</td>'
            +'<td><span class="badge '+bc+'">'+st+'</span></td></tr>');
        });
        parts.push('</tbody></table></div>');
      }
      if (!parts.length) document.getElementById('subtasksMount').textContent='暂无子任务';
      else {
        var mountEmp = document.getElementById('subtasksMount');
        mountEmp.innerHTML = parts.join('');
        var empFilter = mountEmp.querySelector('.emp-sub-filter');
        if (empFilter && !empFilter.dataset.bound) {
          empFilter.dataset.bound = '1';
          empFilter.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('[data-emp-bucket]') : null;
            if (!btn) return;
            var key = String(btn.getAttribute('data-emp-bucket') || 'all').trim() || 'all';
            empFilter.querySelectorAll('button[data-emp-bucket]').forEach(function (b) {
              b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            mountEmp.querySelectorAll('[data-emp-row-bucket]').forEach(function (row) {
              var rb = String(row.getAttribute('data-emp-row-bucket') || '');
              row.style.display = (key === 'all' || key === rb) ? '' : 'none';
            });
          });
        }
      }
    } else {
      function countByFilter(f) {
        return subs.filter(function (s) {
          var rawId = String(s.subtaskId || '');
          var dkSrv = String(s.openDeclineKind || '').trim();
          var dk = dkSrv === 'changes' || dkSrv === 'rejected' ? dkSrv : getOpenDeclineKindForSubtask(rawId);
          var bucket = rowBucketForSubtask({ status: s.status, openDeclineKind: dk || null });
          if (f === 'needs_manager') return bucket === 'needs_manager';
          if (f === 'waiting_employee') return bucket === 'waiting_employee';
          if (f === 'in_progress') return bucket === 'in_progress';
          if (f === 'done') return bucket === 'done';
          if (f === 'stopped') return bucket === 'stopped';
          return true;
        }).length;
      }
      var initialFilter = countByFilter('needs_manager') > 0
        ? 'needs_manager'
        : (countByFilter('waiting_employee') > 0
          ? 'waiting_employee'
          : (countByFilter('in_progress') > 0 ? 'in_progress' : 'all'));
      if (urlSubtaskId) {
        var hitSu = subs.filter(function (x) { return String(x.subtaskId || '') === urlSubtaskId; })[0];
        if (hitSu) {
          var hitId = String(hitSu.subtaskId || '');
          var hitDkSrv = String(hitSu.openDeclineKind || '').trim();
          var hitDk = hitDkSrv === 'changes' || hitDkSrv === 'rejected' ? hitDkSrv : getOpenDeclineKindForSubtask(hitId);
          initialFilter = rowBucketForSubtask({ status: hitSu.status, openDeclineKind: hitDk || null });
        }
      }
      var reassignListHrefBase =
        '/workbench/manager/tasks?planId=' +
        encodeURIComponent(String(t.planId || '')) +
        '&focus=reassign';
      var chipHtml = function (key, label, cnt, alertCls) {
        var pressed = initialFilter === key ? 'true' : 'false';
        var ac = alertCls ? ' mgr-sub-filter-chip--alert' : '';
        return (
          '<button type="button" class="mgr-sub-filter-chip' +
          ac +
          '" data-mgr-bucket="' +
          esc(key) +
          '" aria-pressed="' +
          pressed +
          '">' +
          esc(label) +
          ' <span class="mgr-sub-filter-count">' +
          esc(String(cnt)) +
          '</span></button>'
        );
      };
      var head =
        '<div class="mgr-sub-filter-label muted" style="font-size:12px;margin:0 0 6px;font-weight:600;letter-spacing:.04em;">按状态筛选子任务</div>' +
        '<div class="mgr-sub-filter" role="tablist" aria-label="子任务筛选">' +
        chipHtml('needs_manager', '待您处理', countByFilter('needs_manager'), countByFilter('needs_manager') > 0) +
        chipHtml('waiting_employee', '待员工承接', countByFilter('waiting_employee'), false) +
        chipHtml('in_progress', '进行中', countByFilter('in_progress'), false) +
        chipHtml('done', '已完成', countByFilter('done'), false) +
        chipHtml('stopped', '已停止', countByFilter('stopped'), false) +
        chipHtml('all', '全部', subs.length, false) +
        '</div>';
      var rowParts = subs.map(function (s) {
        var rawId = String(s.subtaskId || '');
        var sid = esc(rawId);
        var st = String(s.status || '');
        var openAttr = urlSubtaskId && rawId === urlSubtaskId ? ' open' : '';
        var who = esc(s.assigneeDisplayName || s.assigneeUserId || '—');
        var stEsc = esc(s.statusLabel || st || '—');
        var bc = subBadgeClass(st);
        var idx = s.orderIndex != null && s.orderIndex !== '' ? esc(String(s.orderIndex)) : '—';
        var title = esc(s.title || '—');
        var due = s.dueAt
          ? esc(String(s.dueAt).slice(0, 10))
          : ('承接时自报' + (s.dueExpectation ? ('（期望：' + esc(String(s.dueExpectation)) + '）') : ''));
        var upd = fmtTime(s.updatedAt);
        var progHint = esc(clipStr(s.progressNote || '', 72));
        var actions = [];
        var dkSrv = String(s.openDeclineKind || '').trim();
        var declineKind =
          dkSrv === 'changes' || dkSrv === 'rejected' ? dkSrv : getOpenDeclineKindForSubtask(rawId);
        var bucketSrc = { status: st, openDeclineKind: declineKind || null };
        var declineBtnLabel = declineKind === 'rejected' ? '驳回拒绝' : declineKind === 'changes' ? '驳回申请' : '';
        if (st !== 'STOPPED') {
        if (declineKind) {
          actions.push(
            '<button type="button" class="btn btn-danger btn-sm" data-mgr-toggle="decline">' +
              esc(declineBtnLabel) +
              '</button>',
          );
        }
        if (st === 'BLOCKED' || st === 'DONE') {
          actions.push('<button type="button" class="btn btn-ghost btn-sm" data-mgr-toggle="ack">已知悉</button>');
        } else if (st === 'REJECTED') {
          actions.push('<button type="button" class="btn btn-secondary btn-sm" data-mgr-toggle="ack-rejection">接受拒绝</button>');
        }
        if ((st === 'IN_PROGRESS' || st === 'BLOCKED') && (ROLE === 'manager' || ROLE === 'admin')) {
          actions.push(
            '<button type="button" class="btn btn-primary btn-sm" data-mgr-remind-sub="' +
              sid +
              '">催办</button>',
          );
        }
        if (st !== 'DONE' && ROLE === 'manager') {
          actions.push(
            '<a class="btn btn-secondary btn-sm" href="' +
              esc(reassignListHrefBase + '&subtaskId=' + encodeURIComponent(rawId)) +
              '">改派页</a>',
          );
        } else if (st !== 'DONE' && st !== 'STOPPED') {
          actions.push(
            '<button type="button" class="btn btn-secondary btn-sm" data-mgr-open-reassign-sub="' +
              sid +
              '">改派</button>',
          );
        }
        if (st !== 'DONE' && st !== 'STOPPED' && (ROLE === 'manager' || ROLE === 'admin')) {
          actions.push(
            '<button type="button" class="btn btn-danger btn-sm" data-mgr-toggle="stop">停止</button>',
          );
        }
        if (st !== 'DONE' && st !== 'STOPPED' && (ROLE === 'manager' || ROLE === 'admin')) {
          actions.push(
            '<button type="button" class="btn btn-secondary btn-sm" data-mgr-toggle="set-due">改截止</button>',
          );
        }
        }
        var actionButtons = actions.join('');
        var summaryActionsRow = actionButtons
          ? (function () {
              var remindFb =
                st !== 'DONE' && (ROLE === 'manager' || ROLE === 'admin')
                  ? '<div class="feedback muted" data-mgr-fb="remind" style="margin-top:4px;font-size:12px;"></div>'
                  : '';
              return (
                '<div class="mgr-sub-summary-actions"><div class="mgr-sub-actions">' +
                actionButtons +
                '</div>' +
                remindFb +
                '</div>'
              );
            })()
          : '';
        var defaultSig = st === 'BLOCKED' ? 'blocked' : 'done';
        var note = String(s.progressNote || '').trim();
        var employeeSignal = '';
        if (declineKind === 'changes') {
          employeeSignal = '员工申请修改';
        } else if (declineKind === 'rejected') {
          employeeSignal = '员工拒绝承接';
        } else if (st === 'REJECTED') {
          employeeSignal = '员工拒绝承接';
        } else if (st === 'BLOCKED') {
          employeeSignal = '员工标记阻塞';
        } else if (st === 'DONE') {
          employeeSignal = '员工标记完成';
        }
        var feedbackTag = (declineKind || note) ? '<span class="mgr-feedback-tag">有反馈</span>' : '';
        var employeeDynamicHtml = '';
        if (employeeSignal || note || declineKind || st === 'REJECTED') {
          var dynParts = ['<div class="mgr-employee-dynamic">', '<div class="mgr-employee-info-h">员工动态</div>'];
          if (employeeSignal) dynParts.push('<span class="mgr-employee-signal">' + esc(employeeSignal) + '</span>');
          if (note) dynParts.push('<p class="mgr-inline-ctx">' + esc(note) + '</p>');
          if (st === 'REJECTED') {
            dynParts.push('<p class="mgr-rejected-pool-hint">请使用「改派页」调整负责人。</p>');
          }
          if (st === 'BLOCKED') {
            dynParts.push('<p class="mgr-blocked-hint muted" style="font-size:13px;margin:6px 0 0;">阻塞需关注：可在本行「已知悉」留痕或「催办」协调。</p>');
          }
          dynParts.push('</div>');
          employeeDynamicHtml = dynParts.join('');
        }
        var ctxHtml = '';
        if (declineKind === 'changes') {
          ctxHtml = note
            ? '<p class="mgr-inline-ctx">' + esc(note) + '</p>'
            : '<p class="mgr-inline-ctx muted">（员工未填写补充说明，可在下方「事件」中查看申请记录。）</p>';
        } else if (declineKind === 'rejected') {
          ctxHtml = note
            ? '<p class="mgr-inline-ctx">' + esc(note) + '</p>'
            : '<p class="mgr-inline-ctx muted">（拒绝理由见下方「本子任务事件」或全量事件。）</p>';
        }
        var declinePanelHeading =
          declineKind === 'rejected'
            ? '驳回拒绝承接 · 子任务将回到「进行中」'
            : '驳回调整申请 · 子任务将回到「进行中」';
        var declinePanel =
          declineKind
            ? '<div class="mgr-inline-panel mgr-inline-panel--danger" hidden data-mgr-panel="decline">' +
              '<h4 class="mgr-inline-h">' +
              esc(declinePanelHeading) +
              '</h4>' +
              '<div class="mgr-callout" role="status">驳回后负责人不变。</div>' +
              ctxHtml +
              '<label class="mgr-inline-label">驳回理由<span class="mgr-req">（必填）</span>' +
              '<textarea data-field="note" rows="3" maxlength="800" placeholder="简述不采纳的原因。"></textarea></label>' +
              (ENFORCE_GUARDS
                ? '<label class="mgr-inline-confirm"><input type="checkbox" data-field="confirm" /> 确认执行驳回</label>'
                : '') +
              '<div class="mgr-inline-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-mgr-cancel="decline">取消</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-mgr-submit="decline">提交驳回</button></div>' +
              '<div class="feedback muted" data-mgr-fb="decline"></div></div>'
            : '';
        var ackPanel =
          st === 'BLOCKED' || st === 'DONE'
            ? '<div class="mgr-inline-panel" hidden data-mgr-panel="ack">' +
              '<h4 class="mgr-inline-h">已知悉（留痕）</h4>' +
              '<p class="muted" style="margin:0 0 8px;font-size:13px;">不改变子任务状态，仅写入事件。</p>' +
              '<label class="mgr-inline-label">类型<select data-field="signal">' +
              '<option value="done"' +
              (defaultSig === 'done' ? ' selected' : '') +
              '>员工标记完成</option>' +
              '<option value="blocked"' +
              (defaultSig === 'blocked' ? ' selected' : '') +
              '>员工标记阻塞</option>' +
              '<option value="other">其他</option></select></label>' +
              '<label class="mgr-inline-label">备注（可选）<textarea data-field="ack-note" rows="2"></textarea></label>' +
              '<div class="mgr-inline-actions"><button type="button" class="btn btn-ghost btn-sm" data-mgr-cancel="ack">取消</button>' +
              '<button type="button" class="btn btn-primary btn-sm" data-mgr-submit="ack">已知悉</button></div>' +
              '<div class="feedback muted" data-mgr-fb="ack"></div></div>'
            : '';
        var ackRejectionPanel =
          st === 'REJECTED'
            ? '<div class="mgr-inline-panel" hidden data-mgr-panel="ack-rejection">' +
              '<h4 class="mgr-inline-h">接受拒绝（确认 · 留痕）</h4>' +
              '<p class="muted" style="margin:0 0 8px;font-size:13px;">' +
              '确认接受员工的拒绝，子任务保留「已拒绝」状态，员工会收到 1:1 通知；' +
              '后续可在「改派页」分配给其他人，或由您驳回拒绝让原员工继续。' +
              '</p>' +
              '<label class="mgr-inline-label">说明（建议填写，员工可见）<textarea data-field="ack-rejection-note" rows="3" placeholder="例如：已与你确认，本任务安排其他同事跟进。"></textarea></label>' +
              '<div class="mgr-inline-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-mgr-cancel="ack-rejection">取消</button>' +
              '<button type="button" class="btn btn-primary btn-sm" data-mgr-submit="ack-rejection">提交</button>' +
              '</div>' +
              '<div class="feedback muted" data-mgr-fb="ack-rejection"></div></div>'
            : '';
        var stopPanel =
          st !== 'DONE' && st !== 'STOPPED' && (ROLE === 'manager' || ROLE === 'admin')
            ? '<div class="mgr-inline-panel mgr-inline-panel--danger" hidden data-mgr-panel="stop">' +
              '<h4 class="mgr-inline-h">停止本子任务</h4>' +
              '<p class="muted" style="margin:0 0 8px;font-size:13px;">停止后负责人会收到通知，该子任务不可再改派或执行。</p>' +
              '<label class="mgr-inline-label">停止原因<span class="mgr-req">（必填）</span>' +
              '<textarea data-field="stop-note" rows="3" maxlength="800" placeholder="简述停止原因。"></textarea></label>' +
              (ENFORCE_GUARDS
                ? '<label class="mgr-inline-confirm"><input type="checkbox" data-field="stop-confirm" /> 确认停止本子任务</label>'
                : '') +
              '<div class="mgr-inline-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-mgr-cancel="stop">取消</button>' +
              '<button type="button" class="btn btn-danger btn-sm" data-mgr-submit="stop">确认停止</button></div>' +
              '<div class="feedback muted" data-mgr-fb="stop"></div></div>'
            : '';
        var duePanel =
          st !== 'DONE' && st !== 'STOPPED' && (ROLE === 'manager' || ROLE === 'admin')
            ? '<div class="mgr-inline-panel" hidden data-mgr-panel="set-due">' +
              '<h4 class="mgr-inline-h">调整截止日期</h4>' +
              '<label class="mgr-inline-label">新截止日期<span class="mgr-req">（必填）</span>' +
              '<input data-field="due-at" type="date" value="' + (s.dueAt ? esc(String(s.dueAt).slice(0, 10)) : '') + '" /></label>' +
              '<label class="mgr-inline-label">说明（可选）<textarea data-field="due-note" rows="2" maxlength="300" placeholder="例如：不接受第五天，改回三天内。"></textarea></label>' +
              '<div class="mgr-inline-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-mgr-cancel="set-due">取消</button>' +
              '<button type="button" class="btn btn-primary btn-sm" data-mgr-submit="set-due">确认改期</button></div>' +
              '<div class="feedback muted" data-mgr-fb="set-due"></div></div>'
            : '';
        return (
          '<details class="sub-row-mgr"' +
          openAttr +
          ' data-sub-highlight="' +
          sid +
          '" data-subtask-id="' +
          sid +
          '" data-status="' +
          esc(st) +
          '" data-decline-kind="' +
          esc(declineKind || '') +
          '" data-mgr-buckets="' +
          rowBucketsForSubtask(bucketSrc).join(',') +
          '">' +
          '<summary class="mgr-sub-summary' +
          (st === 'REJECTED' ? ' mgr-sub-summary--rejected-pool' : '') +
          '">' +
          '<div class="mgr-sub-summary-row1">' +
          '<span class="mgr-sub-idx">#' +
          idx +
          '</span>' +
          '<div class="mgr-sub-main"><div class="mgr-sub-title">' +
          title +
          '</div>' +
          '<div class="mgr-sub-meta muted">负责人 ' +
          who +
          ' · 更新 ' +
          upd +
          ' · 截止 ' +
          due +
          (progHint ? ' · ' + progHint : '') +
          (feedbackTag ? ' ' + feedbackTag : '') +
          '</div></div>' +
          '<span class="badge ' +
          bc +
          '">' +
          stEsc +
          '</span></div>' +
          summaryActionsRow +
          '</summary>' +
          '<div class="mgr-sub-body">' +
          employeeDynamicHtml +
          '<div class="mgr-sub-body-grid">' +
          subtaskPlanningBlock(s, subs) +
          '<div><div class="muted" style="font-weight:650;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;">本子任务事件</div>' +
          formatSubEventsMiniForRow(events, rawId) +
          '</div></div>' +
          declinePanel +
          ackPanel +
          ackRejectionPanel +
          stopPanel +
          duePanel +
          '</div></details>'
        );
      });
      var mount = document.getElementById('subtasksMount');
      mount.innerHTML = head + '<div class="mgr-sub-rows">' + rowParts.join('') + '</div>';
      if (!mount.dataset.mgrFilterBound) {
        mount.dataset.mgrFilterBound = '1';
        mount.addEventListener('click', function (ev) {
          var chip = ev.target && ev.target.closest ? ev.target.closest('[data-mgr-bucket]') : null;
          if (!chip || !mount.contains(chip)) return;
          applyMgrSubtaskFilter(mount, String(chip.getAttribute('data-mgr-bucket') || 'all').trim() || 'all');
        });
      }
      applyMgrSubtaskFilter(mount, initialFilter);
    }
    var eventsEl = document.getElementById('eventsMount');
    var eventsMore = document.getElementById('eventsMoreLink');
    var eventsFullLink = document.getElementById('eventsFullPageLink');
    if (eventsFullLink && EVENTS_PAGE_BASE && taskNo) {
      var fromView = pageQs.get('fromView') || 'current';
      eventsFullLink.href = EVENTS_PAGE_BASE + '?taskNo=' + encodeURIComponent(taskNo) + '&fromView=' + encodeURIComponent(fromView);
      if (eventsMore) eventsMore.style.display = 'block';
    }
    if(!events.length){
      if (eventsEl) eventsEl.textContent='暂无事件';
    } else {
      var timeline = events;
      if (ROLE === 'employee') {
        timeline = events.filter(function(e){
          var ty = String(e.type || e.eventType || '').trim();
          return KEY_EVENT_TYPES.indexOf(ty) >= 0;
        });
        timeline.sort(function(a,b){
          return (Date.parse(b.occurredAt||'')||0) - (Date.parse(a.occurredAt||'')||0);
        });
        timeline = timeline.slice(0, 8);
      } else {
        timeline = events.slice(0, 40);
      }
      if (!timeline.length) {
        if (eventsEl) eventsEl.textContent='暂无关键节点';
      } else if (eventsEl) {
        eventsEl.innerHTML = '<ul class="event-list">'+timeline.map(function(e){
          var sev = esc(e.severity||'info');
          var when = fmtTime(e.occurredAt || e.occurred_at || '');
          var title = esc(e.title || e.type || '');
          var sum = esc(e.summary || '');
          var det = e.detail ? '<details><summary>查看原始信息</summary><pre>'+esc(e.detail)+'</pre></details>' : '';
          return '<li class="event '+sev+'"><div class="event-row">'
            +'<span class="event-time">'+when+'</span>'
            +'<span class="event-title">'+title+'</span>'
            +'<span class="event-summary">'+sum+'</span></div>'+det+'</li>';
        }).join('')+'</ul>';
      }
    }
    if (ROLE === 'employee') {
      var mineSub = subs.filter(function(s){ return s.mine; })[0];
      var bar = document.getElementById('empDetailActionBar');
      var backL = document.getElementById('empBackListLink');
      var prim = document.getElementById('empPrimaryActionLink');
      var fromView = pageQs.get('fromView') || 'current';
      var listHref;
      if (fromView === 'history') {
        listHref = '/workbench/employee?view=history';
      } else if (mineSub && String(mineSub.status || '') === 'ASSIGNED') {
        listHref = '/workbench/employee?view=new';
      } else if (fromView === 'new') {
        listHref = '/workbench/employee?view=new';
      } else {
        listHref = '/workbench/employee?view=current';
      }
      if (backL) backL.href = listHref;
      if (prim && mineSub) {
        prim.style.display = 'inline-flex';
        if (String(mineSub.status||'') === 'ASSIGNED') {
          prim.textContent = '前往待承接';
          prim.href = listHref;
        } else if (String(mineSub.status||'') !== 'DONE' && String(mineSub.status||'') !== 'REJECTED') {
          prim.textContent = '前往进行中';
          prim.href = listHref;
        } else {
          prim.style.display = 'none';
        }
      }
    }
    lastLoadedPlanId = String(t.planId || '');
    var fcb = document.getElementById('focusContextBanner');
    if (fcb) {
      if (urlFocus === 'reassign') {
        fcb.style.display = 'block';
        fcb.innerHTML = '<p style="margin:0;font-size:14px;">你从通知进入：<strong>改派</strong>。请在下方「改派」卡片中处理。</p>';
      } else if (urlFocus === 'blocked') {
        fcb.style.display = 'block';
        fcb.innerHTML = '<p style="margin:0;font-size:14px;">你从通知进入：<strong>阻塞风险</strong>。请关注下方子任务状态与进度说明。</p>';
      } else if (urlFocus === 'review') {
        fcb.style.display = 'block';
        fcb.innerHTML =
          '<p style="margin:0;font-size:14px;">你从通知进入：<strong>知晓 / 抽检</strong>。请在对应子任务行展开后使用「已知悉」留痕；若有待修改申请，请使用「驳回申请」。</p>';
      } else {
        fcb.style.display = 'none';
        fcb.innerHTML = '';
      }
    }
    var rc = document.getElementById('reassignCard');
    if (rc && (ROLE !== 'manager' && ROLE !== 'admin')) rc.style.display = 'none';
    var asc = document.getElementById('addSubtaskCard');
    if (asc) {
      if ((ROLE === 'manager' || ROLE === 'admin') && String(t.status || '') !== 'STOPPED') {
        asc.style.display = 'block';
        prepareAddSubtaskFormUi(subs);
      } else {
        asc.style.display = 'none';
      }
    }
    if ((ROLE === 'manager' || ROLE === 'admin') && urlFocus === 'reassign' && lastLoadedPlanId) {
      initDetailReassign(subs, urlSubtaskId);
    } else if (rc) {
      rc.style.display = 'none';
    }
    if (urlSubtaskId) {
      setTimeout(function () {
        var hit = document.querySelector('[data-sub-highlight="' + cssEscAttr(urlSubtaskId) + '"]');
        if (hit) hit.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    }
  }
  void load();
})();
</script>`,
  });
}

const WORKBENCH_HTML_NO_STORE: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, must-revalidate",
  Pragma: "no-cache",
};
const NO_STORE_HEADERS = WORKBENCH_HTML_NO_STORE;

const JSON_UTF8 = "application/json; charset=utf-8";

function writeJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): void {
  const headers: Record<string, string | number | string[]> = {
    "Content-Type": JSON_UTF8,
    ...(extraHeaders ?? {}),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function writeAuthError(res: ServerResponse, status = 401, error = "Unauthorized"): void {
  writeJson(res, status, { ok: false, error });
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { Location: location };
  if (cookies.length > 0) headers["Set-Cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function requireSession(
  req: IncomingMessage,
  res: ServerResponse,
  expectedRole?: WorkbenchRole,
): WorkbenchSession | undefined {
  const session = getSessionFromRequest(req);
  if (!session) {
    writeAuthError(res, 401, "Session required");
    return undefined;
  }
  const normalized = isWorkbenchTestEntrySession(session)
    ? normalizeWorkbenchSession(session)
    : isExternalPasswordSession(session)
      ? normalizeWorkbenchSession({
        ...session,
        role: "employee",
        primaryRole: "employee",
      })
    : resolveEffectiveSession(req, res) ?? normalizeWorkbenchSession(session);

  if (expectedRole && isExternalPasswordSession(normalized) && expectedRole !== "employee") {
    logStructured({
      event: "workbench_role_forbidden",
      path: req.url ?? "",
      expectedRole,
      runtimeRole: normalized.role,
      sessionRole: normalized.role,
      primaryRole: normalized.primaryRole,
      userId: normalized.userId,
      loginSource: normalized.loginSource,
      reason: "external_password_session",
    });
    writeAuthError(res, 403, "Role forbidden");
    return undefined;
  }

  if (expectedRole && !sessionSatisfiesExpectedRole(normalized, expectedRole)) {
    logStructured({
      event: "workbench_role_forbidden",
      path: req.url ?? "",
      expectedRole,
      runtimeRole: normalized.role,
      sessionRole: normalized.role,
      primaryRole: normalized.primaryRole,
      userId: normalized.userId,
      loginSource: normalized.loginSource,
    });
    writeAuthError(res, 403, "Role forbidden");
    return undefined;
  }
  return normalized;
}

/** 交付绩效：主管视角或 admin 视角均可访问；范围由 session.role 决定。 */
function requirePerformanceDashboardSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = requireSession(req, res);
  if (!session) return undefined;
  if (session.role === "admin" && resolveRoleForUser(session.userId) === "admin") {
    return session;
  }
  if (allowsManagerSession(session)) return session;
  logStructured({
    event: "workbench_role_forbidden",
    path: req.url ?? "",
    expectedRole: "manager|admin",
    runtimeRole: session.role,
    sessionRole: session.role,
    primaryRole: session.primaryRole,
    userId: session.userId,
    loginSource: session.loginSource,
    reason: "performance_dashboard",
  });
  writeAuthError(res, 403, "Role forbidden");
  return undefined;
}

/** 日报汇总：主管 / 员工 / 管理员均可查看（实例开关开启时）。 */
function requireDailyReportsViewSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = requireSession(req, res);
  if (!session) return undefined;
  if (!isDailyReportsPageEnabled()) {
    writeJson(res, 404, { ok: false, error: "daily reports page disabled" });
    return undefined;
  }
  return session;
}

/** 日报名单管理：仅 admin（WORKBENCH_ADMIN_USER_IDS）可增删 / 搜人。 */
function requireDailyReportsAdminSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = requireDailyReportsViewSession(req, res);
  if (!session) return undefined;
  if (!resolveWorkbenchCapabilities(session.userId).canAccessAdmin) {
    writeJson(res, 403, { ok: false, error: "admin required" });
    return undefined;
  }
  return session;
}

/** 自定义项目组视图名单：admin 或视图 viewers 白名单。 */
function requireProjectViewRosterSession(
  req: IncomingMessage,
  res: ServerResponse,
  viewId: string,
): WorkbenchSession | undefined {
  const session = requireDailyReportsViewSession(req, res);
  if (!session) return undefined;
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    writeJson(res, 503, { ok: false, error: `日报配置无效：${errors.join("；")}` });
    return undefined;
  }
  const caps = resolveWorkbenchCapabilities(session.userId);
  if (
    !canManageProjectViewRoster(session.userId, viewId, config, {
      canAccessAdmin: caps.canAccessAdmin,
      canManage: caps.canManage,
    })
  ) {
    writeJson(res, 403, { ok: false, error: "无权管理此项目组名单" });
    return undefined;
  }
  return session;
}

/** 搜人：admin 或某 custom 视图 viewer（按组织）。 */
function requireDailyReportsContactsSession(
  req: IncomingMessage,
  res: ServerResponse,
  orgLabel: string,
): WorkbenchSession | undefined {
  const session = requireDailyReportsViewSession(req, res);
  if (!session) return undefined;
  const caps = resolveWorkbenchCapabilities(session.userId);
  if (caps.canAccessAdmin) return session;
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    writeJson(res, 503, { ok: false, error: `日报配置无效：${errors.join("；")}` });
    return undefined;
  }
  if (
    !canSearchProjectViewOrgContacts(session.userId, orgLabel, config, {
      canAccessAdmin: caps.canAccessAdmin,
      canManage: caps.canManage,
    })
  ) {
    writeJson(res, 403, { ok: false, error: "admin required" });
    return undefined;
  }
  return session;
}

function requireDailyReportsProjectGroupsWriteSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = requireDailyReportsViewSession(req, res);
  if (!session) return undefined;
  const caps = resolveWorkbenchCapabilities(session.userId);
  if (!caps.canManage && !caps.canAccessAdmin) {
    writeJson(res, 403, { ok: false, error: "manager or admin required" });
    return undefined;
  }
  return session;
}

function renderDailyReportsWorkbenchPage(params: {
  role: "manager" | "employee" | "admin";
  activeNav: "mgr-daily-reports" | "emp-daily-reports" | "adm-daily-reports";
  userId: string;
  userLabel?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
  initialDate?: string;
  initialView?: string;
}): string {
  const caps = resolveWorkbenchCapabilities(params.userId);
  const { config, errors } = loadDailyReportDigestConfig();
  const hasLegacyDailyReports =
    errors.length === 0 && configHasLegacyDailyReportEmployees(config.orgs);
  return renderDailyReportsPage({
    role: params.role,
    activeNav: params.activeNav,
    userLabel: params.userLabel,
    sessionUserId: params.userId,
    showAdminOpsLink: params.showAdminOpsLink,
    portfolioEnabled: params.portfolioEnabled,
    initialDate: params.initialDate,
    initialView: params.initialView ?? "project",
    canManageRoster: caps.canAccessAdmin && hasLegacyDailyReports,
    canManageProjectGroups: (caps.canManage || caps.canAccessAdmin) && hasLegacyDailyReports,
    canExecuteAsManager: caps.canExecuteAsManager,
  });
}

function isDailyReportsDataApiPath(pathname: string): boolean {
  return (
    pathname === "/api/workbench/daily-reports"
    || pathname === "/api/workbench/manager/daily-reports"
  );
}

function isDailyReportsContactsApiPath(pathname: string): boolean {
  return (
    pathname === "/api/workbench/daily-reports/contacts"
    || pathname === "/api/workbench/manager/daily-reports/contacts"
  );
}

function isDailyReportsRosterApiPath(pathname: string): boolean {
  return (
    pathname === "/api/workbench/daily-reports/roster"
    || pathname === "/api/workbench/manager/daily-reports/roster"
  );
}

function isDailyReportsProjectGroupsApiPath(pathname: string): boolean {
  return (
    pathname === "/api/workbench/daily-reports/project-groups"
    || pathname === "/api/workbench/manager/daily-reports/project-groups"
  );
}

function parseDailyReportsPageViewParam(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (v.toLowerCase() === "company") return "company";
  if (v.startsWith("custom:")) return v;
  return "project";
}

function resolveDailyReportsRolePath(session: { userId: string; role: WorkbenchRole; primaryRole?: WorkbenchRole }): string {
  const caps = resolveWorkbenchCapabilities(session.userId);
  const normalized = normalizeWorkbenchSession(session);
  if (normalized.role === "admin" && caps.canAccessAdmin) {
    return "/workbench/admin/daily-reports";
  }
  if (normalized.role === "manager" && caps.canManage) {
    return "/workbench/manager/daily-reports";
  }
  if (normalized.role === "employee" || caps.primaryRole === "employee") {
    return "/workbench/employee/daily-reports";
  }
  if (caps.canAccessAdmin) return "/workbench/admin/daily-reports";
  if (caps.canManage) return "/workbench/manager/daily-reports";
  return "/workbench/employee/daily-reports";
}

function performanceQueryFromUrl(url: URL) {
  return {
    windowDays: url.searchParams.get("windowDays"),
    periodKind: url.searchParams.get("periodKind"),
    periodAnchor: url.searchParams.get("periodAnchor"),
    projectId: url.searchParams.get("projectId") ?? undefined,
  };
}

function handlePerformanceDashboardGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  const session = requirePerformanceDashboardSession(req, res);
  if (!session) return true;
  if (!isPerformanceDashboardEnabled()) {
    writeJson(res, 404, { ok: false, error: "performance dashboard disabled" });
    return true;
  }
  const scope = resolvePerformanceScopeFromSession(session);
  const peopleStore = createPeopleDirectoryStore();
  try {
    const payload = buildPerformanceDashboardPayload({
      taskStore: getFormalTaskStore(),
      scope,
      ...performanceQueryFromUrl(url),
      resolveName: (uid) => peopleStore.getContact(uid)?.name?.trim(),
    });
    writeJson(res, 200, payload);
  } finally {
    peopleStore.close();
  }
  return true;
}

function handlePerformanceEmployeeDetailGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  const session = requirePerformanceDashboardSession(req, res);
  if (!session) return true;
  if (!isPerformanceDashboardEnabled()) {
    writeJson(res, 404, { ok: false, error: "performance dashboard disabled" });
    return true;
  }
  const userId = url.searchParams.get("userId")?.trim() ?? "";
  if (!userId) {
    writeJson(res, 400, { ok: false, error: "userId is required" });
    return true;
  }
  const scope = resolvePerformanceScopeFromSession(session);
  const peopleStore = createPeopleDirectoryStore();
  try {
    const payload = buildPerformanceEmployeeDetailPayload({
      taskStore: getFormalTaskStore(),
      scope,
      userId,
      ...performanceQueryFromUrl(url),
      resolveName: (uid) => peopleStore.getContact(uid)?.name?.trim(),
    });
    writeJson(res, payload.ok ? 200 : 404, payload);
  } finally {
    peopleStore.close();
  }
  return true;
}

function writePerformanceChatSse(res: ServerResponse, event: string, data: Record<string, unknown>): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeCompetencyEvalChatSse(res: ServerResponse, event: string, data: Record<string, unknown>): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function requireCompetencyEvalSessionFromRequest(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = requireSession(req, res, "manager");
  return requireCompetencyEvalSession(req, res, session);
}

async function handleCompetencyEvalChatPost(
  req: IncomingMessage,
  res: ServerResponse,
  session: WorkbenchSession,
): Promise<void> {
  if (!qwenConfig) {
    writeJson(res, 503, { ok: false, error: "LLM not configured" });
    return;
  }
  const body = await readJsonBody(req, 256 * 1024);
  const message = String(body.message ?? "").trim();
  if (!message) {
    writeJson(res, 400, { ok: false, error: "message is required" });
    return;
  }
  const activeRubricId = String(body.activeRubricId ?? "").trim() || undefined;
  const conversationHistory = parseCompetencyEvalConversationHistory(body.conversationHistory);
  const wantStream = body.stream === true
    || String(req.headers.accept ?? "").includes("text/event-stream");

  const turnInput = {
    userMessage: message,
    clientConfig: buildCompetencyEvalClientConfig(qwenConfig),
    employeeRepo,
    actorUserId: session.userId,
    activeRubricId,
    conversationHistory,
  } as const;

  if (wantStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    writeCompetencyEvalChatSse(res, "status", { phase: "thinking" });
    const turn = await runCompetencyEvalTurn({
      ...turnInput,
      onStreamStatus: (phase) => writeCompetencyEvalChatSse(res, "status", { phase }),
      onStreamDelta: (messagePreview) =>
        writeCompetencyEvalChatSse(res, "delta", { message: messagePreview }),
    });
    writeCompetencyEvalChatSse(res, "done", { ok: true, message: turn.message });
    res.end();
    return;
  }

  const turn = await runCompetencyEvalTurn(turnInput);
  writeJson(res, 200, { ok: true, message: turn.message });
}

async function handlePerformanceChatPost(
  req: IncomingMessage,
  res: ServerResponse,
  session: WorkbenchSession,
): Promise<void> {
  if (!isPerformanceDashboardEnabled()) {
    writeJson(res, 404, { ok: false, error: "performance dashboard disabled" });
    return;
  }
  if (!qwenConfig) {
    writeJson(res, 503, { ok: false, error: "LLM not configured" });
    return;
  }
  const body = await readJsonBody(req, 256 * 1024);
  const message = String(body.message ?? "").trim();
  if (!message) {
    writeJson(res, 400, { ok: false, error: "message is required" });
    return;
  }
  const scope = resolvePerformanceScopeFromSession(session);
  const periodOpts = parsePerformanceQueryInput({
    windowDays: body.windowDays,
    periodKind: body.periodKind,
    periodAnchor: body.periodAnchor,
  });
  const pageQuery = {
    ...periodOpts,
    projectId: String(body.projectId ?? "").trim() || undefined,
  };
  const conversationHistory = parsePerformanceConversationHistory(body.conversationHistory);
  const wantStream = body.stream === true
    || String(req.headers.accept ?? "").includes("text/event-stream");

  const turnInput = {
    userMessage: message,
    clientConfig: buildManagerQwenClientConfig(qwenConfig),
    employeeRepo,
    actorUserId: session.userId,
    scope,
    pageQuery,
    conversationHistory,
  } as const;

  if (wantStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    writePerformanceChatSse(res, "status", { phase: "thinking" });
    const turn = await runPerformanceAgentTurn({
      ...turnInput,
      onStreamStatus: (phase) => writePerformanceChatSse(res, "status", { phase }),
      onStreamDelta: (messagePreview) => writePerformanceChatSse(res, "delta", { message: messagePreview }),
    });
    writePerformanceChatSse(res, "done", { ok: true, message: turn.message });
    res.end();
    return;
  }

  const turn = await runPerformanceAgentTurn(turnInput);
  writeJson(res, 200, { ok: true, message: turn.message });
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > maxBytes) throw new Error("Request body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function handleAssignmentHttp(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  const isGetOrHead = req.method === "GET" || req.method === "HEAD";

  if (isGetOrHead && url.pathname === "/static/workbench-dd-login.js") {
    const bundlePath = resolveWorkbenchDdLoginBundlePath();
    if (!existsSync(bundlePath)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "// Workbench login bundle missing on server. Run: npm run build:workbench-login\n",
      );
      return true;
    }
    const body = readFileSync(bundlePath);
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
    return true;
  }

  if (isGetOrHead && url.pathname === "/static/workbench-draft-grid.js") {
    const bundlePath = resolveWorkbenchDraftGridBundlePath();
    if (!existsSync(bundlePath)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "// Workbench draft grid bundle missing. Run: npm run build:workbench-draft-grid\n",
      );
      return true;
    }
    const body = readFileSync(bundlePath);
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
    return true;
  }

  if (isGetOrHead && url.pathname === "/static/performance-chat-markdown.js") {
    const bundlePath = resolvePerformanceChatMarkdownBundlePath();
    if (!existsSync(bundlePath)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "// Performance chat markdown bundle missing. Run: npm run build:performance-chat-markdown\n",
      );
      return true;
    }
    const body = readFileSync(bundlePath);
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/workbench/auth/jsapi-config") {
    void (async () => {
      try {
        const rawUrl = String(url.searchParams.get("url") ?? "").trim();
        if (!rawUrl) {
          writeJson(res, 400, { ok: false, error: "url query parameter is required" });
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          writeJson(res, 400, { ok: false, error: "invalid url" });
          return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          writeJson(res, 400, { ok: false, error: "url must be http(s)" });
          return;
        }
        const pageUrlForSign = `${parsed.origin}${parsed.pathname}${parsed.search}`;
        const cfg = await buildWorkbenchJsapiConfig(pageUrlForSign);
        writeJson(res, 200, {
          ok: true,
          corpId: cfg.corpId,
          agentId: cfg.agentId,
          timeStamp: cfg.timeStamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status =
          msg.includes("DINGTALK_CORP_ID") ||
          msg.includes("DINGTALK_AGENT_ID") ||
          msg.includes("CLIENT_ID")
            ? 503
            : 502;
        writeJson(res, status, { ok: false, error: msg });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/auth/dingtalk") {
    void (async () => {
      try {
        const body = await readJsonBody(req);
        const authCode = String(body.authCode ?? "").trim();
        if (!authCode) {
          writeJson(res, 400, { ok: false, error: "authCode is required" });
          return;
        }
        const dingIdentity = await dingtalkAuthClient.resolveIdentityByAuthCode(authCode);
        const role = defaultLoginViewRole(dingIdentity.userId);
        logStructured({
          event: "workbench_dingtalk_auth_ok",
          userId: dingIdentity.userId,
          role,
          name: dingIdentity.name ?? "",
        });
        const session = createWorkbenchSession({
          userId: dingIdentity.userId,
          role,
          loginSource: "dingtalk_authcode",
          dingUser: {
            userId: dingIdentity.userId,
            name: dingIdentity.name,
            unionId: dingIdentity.unionId,
            loginAt: new Date().toISOString(),
          },
        });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": buildSessionCookie(session),
        });
        res.end(
          JSON.stringify({
            ok: true,
            userId: dingIdentity.userId,
            name: dingIdentity.name ?? null,
            role,
            redirectTo: defaultPathForRole(role),
          }),
        );
      } catch (err) {
        logStructured({
          event: "workbench_dingtalk_auth_failed",
          reason: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof DingTalkAuthError) {
          writeJson(res, err.statusCode, {
            ok: false,
            error: err.message,
            code: err.code,
          });
          return;
        }
        writeJson(res, 502, {
          ok: false,
          error: err instanceof Error ? err.message : "dingtalk auth failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/dingtalk/contact-event") {
    void (async () => {
      try {
        const expectedToken = String(process.env.DINGTALK_CONTACT_EVENT_TOKEN ?? "").trim();
        if (expectedToken) {
          const token = String(req.headers["x-contact-event-token"] ?? "").trim();
          if (token !== expectedToken) {
            writeJson(res, 403, { ok: false, error: "forbidden" });
            return;
          }
        }
        const body = await readJsonBody(req, 256 * 1024);
        const syncPayload = (body.biz_data && typeof body.biz_data === "object")
          ? (body.biz_data as Record<string, unknown>)
          : body;
        const result = await createDingTalkContactSyncService().applyContactEvent(syncPayload);
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "contact event handling failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/login") {
    void (async () => {
      try {
        if (!isWorkbenchTestLoginEnabled()) {
          writeJson(res, 403, {
            ok: false,
            error: "Test login is disabled in this environment",
          });
          return;
        }
        const body = await readJsonBody(req);
        const userId = String(body.userId ?? "").trim();
        const roleInput = String(body.role ?? "auto").trim();
        if (!userId) {
          writeJson(res, 400, { ok: false, error: "userId is required" });
          return;
        }
        const autoRole = defaultLoginViewRole(userId);
        if (roleInput === "admin" && !resolveWorkbenchCapabilities(userId).canAccessAdmin) {
          writeJson(res, 403, {
            ok: false,
            error: "userId is not in admin whitelist",
          });
          return;
        }
        if (roleInput === "manager" && autoRole === "employee") {
          writeJson(res, 403, {
            ok: false,
            error: "userId is not in manager whitelist",
          });
          return;
        }
        const role: WorkbenchRole =
          roleInput === "admin" || roleInput === "manager" || roleInput === "employee"
            ? roleInput
            : autoRole;
        const session = createWorkbenchSession({
          userId,
          role,
          loginSource: "entry",
          dingUser: {
            userId,
            loginAt: new Date().toISOString(),
          },
        });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": buildSessionCookie(session),
        });
        res.end(
          JSON.stringify({
            ok: true,
            role,
            redirectTo: defaultPathForRole(role),
          }),
        );
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === EXTERNAL_WORKBENCH_LOGIN_PATH) {
    if (!isWorkbenchExternalLoginEnabled()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("External login is disabled");
      return true;
    }
    const session = getSessionFromRequest(req);
    if (session && isExternalPasswordSession(session)) {
      redirect(res, readExternalLoginNextFromUrl(url.search));
      return true;
    }
    res.writeHead(200, WORKBENCH_HTML_NO_STORE);
    if (req.method === "HEAD") res.end();
    else res.end(renderExternalLoginHtml());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/external/login") {
    void (async () => {
      try {
        if (!isWorkbenchExternalLoginEnabled()) {
          writeJson(res, 403, {
            ok: false,
            error: "External login is disabled in this environment",
          });
          return;
        }
        const body = await readJsonBody(req);
        const username = String(body.username ?? "").trim();
        const password = String(body.password ?? "");
        if (!username || !password) {
          writeJson(res, 400, { ok: false, error: "username and password are required" });
          return;
        }
        const rateKey = externalLoginRateLimitKey(username, resolveClientIp(req));
        if (!checkExternalLoginRateLimit(rateKey)) {
          writeJson(res, 429, { ok: false, error: "Too many login attempts, try again later" });
          return;
        }
        const account = withPeopleDirectoryStore((store) =>
          store.verifyExternalAccountLogin(username, password),
        );
        if (!account) {
          writeJson(res, 401, { ok: false, error: "Invalid username or password" });
          return;
        }
        resetExternalLoginRateLimit(rateKey);
        const next = sanitizeWorkbenchNextPath(String(body.next ?? "").trim())
          ?? defaultPathForRole("employee");
        const session = createWorkbenchSession({
          userId: account.userId,
          role: "employee",
          loginSource: "external_password",
          dingUser: {
            userId: account.userId,
            name: account.displayName,
            loginAt: new Date().toISOString(),
          },
        });
        logStructured({
          event: "workbench_external_login_ok",
          userId: account.userId,
          username: account.username,
        });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": buildSessionCookie(session),
        });
        res.end(
          JSON.stringify({
            ok: true,
            role: "employee",
            redirectTo: next,
          }),
        );
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/external/change-password") {
    void (async () => {
      try {
        if (!isWorkbenchExternalLoginEnabled()) {
          writeJson(res, 403, { ok: false, error: "External login is disabled" });
          return;
        }
        const session = getSessionFromRequest(req);
        if (!session || !isExternalPasswordSession(session)) {
          writeAuthError(res, 401, "External session required");
          return;
        }
        const body = await readJsonBody(req);
        const currentPassword = String(body.currentPassword ?? "");
        const newPassword = String(body.newPassword ?? "").trim();
        if (!currentPassword || !newPassword) {
          writeJson(res, 400, { ok: false, error: "currentPassword and newPassword are required" });
          return;
        }
        if (newPassword.length < 8) {
          writeJson(res, 400, { ok: false, error: "新密码至少 8 位" });
          return;
        }
        if (currentPassword === newPassword) {
          writeJson(res, 400, { ok: false, error: "新密码不能与当前密码相同" });
          return;
        }
        const verified = withPeopleDirectoryStore((store) => {
          const account = store.getExternalAccountByUserId(session.userId);
          if (!account) return false;
          if (!store.verifyExternalAccountLogin(account.username, currentPassword)) return false;
          return store.updateExternalAccountPassword(session.userId, newPassword);
        });
        if (!verified) {
          writeJson(res, 400, { ok: false, error: "当前密码不正确" });
          return;
        }
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/logout") {
    const session = getSessionFromRequest(req);
    const redirectTo = resolveWorkbenchLogoutRedirect(session?.loginSource);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true, redirectTo }));
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/me") {
    const session = resolveEffectiveSession(req, res);
    if (!session) {
      writeAuthError(res, 401, "Session required");
      return true;
    }
    const caps = resolveWorkbenchCapabilities(session.userId);
    let externalAccount: { username: string; displayName: string } | undefined;
    if (isExternalPasswordSession(session)) {
      const account = withPeopleDirectoryStore((store) =>
        store.getExternalAccountByUserId(session.userId),
      );
      if (account) {
        externalAccount = {
          username: account.username,
          displayName: account.displayName,
        };
      }
    }
    writeJson(res, 200, {
      ok: true,
      userId: session.userId,
      role: session.role,
      primaryRole: session.primaryRole ?? caps.primaryRole,
      canExecuteAsManager: caps.canExecuteAsManager,
      canSwitchView: caps.canExecuteAsManager || caps.canAccessAdmin,
      canSwitchToAdmin: caps.canAccessAdmin && session.role !== "admin",
      canSwitchToManager: caps.canManage && session.role !== "manager",
      alsoManager: caps.alsoManager,
      canAccessAdmin: caps.canAccessAdmin,
      canManage: caps.canManage,
      loginSource: session.loginSource,
      dingUser: session.dingUser ?? null,
      externalAccount: externalAccount ?? null,
      exp: session.exp,
      projectPortfolioEnabled: isWorkbenchProjectPortfolioEnabled(session.userId),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/switch-view") {
    void (async () => {
      try {
        const session = resolveEffectiveSession(req, res);
        if (!session) {
          writeAuthError(res, 401, "Session required");
          return;
        }
        const body = await readJsonBody(req);
        const view = String(body.view ?? "").trim();
        if (view !== "manager" && view !== "employee" && view !== "admin") {
          writeJson(res, 400, { ok: false, error: "view must be manager, employee, or admin" });
          return;
        }
        const caps = resolveWorkbenchCapabilities(session.userId);
        if (view === "admin" && !caps.canAccessAdmin) {
          writeJson(res, 403, { ok: false, error: "User is not an admin" });
          return;
        }
        if (view === "manager" && !caps.canManage) {
          writeJson(res, 403, { ok: false, error: "User is not a manager" });
          return;
        }
        if (isExternalPasswordSession(session)) {
          writeJson(res, 403, { ok: false, error: "External accounts cannot switch view" });
          return;
        }
        if (view === "employee") {
          const canEmployee =
            caps.primaryRole === "employee" || caps.canExecuteAsManager;
          if (!canEmployee) {
            writeJson(res, 403, { ok: false, error: "Employee view not available" });
            return;
          }
        }
        const nextRole: WorkbenchRole =
          view === "admin" ? "admin" : view === "manager" ? "manager" : "employee";
        const refreshed = normalizeWorkbenchSession({
          ...session,
          primaryRole: caps.primaryRole,
          role: nextRole,
        });
        const redirectTo =
          view === "admin"
            ? "/workbench/admin/ops"
            : defaultPathForRole(refreshed.role, session.userId);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": buildSessionCookie(refreshed),
        });
        res.end(
          JSON.stringify({
            ok: true,
            role: refreshed.role,
            primaryRole: refreshed.primaryRole,
            redirectTo,
          }),
        );
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/tasks") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const projectId = isWorkbenchProjectPortfolioEnabled(session.userId)
      ? String(url.searchParams.get("projectId") ?? "").trim()
      : "";
    const tasks = enrichManagerTasksForApi(
      session.userId,
      projectId ? { projectId } : undefined,
    );
    writeJson(res, 200, { ok: true, tasks });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/weekly-dashboard") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const portfolioEnabled = isWorkbenchProjectPortfolioEnabled(session.userId);
    const projectId = portfolioEnabled
      ? String(url.searchParams.get("projectId") ?? "").trim()
      : "";
    const feedOnly = url.searchParams.get("feedOnly") === "1";
    const peopleStore = createPeopleDirectoryStore();
    try {
      const payload = buildWeeklyDashboardHttpPayload({
        taskStore: getFormalTaskStore(),
        managerUserId: session.userId,
        week: String(url.searchParams.get("week") ?? "").trim() || undefined,
        span: url.searchParams.get("span"),
        feedCursor: String(url.searchParams.get("feedCursor") ?? "").trim() || undefined,
        feedLimit: url.searchParams.get("feedLimit"),
        projectId: projectId || undefined,
        feedOnly,
        resolveName: (uid) => peopleStore.getContact(uid)?.name?.trim(),
      });
      writeJson(res, 200, payload);
    } finally {
      peopleStore.close();
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/weekly-advisor") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        const portfolioEnabled = isWorkbenchProjectPortfolioEnabled(session.userId);
        const body = await readJsonBody(req);
        const projectId = portfolioEnabled ? String(body.projectId ?? "").trim() : "";
        const peopleStore = createPeopleDirectoryStore();
        try {
          const payload = await buildWeeklyAdvisorHttpPayload({
            taskStore: getFormalTaskStore(),
            managerUserId: session.userId,
            week: String(body.week ?? "").trim() || undefined,
            span: body.span,
            projectId: projectId || undefined,
            resolveName: (uid) => peopleStore.getContact(uid)?.name?.trim(),
          });
          writeJson(res, 200, payload);
        } finally {
          peopleStore.close();
        }
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && isDailyReportsDataApiPath(url.pathname)) {
    const session = requireDailyReportsViewSession(req, res);
    if (!session) return true;
    const date = String(url.searchParams.get("date") ?? "").trim() || undefined;
    const view = parseDailyReportsViewParam(url.searchParams.get("view"));
    const refresh = url.searchParams.get("refresh") === "1";
    void (async () => {
      try {
        const caps = resolveWorkbenchCapabilities(session.userId);
        const payload = await buildDailyReportsHttpPayload({
          date,
          view,
          userId: session.userId,
          refresh,
          caps: {
            canAccessAdmin: caps.canAccessAdmin,
            canManage: caps.canManage,
          },
        });
        writeJson(res, 200, payload as unknown as Record<string, unknown>);
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && isDailyReportsProjectGroupsApiPath(url.pathname)) {
    const session = requireDailyReportsProjectGroupsWriteSession(req, res);
    if (!session) return true;
    try {
      writeJson(res, 200, { ok: true, members: listProjectGroupMembers() });
    } catch (err) {
      writeJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "invalid request",
      });
    }
    return true;
  }

  if (req.method === "POST" && isDailyReportsProjectGroupsApiPath(url.pathname)) {
    const session = requireDailyReportsProjectGroupsWriteSession(req, res);
    if (!session) return true;
    void (async () => {
      try {
        const body = await readJsonBody(req);
        const updates = Array.isArray(body.updates) ? body.updates : [];
        const members = updateProjectGroupAssignments(
          updates.map((u: Record<string, unknown>) => ({
            orgLabel: String(u.orgLabel ?? "").trim(),
            userid: String(u.userid ?? "").trim(),
            projectGroup: String(u.projectGroup ?? "").trim() as "intracranial" | "brain" | "ops",
          })),
        );
        writeJson(res, 200, { ok: true, members });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && isDailyReportsContactsApiPath(url.pathname)) {
    const org = String(url.searchParams.get("org") ?? "").trim();
    const session = requireDailyReportsContactsSession(req, res, org);
    if (!session) return true;
    const q = String(url.searchParams.get("q") ?? "").trim();
    void (async () => {
      try {
        const result = await searchOrgCandidates(org, q);
        writeJson(res, 200, { ok: true, ...result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && isDailyReportsRosterApiPath(url.pathname)) {
    const session = requireDailyReportsAdminSession(req, res);
    if (!session) return true;
    try {
      writeJson(res, 200, { ok: true, ...getRosterView() });
    } catch (err) {
      writeJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "invalid request",
      });
    }
    return true;
  }

  if (req.method === "POST" && isDailyReportsRosterApiPath(url.pathname)) {
    const session = requireDailyReportsAdminSession(req, res);
    if (!session) return true;
    void (async () => {
      try {
        const body = await readJsonBody(req);
        const action = String(body.action ?? "").trim();
        const org = String(body.org ?? "").trim();
        const userid = String(body.userid ?? "").trim();
        const name = String(body.name ?? "").trim() || undefined;
        if (!org || !userid) {
          writeJson(res, 400, { ok: false, error: "org 与 userid 必填" });
          return;
        }
        if (action === "add") {
          const result = await addToRoster(org, userid, name);
          writeJson(res, 200, { ok: true, ...result });
        } else if (action === "remove") {
          const result = removeFromRoster(org, userid);
          writeJson(res, 200, { ok: true, ...result });
        } else {
          writeJson(res, 400, { ok: false, error: "action 必须为 add 或 remove" });
        }
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  const projectViewRosterId = parseDailyReportsProjectViewRosterPath(url.pathname);
  if (isGetOrHead && projectViewRosterId) {
    const session = requireProjectViewRosterSession(req, res, projectViewRosterId);
    if (!session) return true;
    try {
      const payload = getProjectViewRosterPayload(projectViewRosterId);
      writeJson(res, payload.ok ? 200 : 404, payload as unknown as Record<string, unknown>);
    } catch (err) {
      writeJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : "invalid request",
      });
    }
    return true;
  }

  if (req.method === "POST" && projectViewRosterId) {
    const session = requireProjectViewRosterSession(req, res, projectViewRosterId);
    if (!session) return true;
    void (async () => {
      try {
        const body = await readJsonBody(req);
        const action = String(body.action ?? "").trim() as "add" | "remove";
        const userid = String(body.userid ?? "").trim();
        const name = String(body.name ?? "").trim() || undefined;
        if (!userid) {
          writeJson(res, 400, { ok: false, error: "userid 必填" });
          return;
        }
        const payload = await mutateProjectViewRoster({
          viewId: projectViewRosterId,
          action,
          userid,
          name,
        });
        writeJson(res, payload.ok ? 200 : 400, payload as unknown as Record<string, unknown>);
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  const projectViewDiscoverId = parseDailyReportsProjectViewDiscoverPath(url.pathname);
  if (req.method === "POST" && projectViewDiscoverId) {
    const session = requireProjectViewRosterSession(req, res, projectViewDiscoverId);
    if (!session) return true;
    void (async () => {
      try {
        const payload = await rediscoverProjectViewRoster(projectViewDiscoverId);
        writeJson(res, payload.ok ? 200 : 400, payload as unknown as Record<string, unknown>);
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/performance") {
    return handlePerformanceDashboardGet(req, res, url);
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/performance") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    return handlePerformanceDashboardGet(req, res, url);
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/performance/employee") {
    return handlePerformanceEmployeeDetailGet(req, res, url);
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/performance/employee") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    return handlePerformanceEmployeeDetailGet(req, res, url);
  }

  if (isGetOrHead && url.pathname === "/api/workbench/competency-eval/sessions") {
    const session = requireCompetencyEvalSessionFromRequest(req, res);
    if (!session) return true;
    writeJson(res, 200, buildCompetencyEvalSessionsPayload(session.userId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/competency-eval/sessions") {
    const session = requireCompetencyEvalSessionFromRequest(req, res);
    if (!session) return true;
    writeJson(res, 200, handleCompetencyEvalSessionCreate(session.userId));
    return true;
  }

  const compEvalSessionActivateId = parseCompetencyEvalSessionActivatePath(url.pathname);
  if (req.method === "POST" && compEvalSessionActivateId) {
    const session = requireCompetencyEvalSessionFromRequest(req, res);
    if (!session) return true;
    const payload = handleCompetencyEvalSessionActivate(session.userId, compEvalSessionActivateId);
    writeJson(res, payload.ok ? 200 : 404, payload);
    return true;
  }

  const compEvalSessionId = parseCompEvalSessionIdFromPath(url.pathname);
  if (compEvalSessionId) {
    if (isGetOrHead) {
      const session = requireCompetencyEvalSessionFromRequest(req, res);
      if (!session) return true;
      const payload = handleCompetencyEvalSessionGet(session.userId, compEvalSessionId);
      writeJson(res, payload.ok ? 200 : 404, payload);
      return true;
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      void (async () => {
        try {
          const session = requireCompetencyEvalSessionFromRequest(req, res);
          if (!session) return;
          const body = await readJsonBody(req, 512 * 1024);
          const payload = handleCompetencyEvalSessionSave(
            session.userId,
            compEvalSessionId,
            body as Record<string, unknown>,
          );
          writeJson(res, payload.ok ? 200 : 404, payload);
        } catch (err) {
          writeJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : "save failed",
          });
        }
      })();
      return true;
    }
    if (req.method === "DELETE") {
      const session = requireCompetencyEvalSessionFromRequest(req, res);
      if (!session) return true;
      const payload = handleCompetencyEvalSessionDelete(session.userId, compEvalSessionId);
      writeJson(res, payload.ok ? 200 : 404, payload);
      return true;
    }
  }

  if (isGetOrHead && url.pathname === "/api/workbench/competency-eval/rubrics") {
    const session = requireCompetencyEvalSessionFromRequest(req, res);
    if (!session) return true;
    writeJson(res, 200, buildCompetencyEvalRubricsPayload(session.userId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/competency-eval/rubrics/upload") {
    void (async () => {
      try {
        const session = requireCompetencyEvalSessionFromRequest(req, res);
        if (!session) return;
        let multipart;
        try {
          multipart = await readMultipartSingleFile(req, { maxFileBytes: 2 * 1024 * 1024 });
        } catch (err) {
          writeJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : "multipart parse failed",
          });
          return;
        }
        if (!multipart.file) {
          writeJson(res, 400, { ok: false, error: "缺少上传文件字段（form 字段名：file）" });
          return;
        }
        const payload = await handleCompetencyEvalRubricUpload({
          userId: session.userId,
          filename: multipart.file.filename,
          mimeType: multipart.file.mimeType,
          buffer: multipart.file.buffer,
        });
        writeJson(res, payload.ok ? 200 : 400, payload);
      } catch (err) {
        writeJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : "upload failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "DELETE") {
    const rubricId = parseCompetencyEvalRubricIdFromPath(url.pathname);
    if (rubricId) {
      const session = requireCompetencyEvalSessionFromRequest(req, res);
      if (!session) return true;
      const payload = handleCompetencyEvalRubricDelete(session.userId, rubricId);
      writeJson(res, payload.ok ? 200 : 404, payload);
      return true;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/competency-eval/chat") {
    void (async () => {
      try {
        const session = requireCompetencyEvalSessionFromRequest(req, res);
        if (!session) return;
        await handleCompetencyEvalChatPost(req, res, session);
      } catch (err) {
        if (!res.headersSent) {
          writeJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : "chat failed",
          });
        } else {
          writeCompetencyEvalChatSse(res, "error", {
            error: err instanceof Error ? err.message : "chat failed",
          });
          res.end();
        }
      }
    })();
    return true;
  }

  if (req.method === "POST" && (
    url.pathname === "/api/workbench/manager/performance/chat"
    || url.pathname === "/api/workbench/admin/performance/chat"
  )) {
    void (async () => {
      try {
        const isAdminChat = url.pathname.startsWith("/api/workbench/admin/");
        const session = isAdminChat
          ? requireSession(req, res, "admin")
          : requirePerformanceDashboardSession(req, res);
        if (!session) return;
        await handlePerformanceChatPost(req, res, session);
      } catch (err) {
        if (!res.headersSent) {
          writeJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : "chat failed",
          });
        } else {
          writePerformanceChatSse(res, "error", {
            error: err instanceof Error ? err.message : "chat failed",
          });
          res.end();
        }
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/meeting-import/parse") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isMeetingImportEnabled()) {
          writeJson(res, 404, { ok: false, error: "meeting import disabled" });
          return;
        }
        if (!requirePortfolioManager(session, res)) return;
        const body = await readJsonBody(req);
        const result = await handleMeetingImportParse({
          taskStore: getFormalTaskStore(),
          managerUserId: session.userId,
          pastedText: String(body.pastedText ?? ""),
          docUrl: String(body.docUrl ?? ""),
          meetingTitle: String(body.meetingTitle ?? ""),
          meetingDate: String(body.meetingDate ?? ""),
        });
        writeJson(res, 200, { ok: true, ...result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "parse failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/meeting-import/analyze") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isMeetingImportEnabled()) {
          writeJson(res, 404, { ok: false, error: "meeting import disabled" });
          return;
        }
        if (!requirePortfolioManager(session, res)) return;
        const body = await readJsonBody(req);
        const projectId = String(body.projectId ?? "").trim();
        if (!projectId) {
          writeJson(res, 400, { ok: false, error: "projectId is required" });
          return;
        }
        const result = await handleMeetingImportAnalyze({
          taskStore: getFormalTaskStore(),
          managerUserId: session.userId,
          batchId: String(body.batchId ?? "").trim(),
          projectId,
          projectName: String(body.projectName ?? "").trim(),
          items: Array.isArray(body.items) ? body.items : [],
          meetingTitle: String(body.meetingTitle ?? "").trim() || undefined,
        });
        writeJson(res, 200, { ok: true, ...result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "analyze failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/meeting-import/commit") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isMeetingImportEnabled()) {
          writeJson(res, 404, { ok: false, error: "meeting import disabled" });
          return;
        }
        if (!requirePortfolioManager(session, res)) return;
        const body = await readJsonBody(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const result = await handleMeetingImportCommit({
          taskStore: getFormalTaskStore(),
          managerUserId: session.userId,
          batchId: String(body.batchId ?? "").trim(),
          projectId: String(body.projectId ?? "").trim(),
          projectName: String(body.projectName ?? "").trim(),
          meetingTitle: String(body.meetingTitle ?? "").trim() || undefined,
          rows,
          actorName: session.dingUser?.name,
        });
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "commit failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/task-intake/preview") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isTaskIntakeEnabled()) {
          writeJson(res, 404, { ok: false, error: "task_intake_disabled" });
          return;
        }
        const body = await readJsonBody(req);
        const existing = getFormalTaskStore()
          .listManagerTasks(session.userId)
          .filter((t) => t.status !== "DONE" && t.status !== "STOPPED")
          .map((t) => ({ planId: t.planId, title: t.title, taskNo: t.taskNo }));
        const result = await handleTaskIntakePreview({
          pastedText: String(body.pastedText ?? ""),
          parentTitle: String(body.parentTitle ?? ""),
          existingTasks: existing,
        });
        writeJson(res, 200, { ok: true, ...result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "preview failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/task-intake/commit") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isTaskIntakeEnabled()) {
          writeJson(res, 404, { ok: false, error: "task_intake_disabled" });
          return;
        }
        const body = await readJsonBody(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        // Project archiving is optional and only meaningful for portfolio managers.
        const portfolioEnabled = isWorkbenchProjectPortfolioEnabled(session.userId);
        const projectId = portfolioEnabled ? String(body.projectId ?? "").trim() : "";
        const projectName = portfolioEnabled ? String(body.projectName ?? "").trim() : "";
        const stageDraft = (staged: {
          draft: Record<string, unknown>;
          assignment: Record<string, unknown>;
        }): void => {
          const target = findMainThreadSession(session.userId);
          const nowIso = new Date().toISOString();
          planSessionStore.save({
            ...target,
            senderStaffId: session.userId,
            latestDraft: staged.draft,
            latestAssignment: staged.assignment as PlanSession["latestAssignment"],
            updatedAt: nowIso,
            revisionEvents: [
              ...(target.revisionEvents ?? []),
              {
                occurredAt: nowIso,
                eventType: "TASK_INTAKE_STAGED",
                planId: target.planId,
              },
            ].slice(-60),
          });
        };
        const result = await handleTaskIntakeCommit({
          taskStore: getFormalTaskStore(),
          managerUserId: session.userId,
          parentTitle: String(body.parentTitle ?? "").trim(),
          parentDescription: String(body.parentDescription ?? "").trim(),
          projectId: projectId || undefined,
          projectName: projectName || undefined,
          rows,
          actorName: session.dingUser?.name,
          stageDraft,
        });
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "commit failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/task-intake/append") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!isTaskIntakeEnabled()) {
          writeJson(res, 404, { ok: false, error: "task_intake_disabled" });
          return;
        }
        const body = await readJsonBody(req);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const targetPlanId = String(body.targetPlanId ?? "").trim();
        if (!targetPlanId) {
          writeJson(res, 400, { ok: false, error: "targetPlanId is required" });
          return;
        }
        const result = await handleTaskIntakeAppend({
          taskStore: getFormalTaskStore(),
          managerUserId: session.userId,
          targetPlanId,
          rows,
          actorName: session.dingUser?.name,
        });
        writeJson(res, 200, { ok: true, result });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "append failed",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/projects") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    if (!requirePortfolioManager(session, res)) return true;
    const payload = buildManagerProjectsListResponse(session.userId);
    writeJson(res, 200, { ok: true, ...payload });
    return true;
  }

  const managerProjectDetailMatch = url.pathname.match(
    /^\/api\/workbench\/manager\/projects\/([^/]+)$/,
  );
  if (isGetOrHead && managerProjectDetailMatch) {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    if (!requirePortfolioManager(session, res)) return true;
    const projectId = decodeURIComponent(managerProjectDetailMatch[1] ?? "");
    const detail = buildManagerProjectDetailResponse(session.userId, projectId);
    if (!detail) {
      writeJson(res, 404, { ok: false, error: "project_not_found" });
      return true;
    }
    writeJson(res, 200, { ok: true, ...detail });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/projects") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!requirePortfolioManager(session, res)) return;
        const body = await readJsonBody(req);
        const name = String(body.name ?? "").trim();
        if (!name) {
          writeJson(res, 400, { ok: false, error: "name is required" });
          return;
        }
        const store = getFormalTaskStore();
        const project = store.createProject({
          ownerUserId: session.userId,
          name,
          description: String(body.description ?? "").trim() || undefined,
          aliases: Array.isArray(body.aliases)
            ? (body.aliases as unknown[]).map((x) => String(x).trim()).filter(Boolean)
            : undefined,
        });
        writeJson(res, 200, { ok: true, project });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (req.method === "PATCH" && managerProjectDetailMatch) {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!requirePortfolioManager(session, res)) return;
        const projectId = decodeURIComponent(managerProjectDetailMatch[1] ?? "");
        const body = await readJsonBody(req);
        const store = getFormalTaskStore();
        const project = store.updateProject({
          projectId,
          ownerUserId: session.userId,
          name: body.name !== undefined ? String(body.name).trim() : undefined,
          description:
            body.description !== undefined ? String(body.description).trim() : undefined,
          status:
            body.status === "archived" || body.status === "active"
              ? body.status
              : undefined,
          aliases: Array.isArray(body.aliases)
            ? (body.aliases as unknown[]).map((x) => String(x).trim()).filter(Boolean)
            : undefined,
        });
        writeJson(res, 200, { ok: true, project });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid request";
        const status = msg.includes("not found") ? 404 : 400;
        writeJson(res, status, { ok: false, error: msg });
      }
    })();
    return true;
  }

  const managerTaskProjectMatch = url.pathname.match(
    /^\/api\/workbench\/manager\/tasks\/([^/]+)\/project$/,
  );
  if (req.method === "POST" && managerTaskProjectMatch) {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!requirePortfolioManager(session, res)) return;
        const taskNo = decodeURIComponent(managerTaskProjectMatch[1] ?? "");
        const body = await readJsonBody(req);
        const rawPid = body.projectId;
        const projectId =
          rawPid === null || rawPid === undefined
            ? null
            : String(rawPid).trim() || null;
        const store = getFormalTaskStore();
        const task = store.setTaskProject({
          taskNo,
          managerUserId: session.userId,
          projectId,
        });
        writeJson(res, 200, { ok: true, task });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid request";
        const status = msg.includes("not found") ? 404 : 400;
        writeJson(res, status, { ok: false, error: msg });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/active-project") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        if (!requirePortfolioManager(session, res)) return;
        const body = await readJsonBody(req);
        const target =
          resolveConversationThread(session.userId, { threadKind: "main" })
          ?? findMainThreadSession(session.userId);
        const pid = String(body.projectId ?? "").trim();
        const store = getFormalTaskStore();
        if (!pid) {
          target.activeProjectId = undefined;
        } else {
          const proj = store.getProject(pid, session.userId);
          if (!proj || proj.status !== "active") {
            writeJson(res, 400, { ok: false, error: "invalid_project" });
            return;
          }
          target.activeProjectId = pid;
        }
        planSessionStore.save(target);
        writeJson(res, 200, {
          ok: true,
          projectId: target.activeProjectId ?? null,
          projectName: target.activeProjectId
            ? store.getProject(target.activeProjectId, session.userId)?.name
            : null,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/contacts") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const keyword = String(url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const contacts = withPeopleDirectoryStore((store) =>
      keyword ? store.searchContacts(keyword, 40) : store.listContacts().slice(0, 40),
    );
    const rows = contacts.slice(0, 40).map((contact) => {
      const deptSummary = [...new Set(contact.departmentNames.filter(Boolean))].slice(0, 3).join(" / ");
      return {
        userId: contact.userId,
        name: contact.name,
        departmentName: contact.departmentNames[0] ?? "未分配部门",
        departmentSummary: deptSummary || (contact.departmentNames[0] ?? "未分配部门"),
        departmentNames: contact.departmentNames,
        matchedField: contact.matchedField ?? (keyword ? "other" : "name"),
        active: contact.active,
      };
    });
    writeJson(res, 200, { ok: true, contacts: rows });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/tasks") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    const status = String(url.searchParams.get("status") ?? "").trim();
    const department = String(url.searchParams.get("department") ?? "").trim();
    const assignee = String(url.searchParams.get("assignee") ?? "").trim();
    const taskNo = String(url.searchParams.get("taskNo") ?? "").trim();
    const keyword = String(url.searchParams.get("keyword") ?? "").trim();
    const tasks = getFormalTaskStore()
      .listAdminTasks({
        status,
        department,
        assignee,
        taskNo,
        keyword,
      })
      .map((t) => ({
        ...t,
        managerDisplayName:
          withPeopleDirectoryStore((s) => s.getContact(t.managerUserId)?.name?.trim()) ?? "",
        statusLabel: taskStatusLabel(t.status),
      }));
    writeJson(res, 200, { ok: true, tasks });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/task-detail") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    const taskId = String(url.searchParams.get("taskId") ?? "").trim();
    const planId = String(url.searchParams.get("planId") ?? "").trim();
    const taskNo = String(url.searchParams.get("taskNo") ?? "").trim();
    const key = taskNo || taskId || planId;
    if (!key) {
      writeJson(res, 400, { ok: false, error: "taskNo or taskId or planId is required" });
      return true;
    }
    const detail = getFormalTaskStore().getTaskDetail(key);
    if (!detail) {
      writeJson(res, 404, { ok: false, error: "Task not found" });
      return true;
    }
    const enriched = enrichWorkbenchTaskDetail(detail, {
      presentEventCtx: { showManagerReassignPayload: true },
    });
    writeJson(res, 200, {
      ok: true,
      task: enriched.task,
      subtasks: attachSubtaskOpenDeclineHints(enriched.subtasks),
      events: enriched.events,
    });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/tasks/detail") {
    const session = requireSession(req, res);
    if (!session) return true;
    const taskNo = String(url.searchParams.get("taskNo") ?? "").trim();
    const debugTimeline = String(url.searchParams.get("debug") ?? "").trim() === "1";
    const omitReassignNotifyEvents =
      !debugTimeline && (session.role === "manager" || session.role === "employee");
    const showManagerReassignPayload =
      session.role === "admin" || (debugTimeline && session.role === "manager");
    if (!taskNo) {
      writeJson(res, 400, { ok: false, error: "taskNo is required" });
      return true;
    }
    const detail = getFormalTaskStore().getTaskDetail(taskNo);
    if (!detail) {
      writeJson(res, 404, { ok: false, error: "Task not found" });
      return true;
    }
    if (session.role === "manager" && detail.task.managerUserId !== session.userId) {
      writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
      return true;
    }
    if (session.role === "employee") {
      const own = detail.subtasks.some((subtask) => subtask.assigneeUserId === session.userId);
      if (!own) {
        writeJson(res, 403, { ok: false, error: "Task does not belong to current employee" });
        return true;
      }
      const mySubtaskIds = new Set(
        detail.subtasks
          .filter((s) => s.assigneeUserId === session.userId)
          .map((s) => s.subtaskId),
      );
      /** 员工详情时间线：仅本人子任务事件 + 一条任务级「已发布」摘要，避免暴露改派/他人通知等任务级日志。 */
      const EMPLOYEE_TASK_LEVEL_EVENT_WHITELIST = new Set(["TASK_PUBLISHED"]);
      const detailForEmployee = {
        ...detail,
        events: detail.events.filter((row) => {
          const r = row as Record<string, unknown>;
          const sid = String(r.subtask_id ?? "").trim();
          const eventType = String(r.event_type ?? "").trim();
          if (sid) return mySubtaskIds.has(sid);
          return EMPLOYEE_TASK_LEVEL_EVENT_WHITELIST.has(eventType);
        }),
      };
      const enriched = enrichWorkbenchTaskDetail(detailForEmployee, {
        omitReassignNotifyEvents,
        presentEventCtx: { showManagerReassignPayload },
      });
      const subtasksWithMine = enriched.subtasks.map((s) => {
        const mine = s.assigneeUserId === session.userId;
        if (mine) return { ...s, mine: true };
        return {
          subtaskId: s.subtaskId,
          sourceTaskKey: s.sourceTaskKey,
          title: s.title,
          assigneeUserId: s.assigneeUserId,
          assigneeDisplayName: s.assigneeDisplayName,
          status: s.status,
          statusLabel: s.statusLabel,
          orderIndex: s.orderIndex,
          mine: false,
        };
      });
      writeJson(res, 200, {
        ok: true,
        task: enriched.task,
        subtasks: subtasksWithMine,
        events: enriched.events,
      });
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      ...(() => {
        const enriched = enrichWorkbenchTaskDetail(detail, {
          omitReassignNotifyEvents,
          presentEventCtx: { showManagerReassignPayload },
        });
        if (session.role === "manager" || session.role === "admin") {
          return {
            task: enriched.task,
            subtasks: attachSubtaskOpenDeclineHints(enriched.subtasks),
            events: enriched.events,
          };
        }
        return enriched;
      })(),
    });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/employees") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    const keyword = String(url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const contacts = withPeopleDirectoryStore((store) =>
      keyword ? store.searchContacts(keyword, 50) : store.listContacts().slice(0, 50),
    );
    const employees = contacts
      .slice(0, 50)
      .map((contact) => ({
        userId: contact.userId,
        name: contact.name,
        departmentName: contact.departmentNames[0] ?? "未分配部门",
        title: contact.position ?? "Employee",
        active: contact.active,
        isManager: listWorkbenchManagerIds().has(contact.userId),
        isPortfolioManager: listWorkbenchProjectPortfolioUserIds().has(contact.userId),
      }));
    writeJson(res, 200, { ok: true, employees });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/portfolio-managers") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    const effective = [...listWorkbenchProjectPortfolioUserIds()].sort();
    writeJson(res, 200, {
      ok: true,
      dynamicPortfolioManagers: listDynamicWorkbenchPortfolioManagers().map((id) => ({
        userId: id,
        name: withPeopleDirectoryStore((s) => s.getContact(id)?.name?.trim() ?? ""),
      })),
      effectivePortfolioManagers: effective.map((id) => ({
        userId: id,
        name: withPeopleDirectoryStore((s) => s.getContact(id)?.name?.trim() ?? ""),
      })),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/admin/portfolio-managers") {
    void (async () => {
      try {
        const session = requireSession(req, res, "admin");
        if (!session) return;
        const body = await readJsonBody(req);
        const userId = String(body.userId ?? "").trim();
        const enabled = Boolean(body.enabled);
        const contact = withPeopleDirectoryStore((store) => store.getContact(userId));
        if (!contact) {
          writeJson(res, 404, { ok: false, error: "contact not found" });
          return;
        }
        if (enabled && !contact.active) {
          writeJson(res, 400, { ok: false, error: "cannot grant portfolio manager to inactive contact" });
          return;
        }
        const mutation = setDynamicWorkbenchPortfolioManager(userId, enabled);
        getFormalTaskStore().appendPermissionEvent({
          actorUserId: session.userId,
          targetUserId: userId,
          before: mutation.before,
          after: mutation.after,
          payload: {
            changed: mutation.changed,
            source: "admin_api",
            permissionKind: "portfolio_manager",
          },
        });
        writeJson(res, 200, {
          ok: true,
          userId,
          before: mutation.before,
          after: mutation.after,
          changed: mutation.changed,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "update portfolio manager permission failed",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/metrics") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    writeJson(res, 200, { ok: true, metrics: getFormalTaskStore().getMetrics() });
    return true;
  }

  const opsPayload = handleOpsDashboardApi(url);
  if (opsPayload && isGetOrHead) {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    writeJson(res, 200, opsPayload);
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/managers") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    writeJson(res, 200, {
      ok: true,
      dynamicManagers: listDynamicWorkbenchManagers().map((id) => ({
        userId: id,
        name: withPeopleDirectoryStore((s) => s.getContact(id)?.name?.trim() ?? ""),
      })),
      effectiveManagers: [...listWorkbenchManagerIds()].sort().map((id) => ({
        userId: id,
        name: withPeopleDirectoryStore((s) => s.getContact(id)?.name?.trim() ?? ""),
      })),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/admin/managers") {
    void (async () => {
      try {
        const session = requireSession(req, res, "admin");
        if (!session) return;
        const body = await readJsonBody(req);
        const userId = String(body.userId ?? "").trim();
        const enabled = Boolean(body.enabled);
        const contact = withPeopleDirectoryStore((store) => store.getContact(userId));
        if (!contact) {
          writeJson(res, 404, { ok: false, error: "contact not found" });
          return;
        }
        if (enabled && !contact.active) {
          writeJson(res, 400, { ok: false, error: "cannot grant manager to inactive contact" });
          return;
        }
        const mutation = setDynamicWorkbenchManager(userId, enabled);
        getFormalTaskStore().appendPermissionEvent({
          actorUserId: session.userId,
          targetUserId: userId,
          before: mutation.before,
          after: mutation.after,
          payload: {
            changed: mutation.changed,
            source: "admin_api",
          },
        });
        writeJson(res, 200, {
          ok: true,
          userId,
          before: mutation.before,
          after: mutation.after,
          changed: mutation.changed,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "update manager permission failed",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/new") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    emitWorkbenchApiActivity(session, url.pathname);
    const subs = getFormalTaskStore()
      .listEmployeeSubtasks(session.userId)
      .filter((t) => t.status === "ASSIGNED" || t.status === "REJECTED");
    const mapped = subs.map((t) => mapEmployeeSubtaskForApi(t));
    const actionable = mapped.filter((t) => t.status === "ASSIGNED" && !t.openSignal);
    const waiting = mapped.filter(
      (t) => t.status === "REJECTED" || (t.status === "ASSIGNED" && Boolean(t.openSignal)),
    );
    writeJson(
      res,
      200,
      {
        ok: true,
        actionable,
        waiting,
        tasks: mapped,
      },
      { ...NO_STORE_HEADERS },
    );
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/current") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    emitWorkbenchApiActivity(session, url.pathname);
    const tasks = getFormalTaskStore()
      .listEmployeeSubtasks(session.userId)
      .filter((t) => t.status === "IN_PROGRESS" || t.status === "BLOCKED");
    writeJson(
      res,
      200,
      {
        ok: true,
        tasks: tasks.map((t) => mapEmployeeSubtaskForApi(t)),
      },
      { ...NO_STORE_HEADERS },
    );
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/history") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    emitWorkbenchApiActivity(session, url.pathname);
    const tasks = getFormalTaskStore()
      .listEmployeeSubtasks(session.userId)
      .filter((t) => t.status === "DONE" || t.status === "STOPPED");
    writeJson(
      res,
      200,
      {
        ok: true,
        tasks: tasks.map((t) => mapEmployeeSubtaskForApi(t)),
      },
      { ...NO_STORE_HEADERS },
    );
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/profile") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    const snapshot = withPeopleDirectoryStore((store) =>
      store.getEmployeeSnapshot(session.userId),
    );
    writeJson(
      res,
      200,
      {
        ok: true,
        profile: snapshot?.selfProfile ?? {
          skillTags: [],
          strengths: [],
          boundaries: [],
          cases: [],
          tools: [],
          availability: {},
        },
        updatedAt: withPeopleDirectoryStore((store) => store.getProfile(session.userId)?.updatedAt ?? null),
      },
      { ...NO_STORE_HEADERS },
    );
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/employee/profile") {
    void (async () => {
      try {
        const session = requireSession(req, res, "employee");
        if (!session) return;
        const body = await readJsonBody(req);
        withPeopleDirectoryStore((store) => {
          store.mergeSelfServiceProfile(session.userId, body as Record<string, unknown>);
          const after = store.getProfile(session.userId);
          store.appendProfileEvent({
            userId: session.userId,
            eventType: "employee_profile_updated",
            actorUserId: session.userId,
            payload: {
              skillTagsCount: after?.skillTags.length ?? 0,
              strengthsCount: after?.strengths.length ?? 0,
              boundariesCount: after?.boundaries.length ?? 0,
              toolsCount: after?.tools.length ?? 0,
              casesCount: after?.cases.length ?? 0,
              backgroundChars: after?.background?.length ?? 0,
            },
          });
        });
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "profile update failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/reassign") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_reassign", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const assigneeUserId = String(body.assigneeUserId ?? "").trim();
        const note = String(body.note ?? "").trim();
        const subtaskIdRaw = String(body.subtaskId ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!assigneeUserId) {
          writeJson(res, 400, { ok: false, error: "assigneeUserId is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detailForAuth = store.getTaskDetail(planId);
        if (!detailForAuth) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserIdForReassign = session.userId;
        if (session.role === "manager") {
          if (detailForAuth.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserIdForReassign = detailForAuth.task.managerUserId;
        }
        const { task: updated } = executeReassignWithSideEffects(
          {
            planId,
            managerUserId: managerUserIdForReassign,
            assigneeUserId,
            note,
            actorName: session.dingUser?.name,
            subtaskId: subtaskIdRaw || undefined,
          },
          {
            taskStore: getFormalTaskStore(),
            findLatestSessionByPlanId,
            planSessionStore,
            patchLatestAssignmentAssignee,
          },
        );

        const storeAfter = getFormalTaskStore();
        voidFireReassignAssigneeNotify({
          notifier: workbenchPublishNotifier,
          getDisplayName: (userId) => withPeopleDirectoryStore((s) => s.getContact(userId)?.name?.trim()),
          appendTaskEvent: storeAfter.appendTaskEvent,
          taskStore: storeAfter,
          taskId: updated.taskId,
          planId,
          managerUserId: managerUserIdForReassign,
          assigneeUserId,
          subtaskIdRaw: subtaskIdRaw || undefined,
        });

        writeJson(res, 200, {
          ok: true,
          task: {
            ...updated,
            assigneeUserId,
            statusLabel: taskStatusLabel(updated.status),
          },
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/decline-changes") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_decline_changes", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const subtaskIdRaw = String(body.subtaskId ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!note) {
          writeJson(res, 400, { ok: false, error: "note is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detail = store.getTaskDetail(planId);
        if (!detail) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserId = session.userId;
        if (session.role === "manager") {
          if (detail.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserId = detail.task.managerUserId;
        }
        const targetSid =
          subtaskIdRaw
          || detail.subtasks.find((s) => s.status === "ASSIGNED")?.subtaskId
          || "";
        if (!targetSid) {
          writeJson(res, 400, { ok: false, error: "subtaskId required or no ASSIGNED subtask" });
          return;
        }
        const targetSubBeforeDecline = detail.subtasks.find((s) => s.subtaskId === targetSid);
        const declineKind: "decline_changes" | "decline_rejection" =
          targetSubBeforeDecline?.status === "REJECTED" ? "decline_rejection" : "decline_changes";
        const updated = store.managerDeclineSubtaskChanges({
          subtaskId: targetSid,
          managerUserId,
          note,
        });
        try {
          const mgrName = withPeopleDirectoryStore((st) =>
            st.getContact(managerUserId)?.name?.trim(),
          );
          await notifyEmployeeOfManagerActionAfterUpdate({
            taskStore: store,
            notifier: workbenchPublishNotifier,
            subtaskId: targetSid,
            managerUserId,
            managerDisplayName: mgrName || managerUserId,
            kind: declineKind,
            note,
          });
        } catch {}
        writeJson(res, 200, {
          ok: true,
          task: { ...updated.task, statusLabel: taskStatusLabel(updated.task.status) },
          subtask: { ...updated.subtask, statusLabel: taskStatusLabel(updated.subtask.status) },
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "decline changes failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/ack-signal") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_ack_signal", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const subtaskIdRaw = String(body.subtaskId ?? "").trim();
        const signal = String(body.signal ?? "done").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detail = store.getTaskDetail(planId);
        if (!detail) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserId = session.userId;
        if (session.role === "manager") {
          if (detail.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserId = detail.task.managerUserId;
        }
        const targetSid = subtaskIdRaw || detail.subtasks[0]?.subtaskId || "";
        if (!targetSid) {
          writeJson(res, 400, { ok: false, error: "subtaskId is required" });
          return;
        }
        store.managerAcknowledgeSubtaskSignal({
          subtaskId: targetSid,
          managerUserId,
          signal: signal || "done",
          note: note || undefined,
        });
        if (signal === "ack_rejection") {
          try {
            const mgrName = withPeopleDirectoryStore((st) =>
              st.getContact(managerUserId)?.name?.trim(),
            );
            await notifyEmployeeOfManagerActionAfterUpdate({
              taskStore: store,
              notifier: workbenchPublishNotifier,
              subtaskId: targetSid,
              managerUserId,
              managerDisplayName: mgrName || managerUserId,
              kind: "ack_rejection",
              note: note || undefined,
            });
          } catch {}
        }
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "ack failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/subtasks/remind") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_subtask_remind", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const subtaskId = String(body.subtaskId ?? "").trim();
        const toneRaw = String(body.tone ?? "").trim();
        const tone = toneRaw === "firm" || toneRaw === "polite" ? toneRaw : undefined;
        if (!subtaskId) {
          writeJson(res, 400, { ok: false, error: "subtaskId is required" });
          return;
        }
        const store = getFormalTaskStore();
        const pair = store.getSubtaskWithTask(subtaskId);
        if (!pair) {
          writeJson(res, 404, { ok: false, error: "Subtask not found" });
          return;
        }
        if (session.role === "manager" && pair.task.managerUserId !== session.userId) {
          writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
          return;
        }
        const actorUserId =
          session.role === "admin" ? pair.task.managerUserId : session.userId;
        const peopleStore = createPeopleDirectoryStore();
        try {
          const result = await sendSubtaskReminder(
            {
              subtaskId,
              trigger: "manual_workbench",
              actorUserId,
              tone,
            },
            {
              taskStore: store,
              notifier: workbenchPublishNotifier,
              peopleStore,
            },
          );
          if (!result.ok) {
            const status = result.error === "forbidden" ? 403 : result.skipped ? 200 : 400;
            writeJson(res, status, { ...result });
            return;
          }
          writeJson(res, 200, { ...result });
        } finally {
          peopleStore.close();
        }
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/tasks/stop") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_stop_task", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!note) {
          writeJson(res, 400, { ok: false, error: "note is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detailForAuth = store.getTaskDetail(planId);
        if (!detailForAuth) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserId = session.userId;
        if (session.role === "manager") {
          if (detailForAuth.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserId = detailForAuth.task.managerUserId;
        }
        const result = store.stopTask({
          planId,
          managerUserId,
          note,
          actorName: session.dingUser?.name,
        });
        if (!result.alreadyStopped && result.stoppedSubtaskIds.length > 0) {
          const assigneeMap = new Map<string, string[]>();
          for (const sub of result.subtasks) {
            if (!result.stoppedSubtaskIds.includes(sub.subtaskId)) continue;
            const uid = sub.assigneeUserId;
            const titles = assigneeMap.get(uid) ?? [];
            titles.push(sub.title);
            assigneeMap.set(uid, titles);
          }
          void (async () => {
            try {
              const notifyResult = await workbenchPublishNotifier.notifyTaskStopped({
                taskNo: result.task.taskNo,
                taskTitle: result.task.title,
                managerUserId,
                managerDisplayName: withPeopleDirectoryStore((s) =>
                  s.getContact(managerUserId)?.name?.trim(),
                ),
                note,
                assignees: [...assigneeMap.entries()].map(([userId, subtaskTitles]) => ({
                  userId,
                  displayName: withPeopleDirectoryStore((s) => s.getContact(userId)?.name?.trim()),
                  subtaskTitles,
                })),
              });
              store.appendTaskEvent({
                taskId: result.task.taskId,
                eventType: "TASK_STOP_NOTIFY_OK",
                actorUserId: managerUserId,
                payload: {
                  enabled: notifyResult.enabled,
                  skippedReason: notifyResult.skippedReason,
                  success: notifyResult.success,
                  failed: notifyResult.failed,
                },
              });
            } catch (err) {
              store.appendTaskEvent({
                taskId: result.task.taskId,
                eventType: "TASK_STOP_NOTIFY_FAILED",
                actorUserId: managerUserId,
                note: err instanceof Error ? err.message : String(err),
              });
            }
          })();
        }
        writeJson(res, 200, {
          ok: true,
          planId: result.task.planId,
          taskNo: result.task.taskNo,
          status: result.task.status,
          stoppedSubtaskIds: result.stoppedSubtaskIds,
          alreadyStopped: result.alreadyStopped,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "stop task failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/subtasks") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_add_subtask", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const title = String(body.title ?? "").trim();
        const assigneeUserId = String(body.assigneeUserId ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!title) {
          writeJson(res, 400, { ok: false, error: "title is required" });
          return;
        }
        if (!assigneeUserId) {
          writeJson(res, 400, { ok: false, error: "assigneeUserId is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detailForAuth = store.getTaskDetail(planId);
        if (!detailForAuth) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserId = session.userId;
        if (session.role === "manager") {
          if (detailForAuth.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserId = detailForAuth.task.managerUserId;
        }
        const dueAtRaw = String(body.dueAt ?? "").trim();
        const completionCriteria = String(body.completionCriteria ?? "").trim();
        const objective = String(body.objective ?? "").trim();
        const deliverables = String(body.deliverables ?? "").trim();
        if (!objective) {
          writeJson(res, 400, { ok: false, error: "objective is required" });
          return;
        }
        if (!deliverables) {
          writeJson(res, 400, { ok: false, error: "deliverables is required" });
          return;
        }
        if (!completionCriteria) {
          writeJson(res, 400, { ok: false, error: "completionCriteria is required" });
          return;
        }
        if (!dueAtRaw) {
          writeJson(res, 400, { ok: false, error: "dueAt is required" });
          return;
        }
        const clientRequestId = String(body.clientRequestId ?? "").trim().slice(0, 128) || undefined;
        const appendResult = store.appendSubtask({
          planId,
          managerUserId,
          title,
          assigneeUserId,
          dueAt: dueAtRaw,
          completionCriteria,
          objective,
          deliverables,
          dependsOn: parseRichStringListFromBody(body.dependsOn),
          actions: parseRichStringListFromBody(body.actions),
          note: note || undefined,
          actorName: session.dingUser?.name,
          clientRequestId,
        });
        const { task, subtask, duplicated } = appendResult;
        if (!duplicated) {
          void (async () => {
            try {
              const notifyResult = await workbenchPublishNotifier.notifyPublishedTask({
                taskNo: task.taskNo,
                title: task.title,
                managerUserId,
                managerDisplayName: withPeopleDirectoryStore((s) =>
                  s.getContact(managerUserId)?.name?.trim(),
                ),
                taskDescription: task.description,
                assignees: [
                  {
                    userId: assigneeUserId,
                    displayName: withPeopleDirectoryStore((s) =>
                      s.getContact(assigneeUserId)?.name?.trim(),
                    ),
                    subtasks: [{ title: subtask.title }],
                  },
                ],
              });
              store.appendTaskEvent({
                taskId: task.taskId,
                subtaskId: subtask.subtaskId,
                eventType: "SUBTASK_ADD_NOTIFY_OK",
                actorUserId: managerUserId,
                payload: {
                  enabled: notifyResult.enabled,
                  skippedReason: notifyResult.skippedReason,
                  success: notifyResult.success,
                  failed: notifyResult.failed,
                },
              });
            } catch (err) {
              store.appendTaskEvent({
                taskId: task.taskId,
                subtaskId: subtask.subtaskId,
                eventType: "SUBTASK_ADD_NOTIFY_FAILED",
                actorUserId: managerUserId,
                note: err instanceof Error ? err.message : String(err),
              });
            }
          })();
        }
        writeJson(res, 200, {
          ok: true,
          duplicated: duplicated === true,
          planId: task.planId,
          taskNo: task.taskNo,
          subtaskId: subtask.subtaskId,
          sourceTaskKey: subtask.sourceTaskKey,
          status: subtask.status,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "add subtask failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/subtasks/due") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        const subtaskId = String(body.subtaskId ?? "").trim();
        const dueAt = String(body.dueAt ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!subtaskId) {
          writeJson(res, 400, { ok: false, error: "subtaskId is required" });
          return;
        }
        if (!dueAt) {
          writeJson(res, 400, { ok: false, error: "dueAt is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detail = store.getSubtaskWithTask(subtaskId);
        if (!detail) {
          writeJson(res, 404, { ok: false, error: "Subtask not found" });
          return;
        }
        const managerUserId = session.role === "manager"
          ? session.userId
          : detail.task.managerUserId;
        if (session.role === "manager" && detail.task.managerUserId !== session.userId) {
          writeJson(res, 403, { ok: false, error: "Subtask does not belong to current manager" });
          return;
        }
        const changed = store.managerSetSubtaskDueAt({
          managerUserId,
          subtaskId,
          dueAt,
          note: note || "主管强制改期",
        });
        await workbenchPublishNotifier.notifyEmployeeOfManagerAction({
          employeeUserId: changed.subtask.assigneeUserId,
          managerUserId,
          managerDisplayName: withPeopleDirectoryStore((s) =>
            s.getContact(managerUserId)?.name?.trim() || managerUserId,
          ),
          taskNo: changed.task.taskNo,
          taskTitle: changed.task.title,
          subtaskId: changed.subtask.subtaskId,
          subtaskTitle: changed.subtask.title,
          kind: "decline_changes",
          note: `主管已调整截止日期为 ${dueAt}${note ? `；${note}` : ""}`,
        }).catch(() => undefined);
        emitWorkbenchApiActivity(session, url.pathname);
        writeJson(res, 200, {
          ok: true,
          subtaskId: changed.subtask.subtaskId,
          dueAt: changed.subtask.dueAt,
          dueSetBy: changed.subtask.dueSetBy,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "set due failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/subtasks/stop") {
    void (async () => {
      try {
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "manager" && session.role !== "admin") {
          writeJson(res, 403, { ok: false, error: "manager or admin role required" });
          return;
        }
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, { ok: false, error: "confirm=true is required" });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("manager_stop_subtask", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const subtaskId = String(body.subtaskId ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!subtaskId) {
          writeJson(res, 400, { ok: false, error: "subtaskId is required" });
          return;
        }
        if (!note) {
          writeJson(res, 400, { ok: false, error: "note is required" });
          return;
        }
        const store = getFormalTaskStore();
        const detailForAuth = store.getTaskDetail(planId);
        if (!detailForAuth) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        let managerUserId = session.userId;
        if (session.role === "manager") {
          if (detailForAuth.task.managerUserId !== session.userId) {
            writeJson(res, 403, { ok: false, error: "Task does not belong to current manager" });
            return;
          }
        } else {
          managerUserId = detailForAuth.task.managerUserId;
        }
        const result = store.stopSubtask({
          planId,
          subtaskId,
          managerUserId,
          note,
          actorName: session.dingUser?.name,
        });
        if (!result.alreadyStopped) {
          void (async () => {
            try {
              const notifyResult = await workbenchPublishNotifier.notifyTaskStopped({
                taskNo: result.task.taskNo,
                taskTitle: result.task.title,
                managerUserId,
                managerDisplayName: withPeopleDirectoryStore((s) =>
                  s.getContact(managerUserId)?.name?.trim(),
                ),
                note,
                assignees: [
                  {
                    userId: result.subtask.assigneeUserId,
                    subtaskTitles: [result.subtask.title],
                  },
                ],
              });
              store.appendTaskEvent({
                taskId: result.task.taskId,
                subtaskId: result.subtask.subtaskId,
                eventType: "SUBTASK_STOP_NOTIFY_OK",
                actorUserId: managerUserId,
                payload: {
                  enabled: notifyResult.enabled,
                  skippedReason: notifyResult.skippedReason,
                  success: notifyResult.success,
                  failed: notifyResult.failed,
                },
              });
            } catch (err) {
              store.appendTaskEvent({
                taskId: result.task.taskId,
                subtaskId: result.subtask.subtaskId,
                eventType: "SUBTASK_STOP_NOTIFY_FAILED",
                actorUserId: managerUserId,
                note: err instanceof Error ? err.message : String(err),
              });
            }
          })();
        }
        writeJson(res, 200, {
          ok: true,
          planId: result.task.planId,
          taskNo: result.task.taskNo,
          subtaskId: result.subtask.subtaskId,
          status: result.subtask.status,
          alreadyStopped: result.alreadyStopped,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "stop subtask failed",
        });
      }
    })();
    return true;
  }

  if (
    req.method === "POST"
    && (url.pathname === "/api/workbench/employee/action"
      || url.pathname === "/api/workbench/employee/subtasks/action")
  ) {
    void (async () => {
      try {
        const session = requireSession(req, res, "employee");
        if (!session) return;
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("employee_action", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const subtaskIdInput = String(body.subtaskId ?? "").trim();
        const action = String(body.action ?? "").trim();
        const note = String(body.note ?? "").trim();
        const proposedDueAt = String(body.proposedDueAt ?? "").trim();
        if (!planId && !subtaskIdInput) {
          writeJson(res, 400, { ok: false, error: "subtaskId or planId is required" });
          return;
        }
        if (!action) {
          writeJson(res, 400, { ok: false, error: "action is required" });
          return;
        }
        if (
          action !== "accept"
          && action !== "reject"
          && action !== "request_changes"
          && action !== "customize"
        ) {
          writeJson(res, 400, { ok: false, error: "unsupported action" });
          return;
        }
        if ((action === "reject" || action === "request_changes" || action === "customize") && !note) {
          writeJson(res, 400, {
            ok: false,
            error: "note is required for this action",
          });
          return;
        }
        const targetSubtaskId = subtaskIdInput || (() => {
          const first = getFormalTaskStore()
            .listEmployeeSubtasks(session.userId)
            .find((item) => item.planId === planId);
          return first?.subtaskId ?? "";
        })();
        if (!targetSubtaskId) {
          writeJson(res, 404, { ok: false, error: "Subtask not found" });
          return;
        }
        const subtaskDetail = getFormalTaskStore().getSubtaskWithTask(targetSubtaskId);
        if (!subtaskDetail) {
          writeJson(res, 404, { ok: false, error: "Subtask not found" });
          return;
        }
        const needsProposedDueAt = action === "accept"
          && !String(subtaskDetail.subtask.dueAt ?? "").trim()
          && String(subtaskDetail.subtask.dueSetBy ?? "") !== "manager";
        if (needsProposedDueAt && !proposedDueAt) {
          writeJson(res, 400, { ok: false, error: "proposedDueAt is required for this subtask" });
          return;
        }
        if (action === "accept" && proposedDueAt) {
          getFormalTaskStore().setSubtaskDueAt({
            subtaskId: targetSubtaskId,
            actorUserId: session.userId,
            dueAt: proposedDueAt,
            dueSetBy: "employee",
            note: note || "员工承接时自报截止",
          });
          await notifyManagerOfEmployeeActionAfterUpdate({
            taskStore: getFormalTaskStore(),
            notifier: workbenchPublishNotifier,
            subtaskId: targetSubtaskId,
            actorUserId: session.userId,
            kind: "customize",
            note: `员工承接时自报截止：${proposedDueAt}`,
            getDisplayName: (uid) =>
              withPeopleDirectoryStore((s) => s.getContact(uid)?.name?.trim()),
          });
        }
        const updated = getFormalTaskStore().updateSubtaskStatus({
          subtaskId: targetSubtaskId,
          actorUserId: session.userId,
          action:
            action === "accept"
              ? "accept"
              : action === "reject"
                ? "reject"
                : action === "customize"
                  ? "customize"
                  : "request_changes",
          note,
        });
        const store = getFormalTaskStore();
        if (action === "reject" || action === "request_changes" || action === "customize") {
          store.appendTaskEvent({
            taskId: updated.task.taskId,
            subtaskId: updated.subtask.subtaskId,
            eventType: "EMPLOYEE_RESPONSE_SUMMARY",
            actorUserId: session.userId,
            note,
            payload: { action, source: "employee_web" },
          });
        }
        const notifyKind =
          action === "reject"
            ? ("rejected" as const)
            : action === "accept"
              ? undefined
              : action === "customize"
                ? ("customize" as const)
                : ("changes_requested" as const);
        if (notifyKind) {
          await notifyManagerOfEmployeeActionAfterUpdate({
            taskStore: store,
            notifier: workbenchPublishNotifier,
            subtaskId: updated.subtask.subtaskId,
            actorUserId: session.userId,
            kind: notifyKind,
            note,
            getDisplayName: (uid) =>
              withPeopleDirectoryStore((s) => s.getContact(uid)?.name?.trim()),
          });
        }
        if (action === "accept") {
          await notifyEmployeeTodoOnAcceptAfterUpdate({
            taskStore: store,
            notifier: workbenchPublishNotifier,
            subtaskId: updated.subtask.subtaskId,
            actorUserId: session.userId,
            previousStatus: updated.previousStatus,
            action: "accept",
            getContact: (uid) => withPeopleDirectoryStore((s) => s.getContact(uid)) ?? undefined,
          });
        }
        emitWorkbenchApiActivity(session, url.pathname);
        writeJson(res, 200, {
          ok: true,
          planId: updated.task.planId,
          taskStatus: updated.task.status,
          subtaskId: updated.subtask.subtaskId,
          status: updated.subtask.status,
          statusLabel: taskStatusLabel(updated.subtask.status),
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && (url.pathname === "/workbench" || url.pathname === "/")) {
    const session = resolveEffectiveSession(req, res);
    if (!session) {
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(renderWorkbenchEntryLoginHtml());
      return true;
    }
    redirect(res, defaultPathForRole(session.role));
    return true;
  }

  if (
    req.method === "POST"
    && url.pathname === "/api/workbench/manager/profile-verify"
  ) {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      if (process.env.WORKBENCH_MANAGER_PROFILE_VERIFY_ENABLED !== "1") {
        writeJson(res, 501, {
          ok: false,
          deferred: true,
          error:
            "Manager profile verification is deferred. See docs/workbench-manager-profile-verify-deferred.md",
        });
        return;
      }
      writeJson(res, 501, {
        ok: false,
        error: "not_implemented",
        message: "WORKBENCH_MANAGER_PROFILE_VERIFY_ENABLED is set but server stub is not yet implemented.",
      });
    })();
    return true;
  }

  if (
    req.method === "POST"
    && (url.pathname === "/api/workbench/employee/progress"
      || url.pathname === "/api/workbench/employee/subtasks/progress")
  ) {
    void (async () => {
      try {
        const session = requireSession(req, res, "employee");
        if (!session) return;
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, { ok: false, error: "idempotencyKey is required" });
            return;
          }
          if (!rememberActionKey("employee_progress", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim();
        const subtaskIdInput = String(body.subtaskId ?? "").trim();
        const progressStatus = String(body.progressStatus ?? "").trim();
        const note = String(body.note ?? "").trim();

        if (!planId && !subtaskIdInput) {
          writeJson(res, 400, { ok: false, error: "subtaskId or planId is required" });
          return;
        }
        if (!progressStatus) {
          writeJson(res, 400, { ok: false, error: "progressStatus is required" });
          return;
        }
        if (!note) {
          writeJson(res, 400, { ok: false, error: "note is required" });
          return;
        }

        const targetSubtaskId =
          subtaskIdInput ||
          getFormalTaskStore()
            .listEmployeeSubtasks(session.userId)
            .find((item) => item.planId === planId)?.subtaskId;
        if (!targetSubtaskId) {
          writeJson(res, 404, { ok: false, error: "Subtask not found" });
          return;
        }

        const now = new Date().toISOString();
        const updated = getFormalTaskStore().updateSubtaskStatus({
          subtaskId: targetSubtaskId,
          actorUserId: session.userId,
          action: "progress",
          note,
          progressStatus:
            progressStatus === "DONE"
              ? "DONE"
              : progressStatus === "BLOCKED"
                ? "BLOCKED"
                : "IN_PROGRESS",
        });

        const store = getFormalTaskStore();
        const normalized =
          progressStatus === "DONE"
            ? "DONE"
            : progressStatus === "BLOCKED"
              ? "BLOCKED"
              : "IN_PROGRESS";
        if (normalized === "BLOCKED" || normalized === "DONE") {
          await notifyManagerOfEmployeeActionAfterUpdate({
            taskStore: store,
            notifier: workbenchPublishNotifier,
            subtaskId: updated.subtask.subtaskId,
            actorUserId: session.userId,
            kind: normalized === "BLOCKED" ? "blocked" : "done",
            note,
            getDisplayName: (uid) =>
              withPeopleDirectoryStore((s) => s.getContact(uid)?.name?.trim()),
          });
        }

        emitWorkbenchApiActivity(session, url.pathname);
        writeJson(res, 200, {
          ok: true,
          planId: updated.task.planId,
          subtaskId: updated.subtask.subtaskId,
          progressStatus,
          updatedAt: now,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/overview") {
    const session = requireSession(req, res);
    if (!session) return true;
    const view = resolveWorkbenchView(
      `/workbench/${url.searchParams.get("view") ?? ""}`.replace(/\/+$/, ""),
    );
    if (
      (view === "manager" || view === "conversation") &&
      session.role !== "manager"
    ) {
      writeAuthError(res, 403, "Manager role required");
      return true;
    }
    if (view === "employee" && session.role !== "employee") {
      writeAuthError(res, 403, "Employee role required");
      return true;
    }
    let userId =
      view === "employee" || view === "manager" || view === "conversation"
        ? session.userId
        : url.searchParams.get("userId") ?? undefined;
    if (view === "in-progress" && session.role === "employee" && !userId) {
      userId = session.userId;
    }
    const payload = buildOverviewPayload(view, userId);
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end();
      return true;
    }
    writeJson(res, 200, payload);
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/conversation/threads") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const threads = listManagerConversationSessions(session.userId).map((s) =>
      buildThreadListItem(s),
    );
    writeJson(res, 200, { ok: true, threads });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/conversation/new") {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      try {
        const created = createSideThreadSession(session.userId);
        const item = buildThreadListItem(created);
        const chatUrl =
          buildManagerChatDeepLink({
            threadKind: "side",
            threadId: item.threadId,
          }) ?? `/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(item.threadId)}`;
        writeJson(res, 200, {
          ok: true,
          threadId: item.threadId,
          planId: created.planId,
          title: item.title,
          chatUrl,
          kind: item.kind,
          badge: item.badge,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "failed to create side thread",
        });
      }
    })();
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/workbench/conversation/thread") {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const threadId = String(body.threadId ?? "").trim();
        const threadKind = String(body.threadKind ?? "").trim().toLowerCase();
        if (threadKind !== "side" || !threadId) {
          writeJson(res, 400, { ok: false, error: "only side threads can be renamed" });
          return;
        }
        const label = String(body.threadLabel ?? "").trim();
        const updated = renameSideThreadSession(session.userId, threadId, label);
        if (!updated) {
          writeJson(res, 404, { ok: false, error: "No session found for thread" });
          return;
        }
        const item = buildThreadListItem(updated);
        writeJson(res, 200, {
          ok: true,
          threadId: item.threadId,
          title: item.title,
          kind: item.kind,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "failed to rename thread",
        });
      }
    })();
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/workbench/conversation/thread") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const query = parseConversationThreadQuery(url);
    if (query.threadKind !== "side" || !query.threadId) {
      writeJson(res, 400, { ok: false, error: "only side threads can be deleted" });
      return true;
    }
    const target = resolveConversationThread(session.userId, query);
    if (!target || !isSideThreadSession(target)) {
      writeJson(res, 404, { ok: false, error: "No session found for thread" });
      return true;
    }
    const deleted = deleteSideThreadSession(session.userId, query.threadId);
    if (!deleted) {
      writeJson(res, 404, { ok: false, error: "No session found for thread" });
      return true;
    }
    writeJson(res, 200, { ok: true, threadId: query.threadId });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/conversation/messages") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const query = parseConversationThreadQuery(url);
    const target = resolveConversationThread(session.userId, query);
    if (!target) {
      writeJson(res, 404, { ok: false, error: "No session found for thread" });
      return true;
    }
    const history = target.conversationHistory ?? [];
    const messages = history.map((m, index) => {
      const role = String(m.role || "system");
      const content = String(m.content ?? "");
      const at = typeof m.at === "string" ? m.at : undefined;
      if (role === "assistant") {
        const displayContent = resolveMessageDisplayContent(m, target, index, history);
        return {
          role,
          content,
          displayContent,
          at,
          html: formatWorkbenchAssistantHtml(displayContent),
        };
      }
      return { role, content, at };
    });
    const threadMeta = buildThreadListItem(target);
    const portfolioOn = isWorkbenchProjectPortfolioEnabled(session.userId);
    const activePid = portfolioOn ? String(target.activeProjectId ?? "").trim() : "";
    const draftPid =
      portfolioOn && target.latestDraft && typeof target.latestDraft === "object"
        ? String((target.latestDraft as Record<string, unknown>).projectId ?? "").trim()
        : "";
    const resolvedPid = activePid || draftPid;
    let activeProjectName: string | undefined;
    if (resolvedPid) {
      activeProjectName = getFormalTaskStore()
        .getProject(resolvedPid, session.userId)
        ?.name;
    }
    writeJson(res, 200, {
      ok: true,
      planId: target.planId,
      threadId: threadMeta.threadId,
      kind: threadMeta.kind,
      title: threadMeta.title,
      badge: threadMeta.badge,
      messages,
      knownFacts: target.knownFacts ?? [],
      hasDraft: planSessionHasDraft(target),
      updatedAt: target.updatedAt,
      ...(portfolioOn
        ? {
            activeProjectId: resolvedPid || null,
            activeProjectName: activeProjectName ?? null,
          }
        : {}),
    });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/conversation/draft") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const query = parseConversationThreadQuery(url);
    const target = resolveConversationThread(session.userId, query);
    if (!target) {
      writeJson(res, 404, { ok: false, error: "No session found for thread" });
      return true;
    }
    const rawDraft = target.latestDraft as Record<string, unknown> | undefined;
    const draft = rawDraft ? normalizeDraftTasksForSession(rawDraft) : undefined;
    const editable = Boolean(draft && Array.isArray(draft.tasks) && draft.tasks.length > 0);
    writeJson(res, 200, {
      ok: true,
      editable,
      planId: target.planId,
      threadId: buildThreadListItem(target).threadId,
      draft: editable ? draft : undefined,
      assignment: target.latestAssignment,
      candidatePool: target.candidatePool,
      rows: editable
        ? draftToExcelRows({
            draft: draft!,
            assignment: target.latestAssignment as Record<string, unknown> | undefined,
          })
        : [],
      title: editable ? String(draft?.title ?? "").trim() : "",
      description: editable
        ? String(draft?.description ?? draft?.summary ?? "").trim()
        : "",
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/conversation/draft/revise") {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      if (!qwenConfig) {
        writeJson(res, 503, { ok: false, error: "QWEN_API_KEY is not configured" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const threadQuery = resolveConversationThreadFromBody(body);
        let target = resolveConversationThread(session.userId, threadQuery);
        if (!target) {
          target =
            threadQuery.threadKind === "side" && threadQuery.threadId
              ? undefined
              : findMainThreadSession(session.userId);
        }
        if (!target) {
          writeJson(res, 404, { ok: false, error: "No session found for thread" });
          return;
        }
        const preTurnDraft = target.latestDraft;
        const preTurnAssignment = target.latestAssignment;
        const preTurnPlanId = target.planId;
        let draft = (body.draft ?? {}) as Record<string, unknown>;
        const title = String(body.title ?? draft.title ?? "").trim();
        const description = String(
          body.description ?? draft.description ?? draft.summary ?? "",
        ).trim();
        draft = applyDraftScalarsFromForm(draft, title, description);
        const assignment = (body.assignment ?? target.latestAssignment) as
          | Record<string, unknown>
          | undefined;

        const pre = prevalidateWorkbenchDraftRevision({
          draft,
          assignment,
          previousDraft: preTurnDraft,
          previousAssignment: preTurnAssignment as Record<string, unknown> | undefined,
        });
        if (!pre.ok) {
          writeJson(res, 400, { ok: false, error: "validation failed", errors: pre.errors });
          return;
        }

        const planId = target.planId;
        const memoryContext = loadMemoryContextForPlan(planId);
        let mutableKnownFacts = [...(target.knownFacts ?? [])];
        const knownFactsStore: KnownFactsStore = {
          get: () => mutableKnownFacts,
          update: (facts: string[]) => {
            mutableKnownFacts = Array.from(
              new Set([
                ...mutableKnownFacts,
                ...facts.map((f) => String(f).trim()).filter(Boolean),
              ]),
            ).slice(-50);
          },
        };
        let mutableTarget = target;
        const revised = await runWorkbenchDraftRevision({
          session: target,
          draft: pre.draft,
          assignment: pre.assignment,
          orchestratorConfig: {
            clientConfig: {
              ...qwenConfig,
              thinking: process.env.DINGTALK_QWEN_THINKING?.trim() === "1",
            },
            employeeRepo,
            toolProfile: session.role === "admin" ? "admin" : "manager",
            promptProfile: "planner",
            managerFollowup: session.role === "admin" || session.role === "manager",
            knownFactsStore,
            currentSessionPlanId: planId,
            currentSession: target,
            actorName: session.dingUser?.name,
            actorRole: "manager",
            onSessionMutated: (mutated) => {
              mutableTarget = { ...mutableTarget, ...mutated };
            },
            sessionContext: {
              conversationHistory: target.conversationHistory,
              planId,
              latestDraft: target.latestDraft,
              latestAssignment: target.latestAssignment,
              memorySummary: memoryContext.summary || buildSessionMemorySummary(target),
              memoryFacts: [...memoryContext.facts, ...mutableKnownFacts].slice(0, 8),
              currentTimeIso: new Date().toISOString(),
            },
          },
        });
        if (!revised.ok) {
          writeJson(res, revised.status, {
            ok: false,
            error: revised.error,
            errors: revised.errors,
          });
          return;
        }

        mutableTarget = {
          ...mutableTarget,
          latestDraft: revised.prevalidatedDraft,
          latestAssignment: revised.prevalidatedAssignment,
        };
        const turnDisplay = buildWorkbenchTurnDisplay({
          orchResult: revised.orch,
          session: mutableTarget,
          preTurnDraft,
          preTurnAssignment,
          preTurnPlanId,
          postTurnDraft: revised.prevalidatedDraft,
          modelName: qwenConfig.model,
          employees: employeeRepo.list().map((e) => ({
            userId: e.userId,
            displayName: e.displayName,
          })),
        });
        const nowIso = new Date().toISOString();
        const nextConversationHistory = [
          ...(target.conversationHistory ?? []),
          { role: "user", content: WORKBENCH_DRAFT_REVISE_HISTORY_USER, at: nowIso },
          {
            role: "assistant",
            content: turnDisplay.pureAssistantMessage,
            displayContent: turnDisplay.displayContent,
            at: nowIso,
          },
        ].slice(-20);
        const threadMeta = buildThreadListItem({
          ...mutableTarget,
          conversationHistory: nextConversationHistory,
          latestDraft: turnDisplay.persistedDraft ?? revised.prevalidatedDraft,
          latestAssignment: turnDisplay.latestAssignment ?? revised.prevalidatedAssignment,
        });
        planSessionStore.save({
          ...mutableTarget,
          senderStaffId: session.userId,
          lastTraceId: revised.orch.traceId,
          knownFacts: mutableKnownFacts,
          latestDraft: turnDisplay.persistedDraft ?? revised.prevalidatedDraft,
          latestAssignment: turnDisplay.latestAssignment ?? revised.prevalidatedAssignment,
          conversationHistory: nextConversationHistory,
          revisionEvents: [
            ...(mutableTarget.revisionEvents ?? []),
            {
              occurredAt: nowIso,
              eventType: "MANAGER_WORKBENCH_DRAFT_REVISE",
              planId,
              traceId: revised.orch.traceId,
            },
          ].slice(-60),
        });
        planSessionStore.appendEvent({
          planId,
          chatKeyHash: target.chatKeyHash,
          eventType: "manager_workbench_draft_revise",
          payload: {
            traceId: revised.orch.traceId,
            actorUserId: session.userId,
            threadId: threadMeta.threadId,
          },
        });
        writeJson(res, 200, {
          ok: true,
          planId,
          threadId: threadMeta.threadId,
          message: turnDisplay.pureAssistantMessage,
          displayContent: turnDisplay.displayContent,
          hasDraft: draftHasTasks(turnDisplay.persistedDraft ?? revised.prevalidatedDraft),
        });
      } catch (err) {
        writeJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : "draft revise failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/upload-roster") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        let multipart;
        try {
          multipart = await readMultipartSingleFile(req, { maxFileBytes: 2 * 1024 * 1024 });
        } catch (err) {
          writeJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : "multipart parse failed",
          });
          return;
        }
        if (!multipart.file) {
          writeJson(res, 400, { ok: false, error: "缺少上传文件字段（form 字段名：file）" });
          return;
        }
        const threadIdField = String(multipart.fields.threadId ?? "").trim();
        const threadKindField = String(multipart.fields.threadKind ?? "").trim().toLowerCase();
        const planIdInput = String(multipart.fields.planId ?? "").trim();
        const target = resolveConversationThread(session.userId, {
          threadId: threadIdField || (threadKindField === "main" ? "main" : undefined),
          threadKind:
            threadKindField === "main" || threadKindField === "side"
              ? threadKindField
              : threadIdField === "main"
                ? "main"
                : undefined,
          planId: planIdInput || undefined,
        }) ?? findMainThreadSession(session.userId);
        const planId = target.planId;
        if (target.senderStaffId && target.senderStaffId !== session.userId) {
          writeJson(res, 403, { ok: false, error: "Plan does not belong to current manager" });
          return;
        }
        const parsed = await parseRosterFile({
          filename: multipart.file.filename,
          mimeType: multipart.file.mimeType,
          buffer: multipart.file.buffer,
          maxBytes: 2 * 1024 * 1024,
        });
        if (!parsed.ok) {
          logStructured({
            event: "workbench_roster_upload_rejected",
            planId,
            userId: session.userId,
            filename: multipart.file.filename,
            reason: parsed.reason,
            bytes: parsed.bytes,
          });
          writeJson(res, 400, {
            ok: false,
            error: parsed.message,
            reason: parsed.reason,
          });
          return;
        }
        planSessionStore.save({
          ...target,
          senderStaffId: target.senderStaffId || session.userId,
          pendingRosterText: parsed.text,
          pendingRosterSource: parsed.sourceLabel,
        });
        planSessionStore.appendEvent({
          planId,
          chatKeyHash: target.chatKeyHash,
          eventType: "manager_roster_uploaded",
          payload: {
            filename: multipart.file.filename,
            kind: parsed.kind,
            chars: parsed.chars,
            bytes: parsed.bytes,
            actorUserId: session.userId,
            actorName: session.dingUser?.name ?? undefined,
          },
        });
        logStructured({
          event: "workbench_roster_uploaded",
          planId,
          userId: session.userId,
          filename: multipart.file.filename,
          kind: parsed.kind,
          chars: parsed.chars,
          bytes: parsed.bytes,
        });
        writeJson(res, 200, {
          ok: true,
          planId,
          filename: multipart.file.filename,
          kind: parsed.kind,
          chars: parsed.chars,
          bytes: parsed.bytes,
          sourceLabel: parsed.sourceLabel,
          hint: "Agent 将在你下一条消息中读取这份名单并核对。请在对话框里告知你想分配的任务诉求。",
        });
      } catch (err) {
        writeJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : "roster upload failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/conversation/send") {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      if (!qwenConfig) {
        writeJson(res, 503, {
          ok: false,
          error: "QWEN_API_KEY is not configured",
        });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const message = String(body.message ?? "").trim();
        const threadQuery = resolveConversationThreadFromBody(body);
        if (!message) {
          writeJson(res, 400, { ok: false, error: "message is required" });
          return;
        }
        let target = resolveConversationThread(session.userId, threadQuery);
        if (!target) {
          target =
            threadQuery.threadKind === "side" && threadQuery.threadId
              ? undefined
              : findMainThreadSession(session.userId);
        }
        if (!target) {
          writeJson(res, 404, { ok: false, error: "No session found for thread" });
          return;
        }
        const planId = target.planId;
        const memoryContext = loadMemoryContextForPlan(planId);
        const turn = await runManagerOrchestratorTurn({
          userMessage: message,
          session: target,
          employeeRepo,
          clientConfig: buildManagerQwenClientConfig(qwenConfig),
          memorySummary:
            memoryContext.summary || buildSessionMemorySummary(target),
          memoryFacts: [
            ...memoryContext.facts,
            ...(target.knownFacts ?? []),
          ],
          actorName: session.dingUser?.name,
          workbenchRole: session.role === "admin" ? "admin" : "manager",
          senderStaffId: session.userId,
        });
        const orch = turn.orchResult;
        const mutableTarget = turn.session;
        const turnDisplay = buildWorkbenchTurnDisplay({
          orchResult: orch,
          session: mutableTarget,
          preTurnDraft: turn.preTurnDraft,
          preTurnAssignment: turn.preTurnAssignment,
          preTurnPlanId: turn.preRotatePlanId,
          postTurnDraft: mutableTarget.latestDraft,
          modelName: qwenConfig.model,
          employees: employeeRepo.list().map((e) => ({
            userId: e.userId,
            displayName: e.displayName,
          })),
        });
        const nowIso = new Date().toISOString();
        const nextConversationHistory = [
          ...(target.conversationHistory ?? []),
          { role: "user", content: message, at: nowIso },
          {
            role: "assistant",
            content: turnDisplay.pureAssistantMessage,
            displayContent: turnDisplay.displayContent,
            at: nowIso,
          },
        ].slice(-20);
        const threadMeta = buildThreadListItem({
          ...mutableTarget,
          conversationHistory: nextConversationHistory,
          latestDraft: turnDisplay.persistedDraft ?? mutableTarget.latestDraft,
          latestAssignment: turnDisplay.latestAssignment ?? mutableTarget.latestAssignment,
        });
        planSessionStore.save(
          preserveThreadIdentityOnSave({
            ...mutableTarget,
            senderStaffId: session.userId,
            canonicalUserId: isSideThreadSession(mutableTarget)
              ? mutableTarget.canonicalUserId
              : session.userId,
            lastTraceId: orch.traceId,
            knownFacts: turn.mutableKnownFacts,
            latestDraft: turnDisplay.persistedDraft ?? mutableTarget.latestDraft,
            latestAssignment:
              turnDisplay.latestAssignment ?? mutableTarget.latestAssignment,
            conversationHistory: nextConversationHistory,
            revisionEvents: [
              ...(mutableTarget.revisionEvents ?? []),
              {
                occurredAt: new Date().toISOString(),
                eventType: "MANAGER_AGENT_CHAT",
                planId,
                traceId: orch.traceId,
                messageChars: message.length,
              },
            ].slice(-60),
          }),
        );
        planSessionStore.appendEvent({
          planId,
          chatKeyHash: target.chatKeyHash,
          eventType: "manager_agent_chat",
          payload: {
            traceId: orch.traceId,
            messageChars: message.length,
            actorUserId: session.userId,
            actorName: session.dingUser?.name ?? undefined,
            threadId: threadMeta.threadId,
          },
        });
        appendMemoryEvents({
          planId,
          userMessage: message,
          assistantMessage: turnDisplay.pureAssistantMessage,
          latestDraft: turnDisplay.persistedDraft ?? mutableTarget.latestDraft,
          latestAssignment: turnDisplay.latestAssignment ?? mutableTarget.latestAssignment,
          traceId: orch.traceId,
          modelConfig: {
            apiKey: qwenConfig.apiKey,
            baseUrl: qwenConfig.baseUrl,
            timeoutMs: qwenConfig.timeoutMs,
          },
        }).catch(() => {});
        recordAgentTurnMetricsAsync({
          traceId: orch.traceId,
          userId: session.userId,
          channel: "workbench",
          userMessage: message,
          orchResult: orch,
          outboundMarkdown: turnDisplay.pureAssistantMessage,
          preTurnDraft: turn.preTurnDraft as Record<string, unknown> | undefined,
          recentContext: buildRecentContextFromHistory(target.conversationHistory),
          publishOk: publishResultSucceeded(turn.publishResult),
          judgeModelConfig: {
            apiKey: qwenConfig.apiKey,
            baseUrl: qwenConfig.baseUrl,
            timeoutMs: qwenConfig.timeoutMs,
          },
        });
        emitWorkbenchAgentTurn(session, orch.traceId);
        writeJson(res, 200, {
          ok: true,
          planId,
          threadId: threadMeta.threadId,
          kind: threadMeta.kind,
          title: threadMeta.title,
          traceId: orch.traceId,
          assistantMessage: turnDisplay.displayContent,
          hasDraft: draftHasTasks(turnDisplay.persistedDraft ?? mutableTarget.latestDraft),
          hasAssignment: Boolean(turnDisplay.latestAssignment ?? mutableTarget.latestAssignment),
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "invalid request body",
        });
      }
    })();
    return true;
  }

  if (isGetOrHead && isWorkbenchHtmlPath(url.pathname)) {
    const session = resolveEffectiveSession(req, res);
    if (!session) {
      redirect(res, resolveUnauthenticatedWorkbenchLoginRedirect(url.pathname, url.search));
      return true;
    }

    const legacyTarget = resolveLegacyWorkbenchRedirect(url.pathname, session.userId);
    if (legacyTarget) {
      if (legacyRedirectRequiresManager(url.pathname) && !allowsManagerSession(session)) {
        redirect(res, defaultPathForRole(session.role, session.userId));
        return true;
      }
      redirect(res, legacyTarget);
      return true;
    }

    if (url.pathname === "/workbench/daily-reports") {
      if (!isDailyReportsPageEnabled()) {
        redirect(res, defaultPathForRole(session.role, session.userId));
        return true;
      }
      redirect(res, `${resolveDailyReportsRolePath(session)}${url.search}`);
      return true;
    }

    if (MANAGER_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      if (isExternalPasswordSession(session)) {
        redirect(res, defaultPathForRole("employee"));
        return true;
      }
      if (!allowsManagerSession(session)) {
        redirect(res, defaultPathForRole(session.role, session.userId));
        return true;
      }
      const portfolioEnabled = isWorkbenchProjectPortfolioEnabled(session.userId);
      if (url.pathname === "/workbench/manager/projects" && !portfolioEnabled) {
        redirect(res, "/workbench/manager/tasks");
        return true;
      }
      if (url.pathname === "/workbench/manager/meeting-import" && (!portfolioEnabled || !isMeetingImportEnabled())) {
        redirect(res, "/workbench/manager/tasks");
        return true;
      }
      if (url.pathname === "/workbench/manager/task-intake" && !isTaskIntakeEnabled()) {
        redirect(res, "/workbench/manager/tasks");
        return true;
      }
      if (url.pathname === "/workbench/manager/daily-reports" && !isDailyReportsPageEnabled()) {
        redirect(res, "/workbench/manager/tasks");
        return true;
      }
      if (url.pathname === "/workbench/manager/competency-eval") {
        if (!isCompetencyEvalPageEnabled() || !isCompetencyEvalUser(session.userId)) {
          writeAuthError(res, 403, "competency eval forbidden");
          return true;
        }
      }
      let chatThreadId = "main";
      let chatThreadKind: "main" | "side" = "main";
      let planTitle: string | undefined;
      if (url.pathname === "/workbench/manager/chat") {
        const threadQuery = parseConversationThreadQuery(url);
        const resolved = resolveConversationThread(session.userId, threadQuery);
        if (
          !resolved &&
          threadQuery.threadKind === "side" &&
          threadQuery.threadId
        ) {
          redirect(res, "/workbench/manager/chat?thread=main");
          return true;
        }
        const target = resolved ?? findMainThreadSession(session.userId);
        const meta = buildThreadListItem(target);
        chatThreadId = meta.threadId;
        chatThreadKind = meta.kind;
        planTitle = meta.title;
      }
      const userLabel = session.dingUser?.name ?? session.userId;
      const showAdminOpsLink = resolveWorkbenchCapabilities(session.userId).canAccessAdmin;
      const mgrTaskNo = url.searchParams.get("taskNo")?.trim() ?? "";
      const initialProjectId = url.searchParams.get("projectId")?.trim() ?? "";
      const tasksViewParam = url.searchParams.get("view")?.trim().toLowerCase();
      const initialTasksView = tasksViewParam === "flat" ? "flat" : "group";
      const competencyEvalEnabled =
        isCompetencyEvalPageEnabled() && isCompetencyEvalUser(session.userId);
      const html =
        url.pathname === "/workbench/manager/dashboard"
          ? renderManagerDashboardPage({
            userLabel,
            sessionUserId: session.userId,
            projectPortfolioEnabled: portfolioEnabled,
            initialProjectId,
            showAdminOpsLink,
          })
          : url.pathname === "/workbench/manager/performance"
          ? renderPerformanceDashboardPage({
            userLabel,
            sessionUserId: session.userId,
            role: "manager",
            scopeLabel: "您名下员工",
            apiBase: "/api/workbench/manager/performance",
            showAdminOpsLink,
            portfolioEnabled,
          })
          : url.pathname === "/workbench/manager/competency-eval"
          ? renderCompetencyEvalPage({
            userLabel,
            sessionUserId: session.userId,
            showAdminOpsLink,
            portfolioEnabled,
            competencyEvalEnabled,
          })
          : url.pathname === "/workbench/manager/daily-reports"
          ? renderDailyReportsWorkbenchPage({
            role: "manager",
            activeNav: "mgr-daily-reports",
            userId: session.userId,
            userLabel,
            showAdminOpsLink,
            portfolioEnabled,
            initialDate: url.searchParams.get("date")?.trim() ?? "",
            initialView: parseDailyReportsPageViewParam(url.searchParams.get("view")),
          })
          : url.pathname === "/workbench/manager/projects"
          ? renderManagerProjectsPage({
            userLabel,
            sessionUserId: session.userId,
            showAdminOpsLink,
          })
          : url.pathname === "/workbench/manager/meeting-import"
            ? renderManagerMeetingImportPage({
              userLabel,
              sessionUserId: session.userId,
              showAdminOpsLink,
            })
          : url.pathname === "/workbench/manager/task-intake"
            ? renderManagerTaskIntakePage({
              userLabel,
              sessionUserId: session.userId,
              showAdminOpsLink,
              portfolioEnabled,
            })
          : url.pathname === "/workbench/manager/tasks"
            ? renderManagerTasksPage({
              planId: url.searchParams.get("planId")?.trim(),
              planTitle,
              userLabel,
              sessionUserId: session.userId,
              projectPortfolioEnabled: portfolioEnabled,
              initialProjectId,
              initialView: portfolioEnabled ? initialTasksView : undefined,
              showAdminOpsLink,
            })
            : url.pathname === "/workbench/manager/chat"
              ? renderManagerChatPage({
                threadId: chatThreadId,
                threadKind: chatThreadKind,
                planTitle,
                userLabel,
                sessionUserId: session.userId,
                openDraftEditor: url.searchParams.get("openDraftEditor") === "1",
                projectPortfolioEnabled: portfolioEnabled,
                showAdminOpsLink,
              })
              : url.pathname === "/workbench/manager/task/events"
              ? renderTaskEventsPage({
                roleLabel: "manager",
                backPath: "/workbench/manager/tasks",
                detailPath: `/workbench/manager/task?taskNo=${encodeURIComponent(mgrTaskNo)}`,
              })
              : renderTaskDetailPage({
                roleLabel: "manager",
                backPath: "/workbench/manager/tasks",
                enforceActionGuards: shouldEnforceActionGuards(),
                eventsPagePath: "/workbench/manager/task/events",
              });
      emitWorkbenchPageView(session, url.pathname);
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

    if (ADMIN_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      if (isExternalPasswordSession(session)) {
        redirect(res, defaultPathForRole("employee"));
        return true;
      }
      if (session.role !== "admin") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      if (url.pathname === "/workbench/admin/daily-reports" && !isDailyReportsPageEnabled()) {
        redirect(res, "/workbench/admin");
        return true;
      }
      const userLabel = session.dingUser?.name ?? session.userId;
      const showAdminOpsLink = resolveWorkbenchCapabilities(session.userId).canAccessAdmin;
      const adminTaskNo = url.searchParams.get("taskNo")?.trim() ?? "";
      const html =
        url.pathname === "/workbench/admin/task/events"
          ? renderTaskEventsPage({
            roleLabel: "admin",
            backPath: "/workbench/admin",
            detailPath: `/workbench/admin/task?taskNo=${encodeURIComponent(adminTaskNo)}`,
          })
          : url.pathname === "/workbench/admin/task"
            ? renderTaskDetailPage({
              roleLabel: "admin",
              backPath: "/workbench/admin",
              enforceActionGuards: shouldEnforceActionGuards(),
              eventsPagePath: "/workbench/admin/task/events",
            })
            : url.pathname === "/workbench/admin/ops"
              ? renderAdminOpsDashboardPage({ userLabel, sessionUserId: session.userId })
              : url.pathname === "/workbench/admin/permissions"
                ? renderAdminPermissionsPage({ userLabel, sessionUserId: session.userId })
              : url.pathname === "/workbench/admin/performance"
                ? renderPerformanceDashboardPage({
                  userLabel,
                  sessionUserId: session.userId,
                  role: "admin",
                  scopeLabel: "全员（管理员视角）",
                  apiBase: "/api/workbench/admin/performance",
                  showAdminOpsLink,
                  portfolioEnabled: false,
                })
              : url.pathname === "/workbench/admin/daily-reports"
                ? renderDailyReportsWorkbenchPage({
                  role: "admin",
                  activeNav: "adm-daily-reports",
                  userId: session.userId,
                  userLabel,
                  showAdminOpsLink,
                  portfolioEnabled: false,
                  initialDate: url.searchParams.get("date")?.trim() ?? "",
                  initialView: parseDailyReportsPageViewParam(url.searchParams.get("view")),
                })
              : renderAdminWorkbenchPage({ userLabel, sessionUserId: session.userId });
      emitWorkbenchPageView(session, url.pathname);
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

    if (EMPLOYEE_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      let employeeSession = ensureManagerEmployeeViewForDeepLink(req, res, session);
      if (!allowsEmployeeSession(employeeSession)) {
        redirect(res, defaultPathForRole(employeeSession.role));
        return true;
      }
      if (url.pathname === "/workbench/employee/new") {
        redirect(res, "/workbench/employee?view=new");
        return true;
      }
      if (url.pathname === "/workbench/employee/current") {
        const tab = (url.searchParams.get("tab") || "").toLowerCase();
        const v = tab === "profile" ? "profile" : "current";
        redirect(res, `/workbench/employee?view=${encodeURIComponent(v)}`);
        return true;
      }
      if (url.pathname === "/workbench/employee" && !url.searchParams.get("view")) {
        redirect(res, "/workbench/employee?view=new");
        return true;
      }
      if (url.pathname === "/workbench/employee/daily-reports" && !isDailyReportsPageEnabled()) {
        redirect(res, "/workbench/employee?view=new");
        return true;
      }
      const fromView = url.searchParams.get("fromView")?.trim() || "current";
      const empUserLabel = employeeSession.dingUser?.name ?? employeeSession.userId;
      const empListBack =
        fromView === "new"
          ? "/workbench/employee?view=new"
          : fromView === "history"
            ? "/workbench/employee?view=history"
            : "/workbench/employee?view=current";
      const html =
        url.pathname === "/workbench/employee/task/events"
          ? renderTaskEventsPage({
            roleLabel: "employee",
            backPath: empListBack,
            detailPath: `/workbench/employee/task?taskNo=${encodeURIComponent(url.searchParams.get("taskNo") ?? "")}&fromView=${encodeURIComponent(fromView)}`,
          })
          : url.pathname === "/workbench/employee/task"
            ? renderTaskDetailPage({
              roleLabel: "employee",
              backPath: empListBack,
              enforceActionGuards: shouldEnforceActionGuards(),
              eventsPagePath: "/workbench/employee/task/events",
            })
            : url.pathname === "/workbench/employee/daily-reports"
              ? renderDailyReportsWorkbenchPage({
                role: "employee",
                activeNav: "emp-daily-reports",
                userId: employeeSession.userId,
                userLabel: empUserLabel,
                initialDate: url.searchParams.get("date")?.trim() ?? "",
                initialView: parseDailyReportsPageViewParam(url.searchParams.get("view")),
              })
            : renderEmployeeWorkbenchPage({
              canExecuteAsManager: resolveWorkbenchCapabilities(employeeSession.userId).canExecuteAsManager,
            });
      emitWorkbenchPageView(employeeSession, url.pathname);
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

  }

  if (url.pathname === "/assignment/workbench" && isGetOrHead) {
    const tokenParam = url.searchParams.get("token");
    if (!tokenParam && !url.searchParams.get("access_token")) {
      const session = resolveEffectiveSession(req, res);
      if (session) {
        const to = defaultPathForRole(session.role);
        redirect(res, to);
      } else {
        redirect(res, "/workbench");
      }
      return true;
    }

    let verified: ReturnType<typeof verifyAssignmentEntry>;
    try {
      verified = verifyAssignmentEntry(
        tokenParam ?? url.searchParams.get("access_token") ?? "",
      );
    } catch (err) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `Access denied: ${err instanceof Error ? err.message : "invalid token"}`,
      );
      return true;
    }

    const autoRole: WorkbenchRole =
      verified.role === "manager" ? "manager" : "employee";
    const session = createWorkbenchSession({
      userId: verified.userId,
      role: autoRole,
      loginSource: "signed_link",
      dingUser: {
        userId: verified.userId,
        loginAt: new Date().toISOString(),
      },
    });
    const base = defaultPathForRole(autoRole);
    const redirectTo =
      autoRole === "manager"
        ? `/workbench/manager/chat?thread=main`
        : `${base}?planId=${encodeURIComponent(verified.planId)}`;
    redirect(res, redirectTo, [buildSessionCookie(session)]);
    return true;
  }

  return false; // not handled here
}
