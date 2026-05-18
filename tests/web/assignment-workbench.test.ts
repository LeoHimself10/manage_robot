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
} from "../../src/web/assignment-workbench";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../src/infra/plan-session-store";
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
    const tasks =
      params.secondAssignee ?
        [
          { id: "task-1", title: "测试子任务", deliverables: "本人交付物（测试）" },
          {
            id: "task-2",
            title: params.secondAssignee.title ?? "同事子任务",
            deliverables: "同事交付物（不应泄露给员工 API）",
            objective: "同事目标",
          },
        ]
      : [{ id: "task-1", title: "测试子任务" }];
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
      notifyManagerOfEmployeeAction: vi.fn(async () => ({
        enabled: false,
        success: [],
        failed: [],
      })),
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
    expect(c.body).toContain("新任务");
    expect(c.body).toContain("进行中");
  });

  it("GET /workbench/manager/chat without planId injects latest manager plan session", async () => {
    const oldPlan = "11111111-1111-1111-1111-111111111111";
    const newPlan = "22222222-2222-2222-2222-222222222222";
    const t0 = "2020-01-01T00:00:00.000Z";
    const t1 = "2026-05-15T12:00:00.000Z";
    writeFileSync(
      join(sessionDir, "old-plan.json"),
      JSON.stringify(
        {
          chatKeyHash: "old-plan",
          planId: oldPlan,
          createdAt: t0,
          updatedAt: t0,
          senderStaffId: "manager-1",
          knownFacts: [],
          conversationHistory: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(sessionDir, "new-plan.json"),
      JSON.stringify(
        {
          chatKeyHash: "new-plan",
          planId: newPlan,
          createdAt: t1,
          updatedAt: t1,
          senderStaffId: "manager-1",
          knownFacts: [],
          conversationHistory: [],
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
      url: "/workbench/manager/chat",
      method: "GET",
      headers: { cookie },
    });
    const { res, captured } = stubRes();
    handleAssignmentHttp(req, res);
    await flushAsync();
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain(`var activePlanId = ${JSON.stringify(newPlan)}`);
    expect(c.body).not.toContain(`var activePlanId = ${JSON.stringify(oldPlan)}`);
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

  it("employee reject invokes notifyManagerOfEmployeeAction, writes EMPLOYEE_RESPONSE_SUMMARY, appears in /tasks/current", async () => {
    const notifyManagerOfEmployeeAction = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "manager-1", robotMessageKey: "rk-reject-test" }],
      failed: [],
    }));
    __setWorkbenchPublishNotifierForTest({
      notifyPublishedTask: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
      notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
      notifyManagerOfEmployeeAction,
    });
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
    const arg0 = notifyManagerOfEmployeeAction.mock.calls[0]?.[0] as { kind?: string; managerUserId?: string };
    expect(arg0.kind).toBe("rejected");
    expect(arg0.managerUserId).toBe("manager-1");

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
    expect(cur.tasks.some((t) => t.subtaskId === subtaskId)).toBe(true);
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
});
