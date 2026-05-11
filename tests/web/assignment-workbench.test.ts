import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAssignmentHttp } from "../../src/web/assignment-workbench";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import type { WorkbenchApiDeps } from "../../src/web/workbench-api";

/** Minimal IncomingMessage stub for tests */
function stubReq(overrides: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    url: overrides.url ?? "/",
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? {},
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

describe("assignment-workbench HTTP handler", () => {
  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false for unhandled paths", async () => {
    const req = stubReq({ url: "/other", method: "GET" });
    const { res } = stubRes();
    await expect(handleAssignmentHttp(req, res)).resolves.toBe(false);
  });

  it("GET without token returns 400", async () => {
    const req = stubReq({
      url: "/assignment/workbench",
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(400);
    expect(c.body).toContain("Missing token");
  });

  it("GET with invalid token returns 403", async () => {
    const req = stubReq({
      url: "/assignment/workbench?token=bad-token",
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access denied");
  });

  it("GET with valid token returns 200 HTML page", async () => {
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
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.headers["Content-Type"]).toContain("text/html");
    expect(c.body).toContain("分配工作台");
    expect(c.body).toContain("plan-1");
    expect(c.body).toContain("user-1");
    expect(c.body).toContain("manager");
  });

  it("routes manager workbench page with a valid manager token", async () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "manager-1",
      role: "manager",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/workbench/manager?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain("分配与追踪中心");
    expect(c.body).toContain("筛选");
  });

  it("blocks employee token from manager workbench route", async () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "employee-1",
      role: "employee",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/workbench/manager?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access denied");
  });

  it("routes conversation center with both conversation modes", async () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "manager-1",
      role: "manager",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/workbench/conversation?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res);
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain("开启新任务");
    expect(c.body).toContain("编辑进行中任务");
  });

  it("routes employee workbench page with employee-scoped tasks", async () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "employee-1",
      role: "employee",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/workbench/employee?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res, createWorkbenchDeps());
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.headers["Content-Type"]).toContain("text/html");
    expect(c.body).toContain("我的任务");
    expect(c.body).toContain("employee-1");
    expect(c.body).toContain("客诉根因分析");
  });

  it("routes in-progress workbench page with scoped sessions", async () => {
    const signed = signAssignmentEntry({
      planId: "plan-1",
      userId: "manager-1",
      role: "manager",
      ttlSeconds: 60,
    });

    const req = stubReq({
      url: `/workbench/in-progress?token=${encodeURIComponent(signed.token)}`,
      method: "GET",
    });
    const { res, captured } = stubRes();
    const handled = await handleAssignmentHttp(req, res, createWorkbenchDeps());
    expect(handled).toBe(true);
    const c = captured();
    expect(c.statusCode).toBe(200);
    expect(c.headers["Content-Type"]).toContain("text/html");
    expect(c.body).toContain("进行中任务");
    expect(c.body).toContain("会话队列");
    expect(c.body).toContain("conv-1");
  });
});

function createWorkbenchDeps(): WorkbenchApiDeps {
  return {
    service: {
      listTasks: () => [
        {
          planId: "plan-1",
          title: "客诉根因分析",
          stage: "EXECUTION",
          ownerUserId: "employee-1",
        },
      ],
      getTaskDetail: () => undefined,
      listInProgressSessions: () => [
        {
          planId: "plan-1",
          conversationId: "conv-1",
          stage: "WAITING_MANAGER",
          managerUserId: "manager-1",
          title: "客诉根因分析追问",
        },
      ],
    },
  };
}
