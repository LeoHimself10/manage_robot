import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
  type WorkbenchTaskStatus,
} from "../infra/workbench-formal-task-store";
import {
  inferConversationTitleFromSession,
  truncateConversationPreview,
} from "../infra/conversation-present";
import { formatWorkbenchAssistantHtml } from "./workbench-markdown-lite";
import { loadQwenPlannerConfigFromEnv } from "../agent/demo/qwen-planner";
import { runOrchestrator } from "../agent/orchestrator";
import type { KnownFactsStore } from "../agent/tools/update-known-facts";
import {
  DingTalkAuthError,
  type DingTalkAuthClient,
  createDingTalkAuthClient,
  getDingTalkCorpId,
} from "../integrations/dingtalk/dingtalk-auth";
import { buildWorkbenchJsapiConfig } from "../integrations/dingtalk/dingtalk-jsapi-config";
import {
  createWorkbenchPublishNotifier,
  type WorkbenchPublishNotifier,
} from "../integrations/dingtalk/workbench-notify";
import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createDingTalkContactSyncService } from "../infra/dingtalk-contact-sync";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { buildPreparePublishTaskHandler } from "../agent/tools/prepare-publish-task";
import { executeReassignWithSideEffects } from "../agent/workbench/reassign-with-side-effects";
import { voidFireReassignAssigneeNotify } from "../agent/workbench/reassign-notify-side-effect";
import {
  appendMemoryEvents,
  loadMemoryContextForPlan,
} from "../infra/workbench-memory-store";
import { listDynamicWorkbenchManagers, setDynamicWorkbenchManager } from "../security/workbench-manager-directory";
import { listWorkbenchManagerIds } from "../security/workbench-manager-whitelist";
import { resolveWorkbenchRole, type WorkbenchRole } from "../security/workbench-role-resolver";
import { verifyAssignmentEntry } from "../security/web-entry-token";
import { parseRosterFile } from "../agent/assignment/roster-parser";
import { readMultipartSingleFile } from "./multipart-single-file";
import { renderAdminWorkbenchPage } from "./admin-workbench-pages";
import {
  renderManagerChatPage,
  renderManagerTasksPage,
} from "./manager-workbench-pages";
import {
  renderEmployeeCurrentTasksPage,
  renderEmployeeNewTasksPage,
} from "./employee-workbench-pages";
import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { logStructured } from "../infra/logger";

const WORKBENCH_LOGIN_PATH = "/workbench";

const MANAGER_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/manager/tasks",
  "/workbench/manager/chat",
  "/workbench/manager/task",
]);

const EMPLOYEE_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/employee/new",
  "/workbench/employee/current",
  "/workbench/employee/task",
]);
const ADMIN_WORKBENCH_PAGE_PATHS = new Set(["/workbench/admin", "/workbench/admin/task"]);

/** Legacy bookmarks → canonical paths (302 after session + role check). */
const LEGACY_WORKBENCH_REDIRECTS: Record<string, string> = {
  "/workbench/manager": "/workbench/manager/tasks",
  "/workbench/in-progress": "/workbench/manager/tasks",
  "/workbench/conversation": "/workbench/manager/chat",
  "/workbench/employee": "/workbench/employee/new",
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
    MANAGER_WORKBENCH_PAGE_PATHS.has(pathname) ||
    EMPLOYEE_WORKBENCH_PAGE_PATHS.has(pathname) ||
    ADMIN_WORKBENCH_PAGE_PATHS.has(pathname) ||
    pathname in LEGACY_WORKBENCH_REDIRECTS
  );
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

interface WorkbenchSession {
  sid: string;
  userId: string;
  role: WorkbenchRole;
  loginSource: "entry" | "signed_link" | "dingtalk_authcode";
  dingUser?: {
    userId: string;
    name?: string;
    unionId?: string;
    loginAt: string;
  };
  iat: number;
  exp: number;
}

const WORKBENCH_COOKIE_NAME = "wb_session";
const WORKBENCH_SESSION_TTL_SECONDS = 12 * 60 * 60;
const ACTION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const seenActionKeys = new Map<string, { action: string; at: number }>();

const assignmentWorkbenchDir = dirname(fileURLToPath(import.meta.url));

function resolveWorkbenchDdLoginBundlePath(): string {
  return join(assignmentWorkbenchDir, "..", "..", "dist", "workbench-dd-login.js");
}

const planSessionStore = createPlanSessionStore();
const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
const qwenConfig = loadQwenPlannerConfigFromEnv();
let formalTaskStore: ReturnType<typeof createWorkbenchFormalTaskStore> | undefined;
let dingtalkAuthClient: DingTalkAuthClient = createDingTalkAuthClient();
let workbenchPublishNotifier: WorkbenchPublishNotifier = createWorkbenchPublishNotifier();
const preparePublishTaskHandler = buildPreparePublishTaskHandler();

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
  return `${WORKBENCH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${WORKBENCH_SESSION_TTL_SECONDS}`;
}

