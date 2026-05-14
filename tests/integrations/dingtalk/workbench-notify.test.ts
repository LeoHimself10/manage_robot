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
    process.env.DINGTALK_ROBOT_CODE = "robot-code-x";
    // Default: robot msg channel on (tests assume "C" path = card + robot + todo)
    delete process.env.WORKBENCH_DINGTALK_ROBOT_MSG_ENABLED;
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

  it("sends card + robot 1:1 message + creates todo when all channels succeed", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => jsonRes({ processQueryKey: "robot-msg-1" }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.enabled).toBe(true);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      userId: "emp-1",
      cardMessageId: expect.any(String),
      robotMessageKey: "robot-msg-1",
      todoId: "todo-1",
    });
    expect(result.failed).toHaveLength(0);

    expect(calls[0]?.url).toContain("/v1.0/oauth2/accessToken");

    const cardCall = calls[1];
    expect(cardCall?.url).toContain("/topapi/message/corpconversation/asyncsend_v2");
    expect((cardCall?.body as { userid_list: string }).userid_list).toBe("emp-1");
    expect((cardCall?.body as { agent_id: number }).agent_id).toBe(9001);

    const robotCall = calls[2];
    expect(robotCall?.url).toContain("/v1.0/robot/oToMessages/batchSend");
    const robotBody = robotCall?.body as {
      robotCode: string;
      userIds: string[];
      msgKey: string;
      msgParam: string;
    };
    expect(robotBody.robotCode).toBe("robot-code-x");
    expect(robotBody.userIds).toEqual(["emp-1"]);
    expect(robotBody.msgKey).toBe("sampleActionCard");
    const robotMsgParam = JSON.parse(robotBody.msgParam) as Record<string, string>;
    expect(robotMsgParam.title).toContain("TK-001");
    expect(robotMsgParam.singleURL).toContain("taskNo=TK-001");
    expect(robotCall?.init?.headers).toMatchObject({
      "x-acs-dingtalk-access-token": "tok-1",
    });

    const todoCall = calls[3];
    expect(todoCall?.url).toContain("/v1.0/todo/users/uni-emp-1/tasks");
    expect(todoCall?.url).not.toContain("/users/emp-1/");
    const todoBody = todoCall?.body as { sourceId: string; detailUrl: string };
    expect(todoBody.sourceId).toBe("workbench:TK-001:emp-1");
    expect(todoBody.sourceId).not.toMatch(/\d{13}/);
    expect(todoBody.detailUrl).toContain("taskNo=TK-001");
  });

  it("falls back to DINGTALK_CLIENT_ID as robotCode when DINGTALK_ROBOT_CODE is unset", async () => {
    delete process.env.DINGTALK_ROBOT_CODE;
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => jsonRes({ processQueryKey: "robot-msg-1" }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].robotMessageKey).toBe("robot-msg-1");

    const robotBody = calls[2]?.body as { robotCode: string };
    expect(robotBody.robotCode).toBe("client-id");
  });

  it("skips robot 1:1 channel when WORKBENCH_DINGTALK_ROBOT_MSG_ENABLED=0 (still sends card + todo)", async () => {
    process.env.WORKBENCH_DINGTALK_ROBOT_MSG_ENABLED = "0";
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(calls.some((c) => c.url.includes("/robot/oToMessages/batchSend"))).toBe(false);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].robotMessageKey).toBeUndefined();
    expect(result.success[0].cardMessageId).toBeDefined();
    expect(result.success[0].todoId).toBe("todo-1");
    expect(result.failed).toHaveLength(0);
  });

  it("records robot send failure but keeps card + todo successes (graceful per-channel)", async () => {
    const { fetch: fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => new Response("forbidden", { status: 403 }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].cardMessageId).toBeDefined();
    expect(result.success[0].robotMessageKey).toBeUndefined();
    expect(result.success[0].todoId).toBe("todo-1");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("robot chat message failed");
  });

  it("still creates todo with deterministic sourceId when unionId present", async () => {
    process.env.WORKBENCH_DINGTALK_ROBOT_MSG_ENABLED = "0";
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-1" }),
      () => jsonRes({ id: "todo-1" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.success).toHaveLength(1);
    const todoCall = calls[2];
    expect(todoCall?.url).toContain("/v1.0/todo/users/uni-emp-1/tasks");
    const todoBody = todoCall?.body as { sourceId: string };
    expect(todoBody.sourceId).toBe("workbench:TK-001:emp-1");
  });

  it("skips createTodo and records failed entry when unionId is missing, but still sends card + robot msg", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-2" }),
      () => jsonRes({ processQueryKey: "robot-msg-2" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask({
      ...baseInput,
      assignees: [{ userId: "emp-1", unionId: undefined, subtaskTitles: ["排查日志"] }],
    });
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.url.includes("/v1.0/todo/"))).toBe(false);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      userId: "emp-1",
      cardMessageId: expect.any(String),
      robotMessageKey: "robot-msg-2",
    });
    expect(result.success[0].todoId).toBeUndefined();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      userId: "emp-1",
      reason: expect.stringContaining("unionId missing"),
    });
  });

  it("records failed when todo API returns non-200 but keeps card + robot successes", async () => {
    const { fetch: fetchImpl } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 0, task_id: "card-task-3" }),
      () => jsonRes({ processQueryKey: "robot-msg-3" }),
      () => new Response("forbidden", { status: 403 }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].cardMessageId).toBeDefined();
    expect(result.success[0].robotMessageKey).toBe("robot-msg-3");
    expect(result.success[0].todoId).toBeUndefined();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("create todo failed");
  });

  it("returns user in failed (no card) but still tries robot msg + todo when card API fails", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-1" }),
      () => jsonRes({ errcode: 60011, errmsg: "no permission" }, 200),
      () => jsonRes({ processQueryKey: "robot-msg-x" }),
      () => jsonRes({ id: "todo-x" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyPublishedTask(baseInput);
    expect(calls.some((c) => c.url.includes("/robot/oToMessages/batchSend"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/v1.0/todo/"))).toBe(true);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].cardMessageId).toBeUndefined();
    expect(result.success[0].robotMessageKey).toBe("robot-msg-x");
    expect(result.success[0].todoId).toBe("todo-x");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("send card failed");
  });
});
