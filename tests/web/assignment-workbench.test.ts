import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __resetWorkbenchStoresForTest,
  __setDingTalkAuthClientForTest,
  __setWorkbenchPublishNotifierForTest,
  __taskStatusLabelForTest,
  handleAssignmentHttp,
  renderTaskDetailPage,
} from "../../src/web/assignment-workbench";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../src/infra/plan-session-store";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import { __resetExternalLoginRateLimitsForTest } from "../../src/web/external-workbench-login";
import { DingTalkAuthError, type DingTalkAuthClient } from "../../src/integrations/dingtalk/dingtalk-auth";
import type { WorkbenchPublishNotifier } from "../../src/integrations/dingtalk/workbench-notify";
import { stubWorkbenchPublishNotifier } from "../helpers/stub-workbench-notifier";
import { __setWeeklyAdvisorLlmForTest } from "../../src/agent/weekly-dashboard/weekly-dashboard-advisor-llm";

/** Minimal IncomingMessage stub for tests */
function stubReq(overrides: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const chunks = overrides.body ? [Buffer.from(overrides.body)] : [];
  return {
    url: overrides.url ?? "/",
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  } as IncomingMessage;
}

/** Minimal ServerResponse stub that captures status, headers and body */
interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function stubRes(): { res: ServerResponse; captured: () => CapturedResponse } {
  const state: CapturedResponse = {
    statusCode: 200,
    headers: {},
    body: "",
  };
  const liveHeaders: Record<string, string | string[] | undefined> = {};
  const res = {
    writeHead(statusCode: number, headers: Record<string, string>): void {
      state.statusCode = statusCode;
      state.headers = { ...state.headers, ...(headers ?? {}) };
      for (const [k, v] of Object.entries(headers ?? {})) {
        liveHeaders[k] = v;
      }
    },
    setHeader(name: string, value: string | string[]): void {
      liveHeaders[name] = value;
      state.headers[name] = value;
    },
    getHeader(name: string): string | string[] | undefined {
      return liveHeaders[name];
    },
    end(chunk: string): void {
      state.body = chunk ?? "";
    },
  } as ServerResponse;
  return {
    res,
    captured: () => state,
  };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("assignment-workbench HTTP handler", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "test-session-secret-at-least-32-chars-long");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1");
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    const tmp = mkdtempSync(join(tmpdir(), "workbench-test-"));
    sqlitePath = join(tmp, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", sqlitePath);
    vi.stubEnv("WORKBENCH_DYNAMIC_MANAGER_IDS_FILE", join(tmp, "workbench-managers.json"));
    __resetWorkbenchStoresForTest();
    sessionDir = join(tmp, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    vi.stubEnv("PLAN_SESSION_DIR", sessionDir);
    vi.stubEnv("PLAN_SESSION_EVENTS_PATH", join(tmp, "plan-session-events.jsonl"));
    __setDingTalkAuthClientForTest({
      resolveIdentityByAuthCode: vi.fn(async (authCode: string) => ({
        userId: `user-${authCode}`,
        name: "测试用户",
        unionId: "union-x",
      })),
    } satisfies DingTalkAuthClient);
  });

  async function seedPublishedTask(params: {
    planId: string;
    managerUserId: string;
    assigneeUserId: string;
    /** 第二条子任务由其他员工承接，用于员工详情 API 分工断言 */
    secondAssignee?: { userId: string; title?: string };
    taskDescription?: string;
  }): Promise<void> {
    seedContact(params.managerUserId, "管理部", "Manager");
    seedContact(params.assigneeUserId, "执行部", "Engineer");
    if (params.secondAssignee) {
      seedContact(params.secondAssignee.userId, "执行部", "Peer");
    }
    const chatKeyHash = `seed-${params.planId}`;
    const now = new Date().toISOString();
    const desc =
      params.taskDescription ??
      "默认任务整体背景（测试种子数据），满足发布链路可读性。";
    const defaultTimeNode = { dueAt: "2026-07-10" };
    const tasks =
      params.secondAssignee ?
        [
          {
            id: "task-1",
            title: "测试子任务",
            deliverables: "本人交付物（测试）",
            timeNode: defaultTimeNode,
          },
          {
            id: "task-2",
            title: params.secondAssignee.title ?? "同事子任务",
            deliverables: "同事交付物（不应泄露给员工 API）",
            objective: "同事目标",
            timeNode: defaultTimeNode,
          },
        ]
      : [{ id: "task-1", title: "测试子任务", timeNode: defaultTimeNode }];
    const assignments =
      params.secondAssignee ?
        [
          {
            taskId: "task-1",
            primary: { userId: params.assigneeUserId, displayName: params.assigneeUserId },
          },
          {
            taskId: "task-2",
            primary: {
              userId: params.secondAssignee.userId,
              displayName: params.secondAssignee.userId,
            },
          },
        ]
      : [
          {
            taskId: "task-1",
            primary: { userId: params.assigneeUserId, displayName: params.assigneeUserId },
          },
        ];
    writeFileSync(
      join(sessionDir, `${chatKeyHash}.json`),
      JSON.stringify(
        {
          chatKeyHash,
          planId: params.planId,
          createdAt: now,
          updatedAt: now,
          senderStaffId: params.managerUserId,
          knownFacts: [],
          conversationHistory: [{ role: "user", content: "测试发布" }],
          latestDraft: {
            title: "测试任务",
            description: desc,
            tasks,
          },
          latestAssignment: {
            assignments,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const sessionPath = join(sessionDir, `${chatKeyHash}.json`);
    const sessionRaw = JSON.parse(readFileSync(sessionPath, "utf8")) as PlanSession & { chatKeyHash: string };
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId: params.planId,
      session: sessionRaw,
      managerUserId: params.managerUserId,
      initiatorDepartment: "管理部",
      actorUserId: params.managerUserId,
    });
  }

  function seedContact(userId: string, departmentName = "执行部", position = "Engineer"): void {
    const people = createPeopleDirectoryStore();
    people.upsertContact({
      userId,
      name: userId,
      departmentIds: ["1"],
      departmentNames: [departmentName],
      position,
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    people.close();
  }

  async function loginCookie(userId: string, role: "admin" | "manager" | "employee" = "manager"): Promise<string> {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    return String(loginRes.captured().headers["Set-Cookie"] ?? "");
  }

  afterEach(() => {
    __resetWorkbenchStoresForTest();
    __resetExternalLoginRateLimitsForTest();
    __setDingTalkAuthClientForTest();
    __setWorkbenchPublishNotifierForTest();
    vi.unstubAllEnvs();
  });

  it("returns false for unhandled paths", () => {
    const req = stubReq({ url: "/other", method: "GET" });
    const { res } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(false);
  });

  it("GET /static/workbench-dd-login.js serves login bundle", () => {
    const req = stubReq({ url: "/static/workbench-dd-login.js", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(String(c.headers["Content-Type"] ?? "")).toContain("javascript");
    expect(String(c.headers["Cache-Control"] ?? "")).toContain("no-store");
    const bodyStr = typeof c.body === "string" ? c.body : Buffer.from(c.body as Uint8Array).toString("utf8");
    expect(bodyStr.length).toBeGreaterThan(500);
    expect(bodyStr).toContain("__wbTryDingTalkLogin");
  });

  it("GET /workbench login page loads dingtalk-jsapi bundle", () => {
    const req = stubReq({ url: "/workbench", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('/static/workbench-dd-login.js?v=');
    expect(c.body).toContain("__WB_CONFIGURED_CORP_ID");
  });

  it("GET /workbench login page hides test login copy when WORKBENCH_TEST_LOGIN_ENABLED=0", () => {
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "0");
    const req = stubReq({ url: "/workbench", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.body).toContain("任务规划工作台");
    expect(c.body).toContain("__WB_TEST_LOGIN_ENABLED = false");
    expect(c.body).not.toContain("测试登录");
    expect(c.body).not.toContain("任务规划工作台登录");
  });

  it("GET /workbench login page does not show test environment wording when test login is enabled", () => {
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    const req = stubReq({ url: "/workbench", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).not.toContain("测试环境");
    expect(c.body).not.toContain("测试登录");
    expect(c.body).not.toContain("娴嬭瘯鐜");
    expect(c.body).not.toContain("娴嬭瘯鐧诲綍");
  });

  it("GET /workbench login page keeps fallback account fields hidden while trying DingTalk SSO", () => {
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "1");
    const req = stubReq({ url: "/workbench", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain("请从钉钉工作台打开");
    expect(c.body).toContain('id="fallbackLoginToggle"');
    expect(c.body).toContain('id="fallbackLoginPanel" hidden');
    expect(c.body).toMatch(/id="fallbackLoginPanel" hidden[\s\S]*id="userId"/);
    expect(c.body).toContain("__wbShowFallbackLogin");
  });

  it("unauthenticated daily reports page preserves target through login redirect", () => {
    const target = "/workbench/daily-reports?date=2026-07-08&view=custom%3Aoverview";
    const req = stubReq({ url: target, method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(c.headers.Location).toBe(`/workbench?next=${encodeURIComponent(target)}`);
  });

  it("logged-in manager daily reports neutral page resolves to manager page", async () => {
    vi.stubEnv("DAILY_REPORTS_PAGE_ENABLED", "1");
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/workbench/daily-reports?date=2026-07-08&view=custom%3Aoverview",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(c.headers.Location).toBe(
      "/workbench/manager/daily-reports?date=2026-07-08&view=custom%3Aoverview",
    );
  });

  it("employee task detail page JS uses 前往待承接 footer copy", () => {
    const html = renderTaskDetailPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=new",
      enforceActionGuards: false,
    });
    expect(html).toContain("前往待承接");
    expect(html).toContain("前往进行中");
    expect(html).not.toContain("返回列表 · 接受任务");
  });

  it("GET without token redirects to /workbench", () => {
    const req = stubReq({
      url: "/assignment/workbench",
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(c.headers.Location).toBe("/workbench");
  });

  it("GET with invalid token returns 403", () => {
    const req = stubReq({
      url: "/assignment/workbench?token=bad-token",
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access denied");
  });

  it("GET with valid token returns 200 HTML page", () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "user-1",
      role: "manager",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/assignment/workbench?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(String(c.headers.Location ?? "")).toMatch(/\/workbench\/manager\/(chat|tasks)/);
    expect(String(c.headers["Set-Cookie"] ?? "")).toContain("wb_session=");
  });

  it("POST /api/workbench/auth/dingtalk sets session and returns role", async () => {
    const req = stubReq({
      url: "/api/workbench/auth/dingtalk",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ authCode: "abc" }),
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(String(c.headers["Set-Cookie"] ?? "")).toContain("wb_session=");
    expect(c.body).toContain('"ok":true');
    expect(c.body).toContain('"userId":"user-abc"');
  });

  it("POST /api/workbench/auth/dingtalk preserves daily reports next path", async () => {
    __setDingTalkAuthClientForTest({
      resolveIdentityByAuthCode: vi.fn(async () => ({
        userId: "manager-1",
        name: "Manager One",
        unionId: "union-manager",
      })),
    } satisfies DingTalkAuthClient);
    const next = "/workbench/manager/daily-reports?date=2026-07-08&view=custom%3Aoverview";
    const req = stubReq({
      url: "/api/workbench/auth/dingtalk",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ authCode: "abc", next }),
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(JSON.parse(c.body).redirectTo).toBe(next);
  });

  it("POST /api/workbench/login preserves daily reports next path", async () => {
    const next = "/workbench/manager/daily-reports?date=2026-07-08&view=custom%3Aoverview";
    const req = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager", next }),
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(JSON.parse(c.body).redirectTo).toBe(next);
  });

  it("POST /api/workbench/auth/dingtalk returns mapped auth error", async () => {
    __setDingTalkAuthClientForTest({
      resolveIdentityByAuthCode: vi.fn(async () => {
        throw new DingTalkAuthError("invalid code", "AUTH_CODE_INVALID", 401);
      }),
    } satisfies DingTalkAuthClient);
    const req = stubReq({
      url: "/api/workbench/auth/dingtalk",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ authCode: "bad" }),
    });
    const { res, captured } = stubRes();
    const handled = handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(401);
    expect(c.body).toContain("AUTH_CODE_INVALID");
  });

  it("manager can reassign task", async () => {
    await seedPublishedTask({
      planId: "plan-1",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/manager/reassign",
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        planId: "plan-1",
        assigneeUserId: "emp-2",
        note: "负载均衡",
      }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('"ok":true');
    expect(c.body).toContain('"assigneeUserId":"emp-2"');
  });

  it("manager reassign invokes notifyReassignedAssignee", async () => {
    const notifyReassignedAssignee = vi.fn(async () => ({
      enabled: false,
      skippedReason: "test",
      success: [],
      failed: [],
    }));
    __setWorkbenchPublishNotifierForTest(stubWorkbenchPublishNotifier({
      notifyReassignedAssignee,
    }));
    await seedPublishedTask({
      planId: "plan-reassign-notify",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/manager/reassign",
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        planId: "plan-reassign-notify",
        assigneeUserId: "emp-2",
        note: "notify test",
      }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 40));
    expect(notifyReassignedAssignee.mock.calls.length).toBe(1);
    const call0 = notifyReassignedAssignee.mock.calls[0] as unknown as [
      { assigneeUserId: string; scope: string; managerUserId: string; taskNo?: string },
    ];
    const arg = call0[0];
    expect(arg.assigneeUserId).toBe("emp-2");
    expect(arg.scope).toBe("plan");
    expect(arg.managerUserId).toBe("manager-1");
    expect(String(arg.taskNo || "")).toMatch(/^TASK-/);
  });

  it("manager can stop task via API", async () => {
    await seedPublishedTask({
      planId: "plan-stop-api",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/manager/tasks/stop",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-stop-api", note: "项目终止" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('"ok":true');
    expect(c.body).toContain('"status":"STOPPED"');
    const store = createWorkbenchFormalTaskStore();
    expect(store.getTaskDetail("plan-stop-api")?.task.status).toBe("STOPPED");
  });

  it("manager can append subtask via API", async () => {
    seedContact("emp-3", "执行部", "Engineer");
    await seedPublishedTask({
      planId: "plan-add-api",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-add-api",
        title: "补增子任务",
        assigneeUserId: "emp-3",
        objective: "完成补增",
        deliverables: "补增交付物",
        completionCriteria: "通过评审",
        dueAt: "2026-06-15",
      }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('"ok":true');
    expect(c.body).toContain('"status":"ASSIGNED"');
    const store = createWorkbenchFormalTaskStore();
    expect(store.getTaskDetail("plan-add-api")?.subtasks).toHaveLength(2);
  });

  it("duplicate append subtask POST dedupes by clientRequestId", async () => {
    const notifyPublishedTask = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "emp-3", robotMessageKey: "rk-crid" }],
      failed: [],
    }));
    __setWorkbenchPublishNotifierForTest(stubWorkbenchPublishNotifier({ notifyPublishedTask }));
    seedContact("emp-3", "执行部", "Engineer");
    await seedPublishedTask({
      planId: "plan-add-crid-api",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const body = JSON.stringify({
      planId: "plan-add-crid-api",
      title: "clientRequestId 子任务",
      assigneeUserId: "emp-3",
      objective: "完成",
      deliverables: "交付",
      completionCriteria: "通过",
      dueAt: "2026-06-15",
      clientRequestId: "api-req-unique-1",
    });
    const req1 = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    const res1 = stubRes();
    handleAssignmentHttp(req1, res1.res);
    await flushAsync();
    expect(res1.captured().statusCode).toBe(200);

    const req2 = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-add-crid-api",
        title: "不同标题",
        assigneeUserId: "emp-3",
        objective: "不同",
        deliverables: "不同",
        completionCriteria: "不同",
        dueAt: "2026-06-20",
        clientRequestId: "api-req-unique-1",
      }),
    });
    const res2 = stubRes();
    handleAssignmentHttp(req2, res2.res);
    await flushAsync();
    expect(res2.captured().body).toContain('"duplicated":true');
    expect(createWorkbenchFormalTaskStore().getTaskDetail("plan-add-crid-api")?.subtasks).toHaveLength(2);
    expect(notifyPublishedTask).toHaveBeenCalledTimes(1);
  });

  it("duplicate append subtask POST returns duplicated and does not notify twice", async () => {
    const notifyPublishedTask = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "emp-3", robotMessageKey: "rk-add" }],
      failed: [],
    }));
    __setWorkbenchPublishNotifierForTest(stubWorkbenchPublishNotifier({ notifyPublishedTask }));
    seedContact("emp-3", "执行部", "Engineer");
    await seedPublishedTask({
      planId: "plan-add-dedup-api",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const body = JSON.stringify({
      planId: "plan-add-dedup-api",
      title: "补增子任务",
      assigneeUserId: "emp-3",
      objective: "完成补增",
      deliverables: "补增交付物",
      completionCriteria: "通过评审",
      dueAt: "2026-06-15",
    });
    const req1 = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    const res1 = stubRes();
    handleAssignmentHttp(req1, res1.res);
    await flushAsync();
    expect(res1.captured().statusCode).toBe(200);
    expect(res1.captured().body).toContain('"ok":true');
    expect(res1.captured().body).not.toContain('"duplicated":true');

    const req2 = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body,
    });
    const res2 = stubRes();
    handleAssignmentHttp(req2, res2.res);
    await flushAsync();
    expect(res2.captured().statusCode).toBe(200);
    expect(res2.captured().body).toContain('"duplicated":true');

    const store = createWorkbenchFormalTaskStore();
    expect(store.getTaskDetail("plan-add-dedup-api")?.subtasks).toHaveLength(2);
    expect(notifyPublishedTask).toHaveBeenCalledTimes(1);
  });

  it("manager task detail page includes add-subtask submit lock and in_progress default filter", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks",
      enforceActionGuards: false,
    });
    expect(html).toContain("addSubtaskSubmitting");
    expect(html).toContain("prepareAddSubtaskFormUi");
    expect(html).toContain("countByFilter('in_progress') > 0 ? 'in_progress'");
    expect(html).toContain("add-subtask-depends-item");
    expect(html).toContain('type="checkbox" name="addSubtaskDependsOn"');
    expect(html).not.toContain('<select id="addSubtaskDependsOn"');
    expect(html).toContain("syncComboDropdownPosition");
    expect(html).toContain("combo-options--fixed");
  });

  it("append subtask API requires deliverables", async () => {
    await seedPublishedTask({
      planId: "plan-add-req",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/manager/subtasks",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-add-req",
        title: "缺字段",
        assigneeUserId: "emp-1",
        objective: "目标",
        completionCriteria: "标准",
        dueAt: "2026-06-01",
      }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(400);
    expect(captured().body).toContain("deliverables is required");
  });

  it("manager can stop single subtask via API", async () => {
    const store = createWorkbenchFormalTaskStore();
    await seedPublishedTask({
      planId: "plan-stop-sub-api",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
      secondAssignee: { userId: "emp-2", title: "子2" },
    });
    const detail = store.getTaskDetail("plan-stop-sub-api")!;
    const sub1 = detail.subtasks.find((s) => s.sourceTaskKey === "task-1")!;
    const sub2 = detail.subtasks.find((s) => s.sourceTaskKey === "task-2")!;
    store.updateSubtaskStatus({ subtaskId: sub2.subtaskId, actorUserId: "emp-2", action: "accept" });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/manager/subtasks/stop",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-stop-sub-api",
        subtaskId: sub1.subtaskId,
        note: "单条停止",
      }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('"ok":true');
    expect(c.body).toContain('"status":"STOPPED"');
    expect(store.getTaskDetail("plan-stop-sub-api")?.task.status).toBe("IN_PROGRESS");
  });

  it("stop task API requires note", async () => {
    await seedPublishedTask({
      planId: "plan-stop-note",
      managerUserId: "manager-1",
      assigneeUserId: "emp-1",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/manager/tasks/stop",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-stop-note" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(400);
    expect(captured().body).toContain("note is required");
  });

  it("employee tasks/new GET sets Cache-Control no-store", async () => {
    await seedPublishedTask({
      planId: "plan-cc-head",
      managerUserId: "manager-1",
      assigneeUserId: "emp-cc",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-cc", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/employee/tasks/new",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(String(c.headers["Cache-Control"] ?? "")).toContain("no-store");
  });

  it("test login entry session keeps chosen employee role for manager-whitelisted userId", async () => {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/employee/tasks/current",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    const body = JSON.parse(c.body) as { ok?: boolean; tasks?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  describe("manager executor workbench view", () => {
    async function loginCookie(userId: string, role: "manager" | "employee"): Promise<string> {
      const loginReq = stubReq({
        url: "/api/workbench/login",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const loginRes = stubRes();
      handleAssignmentHttp(loginReq, loginRes.res);
      await flushAsync();
      return String(loginRes.captured().headers["Set-Cookie"] ?? "");
    }

    it("manager in manager view cannot access employee tasks API", async () => {
      const cookie = await loginCookie("manager-1", "manager");
      const req = stubReq({
        url: "/api/workbench/employee/tasks/new",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      expect(captured().statusCode).toBe(403);
    });

    it("switch-view to employee allows employee tasks API", async () => {
      const cookie = await loginCookie("manager-1", "manager");
      const switchReq = stubReq({
        url: "/api/workbench/switch-view",
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ view: "employee" }),
      });
      const switchRes = stubRes();
      handleAssignmentHttp(switchReq, switchRes.res);
      await flushAsync();
      const switchedCookie = String(switchRes.captured().headers["Set-Cookie"] ?? "");
      expect(switchRes.captured().statusCode).toBe(200);
      const switchBody = JSON.parse(switchRes.captured().body) as { ok?: boolean; role?: string };
      expect(switchBody.ok).toBe(true);
      expect(switchBody.role).toBe("employee");

      const req = stubReq({
        url: "/api/workbench/employee/tasks/new",
        method: "GET",
        headers: { cookie: switchedCookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      expect(captured().statusCode).toBe(200);
    });

    it("manager visiting employee HTML auto-switches view for deep links", async () => {
      const cookie = await loginCookie("manager-1", "manager");
      const req = stubReq({
        url: "/workbench/employee?view=new",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      expect(captured().statusCode).toBe(200);
      expect(captured().body).toContain("员工工作台");
      expect(String(captured().headers["Set-Cookie"] ?? "")).toContain("wb_session=");
    });

    it("/api/workbench/me exposes canExecuteAsManager for managers", async () => {
      const cookie = await loginCookie("manager-1", "manager");
      const req = stubReq({
        url: "/api/workbench/me",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      const body = JSON.parse(captured().body) as {
        ok?: boolean;
        primaryRole?: string;
        canExecuteAsManager?: boolean;
      };
      expect(captured().statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.primaryRole).toBe("manager");
      expect(body.canExecuteAsManager).toBe(true);
    });

    it("manager in employee view can accept assigned subtask", async () => {
      await seedPublishedTask({
        planId: "plan-mgr-exec",
        managerUserId: "manager-2",
        assigneeUserId: "manager-1",
      });
      vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1,manager-2");
      const cookie = await loginCookie("manager-1", "employee");
      const req = stubReq({
        url: "/api/workbench/employee/action",
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ planId: "plan-mgr-exec", action: "accept" }),
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      expect(captured().statusCode).toBe(200);
      expect(captured().body).toContain('"status":"IN_PROGRESS"');
    });
  });

  it("employee can accept task via action API", async () => {
    await seedPublishedTask({
      planId: "plan-2",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/employee/action",
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ planId: "plan-2", action: "accept" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('"status":"IN_PROGRESS"');
  });

  it("legacy /workbench/conversation redirects manager to chat", async () => {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/workbench/conversation",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(String(c.headers.Location ?? "")).toBe("/workbench/manager/chat");
  });

  it("legacy /workbench/conversation redirects employee to employee home", async () => {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/workbench/conversation",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    const c = captured();
    expect(c.statusCode).toBe(302);
    expect(String(c.headers.Location ?? "")).toBe("/workbench/employee?view=new");
  });

  it("maps legacy employee paths to ?view= with 302", async () => {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const cases: Array<{ url: string; expectLoc: string }> = [
      { url: "/workbench/employee/new", expectLoc: "/workbench/employee?view=new" },
      { url: "/workbench/employee/current", expectLoc: "/workbench/employee?view=current" },
      { url: "/workbench/employee/current?tab=progress", expectLoc: "/workbench/employee?view=current" },
      { url: "/workbench/employee/current?tab=profile", expectLoc: "/workbench/employee?view=profile" },
    ];
    for (const { url, expectLoc } of cases) {
      const req = stubReq({ url, method: "GET", headers: { cookie } });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      const c = captured();
      expect(c.statusCode, url).toBe(302);
      expect(String(c.headers.Location ?? ""), url).toBe(expectLoc);
    }
  });

  it("labels legacy ACCEPTED status as 进行中 for API consumers", () => {
    expect(__taskStatusLabelForTest("ACCEPTED")).toBe("进行中");
  });

  it("GET tasks/detail surfaces EMPLOYEE_NOTIFY_FAILED with summary and detail", async () => {
    await seedPublishedTask({
      planId: "plan-notify-fail",
      managerUserId: "manager-1",
      assigneeUserId: "emp-nf",
    });
    const store = createWorkbenchFormalTaskStore();
    const taskRow = store.listManagerTasks("manager-1").find((t) => t.planId === "plan-notify-fail");
    if (!taskRow) throw new Error("expected published task");
    store.appendTaskEvent({
      taskId: taskRow.taskId,
      eventType: "EMPLOYEE_NOTIFY_FAILED",
      actorUserId: "manager-1",
      note: "钉钉待办创建失败（测试）",
    });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: `/api/workbench/tasks/detail?taskNo=${encodeURIComponent(taskRow.taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    const body = JSON.parse(c.body) as {
      ok: boolean;
      events?: Array<{ type?: string; summary?: string; detail?: string }>;
    };
    expect(body.ok).toBe(true);
    const ev = body.events?.find((e) => e.type === "EMPLOYEE_NOTIFY_FAILED");
    expect(ev?.summary).toContain("失败");
    expect(ev?.detail).toContain("钉钉");
  });

  it("GET tasks/detail for employee returns peer subtasks with whitelist fields only", async () => {
    await seedPublishedTask({
      planId: "plan-emp-siblings",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
      secondAssignee: { userId: "emp-3", title: "同事子任务" },
      taskDescription: "整条任务背景用于员工详情",
    });
    const store = createWorkbenchFormalTaskStore();
    const taskRow = store.listEmployeeSubtasks("emp-2").find((t) => t.planId === "plan-emp-siblings");
    if (!taskRow?.taskNo) throw new Error("expected task row");

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: `/api/workbench/tasks/detail?taskNo=${encodeURIComponent(taskRow.taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    const body = JSON.parse(c.body) as {
      ok: boolean;
      task?: { description?: string };
      subtasks?: Array<Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    expect(body.task?.description).toContain("整条任务背景");
    expect(body.subtasks).toHaveLength(2);
    const mine = body.subtasks?.find((s) => s.mine === true);
    const peer = body.subtasks?.find((s) => s.mine === false);
    expect(mine?.deliverables).toBeDefined();
    expect(peer?.deliverables).toBeUndefined();
    expect(peer?.objective).toBeUndefined();
    expect(peer).toMatchObject({
      title: "同事子任务",
      assigneeUserId: "emp-3",
    });
  });

  it("GET tasks/detail for employee filters events to TASK_PUBLISHED and own subtasks only", async () => {
    await seedPublishedTask({
      planId: "plan-emp-event-filter",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
      secondAssignee: { userId: "emp-3", title: "同事子任务" },
      taskDescription: "背景",
    });
    const store = createWorkbenchFormalTaskStore();
    const taskRow = store.listEmployeeSubtasks("emp-2").find((t) => t.planId === "plan-emp-event-filter");
    if (!taskRow?.taskNo) throw new Error("expected task row");
    const detail = store.getTaskDetail(taskRow.taskNo);
    if (!detail) throw new Error("expected detail");
    const peerSub = detail.subtasks.find((s) => s.assigneeUserId === "emp-3");
    const mineSub = detail.subtasks.find((s) => s.assigneeUserId === "emp-2");
    if (!peerSub || !mineSub) throw new Error("expected subtasks");

    store.appendTaskEvent({
      taskId: detail.task.taskId,
      eventType: "MANAGER_REASSIGN",
      actorUserId: "manager-1",
      note: "整单改派记录",
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      eventType: "EMPLOYEE_NOTIFIED",
      actorUserId: "manager-1",
      note: "通知 emp-3",
      payload: { userId: "emp-3" },
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: peerSub.subtaskId,
      eventType: "SUBTASK_ACCEPTED",
      actorUserId: "emp-3",
      note: "同事接受",
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: mineSub.subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "emp-2",
      note: "我的进度",
    });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: `/api/workbench/tasks/detail?taskNo=${encodeURIComponent(taskRow.taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    const body = JSON.parse(c.body) as { events?: Array<{ type?: string }> };
    const types = body.events?.map((e) => e.type) ?? [];
    expect(types).toContain("TASK_PUBLISHED");
    expect(types).toContain("SUBTASK_PROGRESS");
    expect(types).not.toContain("MANAGER_REASSIGN");
    expect(types).not.toContain("EMPLOYEE_NOTIFIED");
    expect(types).not.toContain("SUBTASK_ACCEPTED");
  });

  it("GET /workbench/employee/task HTML includes task background section", async () => {
    await seedPublishedTask({
      planId: "plan-emp-html",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
      taskDescription: "HTML 段任务背景",
    });
    const store = createWorkbenchFormalTaskStore();
    const taskRow = store.listEmployeeSubtasks("emp-2").find((t) => t.planId === "plan-emp-html");
    if (!taskRow?.taskNo) throw new Error("expected task row");

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: `/workbench/employee/task?taskNo=${encodeURIComponent(taskRow.taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('class="task-desc"');
    expect(c.body).toContain("待承接");
    expect(c.body).toContain("进行中");
  });

  it("GET /workbench/manager/chat defaults to main thread", async () => {
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/workbench/manager/chat",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain('var activeThreadId = "main"');
    expect(c.body).toContain('id="threadList"');
    expect(c.body).toContain("新规划会话");
    expect(c.body).not.toContain('id="editChips"');
    expect(c.body).toContain('id="editDraftBtnPanel"');
    expect(c.body).toContain('class="btn-draft-edit-table"');
    expect(c.body).toContain('class="btn-draft-publish"');
    expect(c.body).toContain('id="draftPreviewList"');
    expect(c.body).not.toContain('draft-stat-grid');
    expect(c.body).not.toContain('id="editDraftBtn"');
    expect(c.body).toContain("/static/workbench-draft-grid.js");
  });

  it("GET /api/workbench/conversation/draft returns editable rows for main thread draft", async () => {
    const now = new Date().toISOString();
    const { hashChatKey } = await import("../../src/infra/plan-session-store");
    const chatKeyHash = hashChatKey("workbench:main:manager-1");
    writeFileSync(
      join(sessionDir, `${chatKeyHash}.json`),
      JSON.stringify({
        chatKeyHash,
        planId: "plan-draft-get",
        createdAt: now,
        updatedAt: now,
        senderStaffId: "manager-1",
        threadKind: "main",
        threadId: "main",
        latestDraft: {
          title: "草案标题",
          description: "背景",
          tasks: [
            {
              id: "task_1",
              title: "子任务 A",
              objective: "目标",
              deliverables: ["交付物"],
              completionCriteria: ["标准"],
              timeNode: { dueAt: "2026-07-01" },
            },
          ],
        },
      }),
      "utf8",
    );

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/conversation/draft?thread=main",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    const c = captured();
    expect(c.statusCode).toBe(200);
    const data = JSON.parse(c.body) as { ok: boolean; editable: boolean; rows: unknown[] };
    expect(data.ok).toBe(true);
    expect(data.editable).toBe(true);
    expect(data.rows).toHaveLength(1);
  });

  it("GET draft on main thread reads dingtalk draft when canonical merges dual session files", async () => {
    const userId = "manager-canonical-dual";
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", `manager-1,${userId}`);
    const now = new Date().toISOString();
    const { canonicalMainChatKey } = await import(
      "../../src/web/canonical-main-session"
    );
    const { hashChatKey } = await import("../../src/infra/plan-session-store");
    const wbKey = canonicalMainChatKey(userId);
    const dtKey = `conv-dual::1::${userId}`;
    writeFileSync(
      join(sessionDir, `${hashChatKey(wbKey)}.json`),
      JSON.stringify({
        chatKeyHash: hashChatKey(wbKey),
        planId: "plan-wb-placeholder",
        createdAt: now,
        updatedAt: now,
        senderStaffId: userId,
        threadKind: "main",
        threadId: "main",
      }),
      "utf8",
    );
    writeFileSync(
      join(sessionDir, `${hashChatKey(dtKey)}.json`),
      JSON.stringify({
        chatKeyHash: hashChatKey(dtKey),
        planId: "plan-dt-draft",
        createdAt: now,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        senderStaffId: userId,
        conversationId: "conv-dual",
        latestDraft: {
          title: "钉钉合并后标题",
          tasks: [
            {
              id: "task_1",
              title: "子任务来自钉钉",
              objective: "o",
              deliverables: ["d"],
              completionCriteria: ["c"],
              timeNode: { dueAt: "2026-08-01" },
            },
          ],
        },
      }),
      "utf8",
    );

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/conversation/draft?thread=main",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    const data = JSON.parse(c.body) as {
      ok: boolean;
      title?: string;
      rows: Array<{ title?: string }>;
    };
    expect(data.ok).toBe(true);
    expect(data.title).toBe("钉钉合并后标题");
    expect(data.rows[0]?.title).toBe("子任务来自钉钉");
  });

  it("employee reject without note returns 400", async () => {
    await seedPublishedTask({
      planId: "plan-rej",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const req = stubReq({
      url: "/api/workbench/employee/action",
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ planId: "plan-rej", action: "reject", note: "" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(400);
    expect(c.body).toContain("note is required");
  });

  it("employee reject invokes notifyManagerOfEmployeeAction, writes EMPLOYEE_RESPONSE_SUMMARY, appears in /tasks/new waiting bucket (not /current)", async () => {
    const notifyManagerOfEmployeeAction = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "manager-1", robotMessageKey: "rk-reject-test" }],
      failed: [],
    }));
    __setWorkbenchPublishNotifierForTest(stubWorkbenchPublishNotifier({ notifyManagerOfEmployeeAction }));
    await seedPublishedTask({
      planId: "plan-rej-notify",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });
    const store = createWorkbenchFormalTaskStore();
    const row = store.listEmployeeSubtasks("emp-2").find((r) => r.planId === "plan-rej-notify");
    expect(row?.subtaskId).toBeTruthy();
    const subtaskId = String(row?.subtaskId);
    const taskNo = String(row?.taskNo);

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const actionReq = stubReq({
      url: "/api/workbench/employee/subtasks/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-rej-notify",
        subtaskId,
        action: "reject",
        note: "资源不足",
        idempotencyKey: "idem-rej-notify-1",
      }),
    });
    const actionRes = stubRes();
    handleAssignmentHttp(actionReq, actionRes.res);
    await flushAsync();
    expect(actionRes.captured().statusCode).toBe(200);
    expect(notifyManagerOfEmployeeAction).toHaveBeenCalledTimes(1);
    expect(notifyManagerOfEmployeeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "rejected",
        managerUserId: "manager-1",
      }),
    );

    const events = store.getTaskDetail(taskNo)?.events ?? [];
    expect(events.some((e) => String(e.event_type ?? "") === "EMPLOYEE_RESPONSE_SUMMARY")).toBe(true);

    const curReq = stubReq({
      url: "/api/workbench/employee/tasks/current",
      method: "GET",
      headers: { cookie },
    });
    const curRes = stubRes();
    handleAssignmentHttp(curReq, curRes.res);
    await flushAsync();
    const cur = JSON.parse(curRes.captured().body) as { ok: boolean; tasks: Array<{ subtaskId: string }> };
    expect(cur.ok).toBe(true);
    expect(cur.tasks.some((t) => t.subtaskId === subtaskId)).toBe(false);

    const newReq = stubReq({
      url: "/api/workbench/employee/tasks/new",
      method: "GET",
      headers: { cookie },
    });
    const newRes = stubRes();
    handleAssignmentHttp(newReq, newRes.res);
    await flushAsync();
    const inbox = JSON.parse(newRes.captured().body) as {
      ok: boolean;
      actionable: Array<{ subtaskId: string }>;
      waiting: Array<{ subtaskId: string }>;
    };
    expect(inbox.ok).toBe(true);
    expect(inbox.waiting.some((t) => t.subtaskId === subtaskId)).toBe(true);
    expect(inbox.actionable.some((t) => t.subtaskId === subtaskId)).toBe(false);
  });

  it("employee subtasks/action requires idempotencyKey when WORKBENCH_ENFORCE_ACTION_GUARDS=1", async () => {
    await seedPublishedTask({
      planId: "plan-guard-action",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });
    vi.stubEnv("WORKBENCH_ENFORCE_ACTION_GUARDS", "1");

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const badReq = stubReq({
      url: "/api/workbench/employee/subtasks/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-guard-action", action: "accept", note: "" }),
    });
    const badRes = stubRes();
    handleAssignmentHttp(badReq, badRes.res);
    await flushAsync();
    expect(badRes.captured().statusCode).toBe(400);
    expect(badRes.captured().body).toContain("idempotencyKey");

    const okReq = stubReq({
      url: "/api/workbench/employee/subtasks/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-guard-action",
        action: "accept",
        note: "",
        idempotencyKey: "idem-accept-guard-1",
      }),
    });
    const okRes = stubRes();
    handleAssignmentHttp(okReq, okRes.res);
    await flushAsync();
    expect(okRes.captured().statusCode).toBe(200);
    expect(okRes.captured().body).toContain('"status":"IN_PROGRESS"');
  });

  it("employee subtasks/progress requires idempotencyKey when WORKBENCH_ENFORCE_ACTION_GUARDS=1", async () => {
    await seedPublishedTask({
      planId: "plan-guard-progress",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });
    vi.stubEnv("WORKBENCH_ENFORCE_ACTION_GUARDS", "1");

    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const acceptReq = stubReq({
      url: "/api/workbench/employee/subtasks/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-guard-progress",
        action: "accept",
        note: "",
        idempotencyKey: "idem-accept-guard-progress",
      }),
    });
    const acceptRes = stubRes();
    handleAssignmentHttp(acceptReq, acceptRes.res);
    await flushAsync();
    expect(acceptRes.captured().statusCode).toBe(200);

    const badReq = stubReq({
      url: "/api/workbench/employee/subtasks/progress",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-guard-progress",
        progressStatus: "IN_PROGRESS",
        note: "开始执行",
      }),
    });
    const badRes = stubRes();
    handleAssignmentHttp(badReq, badRes.res);
    await flushAsync();
    expect(badRes.captured().statusCode).toBe(400);
    expect(badRes.captured().body).toContain("idempotencyKey");

    const okReq = stubReq({
      url: "/api/workbench/employee/subtasks/progress",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        planId: "plan-guard-progress",
        progressStatus: "IN_PROGRESS",
        note: "开始执行",
        idempotencyKey: "idem-progress-guard-1",
      }),
    });
    const okRes = stubRes();
    handleAssignmentHttp(okReq, okRes.res);
    await flushAsync();
    expect(okRes.captured().statusCode).toBe(200);
    expect(okRes.captured().body).toContain('"ok":true');
  });

  it("employee tasks/new is empty when logged-in user is not assignee", async () => {
    await seedPublishedTask({
      planId: "plan-wrong-emp",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-3", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/employee/tasks/new",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    expect(captured().statusCode).toBe(200);
    const body = JSON.parse(captured().body) as { ok: boolean; tasks: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBe(0);
  });

  it("employee request_changes keeps ASSIGNED and writes change event", async () => {
    await seedPublishedTask({
      planId: "plan-change",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/employee/subtasks/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-change", action: "request_changes", note: "需补充验收标准" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(200);
    expect(captured().body).toContain('"status":"ASSIGNED"');
  });

  it("test login endpoint can be disabled", async () => {
    vi.stubEnv("WORKBENCH_TEST_LOGIN_ENABLED", "0");
    const req = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(403);
  });

  it("admin employee search reads contacts snapshot", async () => {
    seedContact("admin-1", "管理部", "Admin");
    seedContact("emp-search", "研发部", "Engineer");
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "admin-1", role: "admin" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const req = stubReq({
      url: "/api/workbench/admin/employees?keyword=emp-search",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    expect(captured().statusCode).toBe(200);
    expect(captured().body).toContain("emp-search");
  });

  it("admin manager group write APIs are disabled when manager groups are off", async () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "0");
    seedContact("admin-1", "管理部", "Admin");
    const cookie = await loginCookie("admin-1", "admin");

    const createReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Disabled group" }),
    });
    const createRes = stubRes();
    expect(handleAssignmentHttp(createReq, createRes.res)).toBe(true);
    await flushAsync();

    const body = JSON.parse(createRes.captured().body) as { ok?: boolean; error?: string };
    expect(createRes.captured().statusCode).toBe(404);
    expect(body).toMatchObject({ ok: false, error: "manager_groups_disabled" });
  });

  it("admin can create manager group and add a member", async () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    seedContact("admin-1", "管理部", "Admin");
    seedContact("mgr-a", "项目部", "Manager");
    const cookie = await loginCookie("admin-1", "admin");

    const createReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "明思项目主管组", description: "项目任务共享", portfolioEnabled: true }),
    });
    const createRes = stubRes();
    expect(handleAssignmentHttp(createReq, createRes.res)).toBe(true);
    await flushAsync();
    const created = JSON.parse(createRes.captured().body) as {
      ok?: boolean;
      group?: { groupId?: string; portfolioEnabled?: boolean };
    };
    expect(createRes.captured().statusCode).toBe(200);
    expect(created.ok).toBe(true);
    expect(created.group?.groupId).toMatch(/^mgrgrp:/);
    expect(created.group?.portfolioEnabled).toBe(true);

    const updateReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ groupId: created.group?.groupId, status: "inactive" }),
    });
    const updateRes = stubRes();
    expect(handleAssignmentHttp(updateReq, updateRes.res)).toBe(true);
    await flushAsync();
    const updated = JSON.parse(updateRes.captured().body) as {
      ok?: boolean;
      group?: { name?: string; status?: string };
    };
    expect(updateRes.captured().statusCode).toBe(200);
    expect(updated.ok).toBe(true);
    expect(updated.group).toMatchObject({ name: "明思项目主管组", status: "inactive" });

    const addReq = stubReq({
      url: "/api/workbench/admin/manager-groups/members",
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ groupId: created.group?.groupId, userId: "mgr-a", enabled: true }),
    });
    const addRes = stubRes();
    expect(handleAssignmentHttp(addReq, addRes.res)).toBe(true);
    await flushAsync();
    expect(addRes.captured().statusCode).toBe(200);
    expect(JSON.parse(addRes.captured().body).ok).toBe(true);

    const listReq = stubReq({
      url: "/api/workbench/admin/manager-groups",
      method: "GET",
      headers: { cookie },
    });
    const listRes = stubRes();
    expect(handleAssignmentHttp(listReq, listRes.res)).toBe(true);
    const listed = JSON.parse(listRes.captured().body) as {
      ok?: boolean;
      groups?: Array<{
        groupId?: string;
        memberUserIds?: string[];
        members?: Array<{ userId?: string; name?: string }>;
        taskCount?: number;
        projectCount?: number;
      }>;
    };
    expect(listRes.captured().statusCode).toBe(200);
    expect(listed.ok).toBe(true);
    expect(listed.groups?.[0]?.memberUserIds).toContain("mgr-a");
    expect(listed.groups?.[0]?.members?.[0]).toMatchObject({ userId: "mgr-a", name: "mgr-a" });
    expect(listed.groups?.[0]?.taskCount).toBe(0);
    expect(listed.groups?.[0]?.projectCount).toBe(0);
  });

  it("manager group members can list and open each other's group tasks", async () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import(
      "../../src/security/workbench-manager-groups"
    );
    const group = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
    await seedPublishedTask({ planId: "plan-group-visible", managerUserId: "mgr-a", assigneeUserId: "emp-a" });
    createWorkbenchFormalTaskStore().migrateManagerObjectsToGroup({
      managerUserId: "mgr-a",
      managerGroupId: group.groupId,
    });
    const cookie = await loginCookie("mgr-b", "manager");

    const listReq = stubReq({ url: "/api/workbench/manager/tasks", method: "GET", headers: { cookie } });
    const listRes = stubRes();
    expect(handleAssignmentHttp(listReq, listRes.res)).toBe(true);
    const listed = JSON.parse(listRes.captured().body) as { tasks?: Array<{ planId?: string }> };
    expect(listed.tasks?.some((t) => t.planId === "plan-group-visible")).toBe(true);

    const taskNo = createWorkbenchFormalTaskStore().getTaskDetail("plan-group-visible")?.task.taskNo ?? "";
    const detailReq = stubReq({
      url: `/api/workbench/tasks/detail?taskNo=${encodeURIComponent(taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const detailRes = stubRes();
    expect(handleAssignmentHttp(detailReq, detailRes.res)).toBe(true);
    expect(detailRes.captured().statusCode).toBe(200);
  });

  it("different manager groups cannot open each other's tasks", async () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import(
      "../../src/security/workbench-manager-groups"
    );
    const a = createWorkbenchManagerGroup({ name: "明思项目主管组" });
    const b = createWorkbenchManagerGroup({ name: "商务部主管组" });
    addWorkbenchManagerGroupMember(a.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(b.groupId, "mgr-b");
    await seedPublishedTask({ planId: "plan-group-private", managerUserId: "mgr-a", assigneeUserId: "emp-a" });
    createWorkbenchFormalTaskStore().migrateManagerObjectsToGroup({
      managerUserId: "mgr-a",
      managerGroupId: a.groupId,
    });
    const cookie = await loginCookie("mgr-b", "manager");

    const taskNo = createWorkbenchFormalTaskStore().getTaskDetail("plan-group-private")?.task.taskNo ?? "";
    const detailReq = stubReq({
      url: `/api/workbench/tasks/detail?taskNo=${encodeURIComponent(taskNo)}`,
      method: "GET",
      headers: { cookie },
    });
    const detailRes = stubRes();
    expect(handleAssignmentHttp(detailReq, detailRes.res)).toBe(true);
    expect(detailRes.captured().statusCode).toBe(403);
  });

  it("employee can update profile via api without touching contacts", async () => {
    seedContact("emp-profile", "研发部", "Engineer");
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-profile", role: "employee" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const postReq = stubReq({
      url: "/api/workbench/employee/profile",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        skillTags: ["Python", "SPC"],
        strengths: ["analysis"],
        boundaries: ["no supplier audit"],
        tools: ["Jira"],
        availability: { capacityHint: "忙碌" },
      }),
    });
    const postRes = stubRes();
    handleAssignmentHttp(postReq, postRes.res);
    await flushAsync();
    expect(postRes.captured().statusCode).toBe(200);

    const getReq = stubReq({
      url: "/api/workbench/employee/profile",
      method: "GET",
      headers: { cookie },
    });
    const getRes = stubRes();
    handleAssignmentHttp(getReq, getRes.res);
    expect(getRes.captured().statusCode).toBe(200);
    expect(getRes.captured().body).toContain("Python");
  });

  it("runs minimal end-to-end flow: draft->publish->employee action->manager reassign", async () => {
    await seedPublishedTask({
      planId: "plan-e2e-1",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
    });

    const employeeLoginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "emp-2", role: "employee" }),
    });
    const employeeLoginRes = stubRes();
    handleAssignmentHttp(employeeLoginReq, employeeLoginRes.res);
    await flushAsync();
    const employeeCookie = String(employeeLoginRes.captured().headers["Set-Cookie"] ?? "");

    const employeeAcceptReq = stubReq({
      url: "/api/workbench/employee/action",
      method: "POST",
      headers: { "content-type": "application/json", cookie: employeeCookie },
      body: JSON.stringify({ planId: "plan-e2e-1", action: "accept" }),
    });
    const employeeAcceptRes = stubRes();
    handleAssignmentHttp(employeeAcceptReq, employeeAcceptRes.res);
    await flushAsync();
    expect(employeeAcceptRes.captured().statusCode).toBe(200);
    expect(employeeAcceptRes.captured().body).toContain('"status":"IN_PROGRESS"');

    seedContact("emp-3");
    const managerLoginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "manager-1", role: "manager" }),
    });
    const managerLoginRes = stubRes();
    handleAssignmentHttp(managerLoginReq, managerLoginRes.res);
    await flushAsync();
    const managerCookie = String(managerLoginRes.captured().headers["Set-Cookie"] ?? "");

    const reassignReq = stubReq({
      url: "/api/workbench/manager/reassign",
      method: "POST",
      headers: { "content-type": "application/json", cookie: managerCookie },
      body: JSON.stringify({ planId: "plan-e2e-1", assigneeUserId: "emp-3", note: "工作量调整" }),
    });
    const reassignRes = stubRes();
    handleAssignmentHttp(reassignReq, reassignRes.res);
    await flushAsync();
    expect(reassignRes.captured().statusCode).toBe(200);
    expect(reassignRes.captured().body).toContain('"assigneeUserId":"emp-3"');
  });

  it("external login creates employee session and blocks manager API", async () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const people = createPeopleDirectoryStore();
    people.upsertContact({
      userId: "ext_demo",
      name: "外部演示",
      departmentIds: ["外部"],
      departmentNames: ["外部"],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      rawJson: { source: "external_manual" },
    });
    people.upsertExternalAccount({
      userId: "ext_demo",
      username: "demo_user",
      password: "password-1234",
      displayName: "外部演示",
    });
    people.close();

    const loginReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo_user", password: "password-1234" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    expect(loginRes.captured().statusCode).toBe(200);
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    expect(cookie).toContain("wb_session=");

    const managerReq = stubReq({
      url: "/api/workbench/manager/tasks",
      method: "GET",
      headers: { cookie },
    });
    const managerRes = stubRes();
    handleAssignmentHttp(managerReq, managerRes.res);
    expect(managerRes.captured().statusCode).toBe(403);

    const logoutReq = stubReq({
      url: "/api/workbench/logout",
      method: "POST",
      headers: { cookie },
    });
    const logoutRes = stubRes();
    handleAssignmentHttp(logoutReq, logoutRes.res);
    expect(logoutRes.captured().statusCode).toBe(200);
    expect(JSON.parse(logoutRes.captured().body)).toEqual({
      ok: true,
      redirectTo: "/workbench/external/login",
    });
  });

  it("external login page is available when enabled", () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const req = stubReq({ url: "/workbench/external/login", method: "GET" });
    const { res, captured } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(true);
    expect(captured().statusCode).toBe(200);
    expect(captured().body).toContain("外部执行者登录");
    expect(captured().body).toContain("钉钉用户请");
  });

  it("unauthenticated employee HTML redirects to external login with next when enabled", () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const req = stubReq({ url: "/workbench/employee?view=current", method: "GET" });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    expect(captured().statusCode).toBe(302);
    expect(String(captured().headers.Location ?? "")).toBe(
      "/workbench/external/login?next=%2Fworkbench%2Femployee%3Fview%3Dcurrent",
    );
  });

  it("logged-in external user visiting login page redirects to employee home", async () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const people = createPeopleDirectoryStore();
    people.upsertContact({
      userId: "ext_demo2",
      name: "外部演示2",
      departmentIds: ["外部"],
      departmentNames: ["外部"],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      rawJson: { source: "external_manual" },
    });
    people.upsertExternalAccount({
      userId: "ext_demo2",
      username: "demo_user2",
      password: "password-1234",
      displayName: "外部演示2",
    });
    people.close();

    const loginReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "demo_user2",
        password: "password-1234",
        next: "/workbench/employee?view=history",
      }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    expect(JSON.parse(loginRes.captured().body).redirectTo).toBe("/workbench/employee?view=history");

    const pageReq = stubReq({
      url: "/workbench/external/login?next=%2Fworkbench%2Femployee%3Fview%3Dhistory",
      method: "GET",
      headers: { cookie },
    });
    const pageRes = stubRes();
    handleAssignmentHttp(pageReq, pageRes.res);
    expect(pageRes.captured().statusCode).toBe(302);
    expect(String(pageRes.captured().headers.Location ?? "")).toBe("/workbench/employee?view=history");
  });

  it("external user can change password via API", async () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const people = createPeopleDirectoryStore();
    people.upsertContact({
      userId: "ext_pwd",
      name: "外部改密",
      departmentIds: ["外部"],
      departmentNames: ["外部"],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      rawJson: { source: "external_manual" },
    });
    people.upsertExternalAccount({
      userId: "ext_pwd",
      username: "pwd_user",
      password: "password-1234",
      displayName: "外部改密",
    });
    people.close();

    const loginReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "pwd_user", password: "password-1234" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const changeReq = stubReq({
      url: "/api/workbench/external/change-password",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        currentPassword: "password-1234",
        newPassword: "new-password-99",
      }),
    });
    const changeRes = stubRes();
    handleAssignmentHttp(changeReq, changeRes.res);
    await flushAsync();
    expect(changeRes.captured().statusCode).toBe(200);

    const reloginReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "pwd_user", password: "new-password-99" }),
    });
    const reloginRes = stubRes();
    handleAssignmentHttp(reloginReq, reloginRes.res);
    await flushAsync();
    expect(reloginRes.captured().statusCode).toBe(200);

    const badChangeReq = stubReq({
      url: "/api/workbench/external/change-password",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        currentPassword: "wrong-current-password",
        newPassword: "another-password-99",
      }),
    });
    const badChangeRes = stubRes();
    handleAssignmentHttp(badChangeReq, badChangeRes.res);
    await flushAsync();
    expect(badChangeRes.captured().statusCode).toBe(400);
    expect(badChangeRes.captured().body).toContain("当前密码不正确");

    const reloginOldReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "pwd_user", password: "new-password-99" }),
    });
    const reloginOldRes = stubRes();
    handleAssignmentHttp(reloginOldReq, reloginOldRes.res);
    await flushAsync();
    expect(reloginOldRes.captured().statusCode).toBe(200);

    const samePwdReq = stubReq({
      url: "/api/workbench/external/change-password",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        currentPassword: "new-password-99",
        newPassword: "new-password-99",
      }),
    });
    const samePwdRes = stubRes();
    handleAssignmentHttp(samePwdReq, samePwdRes.res);
    await flushAsync();
    expect(samePwdRes.captured().statusCode).toBe(400);
    expect(samePwdRes.captured().body).toContain("新密码不能与当前密码相同");
  });

  it("external employee HTML exposes security tab and account metadata", async () => {
    vi.stubEnv("WORKBENCH_EXTERNAL_LOGIN_ENABLED", "1");
    const people = createPeopleDirectoryStore();
    people.upsertContact({
      userId: "ext_ui",
      name: "武传宾",
      departmentIds: ["外部"],
      departmentNames: ["外部"],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      rawJson: { source: "external_manual" },
    });
    people.upsertExternalAccount({
      userId: "ext_ui",
      username: "wuchuanbin",
      password: "password-1234",
      displayName: "武传宾",
    });
    people.close();

    const loginReq = stubReq({
      url: "/api/workbench/external/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "wuchuanbin", password: "password-1234" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");

    const meReq = stubReq({
      url: "/api/workbench/me",
      method: "GET",
      headers: { cookie },
    });
    const meRes = stubRes();
    handleAssignmentHttp(meReq, meRes.res);
    const meBody = JSON.parse(meRes.captured().body) as {
      externalAccount?: { username?: string; displayName?: string };
    };
    expect(meBody.externalAccount?.username).toBe("wuchuanbin");

    const pageReq = stubReq({
      url: "/workbench/employee?view=security",
      method: "GET",
      headers: { cookie },
    });
    const pageRes = stubRes();
    handleAssignmentHttp(pageReq, pageRes.res);
    expect(pageRes.captured().statusCode).toBe(200);
    expect(pageRes.captured().body).toContain("账号安全");
    expect(pageRes.captured().body).toContain('id="panelSecurity"');
    expect(pageRes.captured().body).toContain("getElementById('navSecurity')");
    expect(pageRes.captured().body).toContain('id="pwdSuccessBanner"');
    expect(pageRes.captured().body).toContain("/workbench/external/login");
    expect(pageRes.captured().body).not.toContain('id="externalPasswordCard"');
  });

  describe("project portfolio API", () => {
    async function loginCookie(userId: string): Promise<string> {
      const loginReq = stubReq({
        url: "/api/workbench/login",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: "manager" }),
      });
      const loginRes = stubRes();
      handleAssignmentHttp(loginReq, loginRes.res);
      await flushAsync();
      return String(loginRes.captured().headers["Set-Cookie"] ?? "");
    }

    it("GET /api/workbench/manager/projects returns 404 when portfolio disabled", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-only");
      const cookie = await loginCookie("manager-1");
      const req = stubReq({
        url: "/api/workbench/manager/projects",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      expect(captured().statusCode).toBe(404);
    });

    it("baseline manager tasks API ignores projectId query when portfolio disabled", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-only");
      await seedPublishedTask({
        planId: "plan-baseline-project-query",
        managerUserId: "manager-1",
        assigneeUserId: "emp-project-query",
      });
      const cookie = await loginCookie("manager-1");
      const req = stubReq({
        url: "/api/workbench/manager/tasks?projectId=proj%3Ashould-not-filter",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as { tasks?: unknown[] };
      expect(captured().statusCode).toBe(200);
      expect(body.tasks).toHaveLength(1);
    });

    it("portfolio manager can create project and list rollup cards", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-mgr");
      vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1,portfolio-mgr");
      const cookie = await loginCookie("portfolio-mgr");
      const createReq = stubReq({
        url: "/api/workbench/manager/projects",
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "OCT 上市", description: "客诉专项" }),
      });
      const createRes = stubRes();
      handleAssignmentHttp(createReq, createRes.res);
      await flushAsync();
      expect(createRes.captured().statusCode).toBe(200);
      const created = JSON.parse(createRes.captured().body) as {
        ok?: boolean;
        project?: { projectId?: string };
      };
      expect(created.ok).toBe(true);
      expect(created.project?.projectId).toMatch(/^proj:/);

      const listReq = stubReq({
        url: "/api/workbench/manager/projects",
        method: "GET",
        headers: { cookie },
      });
      const listRes = stubRes();
      handleAssignmentHttp(listReq, listRes.res);
      await flushAsync();
      const listed = JSON.parse(listRes.captured().body) as {
        ok?: boolean;
        cards?: Array<{ name?: string }>;
      };
      expect(listed.ok).toBe(true);
      expect(listed.cards?.some((c) => c.name === "OCT 上市")).toBe(true);
    });

    it("manager group portfolio members can share projects and assign group tasks", async () => {
      vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
      vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(tmpdir(), `test-manager-groups-${Date.now()}.json`));
      vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "");
      const { createWorkbenchManagerGroup, addWorkbenchManagerGroupMember } = await import(
        "../../src/security/workbench-manager-groups"
      );
      const group = createWorkbenchManagerGroup({ name: "明思项目主管组", portfolioEnabled: true });
      addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
      addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
      const cookieA = await loginCookie("mgr-a");
      const createReq = stubReq({
        url: "/api/workbench/manager/projects",
        method: "POST",
        headers: { cookie: cookieA, "content-type": "application/json" },
        body: JSON.stringify({ name: "组内共享项目", description: "项目组共享" }),
      });
      const createRes = stubRes();
      handleAssignmentHttp(createReq, createRes.res);
      await flushAsync();
      expect(createRes.captured().statusCode).toBe(200);
      const created = JSON.parse(createRes.captured().body) as { project?: { projectId?: string } };
      const projectId = created.project?.projectId ?? "";

      await seedPublishedTask({
        planId: "plan-group-project",
        managerUserId: "mgr-a",
        assigneeUserId: "emp-project-group",
      });
      const store = createWorkbenchFormalTaskStore();
      store.migrateManagerObjectsToGroup({ managerUserId: "mgr-a", managerGroupId: group.groupId });
      const taskNo = store.getTaskDetail("plan-group-project")?.task.taskNo ?? "";
      const cookieB = await loginCookie("mgr-b");
      const listReq = stubReq({
        url: "/api/workbench/manager/projects",
        method: "GET",
        headers: { cookie: cookieB },
      });
      const listRes = stubRes();
      handleAssignmentHttp(listReq, listRes.res);
      expect(listRes.captured().statusCode).toBe(200);
      const listed = JSON.parse(listRes.captured().body) as { cards?: Array<{ projectId?: string }> };
      expect(listed.cards?.some((card) => card.projectId === projectId)).toBe(true);

      const assignReq = stubReq({
        url: "/api/workbench/manager/tasks/" + encodeURIComponent(taskNo) + "/project",
        method: "POST",
        headers: { cookie: cookieB, "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const assignRes = stubRes();
      handleAssignmentHttp(assignReq, assignRes.res);
      await flushAsync();
      expect(assignRes.captured().statusCode).toBe(200);
      expect(store.getTaskDetail("plan-group-project")?.task.projectId).toBe(projectId);
    });

    it("POST /api/workbench/manager/tasks/{taskNo}/project assigns project", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-mgr");
      vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1,portfolio-mgr");
      const cookie = await loginCookie("portfolio-mgr");
      const createReq = stubReq({
        url: "/api/workbench/manager/projects",
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "测试项目", description: "" }),
      });
      const createRes = stubRes();
      handleAssignmentHttp(createReq, createRes.res);
      await flushAsync();
      const created = JSON.parse(createRes.captured().body) as {
        project?: { projectId?: string };
      };
      const projectId = String(created.project?.projectId ?? "");

      await seedPublishedTask({
        planId: "plan-assign-project",
        managerUserId: "portfolio-mgr",
        assigneeUserId: "emp-1",
      });
      const store = createWorkbenchFormalTaskStore();
      const before = store.getTaskDetail("plan-assign-project");
      expect(before?.task.projectId ?? "").toBe("");

      const assignReq = stubReq({
        url: "/api/workbench/manager/tasks/" + encodeURIComponent(before!.task.taskNo) + "/project",
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const assignRes = stubRes();
      handleAssignmentHttp(assignReq, assignRes.res);
      await flushAsync();
      expect(assignRes.captured().statusCode).toBe(200);
      const after = store.getTaskDetail("plan-assign-project");
      expect(after?.task.projectId).toBe(projectId);
    });

    it("GET /api/workbench/me includes projectPortfolioEnabled", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-mgr");
      vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1,portfolio-mgr");
      const cookie = await loginCookie("portfolio-mgr");
      const req = stubReq({
        url: "/api/workbench/me",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as { projectPortfolioEnabled?: boolean };
      expect(body.projectPortfolioEnabled).toBe(true);
    });
  });

  describe("weekly dashboard", () => {
    async function loginCookie(userId = "manager-1"): Promise<string> {
      const loginReq = stubReq({
        url: "/api/workbench/login",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: "manager" }),
      });
      const loginRes = stubRes();
      handleAssignmentHttp(loginReq, loginRes.res);
      await flushAsync();
      return String(loginRes.captured().headers["Set-Cookie"] ?? "");
    }

    it("GET /workbench/manager/dashboard returns HTML for manager", async () => {
      const cookie = await loginCookie();
      const req = stubReq({
        url: "/workbench/manager/dashboard",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      expect(captured().statusCode).toBe(200);
      expect(captured().body).toContain("周度看板");
      expect(captured().body).toContain("id=\"kpiEvents\"");
      expect(captured().body).toContain("id=\"openAdvisorDrawerBtn\"");
      expect(captured().body).toContain("id=\"advisorDrawer\"");
    });

    it("GET /api/workbench/manager/weekly-dashboard returns facts payload", async () => {
      await seedPublishedTask({
        planId: "plan-weekly-api",
        managerUserId: "manager-1",
        assigneeUserId: "emp-weekly",
      });
      const cookie = await loginCookie();
      const req = stubReq({
        url: "/api/workbench/manager/weekly-dashboard?week=2026-05-20&span=1",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as {
        ok?: boolean;
        kpi?: { eventCount?: number };
        timeline?: { byTask?: unknown[] };
        week?: { mondayYmd?: string };
      };
      expect(captured().statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.kpi).toBeTruthy();
      expect(body.timeline).toBeTruthy();
      expect(body.week?.mondayYmd).toBeTruthy();
    });

    it("POST /api/workbench/manager/weekly-advisor returns template sections", async () => {
      __setWeeklyAdvisorLlmForTest(async () => null);
      await seedPublishedTask({
        planId: "plan-weekly-advisor",
        managerUserId: "manager-1",
        assigneeUserId: "emp-advisor",
      });
      const cookie = await loginCookie();
      const req = stubReq({
        url: "/api/workbench/manager/weekly-advisor",
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ week: "2026-05-20", span: 1 }),
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as {
        ok?: boolean;
        sections?: Array<{ title?: string }>;
      };
      expect(captured().statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.sections?.length).toBeGreaterThan(0);
      __setWeeklyAdvisorLlmForTest(undefined);
    });

    it("GET weekly-dashboard with projectId ignores filter when portfolio disabled", async () => {
      vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-only");
      await seedPublishedTask({
        planId: "plan-weekly-project-filter",
        managerUserId: "manager-1",
        assigneeUserId: "emp-1",
      });
      const cookie = await loginCookie();
      const req = stubReq({
        url: "/api/workbench/manager/weekly-dashboard?projectId=proj%3Ano-such",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as { ok?: boolean; tasks?: unknown[] };
      expect(captured().statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.tasks?.length).toBeGreaterThan(0);
    });

    it("feedOnly query returns feed slice without tasks", async () => {
      await seedPublishedTask({
        planId: "plan-weekly-feed-only",
        managerUserId: "manager-1",
        assigneeUserId: "emp-feed",
      });
      const cookie = await loginCookie();
      const req = stubReq({
        url: "/api/workbench/manager/weekly-dashboard?feedOnly=1&week=2026-05-20",
        method: "GET",
        headers: { cookie },
      });
      const { res, captured } = stubRes();
      handleAssignmentHttp(req, res);
      await flushAsync();
      const body = JSON.parse(captured().body) as {
        ok?: boolean;
        feed?: { items?: unknown[] };
        tasks?: unknown[];
        timeline?: unknown;
      };
      expect(captured().statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.feed).toBeTruthy();
      expect(body.tasks).toBeUndefined();
      expect(body.timeline).toBeUndefined();
    });
  });
});
