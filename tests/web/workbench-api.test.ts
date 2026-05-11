import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../src/infra/plan-session-store";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import { handleWorkbenchApi, type WorkbenchApiDeps } from "../../src/web/workbench-api";
import { createWorkbenchService } from "../../src/web/workbench-service";
import type { WorkbenchSubtaskStatus } from "../../src/web/workbench-types";

function stubReq(overrides: {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): IncomingMessage {
  const payload =
    overrides.body === undefined ? [] : [JSON.stringify(overrides.body)];
  const req = Readable.from(payload) as IncomingMessage;
  req.url = overrides.url;
  req.method = overrides.method ?? "GET";
  req.headers = overrides.headers ?? {};
  return req;
}

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

async function request(
  path: string,
  deps: WorkbenchApiDeps,
  options: { method?: string; body?: unknown } = {},
): Promise<CapturedResponse> {
  const req = stubReq({
    url: path,
    method: options.method,
    body: options.body,
    headers: { host: "localhost" },
  });
  const { res, captured } = stubRes();

  const handled = await handleWorkbenchApi(req, res, deps);

  expect(handled).toBe(true);
  return captured();
}

describe("workbench API", () => {
  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("GET /api/me returns identity JSON", async () => {
    const deps = createApiDeps();
    const token = signToken("manager-1", "manager");

    const res = await request(`/api/me?token=${encodeURIComponent(token)}`, deps);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toMatchObject({
      planId: "plan-customer-complaint",
      userId: "manager-1",
      role: "manager",
    });
  });

  it("GET /api/tasks returns role-scoped task summaries", async () => {
    const deps = createApiDeps();
    const token = signToken("emp-1", "employee");

    const res = await request(`/api/tasks?token=${encodeURIComponent(token)}`, deps);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      tasks: [
        expect.objectContaining({
          planId: "plan-customer-complaint",
          ownerUserId: "emp-1",
          title: "客诉根因分析",
        }),
      ],
    });
  });

  it("GET /api/tasks/:taskId returns task detail or 404", async () => {
    const deps = createApiDeps();
    const token = signToken("manager-1", "manager");

    const ok = await request(
      `/api/tasks/plan-customer-complaint?token=${encodeURIComponent(token)}`,
      deps,
    );
    const missing = await request(
      `/api/tasks/plan-missing?token=${encodeURIComponent(token)}`,
      deps,
    );

    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({
      planId: "plan-customer-complaint",
      subtasks: [
        expect.objectContaining({ taskId: "task-1" }),
        expect.objectContaining({ taskId: "task-2" }),
      ],
    });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /api/in-progress-sessions returns scoped sessions", async () => {
    const deps = createApiDeps();
    const token = signToken("emp-2", "employee");

    const res = await request(
      `/api/in-progress-sessions?token=${encodeURIComponent(token)}`,
      deps,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      sessions: [
        expect.objectContaining({
          conversationId: "conv-employee",
          employeeUserId: "emp-2",
        }),
      ],
    });
  });

  it("POST /api/conversations/new-task creates a conversation session record", async () => {
    const deps = createApiDeps();
    const token = signToken("manager-1", "manager");

    const res = await request(
      `/api/conversations/new-task?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "POST",
        body: {
          conversationId: "conv-new-task",
          message: "请规划一次供应商质量复盘任务",
        },
      },
    );

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({
      conversation: {
        planId: "plan-created-from-workbench",
        conversationId: "conv-new-task",
        stage: "WAITING_MODEL",
      },
    });
    expect(deps.sessionStore.loadOrCreate).toHaveBeenCalledWith(
      "workbench:new-task:manager-1:conv-new-task",
    );
    expect(deps.sessionStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-created-from-workbench",
        conversationHistory: [
          { role: "user", content: "请规划一次供应商质量复盘任务" },
        ],
        conversationSessions: [
          expect.objectContaining({
            conversationId: "conv-new-task",
            stage: "WAITING_MODEL",
          }),
        ],
      }),
    );
  });

  it("POST /api/conversations/:id/messages appends a message and records an event", async () => {
    const sessions = sampleSessions();
    const deps = createApiDeps({ sessions });
    const token = signToken("manager-1", "manager");

    const res = await request(
      `/api/conversations/conv-employee/messages?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "POST",
        body: { message: "请补充完成时间和验收口径" },
      },
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      conversation: {
        planId: "plan-customer-complaint",
        conversationId: "conv-employee",
        stage: "WAITING_MODEL",
      },
    });
    expect(deps.sessionStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-customer-complaint",
        conversationHistory: [
          { role: "user", content: "请补充完成时间和验收口径" },
        ],
        conversationSessions: expect.arrayContaining([
          expect.objectContaining({
            conversationId: "conv-employee",
            stage: "WAITING_MODEL",
          }),
        ]),
      }),
    );
    expect(deps.sessionStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-customer-complaint",
        chatKeyHash: "hash-customer",
        eventType: "WORKBENCH_CONVERSATION_MESSAGE_ADDED",
        payload: expect.objectContaining({
          conversationId: "conv-employee",
          actorUserId: "manager-1",
          actorRole: "manager",
          message: "请补充完成时间和验收口径",
        }),
      }),
    );
  });

  it("POST /api/conversations/:id/messages returns 404 for unknown conversation", async () => {
    const deps = createApiDeps();
    const token = signToken("manager-1", "manager");

    const res = await request(
      `/api/conversations/conv-missing/messages?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "POST",
        body: { message: "补充说明" },
      },
    );

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: "Conversation not found" });
    expect(deps.sessionStore.save).not.toHaveBeenCalled();
    expect(deps.sessionStore.appendEvent).not.toHaveBeenCalled();
  });

  it("POST /api/conversations/:id/apply records a revision apply event", async () => {
    const sessions = sampleSessions();
    const deps = createApiDeps({ sessions });
    const token = signToken("manager-1", "manager");

    const res = await request(
      `/api/conversations/conv-done/apply?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "POST",
        body: {
          note: "确认按修订稿执行",
          revision: { status: "APPLIED", summary: "补充验收要求" },
        },
      },
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      applied: true,
      conversation: {
        conversationId: "conv-done",
        stage: "READY_TO_APPLY",
      },
    });
    expect(deps.sessionStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-customer-complaint",
        revisionEvents: [
          expect.objectContaining({
            eventType: "WORKBENCH_CONVERSATION_APPLIED",
            conversationId: "conv-done",
            actorUserId: "manager-1",
            actorRole: "manager",
            note: "确认按修订稿执行",
            revision: { status: "APPLIED", summary: "补充验收要求" },
          }),
        ],
      }),
    );
    expect(deps.sessionStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-customer-complaint",
        chatKeyHash: "hash-customer",
        eventType: "WORKBENCH_CONVERSATION_APPLIED",
        payload: expect.objectContaining({
          conversationId: "conv-done",
          actorUserId: "manager-1",
          actorRole: "manager",
          note: "确认按修订稿执行",
          revision: { status: "APPLIED", summary: "补充验收要求" },
        }),
      }),
    );
  });

  it("PATCH /api/subtasks/:subTaskId/progress updates owned subtask", async () => {
    const deps = createApiDeps();
    const token = signToken("emp-1", "employee");

    const res = await request(
      `/api/subtasks/task-1/progress?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "PATCH",
        body: { status: "IN_PROGRESS", note: "已开始根因分析" },
      },
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      subtask: {
        taskId: "task-1",
        status: "IN_PROGRESS",
        note: "已开始根因分析",
      },
    });
    expect(deps.updateSubtaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "emp-1", role: "employee" }),
      "task-1",
      { status: "IN_PROGRESS", note: "已开始根因分析" },
    );
  });

  it("PATCH /api/subtasks/:subTaskId/progress rejects cross-user writes", async () => {
    const deps = createApiDeps();
    const token = signToken("emp-2", "employee");

    const res = await request(
      `/api/subtasks/task-1/progress?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "PATCH",
        body: { status: "DONE" },
      },
    );

    expect(res.statusCode).toBe(403);
    expect(deps.updateSubtaskProgress).not.toHaveBeenCalled();
  });

  it("GET /api/me returns 401 when token is absent", async () => {
    const deps = createApiDeps();

    const req = stubReq({ url: "/api/me" });
    const { res, captured } = stubRes();
    const handled = await handleWorkbenchApi(req, res, deps);

    expect(handled).toBe(true);
    expect(captured().statusCode).toBe(401);
    expect(JSON.parse(captured().body)).toMatchObject({ error: "Missing token" });
  });

  it("GET /api/me returns 403 when token is invalid", async () => {
    const deps = createApiDeps();

    const req = stubReq({ url: "/api/me?token=bad-token", headers: { host: "localhost" } });
    const { res, captured } = stubRes();
    const handled = await handleWorkbenchApi(req, res, deps);

    expect(handled).toBe(true);
    expect(captured().statusCode).toBe(403);
  });

  it("PATCH /api/subtasks/:id/progress returns 400 for invalid status value", async () => {
    const deps = createApiDeps();
    const token = signToken("emp-1", "employee");

    const res = await request(
      `/api/subtasks/task-1/progress?token=${encodeURIComponent(token)}`,
      deps,
      {
        method: "PATCH",
        body: { status: "INVALID_STATUS" },
      },
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "Invalid progress status" });
    expect(deps.updateSubtaskProgress).not.toHaveBeenCalled();
  });
});

