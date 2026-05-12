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
  createWorkbenchTaskStore,
  type WorkbenchTaskRecord,
  type WorkbenchTaskStatus,
} from "../infra/workbench-task-store";
import { loadQwenPlannerConfigFromEnv } from "../agent/demo/qwen-planner";
import { runOrchestrator } from "../agent/orchestrator";
import {
  DingTalkAuthError,
  type DingTalkAuthClient,
  createDingTalkAuthClient,
  getDingTalkCorpId,
} from "../integrations/dingtalk/dingtalk-auth";
import { buildWorkbenchJsapiConfig } from "../integrations/dingtalk/dingtalk-jsapi-config";
import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { isWorkbenchManager } from "../security/workbench-manager-whitelist";
import { verifyAssignmentEntry } from "../security/web-entry-token";
import {
  renderManagerChatPage,
  renderManagerTasksPage,
} from "./manager-workbench-pages";
import {
  renderEmployeeCurrentTasksPage,
  renderEmployeeNewTasksPage,
} from "./employee-workbench-pages";

const WORKBENCH_LOGIN_PATH = "/workbench";

const MANAGER_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/manager/tasks",
  "/workbench/manager/chat",
]);

const EMPLOYEE_WORKBENCH_PAGE_PATHS = new Set([
  "/workbench/employee/new",
  "/workbench/employee/current",
]);

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

type WorkbenchRole = "manager" | "employee";

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

const assignmentWorkbenchDir = dirname(fileURLToPath(import.meta.url));

function resolveWorkbenchDdLoginBundlePath(): string {
  return join(assignmentWorkbenchDir, "..", "..", "dist", "workbench-dd-login.js");
}

const planSessionStore = createPlanSessionStore();
const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
const qwenConfig = loadQwenPlannerConfigFromEnv();
const workbenchTaskStore = createWorkbenchTaskStore();
let dingtalkAuthClient: DingTalkAuthClient = createDingTalkAuthClient();