function clearSessionCookie(): string {
  return `${WORKBENCH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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

/**
 * Read session cookie and self-heal `role` against runtime resolution.
 * If the cookie role is stale (e.g. user was promoted/demoted after login),
 * we transparently issue a refreshed cookie and return a session whose role
 * already matches the runtime answer. Returns `undefined` when no valid
 * session cookie is present.
 */
function resolveEffectiveSession(
  req: IncomingMessage,
  res: ServerResponse,
): WorkbenchSession | undefined {
  const session = getSessionFromRequest(req);
  if (!session) return undefined;
  const runtimeRole = resolveRoleForUser(session.userId);
  if (runtimeRole === session.role) return session;
  const refreshed: WorkbenchSession = { ...session, role: runtimeRole };
  appendSetCookie(res, buildSessionCookie(refreshed));
  logStructured({
    event: "workbench_session_role_refreshed",
    path: req.url ?? "",
    userId: session.userId,
    fromRole: session.role,
    toRole: runtimeRole,
    loginSource: session.loginSource,
  });
  return refreshed;
}

function createWorkbenchSession(params: {
  userId: string;
  role: WorkbenchRole;
  loginSource: "entry" | "signed_link" | "dingtalk_authcode";
  dingUser?: WorkbenchSession["dingUser"];
}): WorkbenchSession {
  const now = Math.floor(Date.now() / 1000);
  return {
    sid: randomBytes(8).toString("hex"),
    userId: params.userId,
    role: params.role,
    loginSource: params.loginSource,
    dingUser: params.dingUser,
    iat: now,
    exp: now + WORKBENCH_SESSION_TTL_SECONDS,
  };
}

type WorkbenchView =
  | "home"
  | "manager"
  | "employee"
  | "conversation"
  | "in-progress";

function resolveWorkbenchView(path: string): WorkbenchView {
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
  try {
    const dir = resolvePlanSessionDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const out: Array<PlanSession & { chatKeyHash: string }> = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(join(dir, file), "utf8"),
        ) as PlanSession;
        const chatKeyHash =
          typeof raw.chatKeyHash === "string"
            ? raw.chatKeyHash
            : file.replace(/\.json$/, "");
        out.push({ ...raw, chatKeyHash });
      } catch {
        // skip malformed session files
      }
    }
    return out;
  } catch {
    return [];
  }
}

function findLatestSessionByPlanId(
  planId: string,
): (PlanSession & { chatKeyHash: string }) | undefined {
  const sessions = loadAllSessions().filter((s) => s.planId === planId);
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
  const sessions = loadAllSessions().filter((s) => s.senderStaffId === userId);
  sessions.sort((a, b) => {
    const ta = Date.parse(a.updatedAt ?? "") || 0;
    const tb = Date.parse(b.updatedAt ?? "") || 0;
    return tb - ta;
  });
  return sessions[0];
}

function ensureSessionForPlanId(params: {
  planId: string;
  userId: string;
}): PlanSession & { chatKeyHash: string } {
  const existing = findLatestSessionByPlanId(params.planId);
  if (existing) return existing;
  const chatKey = `workbench:${params.userId}:${params.planId}`;
  const createdAt = new Date().toISOString();
  const created: PlanSession & { chatKeyHash: string } = {
    chatKeyHash: hashChatKey(chatKey),
    planId: params.planId,
    createdAt,
    updatedAt: createdAt,
    senderStaffId: params.userId,
    knownFacts: [],
    conversationHistory: [],
  };
  planSessionStore.save(created);
  return created;
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
          .filter((t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS" || t.status === "BLOCKED")
      : allTasks.filter(
          (t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS" || t.status === "BLOCKED",
        );
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

function taskStatusLabel(status: WorkbenchTaskStatus): string {
  if (status === "ASSIGNED") return "待处理";
  if (status === "CHANGES_REQUESTED") return "待修改";
  if (status === "ACCEPTED") return "已接受";
  if (status === "IN_PROGRESS") return "进行中";
  if (status === "BLOCKED") return "阻塞中";
  if (status === "DONE") return "已完成";
  return "已拒绝";
}

function enrichManagerTasksForApi(managerUserId: string) {
  const store = getFormalTaskStore();
  return store.listManagerTasks(managerUserId).map((t) => {
    const detail = store.getTaskDetail(t.taskNo);
    const names = new Set<string>();
    if (detail) {
      for (const s of detail.subtasks) {
        const picked = withPeopleDirectoryStore((st) =>
          st.getContact(s.assigneeUserId)?.name?.trim(),
        );
        if (picked) names.add(picked);
      }
    }
    return {
      ...t,
      statusLabel: taskStatusLabel(t.status),
      assigneeSummary: names.size ? [...names].join("、") : "—",
    };
  });
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

function defaultPathForRole(role: WorkbenchRole): string {
  if (role === "admin") return "/workbench/admin";
  if (role === "manager") return "/workbench/manager/tasks";
  return "/workbench/employee/new";
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

function isWorkbenchTestLoginEnabled(): boolean {
  const raw = String(process.env.WORKBENCH_TEST_LOGIN_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function renderWorkbenchEntryLoginHtml(): string {
  const corpId = getDingTalkCorpId() ?? "";
  const testLoginEnabled = isWorkbenchTestLoginEnabled();
  const loginFormHtml = testLoginEnabled
    ? `<label>钉钉 userId
    <input id="userId" placeholder="例如 641871342" />
  </label>
  <label>身份
    <select id="role">
      <option value="auto">自动判定（推荐）</option>
      <option value="admin">管理员</option>
      <option value="manager">主管</option>
      <option value="employee">员工</option>
    </select>
  </label>
  <button id="loginBtn" type="button">测试登录（非钉钉环境）</button>`
    : `<div class="muted">当前环境已关闭测试登录。请在钉钉工作台中打开本页面完成免登。</div>`;
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作台登录</title>
<style>
body { font-family: system-ui, sans-serif; background: #f5f7fb; color: #0f172a; }
.wrap { max-width: 520px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
h1 { margin: 0 0 10px; font-size: 24px; }
p { color: #475569; }
label { display: grid; gap: 6px; margin: 10px 0; font-size: 14px; }
input, select { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font: inherit; }
button { margin-top: 10px; border: 1px solid #1d4ed8; background: #2563eb; color: #fff; border-radius: 8px; padding: 9px 12px; font-weight: 600; cursor: pointer; }
.muted { color: #64748b; font-size: 13px; margin-top: 10px; }
</style>
</head>
<body>
<main class="wrap">
  <h1>任务规划工作台登录</h1>
  <p>优先尝试钉钉免登。登录后按身份自动跳转到对应界面。</p>
  <div class="muted" id="ssoHint"></div>
  ${loginFormHtml}
  <div class="muted" id="result">正在尝试钉钉免登...</div>
</main>
<script>
window.__WB_CONFIGURED_CORP_ID = ${JSON.stringify(corpId)};
</script>
<script src="/static/workbench-dd-login.js"></script>
<script>
(function () {
  const btn = document.getElementById('loginBtn');
  function setResult(msg) {
    var result = document.getElementById('result');
    if (result) result.textContent = msg;
  }
  if (typeof window.__wbTryDingTalkLogin === 'function') {
    void window.__wbTryDingTalkLogin();
  } else {
    setResult('登录脚本未加载，请刷新或联系管理员运行 npm run build:workbench-login');
  }
  if (btn) {
    btn.addEventListener('click', async function () {
      const userId = (document.getElementById('userId').value || '').trim();
      const role = document.getElementById('role').value;
      if (!userId) {
        setResult('请填写 userId');
        return;
      }
      setResult('登录中...');
      try {
        const res = await fetch('/api/workbench/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        window.location.href = data.redirectTo || '/workbench';
      } catch (err) {
        setResult('登录失败：' + (err && err.message ? err.message : String(err)));
      }
    });
  }
})();
</script>
</body>
</html>`;
}