interface TestApiDeps extends WorkbenchApiDeps {
  sessionStore: TestSessionStore;
  loadPlanSessions: () => PlanSession[];
}

type TestSessionStore = Required<
  Pick<NonNullable<WorkbenchApiDeps["sessionStore"]>, "loadOrCreate" | "save">
> &
  Pick<NonNullable<WorkbenchApiDeps["sessionStore"]>, "appendEvent">;

function createApiDeps(options: { sessions?: PlanSession[] } = {}): TestApiDeps {
  const sessions = options.sessions ?? sampleSessions();
  const createdSession: PlanSession = {
    chatKeyHash: "hash-created-from-workbench",
    planId: "plan-created-from-workbench",
    createdAt: "2026-05-11T04:00:00.000Z",
    updatedAt: "2026-05-11T04:00:00.000Z",
    knownFacts: [],
    conversationHistory: [],
  };
  const sessionStore = {
    loadOrCreate: vi.fn((_chatKey: string): PlanSession => createdSession),
    save: vi.fn((_session: PlanSession): void => undefined),
    appendEvent: vi.fn(
      (_event: Parameters<NonNullable<WorkbenchApiDeps["sessionStore"]>["appendEvent"]>[0]): void =>
        undefined,
    ),
  } satisfies TestSessionStore;
  return {
    service: createWorkbenchService({
      loadPlanSessions: () => sessions,
    }),
    loadPlanSessions: () => sessions,
    sessionStore,
    updateSubtaskProgress: vi.fn(
      async (
        _identity,
        subTaskId: string,
        patch: { status: WorkbenchSubtaskStatus; note?: string },
      ) => ({
        taskId: subTaskId,
        title: "客诉根因分析",
        assigneeUserId: "emp-1",
        status: patch.status,
        note: patch.note,
        updatedAt: "2026-05-11T04:00:00.000Z",
      }),
    ),
  };
}