export function __setDingTalkAuthClientForTest(client?: DingTalkAuthClient): void {
  dingtalkAuthClient = client ?? createDingTalkAuthClient();
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
    if (parsed.role !== "manager" && parsed.role !== "employee") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function resolveRoleForUser(userId: string): WorkbenchRole {
  return isWorkbenchManager(userId) ? "manager" : "employee";
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
  workbenchTaskStore.syncFromSessions();
  const plans = safeReadRecentPlans();
  const sessions = safeReadRecentSessions();
  const allTasks = workbenchTaskStore.listAll();
  const normalizedUserId = userId?.trim() || undefined;

  let filteredSessions = sessions;
  let filteredTasks = allTasks;
  if (view === "employee") {
    filteredSessions = normalizedUserId
      ? sessions.filter((s) => s.senderStaffId === normalizedUserId)
      : sessions.filter((s) => Boolean(s.senderStaffId));
    filteredTasks = normalizedUserId
      ? allTasks.filter((t) => t.assigneeUserId === normalizedUserId)
      : [];
  } else if (view === "in-progress") {
    filteredSessions = sessions.filter((s) => s.conversationTurns > 0);
    filteredTasks = normalizedUserId
      ? allTasks.filter(
          (t) =>
            t.assigneeUserId === normalizedUserId &&
            (t.status === "ACCEPTED" || t.status === "IN_PROGRESS" || t.status === "BLOCKED"),
        )
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

function taskStatusLabel(status: WorkbenchTaskStatus): string {
  if (status === "ASSIGNED") return "待处理";
  if (status === "CHANGES_REQUESTED") return "待确认";
  if (status === "ACCEPTED") return "已接受";
  if (status === "IN_PROGRESS") return "进行中";
  if (status === "BLOCKED") return "阻塞中";
  if (status === "DONE") return "已完成";
  return "已拒绝";
}

function classifyEmployeeTasks(tasks: WorkbenchTaskRecord[]): {
  newTasks: WorkbenchTaskRecord[];
  currentTasks: WorkbenchTaskRecord[];
} {
  const newTasks = tasks.filter(
    (t) => t.status === "ASSIGNED" || t.status === "CHANGES_REQUESTED",
  );
  const currentTasks = tasks.filter(
    (t) => t.status === "ACCEPTED" || t.status === "IN_PROGRESS" || t.status === "BLOCKED",
  );
  return { newTasks, currentTasks };
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
  return role === "manager"
    ? "/workbench/manager/tasks"
    : "/workbench/employee/new";
}

function renderWorkbenchEntryLoginHtml(): string {
  const corpId = getDingTalkCorpId() ?? "";
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
  <p>优先尝试钉钉免登。登录后按身份自动跳转主管或员工界面。</p>
  <div class="muted" id="ssoHint"></div>
  <label>钉钉 userId
    <input id="userId" placeholder="例如 641871342" />
  </label>
  <label>身份
    <select id="role">
      <option value="auto">自动判定（推荐）</option>
      <option value="manager">主管</option>
      <option value="employee">员工</option>
    </select>
  </label>
  <button id="loginBtn" type="button">测试登录（非钉钉环境）</button>
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

function writeJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
  if (expectedRole && session.role !== expectedRole) {
    writeAuthError(res, 403, "Role forbidden");
    return undefined;
  }
  return session;
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

  if (req.method === "POST" && url.pathname === "/api/workbench/login") {
    void (async () => {
      try {
        const body = await readJsonBody(req);
        const userId = String(body.userId ?? "").trim();
        const roleInput = String(body.role ?? "auto").trim();
        if (!userId) {
          writeJson(res, 400, { ok: false, error: "userId is required" });
          return;
        }
        const autoRole = resolveRoleForUser(userId);
        if (roleInput === "manager" && autoRole !== "manager") {
          writeJson(res, 403, {
            ok: false,
            error: "userId is not in manager whitelist",
          });
          return;
        }
        const role: WorkbenchRole =
          roleInput === "manager" || roleInput === "employee"
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
    const session = getSessionFromRequest(req);
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
    workbenchTaskStore.syncFromSessions();
    const tasks = workbenchTaskStore.listForManager(session.userId).map((t) => ({
      ...t,
      statusLabel: taskStatusLabel(t.status),
    }));
    writeJson(res, 200, { ok: true, tasks });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/new") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    workbenchTaskStore.syncFromSessions();
    const tasks = classifyEmployeeTasks(workbenchTaskStore.listForEmployee(session.userId)).newTasks;
    writeJson(res, 200, {
      ok: true,
      tasks: tasks.map((t) => ({ ...t, statusLabel: taskStatusLabel(t.status) })),
    });
    return true;
  }

  if (isGetOrHead && url.pathname === "/api/workbench/employee/tasks/current") {
    const session = requireSession(req, res, "employee");
    if (!session) return true;
    workbenchTaskStore.syncFromSessions();
    const tasks = classifyEmployeeTasks(workbenchTaskStore.listForEmployee(session.userId)).currentTasks;
    writeJson(res, 200, {
      ok: true,
      tasks: tasks.map((t) => ({ ...t, statusLabel: taskStatusLabel(t.status) })),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/manager/reassign") {
    void (async () => {
      try {
        const session = requireSession(req, res, "manager");
        if (!session) return;
        const body = await readJsonBody(req);
        const planId = String(body.planId ?? "").trim();
        const assigneeUserId = String(body.assigneeUserId ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!assigneeUserId) {
          writeJson(res, 400, { ok: false, error: "assigneeUserId is required" });
          return;
        }
        workbenchTaskStore.syncFromSessions();
        const prior = workbenchTaskStore.listAll().find((t) => t.planId === planId);
        if (!prior) {
          writeJson(res, 404, { ok: false, error: "Task not found for planId" });
          return;
        }
        if (prior.managerUserId !== session.userId) {
          writeJson(res, 403, {
            ok: false,
            error: "Task does not belong to current manager",
          });
          return;
        }
        if (prior.status === "DONE" || prior.status === "REJECTED") {
          writeJson(res, 400, {
            ok: false,
            error: "Cannot reassign a finished or rejected task",
          });
          return;
        }
        const updated = workbenchTaskStore.updateTask(planId, (task) => ({
          ...task,
          assigneeUserId,
          status: "ASSIGNED",
          history: [
            ...(task.history ?? []),
            {
              type: "MANAGER_REASSIGN",
              actorUserId: session.userId,
              note,
              occurredAt: new Date().toISOString(),
              payload: { assigneeUserId },
            },
          ],
        }));

        const targetSession = findLatestSessionByPlanId(planId);
        const occurredAt = new Date().toISOString();
        if (targetSession) {
          const eventRecord: Record<string, unknown> = {
            occurredAt,
            eventType: "MANAGER_REASSIGN_SAVED",
            planId,
            actorUserId: session.userId,
            actorName: session.dingUser?.name ?? undefined,
            assigneeUserId,
            note,
          };
          planSessionStore.save({
            ...targetSession,
            latestAssignment: patchLatestAssignmentAssignee(
              targetSession.latestAssignment,
              assigneeUserId,
            ),
            revisionEvents: [...(targetSession.revisionEvents ?? []), eventRecord].slice(-60),
          });
          planSessionStore.appendEvent({
            planId,
            chatKeyHash: targetSession.chatKeyHash,
            eventType: "manager_reassign_saved",
            payload: {
              actorUserId: session.userId,
              actorName: session.dingUser?.name ?? undefined,
              assigneeUserId,
              note,
            },
          });
        }

        writeJson(res, 200, {
          ok: true,
          task: {
            ...updated,
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

  if (req.method === "POST" && url.pathname === "/api/workbench/employee/action") {
    void (async () => {
      try {
        const session = requireSession(req, res, "employee");
        if (!session) return;
        const body = await readJsonBody(req);
        const planId = String(body.planId ?? "").trim();
        const action = String(body.action ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
          return;
        }
        if (!action) {
          writeJson(res, 400, { ok: false, error: "action is required" });
          return;
        }
        if (
          (action === "reject" ||
            action === "customize" ||
            action === "request_changes") &&
          !note
        ) {
          writeJson(res, 400, {
            ok: false,
            error: "note is required for this action",
          });
          return;
        }
        workbenchTaskStore.syncFromSessions();
        const updated = workbenchTaskStore.updateTask(planId, (task) => {
          if (task.assigneeUserId !== session.userId) {
            throw new Error("Task does not belong to current employee");
          }
          let status: WorkbenchTaskStatus = task.status;
          let eventType:
            | "EMPLOYEE_ACCEPT"
            | "EMPLOYEE_REJECT"
            | "EMPLOYEE_CUSTOMIZE"
            | "EMPLOYEE_REQUEST_CHANGES" = "EMPLOYEE_ACCEPT";
          if (action === "accept") {
            status = "ACCEPTED";
            eventType = "EMPLOYEE_ACCEPT";
          } else if (action === "reject") {
            status = "REJECTED";
            eventType = "EMPLOYEE_REJECT";
          } else if (action === "customize") {
            status = "CHANGES_REQUESTED";
            eventType = "EMPLOYEE_CUSTOMIZE";
          } else if (action === "request_changes") {
            status = "CHANGES_REQUESTED";
            eventType = "EMPLOYEE_REQUEST_CHANGES";
          } else {
            throw new Error("Unsupported action");
          }
          return {
            ...task,
            status,
            history: [
              ...(task.history ?? []),
              {
                type: eventType,
                actorUserId: session.userId,
                note,
                occurredAt: new Date().toISOString(),
              },
            ],
          };
        });
        writeJson(res, 200, {
          ok: true,
          planId: updated.planId,
          status: updated.status,
          statusLabel: taskStatusLabel(updated.status),
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
    const session = getSessionFromRequest(req);
    if (!session) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") res.end();
      else res.end(renderWorkbenchEntryLoginHtml());
      return true;
    }
    redirect(res, defaultPathForRole(session.role));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/workbench/employee/progress") {
    void (async () => {
      try {
        const session = requireSession(req, res, "employee");
        if (!session) return;
        const body = await readJsonBody(req);
        const planId = String(body.planId ?? "").trim();
        const progressStatus = String(body.progressStatus ?? "").trim();
        const note = String(body.note ?? "").trim();

        if (!planId) {
          writeJson(res, 400, { ok: false, error: "planId is required" });
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

        const target = findLatestSessionByPlanId(planId);
        if (!target) {
          writeJson(res, 404, {
            ok: false,
            error: "No session found for given planId",
          });
          return;
        }

        const now = new Date().toISOString();
        const eventRecord: Record<string, unknown> = {
          type: "employee_progress_update",
          planId,
          progressStatus,
          note,
          actorUserId:
            session.userId || target.senderStaffId || "unknown",
          actorName: session.dingUser?.name ?? undefined,
          updatedAt: now,
          source: "workbench_api",
        };

        const nextRevisionEvents = Array.isArray(target.revisionEvents)
          ? [...target.revisionEvents, eventRecord]
          : [eventRecord];
        const nextConversationHistory = Array.isArray(target.conversationHistory)
          ? [
              ...target.conversationHistory,
              { role: "employee_update", content: `[${progressStatus}] ${note}` },
            ]
          : [{ role: "employee_update", content: `[${progressStatus}] ${note}` }];

        planSessionStore.save({
          ...target,
          revisionEvents: nextRevisionEvents,
          conversationHistory: nextConversationHistory,
        });
        planSessionStore.appendEvent({
          planId: target.planId,
          chatKeyHash: target.chatKeyHash,
          eventType: "employee_progress_submitted",
          payload: eventRecord,
        });

        workbenchTaskStore.syncFromSessions();
        try {
          workbenchTaskStore.updateTask(planId, (task) => {
            if (task.assigneeUserId !== session.userId) {
              throw new Error("Task does not belong to current employee");
            }
            const nextStatus: WorkbenchTaskStatus =
              progressStatus === "DONE"
                ? "DONE"
                : progressStatus === "BLOCKED"
                  ? "BLOCKED"
                  : "IN_PROGRESS";
            return {
              ...task,
              status: nextStatus,
              progressNote: note,
              history: [
                ...(task.history ?? []),
                {
                  type: "EMPLOYEE_PROGRESS",
                  actorUserId: session.userId,
                  note,
                  occurredAt: now,
                  payload: { progressStatus },
                },
              ],
            };
          });
        } catch (err) {
          writeJson(res, 403, {
            ok: false,
            error: err instanceof Error ? err.message : "progress update forbidden",
          });
          return;
        }

        writeJson(res, 200, {
          ok: true,
          planId,
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
    const threads = [...grouped.values()].sort((a, b) => {
      const ta = Date.parse(a.updatedAt ?? "") || 0;
      const tb = Date.parse(b.updatedAt ?? "") || 0;
      return tb - ta;
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
    writeJson(res, 200, {
      ok: true,
      planId,
      messages: target.conversationHistory ?? [],
      knownFacts: target.knownFacts ?? [],
      updatedAt: target.updatedAt,
    });
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
          sessionContext: {
            knownFacts: target.knownFacts,
            conversationHistory: target.conversationHistory,
            planId: target.planId,
            latestDraft: target.latestDraft,
            latestAssignment: target.latestAssignment,
            memorySummary: buildSessionMemorySummary(target),
          },
        });
        const assistantMessage = orch.messages.join("\n\n").trim() || "已处理。";
        const nextConversationHistory = [
          ...(target.conversationHistory ?? []),
          { role: "user", content: message },
          { role: "assistant", content: assistantMessage },
        ].slice(-20);
        planSessionStore.save({
          ...target,
          senderStaffId: session.userId,
          lastTraceId: orch.traceId,
          knownFacts: orch.knownFacts,
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
    const session = getSessionFromRequest(req);
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
      const html =
        url.pathname === "/workbench/manager/tasks"
          ? renderManagerTasksPage({ planId, userLabel })
          : renderManagerChatPage({ planId, userLabel });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
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
          : renderEmployeeCurrentTasksPage();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") res.end();
      else res.end(html);
      return true;
    }

  }

  if (url.pathname === "/assignment/workbench" && isGetOrHead) {
    const tokenParam = url.searchParams.get("token");
    if (!tokenParam && !url.searchParams.get("access_token")) {
      const session = getSessionFromRequest(req);
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
