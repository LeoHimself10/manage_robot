import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __resetWorkbenchStoresForTest,
  __setDingTalkAuthClientForTest,
  __setWorkbenchPublishNotifierForTest,
  handleAssignmentHttp,
} from "../../src/web/assignment-workbench";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import { DingTalkAuthError, type DingTalkAuthClient } from "../../src/integrations/dingtalk/dingtalk-auth";
import type { WorkbenchPublishNotifier } from "../../src/integrations/dingtalk/workbench-notify";

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
  const res = {
    writeHead(statusCode: number, headers: Record<string, string>): void {
      state.statusCode = statusCode;
      state.headers = headers ?? {};
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
  }): Promise<void> {
    seedContact(params.managerUserId, "管理部", "Manager");
    seedContact(params.assigneeUserId, "执行部", "Engineer");
    const chatKeyHash = `seed-${params.planId}`;
    const now = new Date().toISOString();
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
            tasks: [{ id: "task-1", title: "测试子任务" }],
          },
          latestAssignment: {
            assignments: [
              {
                taskId: "task-1",
                primary: { userId: params.assigneeUserId, displayName: params.assigneeUserId },
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const loginReq = stubReq({
      url: "/api/workbench/login",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: params.managerUserId, role: "manager" }),
    });
    const loginRes = stubRes();
    handleAssignmentHttp(loginReq, loginRes.res);
    await flushAsync();
    const cookie = String(loginRes.captured().headers["Set-Cookie"] ?? "");
    const publishReq = stubReq({
      url: "/api/workbench/manager/publish",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: params.planId }),
    });
    const publishRes = stubRes();
    handleAssignmentHttp(publishReq, publishRes.res);
    await flushAsync();
    expect(publishRes.captured().statusCode).toBe(200);
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

  afterEach(() => {
    __resetWorkbenchStoresForTest();
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
    expect(c.body).toContain('/static/workbench-dd-login.js');
    expect(c.body).toContain("__WB_CONFIGURED_CORP_ID");
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
    expect(String(c.headers.Location ?? "")).toContain("/workbench/manager/tasks?planId=plan-1");
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
    __setWorkbenchPublishNotifierForTest({
      notifyPublishedTask: vi.fn(async () => ({
        enabled: false,
        success: [],
        failed: [],
      })),
      notifyReassignedAssignee,
    });
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
    expect(notifyReassignedAssignee).toHaveBeenCalledTimes(1);
    const arg = notifyReassignedAssignee.mock.calls[0][0];
    expect(arg.assigneeUserId).toBe("emp-2");
    expect(arg.scope).toBe("plan");
    expect(arg.managerUserId).toBe("manager-1");
    expect(String(arg.taskNo || "")).toMatch(/^TASK-/);
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

  it("publish returns generated taskNo", async () => {
    seedContact("manager-1", "管理部", "Manager");
    seedContact("emp-2");
    const chatKeyHash = "seed-plan-taskno";
    const now = new Date().toISOString();
    writeFileSync(
      join(sessionDir, `${chatKeyHash}.json`),
      JSON.stringify(
        {
          chatKeyHash,
          planId: "plan-taskno",
          createdAt: now,
          updatedAt: now,
          senderStaffId: "manager-1",
          knownFacts: [],
          conversationHistory: [{ role: "user", content: "测试发布" }],
          latestDraft: {
            title: "编号测试任务",
            tasks: [{ id: "task-1", title: "测试子任务" }],
          },
          latestAssignment: {
            assignments: [{ taskId: "task-1", primary: { userId: "emp-2" } }],
          },
        },
        null,
        2,
      ),
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
      url: "/api/workbench/manager/publish",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-taskno" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toMatch(/"taskNo":"TASK-\d{8}-\d{4}"/);
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
    expect(c.body).toContain('"status":"ACCEPTED"');
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
    expect(String(c.headers.Location ?? "")).toBe("/workbench/employee/new");
  });

  it("POST /api/workbench/conversation/start returns a new planId for manager", async () => {
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
      url: "/api/workbench/conversation/start",
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: "{}",
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toMatch(/"planId":"[0-9a-f-]{36}"/i);
    expect(c.body).toContain('"ok":true');
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
    expect(okRes.captured().body).toContain('"status":"ACCEPTED"');
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

  it("employee request_changes persists CHANGES_REQUESTED", async () => {
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
    expect(captured().body).toContain('"status":"CHANGES_REQUESTED"');
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

  it("publish returns warnings when notifier is skipped", async () => {
    await seedPublishedTask({
      planId: "plan-skip-notify",
      managerUserId: "manager-1",
      assigneeUserId: "emp-2",
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
      url: "/api/workbench/manager/publish",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-skip-notify" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(200);
    expect(captured().body).toContain('"warnings"');
  });

  it("publish includes warnings on partial notify failure", async () => {
    seedContact("manager-1", "管理部", "Manager");
    seedContact("emp-2");
    seedContact("emp-3");
    const notifier: WorkbenchPublishNotifier = {
      notifyPublishedTask: vi.fn(async () => ({
        enabled: true,
        success: [{ userId: "emp-2", cardMessageId: "card-1", todoId: "todo-1" }],
        failed: [{ userId: "emp-3", reason: "dingtalk error" }],
      })),
      notifyReassignedAssignee: vi.fn(async () => ({
        enabled: false,
        success: [],
        failed: [],
      })),
    };
    __setWorkbenchPublishNotifierForTest(notifier);
    const chatKeyHash = "seed-plan-notify-fail";
    const now = new Date().toISOString();
    writeFileSync(
      join(sessionDir, `${chatKeyHash}.json`),
      JSON.stringify(
        {
          chatKeyHash,
          planId: "plan-notify-fail",
          createdAt: now,
          updatedAt: now,
          senderStaffId: "manager-1",
          knownFacts: [],
          conversationHistory: [{ role: "user", content: "测试发布" }],
          latestDraft: {
            title: "通知测试任务",
            tasks: [{ id: "task-1", title: "子任务1" }, { id: "task-2", title: "子任务2" }],
          },
          latestAssignment: {
            assignments: [
              { taskId: "task-1", primary: { userId: "emp-2" } },
              { taskId: "task-2", primary: { userId: "emp-3" } },
            ],
          },
        },
        null,
        2,
      ),
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
      url: "/api/workbench/manager/publish",
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ planId: "plan-notify-fail" }),
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    expect(captured().statusCode).toBe(200);
    expect(captured().body).toContain("通知失败");
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
    expect(employeeAcceptRes.captured().body).toContain('"status":"ACCEPTED"');

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
});