function signToken(userId: string, role: "manager" | "employee"): string {
  return signAssignmentEntry({
    planId: "plan-customer-complaint",
    userId,
    role,
    ttlSeconds: 60,
  }).token;
}

function sampleSessions(): PlanSession[] {
  return [
    {
      chatKeyHash: "hash-customer",
      planId: "plan-customer-complaint",
      createdAt: "2026-05-11T01:00:00.000Z",
      updatedAt: "2026-05-11T03:00:00.000Z",
      lastTraceId: "trace-customer",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        status: "IN_EXECUTION",
        tasks: [
          {
            id: "task-1",
            title: "客诉根因分析",
            status: "TODO",
          },
          {
            id: "task-2",
            title: "整改方案",
            status: "TODO",
          },
        ],
      },
      latestAssignment: {
        assignments: [
          {
            taskId: "task-1",
            primary: { userId: "emp-1", displayName: "员工一" },
            alternates: [],
            confidence: "HIGH",
            confidenceReason: "匹配客诉分析经验",
          },
          {
            taskId: "task-2",
            primary: { userId: "emp-2", displayName: "员工二" },
            alternates: [],
            confidence: "MEDIUM",
            confidenceReason: "熟悉整改流程",
          },
        ],
      },
      conversationSessions: [
        {
          conversationId: "conv-employee",
          stage: "WAITING_EMPLOYEE",
          employeeUserId: "emp-2",
          updatedAt: "2026-05-11T03:02:00.000Z",
        },
        {
          conversationId: "conv-done",
          stage: "READY_TO_APPLY",
          updatedAt: "2026-05-11T03:03:00.000Z",
          completedAt: "2026-05-11T03:04:00.000Z",
        },
      ],
    } as PlanSession,
  ];
}
