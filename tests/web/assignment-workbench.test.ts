import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __setDingTalkAuthClientForTest,
  handleAssignmentHttp,
} from "../../src/web/assignment-workbench";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import { DingTalkAuthError, type DingTalkAuthClient } from "../../src/integrations/dingtalk/dingtalk-auth";

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
  let tasksPath = "";

  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
    vi.stubEnv("WORKBENCH_SESSION_SECRET", "test-session-secret-at-least-32-chars-long");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1");
    const tmp = mkdtempSync(join(tmpdir(), "workbench-test-"));
    tasksPath = join(tmp, "tasks.json");
    vi.stubEnv("WORKBENCH_TASKS_PATH", tasksPath);
    vi.stubEnv("PLAN_SESSION_DIR", join(tmp, "sessions"));
    vi.stubEnv("PLAN_SESSION_EVENTS_PATH", join(tmp, "plan-session-events.jsonl"));
    __setDingTalkAuthClientForTest({
      resolveIdentityByAuthCode: vi.fn(async (authCode: string) => ({
        userId: `user-${authCode}`,
        name: "测试用户",
        unionId: "union-x",
      })),
    } satisfies DingTalkAuthClient);
  });

  afterEach(() => {
    __setDingTalkAuthClientForTest();
    vi.unstubAllEnvs();
  });

  it("returns false for unhandled paths", () => {
    const req = stubReq({ url: "/other", method: "GET" });
    const { res } = stubRes();
    expect(handleAssignmentHttp(req, res)).toBe(false);
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
    writeFileSync(
      tasksPath,
      JSON.stringify({
        tasks: [
          {
            planId: "plan-1",
            title: "测试任务",
            managerUserId: "manager-1",
            assigneeUserId: "emp-1",
            status: "ASSIGNED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [],
          },
        ],
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

  it("employee can accept task via action API", async () => {
    writeFileSync(
      tasksPath,
      JSON.stringify({
        tasks: [
          {
            planId: "plan-2",
            title: "测试任务2",
            managerUserId: "manager-1",
            assigneeUserId: "emp-2",
            status: "ASSIGNED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [],
          },
        ],
      }),
      "utf8",
    );

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
    writeFileSync(
      tasksPath,
      JSON.stringify({
        tasks: [
          {
            planId: "plan-rej",
            title: "测试任务",
            managerUserId: "manager-1",
            assigneeUserId: "emp-2",
            status: "ASSIGNED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [],
          },
        ],
      }),
      "utf8",
    );

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
});