function renderTaskDetailPage(params: {
  roleLabel: "admin" | "manager" | "employee";
  backPath: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>任务详情</title>
<style>${WORKBENCH_APP_BASE_CSS}</style>
</head>
<body>
<div class="app-shell" style="max-width:980px;">
  <div class="card">
    <div class="brand">工作台</div>
    <h1 class="page-title" style="font-size:22px;">任务详情</h1>
    <p class="page-desc" style="margin-top:4px;">当前角色：${params.roleLabel}</p>
    <div style="margin-top:10px;"><a href="${params.backPath}">返回</a></div>
  </div>
  <div class="card" id="taskMount">加载中…</div>
  <div class="card">
    <h3 style="margin:0 0 10px;">子任务</h3>
    <div id="subtasksMount" class="muted">加载中…</div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 10px;">事件</h3>
    <div id="eventsMount" class="muted">加载中…</div>
  </div>
</div>
<script>
(function(){
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  async function load(){
    var taskNo = new URLSearchParams(location.search).get('taskNo') || '';
    if(!taskNo){ document.getElementById('taskMount').textContent='缺少 taskNo 参数'; return; }
    var res = await fetch('/api/workbench/tasks/detail?taskNo='+encodeURIComponent(taskNo));
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok || !data.ok){ document.getElementById('taskMount').textContent = data.error || ('HTTP '+res.status); return; }
    var t=data.task||{};
    document.getElementById('taskMount').innerHTML =
      '<div><b>'+esc(t.title||'—')+'</b></div>'
      +'<div class="muted">taskNo <code>'+esc(t.taskNo||taskNo)+'</code> · 状态 '+esc(t.status||'—')+'</div>'
      +'<div class="muted">planId <code>'+esc(t.planId||'—')+'</code></div>';
    var subs = data.subtasks || [];
    if(!subs.length){ document.getElementById('subtasksMount').textContent='暂无子任务'; }
    else{
      document.getElementById('subtasksMount').innerHTML =
      '<div class="table-wrap"><table class="data"><thead><tr><th>子任务</th><th>负责人</th><th>状态</th><th>进度</th></tr></thead><tbody>'
      +subs.map(function(s){ return '<tr><td>'+esc(s.title||'—')+'</td><td>'+esc(s.assigneeUserId||'—')+'</td><td>'+esc(s.status||'—')+'</td><td>'+esc(s.progressNote||'—')+'</td></tr>'; }).join('')
      +'</tbody></table></div>';
    }
    var events = data.events || [];
    if(!events.length){ document.getElementById('eventsMount').textContent='暂无事件';}
    else{
      document.getElementById('eventsMount').innerHTML = '<ul>'+events.slice(0,30).map(function(e){
        return '<li><code>'+esc(e.event_type||'')+'</code> '+esc(e.occurred_at||'')+' '+esc(e.note||'')+'</li>';
      }).join('')+'</ul>';
    }
  }
  void load();
})();
</script>
</body>
</html>`;
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, must-revalidate",
  Pragma: "no-cache",
} as const;

const WORKBENCH_HTML_NO_STORE: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, must-revalidate",
  Pragma: "no-cache",
};

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
  const runtimeRole = resolveRoleForUser(session.userId);
  const cookieStale = runtimeRole !== session.role;
  if (cookieStale) {
    appendSetCookie(res, buildSessionCookie({ ...session, role: runtimeRole }));
    logStructured({
      event: "workbench_session_role_refreshed",
      path: req.url ?? "",
      userId: session.userId,
      fromRole: session.role,
      toRole: runtimeRole,
      loginSource: session.loginSource,
    });
  }
  if (expectedRole && runtimeRole !== expectedRole) {
    logStructured({
      event: "workbench_role_forbidden",
      path: req.url ?? "",
      expectedRole,
      runtimeRole,
      sessionRole: session.role,
      userId: session.userId,
      loginSource: session.loginSource,
    });
    writeAuthError(res, 403, "Role forbidden");
    return undefined;
  }
  return cookieStale ? { ...session, role: runtimeRole } : session;
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
        const role = resolveRoleForUser(dingIdentity.userId);
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
        const autoRole = resolveRoleForUser(userId);
        if (roleInput === "admin" && autoRole !== "admin") {
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

  if (req.method === "POST" && url.pathname === "/api/workbench/logout") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": clearSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/me") {
    const session = resolveEffectiveSession(req, res);
    if (!session) {
      writeAuthError(res, 401, "Session required");
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      userId: session.userId,
      role: session.role,
      loginSource: session.loginSource,
      dingUser: session.dingUser ?? null,
      exp: session.exp,
    });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/tasks") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const tasks = enrichManagerTasksForApi(session.userId);
    writeJson(res, 200, { ok: true, tasks });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/manager/contacts") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const keyword = String(url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const contacts = withPeopleDirectoryStore((store) =>
      keyword ? store.searchContacts(keyword, 40) : store.listContacts().slice(0, 40),
    );
    const rows = contacts.slice(0, 40).map((contact) => ({
      userId: contact.userId,
      name: contact.name,
      departmentName: contact.departmentNames[0] ?? "未分配部门",
      active: contact.active,
    }));
    writeJson(res, 200, { ok: true, contacts: rows });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/publish") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        const body = await readJsonBody(req);
        if (shouldEnforceActionGuards()) {
          const confirmed = body.confirm === true;
          if (!confirmed) {
            writeJson(res, 400, {
              ok: false,
              error: "confirm=true is required before publish",
            });
            return;
          }
          const idempotencyKey = String(body.idempotencyKey ?? "").trim();
          if (!idempotencyKey) {
            writeJson(res, 400, {
              ok: false,
              error: "idempotencyKey is required",
            });
            return;
          }
          if (!rememberActionKey("manager_publish", idempotencyKey)) {
            writeJson(res, 200, { ok: true, duplicated: true, alreadyHandled: true });
            return;
          }
        }
        const planId = String(body.planId ?? "").trim()
          || String(body.currentPlanId ?? "").trim();
        const resolvedPlanId = planId || findLatestSessionForManager(session.userId)?.planId || "";
        if (!resolvedPlanId) {
          writeJson(res, 400, { ok: false, error: "No active plan found to publish" });
          return;
        }
        const target = findLatestSessionByPlanId(resolvedPlanId);
        if (!target) {
          writeJson(res, 404, { ok: false, error: "No session found for planId" });
          return;
        }
        if (target.senderStaffId && target.senderStaffId !== session.userId) {
          writeJson(res, 403, {
            ok: false,
            error: "Plan does not belong to current manager",
          });
          return;
        }
        const initiatorUserId = String(target.senderStaffId ?? session.userId).trim();
        const initiatorDepartment =
          employeeRepo.get(initiatorUserId)?.department?.trim() || "未配置部门";
        const assignments = Array.isArray((target.latestAssignment as { assignments?: unknown[] } | undefined)?.assignments)
          ? ((target.latestAssignment as { assignments: Array<Record<string, unknown>> }).assignments)
          : [];
        const unionIdByUser = new Map<string, string | undefined>();
        for (const row of assignments) {
          const primary = row?.primary as Record<string, unknown> | undefined;
          const assignee = String(primary?.userId ?? "").trim();
          if (!assignee) continue;
          const contact = withPeopleDirectoryStore((store) => store.getContact(assignee));
          if (!contact || !contact.active) {
            writeJson(res, 400, {
              ok: false,
              error: `assignee is missing or inactive in contacts: ${assignee}`,
            });
            return;
          }
          unionIdByUser.set(assignee, contact.unionId);
        }
        const published = getFormalTaskStore().publishFromSession({
          planId: resolvedPlanId,
          session: target,
          managerUserId: session.userId,
          initiatorDepartment,
          actorUserId: session.userId,
          actorName: session.dingUser?.name,
        });
        const warnings: string[] = [];
        const groupedAssignees = new Map<string, string[]>();
        published.subtasks.forEach((subtask) => {
          const current = groupedAssignees.get(subtask.assigneeUserId) ?? [];
          current.push(subtask.title);
          groupedAssignees.set(subtask.assigneeUserId, current);
        });
        const notifyResult = await workbenchPublishNotifier.notifyPublishedTask({
          taskNo: published.task.taskNo,
          title: published.task.title,
          managerUserId: session.userId,
          assignees: [...groupedAssignees.entries()].map(([userId, subtaskTitles]) => ({
            userId,
            unionId: unionIdByUser.get(userId),
            subtaskTitles,
          })),
        });
        const store = getFormalTaskStore();
        if (!notifyResult.enabled) {
          warnings.push(notifyResult.skippedReason || "employee notification skipped");
          store.appendTaskEvent({
            taskId: published.task.taskId,
            eventType: "EMPLOYEE_NOTIFY_SKIPPED",
            actorUserId: session.userId,
            note: notifyResult.skippedReason || "notification disabled",
            payload: {
              taskNo: published.task.taskNo,
            },
          });
        } else {
          notifyResult.success.forEach((item) => {
            store.appendTaskEvent({
              taskId: published.task.taskId,
              eventType: "EMPLOYEE_NOTIFIED",
              actorUserId: session.userId,
              note: `notified ${item.userId}`,
              payload: {
                userId: item.userId,
                cardMessageId: item.cardMessageId,
                todoId: item.todoId,
                taskNo: published.task.taskNo,
              },
            });
          });
          notifyResult.failed.forEach((item) => {
            warnings.push(`通知失败: ${item.userId}`);
            store.appendTaskEvent({
              taskId: published.task.taskId,
              eventType: "EMPLOYEE_NOTIFY_FAILED",
              actorUserId: session.userId,
              note: item.reason,
              payload: {
                userId: item.userId,
                taskNo: published.task.taskNo,
              },
            });
          });
        }
        writeJson(res, 200, {
          ok: true,
          alreadyPublished: published.alreadyPublished,
          task: published.task,
          subtasks: published.subtasks,
          warnings,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "publish failed",
        });
      }
    })();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/publish/prepare") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        const body = await readJsonBody(req);
        const prepared = preparePublishTaskHandler(body) as Record<string, unknown>;
        writeJson(res, 200, {
          ok: true,
          prepared,
          requiresManagerConfirm: true,
          managerUserId: session.userId,
        });
      } catch (err) {
        writeJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "prepare publish failed",
        });
      }
    })();
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
    writeJson(res, 200, { ok: true, ...detail });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/tasks/detail") {
    const session = requireSession(req, res);
    if (!session) return true;
    const taskNo = String(url.searchParams.get("taskNo") ?? "").trim();
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
      const scopedSubtasks = detail.subtasks.filter((subtask) => subtask.assigneeUserId === session.userId);
      writeJson(res, 200, {
        ok: true,
        task: detail.task,
        subtasks: scopedSubtasks,
        events: detail.events,
      });
      return true;
    }
    writeJson(res, 200, { ok: true, ...detail });
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
      }));
    writeJson(res, 200, { ok: true, employees });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/admin/metrics") {
    const session = requireSession(req, res, "admin");
    if (!session) return true;
    writeJson(res, 200, { ok: true, metrics: getFormalTaskStore().getMetrics() });
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
      effectiveManagers: [...listWorkbenchManagerIds()].sort(),
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
    const tasks = getFormalTaskStore()
      .listEmployeeSubtasks(session.userId)
      .filter((t) => t.status === "ASSIGNED" || t.status === "CHANGES_REQUESTED");
    writeJson(
      res,
      200,
      {
        ok: true,
        tasks: tasks.map((t) => {
          const mgr = withPeopleDirectoryStore((st) =>
            st.getContact(t.managerUserId)?.name?.trim(),
          );
          return {
            ...t,
            statusLabel: taskStatusLabel(t.status),
            managerDisplayName: mgr || "",
          };
        }),
      },
      { ...NO_STORE_HEADERS },
    );
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/current") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    const tasks = getFormalTaskStore()
      .listEmployeeSubtasks(session.userId)
      .filter((t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS" || t.status === "BLOCKED");
    writeJson(
      res,
      200,
      {
        ok: true,
        tasks: tasks.map((t) => {
          const mgr = withPeopleDirectoryStore((st) =>
            st.getContact(t.managerUserId)?.name?.trim(),
          );
          return {
            ...t,
            statusLabel: taskStatusLabel(t.status),
            managerDisplayName: mgr || "",
          };
        }),
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
        const session = requireSession(req, res, "manager");
        if (!session) return;
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
        const { task: updated } = executeReassignWithSideEffects(
          {
            planId,
            managerUserId: session.userId,
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

        const store = getFormalTaskStore();
        voidFireReassignAssigneeNotify({
          notifier: workbenchPublishNotifier,
          getContact: (userId) => withPeopleDirectoryStore((s) => s.getContact(userId)),
          appendTaskEvent: store.appendTaskEvent,
          taskStore: store,
          taskId: updated.taskId,
          planId,
          managerUserId: session.userId,
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
        const updated = getFormalTaskStore().updateSubtaskStatus({
          subtaskId: targetSubtaskId,
          actorUserId: session.userId,
          action: action === "accept"
            ? "accept"
            : action === "reject"
              ? "reject"
              : "request_changes",
          note,
        });
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

  if (isGetOrHead && url.pathname === "/workbench") {
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
    const all = loadAllSessions().filter((s) => s.senderStaffId === session.userId);
    const grouped = new Map<
      string,
      {
        planId: string;
        updatedAt?: string;
        turns: number;
        knownFacts: number;
        lastMessage?: string;
      }
    >();
    for (const s of all) {
      const existing = grouped.get(s.planId);
      const turns = Array.isArray(s.conversationHistory) ? s.conversationHistory.length : 0;
      const knownFacts = Array.isArray(s.knownFacts) ? s.knownFacts.length : 0;
      const lastMsg = turns > 0 ? s.conversationHistory[turns - 1]?.content : "";
      const updatedAt = s.updatedAt;
      if (!existing) {
        grouped.set(s.planId, {
          planId: s.planId,
          updatedAt,
          turns,
          knownFacts,
          lastMessage: typeof lastMsg === "string" ? lastMsg : "",
        });
      } else {
        const currentTs = Date.parse(existing.updatedAt ?? "") || 0;
        const nextTs = Date.parse(updatedAt ?? "") || 0;
        if (nextTs >= currentTs) {
          grouped.set(s.planId, {
            ...existing,
            updatedAt,
            turns,
            knownFacts,
            lastMessage: typeof lastMsg === "string" ? lastMsg : existing.lastMessage,
          });
        }
      }
    }
    const threads = [...grouped.values()]
      .sort((a, b) => {
        const ta = Date.parse(a.updatedAt ?? "") || 0;
        const tb = Date.parse(b.updatedAt ?? "") || 0;
        return tb - ta;
      })
      .map((row) => {
        const full = findLatestSessionByPlanId(row.planId);
        const title = full ? inferConversationTitleFromSession(full) : row.planId;
        const preview = truncateConversationPreview(row.lastMessage ?? "", 72);
        return { ...row, title, preview };
      });
    writeJson(res, 200, { ok: true, threads });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/conversation/messages") {
    const session = requireSession(req, res, "manager");
    if (!session) return true;
    const planId = String(url.searchParams.get("planId") ?? "").trim();
    if (!planId) {
      writeJson(res, 400, { ok: false, error: "planId is required" });
      return true;
    }
    const target = findLatestSessionByPlanId(planId);
    if (!target) {
      writeJson(res, 404, { ok: false, error: "No session found for planId" });
      return true;
    }
    const messages = (target.conversationHistory ?? []).map((m) => {
      const role = String(m.role || "system");
      const content = String(m.content ?? "");
      const at = typeof m.at === "string" ? m.at : undefined;
      if (role === "assistant") {
        return { role, content, at, html: formatWorkbenchAssistantHtml(content) };
      }
      return { role, content, at };
    });
    writeJson(res, 200, {
      ok: true,
      planId,
      messages,
      knownFacts: target.knownFacts ?? [],
      updatedAt: target.updatedAt,
    });
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
        const planIdInput = String(multipart.fields.planId ?? "").trim();
        const planId = planIdInput || findLatestSessionForManager(session.userId)?.planId;
        if (!planId) {
          writeJson(res, 400, {
            ok: false,
            error: "找不到目标会话；请在表单字段中提供 planId 或先在工作台开启新会话。",
          });
          return;
        }
        const target = ensureSessionForPlanId({ planId, userId: session.userId });
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

  if (req.method === "POST" && url.pathname === "/api/workbench/conversation/start") {
    void (async () => {
      const session = requireSession(req, res, "manager");
      if (!session) return;
      const planId = randomUUID();
      const chatKey = `workbench:${session.userId}:${planId}`;
      const now = new Date().toISOString();
      const created: PlanSession & { chatKeyHash: string } = {
        chatKeyHash: hashChatKey(chatKey),
        planId,
        createdAt: now,
        updatedAt: now,
        senderStaffId: session.userId,
        knownFacts: [],
        conversationHistory: [],
      };
      planSessionStore.save(created);
      planSessionStore.appendEvent({
        planId,
        chatKeyHash: created.chatKeyHash,
        eventType: "workbench_conversation_started",
        payload: {
          actorUserId: session.userId,
          actorName: session.dingUser?.name ?? undefined,
        },
      });
      writeJson(res, 200, { ok: true, planId });
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
        const body = await readJsonBody(req);
        const planId = String(body.planId ?? "").trim();
        const message = String(body.message ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!message) {
          writeJson(res, 400, { ok: false, error: "message is required" });
          return;
        }
        const target = ensureSessionForPlanId({
          planId,
          userId: session.userId,
        });
        const memoryContext = loadMemoryContextForPlan(planId);
        let mutableKnownFacts = [...(target.knownFacts ?? [])];
        const knownFactsStore: KnownFactsStore = {
          get: () => mutableKnownFacts,
          update: (facts: string[]) => {
            const merged = Array.from(new Set([
              ...mutableKnownFacts,
              ...facts.map((f) => String(f).trim()).filter(Boolean),
            ])).slice(-50);
            mutableKnownFacts = merged;
          },
        };
        const pendingRosterCtx = target.pendingRosterText
          ? {
              sourceLabel: target.pendingRosterSource ?? "uploaded:roster",
              chars: target.pendingRosterText.length,
            }
          : undefined;
        const candidatePoolCtx = target.candidatePool
          ? {
              source: target.candidatePool.source,
              entries: target.candidatePool.entries.map((e) => ({
                userId: e.userId,
                displayName: e.displayName,
              })),
              unresolvedCount: target.candidatePool.unresolved?.length,
            }
          : undefined;
        const orch = await runOrchestrator(message, {
          clientConfig: {
            ...qwenConfig,
            thinking:
              process.env.DINGTALK_QWEN_THINKING?.trim() === "1"
                ? true
                : false,
          },
          employeeRepo,
          maxToolIterations: Number(
            process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? "6",
          ),
          toolProfile: session.role === "admin" ? "admin" : "manager",
          promptProfile: "planner",
          knownFactsStore,
          currentSessionPlanId: target.planId,
          currentSession: target,
          actorName: session.dingUser?.name,
          actorRole: "manager",
          allowSearchWeb: isExplicitSearchRequest(message),
          // 工具回调原地修改了 target.candidatePool / pendingRoster*，把这些变更显式带回到落盘 payload
          onSessionMutated: () => {
            // 此处暂不重复落盘（下方 planSessionStore.save 会持久化最终状态），仅占位钩子。
          },
          sessionContext: {
            conversationHistory: target.conversationHistory,
            planId: target.planId,
            latestDraft: target.latestDraft,
            latestAssignment: target.latestAssignment,
            memorySummary: memoryContext.summary || buildSessionMemorySummary(target),
            memoryFacts: [...memoryContext.facts, ...mutableKnownFacts].slice(0, 8),
            currentTimeIso: new Date().toISOString(),
            pendingRoster: pendingRosterCtx,
            candidatePool: candidatePoolCtx,
          },
        });
        const assistantMessage = orch.messages.join("\n\n").trim() || "已处理。";
        const nowIso = new Date().toISOString();
        const nextConversationHistory = [
          ...(target.conversationHistory ?? []),
          { role: "user", content: message, at: nowIso },
          { role: "assistant", content: assistantMessage, at: nowIso },
        ].slice(-20);
        planSessionStore.save({
          ...target,
          senderStaffId: session.userId,
          lastTraceId: orch.traceId,
          knownFacts: mutableKnownFacts,
          latestDraft: orch.draft ?? target.latestDraft,
          latestAssignment: orch.assignment ?? target.latestAssignment,
          conversationHistory: nextConversationHistory,
          revisionEvents: [
            ...(target.revisionEvents ?? []),
            {
              occurredAt: new Date().toISOString(),
              eventType: "MANAGER_AGENT_CHAT",
              planId,
              traceId: orch.traceId,
              messageChars: message.length,
            },
          ].slice(-60),
        });
        planSessionStore.appendEvent({
          planId,
          chatKeyHash: target.chatKeyHash,
          eventType: "manager_agent_chat",
          payload: {
            traceId: orch.traceId,
            messageChars: message.length,
            actorUserId: session.userId,
            actorName: session.dingUser?.name ?? undefined,
          },
        });
        appendMemoryEvents({
          planId,
          userMessage: message,
          assistantMessage,
          latestDraft: orch.draft ?? target.latestDraft,
          latestAssignment: orch.assignment ?? target.latestAssignment,
          traceId: orch.traceId,
          modelConfig: {
            apiKey: qwenConfig.apiKey,
            baseUrl: qwenConfig.baseUrl,
            timeoutMs: qwenConfig.timeoutMs,
          },
        }).catch(() => {});
        writeJson(res, 200, {
          ok: true,
          planId,
          traceId: orch.traceId,
          assistantMessage,
          hasDraft: !!orch.draft,
          hasAssignment: !!orch.assignment,
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
      redirect(res, WORKBENCH_LOGIN_PATH);
      return true;
    }

    const legacyTarget = LEGACY_WORKBENCH_REDIRECTS[url.pathname];
    if (legacyTarget) {
      if (legacyRedirectRequiresManager(url.pathname) && session.role !== "manager") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      if (url.pathname === "/workbench/employee" && session.role !== "employee") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      redirect(res, legacyTarget);
      return true;
    }

    if (MANAGER_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      if (session.role !== "manager") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      const planId = url.searchParams.get("planId")?.trim() || undefined;
      const userLabel = session.dingUser?.name ?? session.userId;
      let planTitle: string | undefined;
      if (planId) {
        const s = findLatestSessionByPlanId(planId);
        if (s) planTitle = inferConversationTitleFromSession(s);
      }
      const html =
        url.pathname === "/workbench/manager/tasks"
          ? renderManagerTasksPage({ planId, planTitle, userLabel })
          : url.pathname === "/workbench/manager/chat"
            ? renderManagerChatPage({ planId, planTitle, userLabel })
            : renderTaskDetailPage({
              roleLabel: "manager",
              backPath: "/workbench/manager/tasks",
            });
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

    if (ADMIN_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      if (session.role !== "admin") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      const userLabel = session.dingUser?.name ?? session.userId;
      const html = url.pathname === "/workbench/admin/task"
        ? renderTaskDetailPage({
          roleLabel: "admin",
          backPath: "/workbench/admin",
        })
        : renderAdminWorkbenchPage({ userLabel });
      res.writeHead(200, WORKBENCH_HTML_NO_STORE);
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

    if (EMPLOYEE_WORKBENCH_PAGE_PATHS.has(url.pathname)) {
      if (session.role !== "employee") {
        redirect(res, defaultPathForRole(session.role));
        return true;
      }
      const html =
        url.pathname === "/workbench/employee/new"
          ? renderEmployeeNewTasksPage()
          : url.pathname === "/workbench/employee/current"
            ? renderEmployeeCurrentTasksPage()
            : renderTaskDetailPage({
              roleLabel: "employee",
              backPath: "/workbench/employee/current",
            });
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
    const redirectTo = `${base}?planId=${encodeURIComponent(verified.planId)}`;
    redirect(res, redirectTo, [buildSessionCookie(session)]);
    return true;
  }

  return false; // not handled here
}
