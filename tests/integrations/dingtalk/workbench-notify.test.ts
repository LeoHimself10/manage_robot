import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbenchPublishNotifier,
  type WorkbenchPublishTaskNotifyInput,
} from "../../../src/integrations/dingtalk/workbench-notify";

interface CapturedRequest {
  url: string;
  init?: RequestInit;
  body?: unknown;
}

function buildFetchMock(handlers: Array<(req: CapturedRequest) => Response | Promise<Response>>) {
  const calls: CapturedRequest[] = [];
  let cursor = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsed: unknown;
    if (init?.body) {
      try {
        parsed = JSON.parse(String(init.body));
      } catch {
        parsed = init.body;
      }
    }
    const captured: CapturedRequest = { url, init, body: parsed };
    calls.push(captured);
    const handler = handlers[cursor] ?? handlers[handlers.length - 1];
    cursor += 1;
    return handler(captured);
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function jsonRes(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseInput: WorkbenchPublishTaskNotifyInput = {
  taskNo: "TK-001",
  title: "产线异常调查",
  managerUserId: "mgr-1",
  assignees: [
    {
      userId: "emp-1",
      unionId: "uni-emp-1",
      subtaskTitles: ["排查日志"],
    },
  ],
};

describe("createWorkbenchPublishNotifier", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "1";
    process.env.DINGTALK_CLIENT_ID = "client-id";
    process.env.DINGTALK_CLIENT_SECRET = "client-secret";
    process.env.DINGTALK_AGENT_ID = "9001";
    process.env.WORKBENCH_NOTIFY_DETAIL_URL_BASE = "https://example.com/workbench/employee/task";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  it("returns enabled=false when WORKBENCH_DINGTALK_NOTIFY_ENABLED is off", async () => {
    delete process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED;
    const notifier = createWorkbenchPublishNotifier();
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.enabled).toBe(false);
    expect(result.skippedReason).toContain("WORKBENCH_DINGTALK_NOTIFY_ENABLED");
  });

  it("sends card + creates todo with unionId path and deterministic sourceId when unionId present", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.enabled).toBe(true);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      userId: "emp-1",
      cardMessageId: expect.any(String),
      todoId: "todo-1",
    });
    expect(result.failed).toHaveLength(0);

    expect(calls[0]?.url).toContain("/v1.0/oauth2/accessToken");

    const cardCall = calls[1];
    expect(cardCall?.url).toContain("/topapi/message/corpconversation/asyncsend_v2");
    expect((cardCall?.body as { userid_list: string }).userid_list).toBe("emp-1");
    expect((cardCall?.body as { agent_id: number }).agent_id).toBe(9001);

    const todoCall = calls[2];
    expect(todoCall?.url).toContain("/v1.0/todo/users/uni-emp-1/tasks");
    expect(todoCall?.url).not.toContain("/users/emp-1/");
    const todoBody = todoCall?.body as { sourceId: string; detailUrl: string };
    expect(todoBody.sourceId).toBe("workbench:TK-001:emp-1");
    expect(todoBody.sourceId).not.toMatch(/\d{13}/);
    expect(todoBody.detailUrl).toContain("taskNo=TK-001");
  });

  it("skips createTodo and records failed entry when unionId is missing, but still sends card", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-2" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask({
      ...baseInput,
      assignees: [
        { userId: "emp-1", unionId: undefined, subtaskTitles: ["排查日志"] },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.url.includes("/v1.0/todo/"))).toBe(false);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      userId: "emp-1",
      cardMessageId: expect.any(String),
    });
    expect(result.success[0].todoId).toBeUndefined();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      userId: "emp-1",
      reason: expect.stringContaining("unionId missing"),
    });
  });

  it("records failed when todo API returns non-200 but keeps card success", async () => {
    const { fetch: fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-3" }),
      () => new Response("forbidden", { status: 403 }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].cardMessageId).toBeDefined();
    expect(result.success[0].todoId).toBeUndefined();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("create todo failed");
  });

  it("returns full failed (no card no todo) when card API fails", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 60011, errmsg: "no permission" }, 200),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(calls.some((c) => c.url.includes("/v1.0/todo/"))).toBe(false);
    expect(result.success).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("send card failed");
  });
});
