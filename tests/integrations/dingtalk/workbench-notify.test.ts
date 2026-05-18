import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildManagerEmployeeActionMarkdown,
  buildPublishTaskNotifyMarkdown,
  createWorkbenchPublishNotifier,
  resolveManagerNotifyDetailFocus,
  resolveManagerTaskDetailUrl,
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
    expect(robotMsgParam.text).toContain("分配给您");
    expect(robotMsgParam.text).toContain("排查日志");
    expect(robotMsgParam.text).toContain("- **负责人**：emp-1");
    expect(robotMsgParam.text).toContain("- **发布人**：mgr-1");
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

  it("notifyReassignedAssignee sends card and todo with reassign-specific sourceId", async () => {
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-r" }),
      () => jsonRes({ errcode: 0, task_id: "card-r" }),
      () => jsonRes({ processQueryKey: "robot-r" }),
      () => jsonRes({ id: "todo-r" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    await notifier.notifyReassignedAssignee({
      taskNo: "TK-002",
      taskTitle: "标题",
      managerUserId: "mgr-1",
      managerDisplayName: "王主管",
      assigneeUserId: "emp-9",
      unionId: "uni-9",
      subtaskId: "task:p1:task_2",
      subtaskTitle: "子A",
      scope: "subtask",
    });
    const corp = calls.find((c) => c.url.includes("corpconversation/asyncsend_v2"));
    expect(JSON.stringify(corp?.body)).toContain("改派");
    expect(JSON.stringify(corp?.body)).toContain("王主管");
    expect(JSON.stringify(corp?.body)).not.toContain("mgr-1");
    const todoCall = calls.find((c) => c.url.includes("/v1.0/todo/"));
    expect((todoCall?.body as { sourceId: string }).sourceId).toBe(
      "workbench:reassign:TK-002:task-p1-task_2",
    );
  });

  it("notifyManagerOfEmployeeAction sends robot 1:1 only (no corp card)", async () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com";
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-mn" }),
      () => jsonRes({ processQueryKey: "pq-manager" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    const result = await notifier.notifyManagerOfEmployeeAction({
      managerUserId: "mgr-99",
      employeeUserId: "emp-1",
      employeeDisplayName: "张三",
      taskNo: "TK-777",
      taskTitle: "整单标题",
      subtaskId: "st-1",
      subtaskTitle: "子任务标题",
      kind: "rejected",
      note: "太累了",
    });
    expect(result.enabled).toBe(true);
    expect(result.success).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("corpconversation/asyncsend_v2"))).toBe(false);
    const robot = calls.find((c) => c.url.includes("/robot/oToMessages/batchSend"));
    expect(robot).toBeDefined();
    const msgParam = JSON.parse(String((robot?.body as { msgParam: string }).msgParam ?? "{}")) as {
      text: string;
      singleURL: string;
    };
    expect(msgParam.text).toContain("拒绝子任务");
    expect(msgParam.text).toContain("TK-777");
    expect(msgParam.singleURL).toContain("/workbench/manager/task?taskNo=TK-777");
    expect(msgParam.singleURL).toContain("focus=reassign");
  });

  it("notifyManagerOfEmployeeAction uses focus=review for done (not reassign)", async () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com";
    const { fetch: fetchImpl, calls } = buildFetchMock([
      () => jsonRes({ accessToken: "tok-mn2" }),
      () => jsonRes({ processQueryKey: "pq-manager-2" }),
    ]);
    const notifier = createWorkbenchPublishNotifier(fetchImpl);
    await notifier.notifyManagerOfEmployeeAction({
      managerUserId: "mgr-99",
      employeeUserId: "emp-1",
      employeeDisplayName: "张三",
      taskNo: "TK-888",
      taskTitle: "整单标题",
      subtaskId: "st-done",
      subtaskTitle: "子任务标题",
      kind: "done",
      note: "完成了",
    });
    const robot = calls.find((c) => c.url.includes("/robot/oToMessages/batchSend"));
    const msgParam = JSON.parse(String((robot?.body as { msgParam: string }).msgParam ?? "{}")) as {
      singleURL: string;
    };
    expect(msgParam.singleURL).toContain("focus=review");
    expect(msgParam.singleURL).not.toContain("focus=reassign");
  });

  it("notifyManagerOfEmployeeAction skips when WORKBENCH_DINGTALK_NOTIFY_MANAGER_ENABLED=0", async () => {
    process.env.WORKBENCH_DINGTALK_NOTIFY_MANAGER_ENABLED = "0";
    const spyFetch = vi.fn();
    const notifier = createWorkbenchPublishNotifier(spyFetch);
    const result = await notifier.notifyManagerOfEmployeeAction({
      managerUserId: "mgr-1",
      employeeUserId: "e",
      employeeDisplayName: "E",
      taskNo: "T1",
      taskTitle: "Ti",
      subtaskId: "s",
      subtaskTitle: "St",
      kind: "done",
    });
    expect(result.enabled).toBe(false);
    expect(result.skippedReason).toContain("MANAGER");
    expect(spyFetch).not.toHaveBeenCalled();
  });
});

describe("buildPublishTaskNotifyMarkdown", () => {
  it("renders taskDescription block when provided", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-bg",
      title: "主任务",
      managerUserId: "mgr",
      taskDescription: "这是任务整体背景说明",
      assignee: { userId: "u1", subtasks: [{ title: "子A" }] },
      subtaskTitleBySourceKey: {},
    });
    expect(md).toContain("- **任务背景**：");
    expect(md).toContain("这是任务整体背景说明");
    expect(md).toContain("本会话继续用文字提问");
  });

  it("omits taskDescription block when empty", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-nobg",
      title: "主任务",
      managerUserId: "mgr",
      taskDescription: "   ",
      assignee: { userId: "u1", subtasks: [{ title: "子A" }] },
      subtaskTitleBySourceKey: {},
    });
    expect(md).not.toContain("任务背景");
    expect(md).not.toContain("本会话继续用文字提问");
  });

  it("preserves task background line when trimming long markdown", () => {
    const subtasks = Array.from({ length: 80 }, (_, i) => ({
      title: `子-${i}-` + "x".repeat(80),
      extra: { risks: ["r".repeat(120)] },
    }));
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-long",
      title: "主任务",
      managerUserId: "mgr",
      taskDescription: "KEEP_BG_TOKEN_UNIQUE",
      assignee: { userId: "u1", subtasks },
      subtaskTitleBySourceKey: {},
    });
    expect(md.length).toBeGreaterThan(1000);
    expect(md).toContain("KEEP_BG_TOKEN_UNIQUE");
    expect(md).toContain("- **任务背景**：");
  });

  it("renders dependency, checkpoints, and risks", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-1",
      title: "主任务",
      managerUserId: "mgr",
      assignee: {
        userId: "u1",
        subtasks: [
          {
            title: "子B",
            extra: { dependsOn: ["task_1"], checkpoints: ["c1"], risks: ["r1"] },
          },
        ],
      },
      subtaskTitleBySourceKey: { task_1: "子A" },
    });
    expect(md).toContain("前置依赖");
    expect(md).toContain("task_1（子A）");
    expect(md).toContain("检查点");
    expect(md).toContain("c1");
    expect(md).toContain("风险");
    expect(md).toContain("r1");
  });

  it("renders v2 extra fields inputMaterials actions collaborators scope", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-v2",
      title: "主任务",
      managerUserId: "mgr",
      assignee: {
        userId: "u1",
        subtasks: [
          {
            title: "子V2",
            extra: {
              v: 2,
              inputMaterials: ["图纸 v2"],
              actions: ["复测"],
              collaborators: ["质量"],
              scope: { inScope: ["A"], outOfScope: ["不做包装"] },
              dependsOn: ["task_1"],
              checkpoints: ["c1"],
              risks: ["r1"],
            },
          },
        ],
      },
      subtaskTitleBySourceKey: { task_1: "前置子" },
    });
    expect(md).toContain("输入材料");
    expect(md).toContain("图纸 v2");
    expect(md).toContain("执行动作");
    expect(md).toContain("复测");
    expect(md).toContain("协作人");
    expect(md).toContain("质量");
    expect(md).toContain("范围内");
    expect(md).toContain("A");
    expect(md).toContain("范围外");
    expect(md).toContain("不做包装");
  });

  it("omits empty extra sections", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-2",
      title: "T",
      managerUserId: "mgr",
      assignee: { userId: "u1", subtasks: [{ title: "仅标题" }] },
      subtaskTitleBySourceKey: {},
    });
    expect(md).toContain("#### 子任务：仅标题");
    expect(md).not.toContain("前置依赖");
  });

  it("supports subtaskTitles fallback", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-3",
      title: "T",
      managerUserId: "mgr",
      assignee: { userId: "u1", subtaskTitles: ["A", "B"] },
      subtaskTitleBySourceKey: {},
    });
    expect(md).toContain("分配给您：**2** 条子任务");
    expect(md).toContain("#### 子任务：A");
  });

  it("uses display names for manager and assignee when provided", () => {
    const md = buildPublishTaskNotifyMarkdown({
      taskNo: "N-4",
      title: "T",
      managerUserId: "641001",
      managerDisplayName: "张三",
      assignee: { userId: "641002", displayName: "李四", subtasks: [{ title: "子" }] },
      subtaskTitleBySourceKey: {},
    });
    expect(md).toContain("- **负责人**：李四");
    expect(md).toContain("- **发布人**：张三");
    expect(md).not.toContain("641001");
    expect(md).not.toContain("641002");
  });
});

describe("resolveManagerTaskDetailUrl / buildManagerEmployeeActionMarkdown", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("resolveManagerTaskDetailUrl builds manager task link", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://host/";
    expect(resolveManagerTaskDetailUrl("TK-1")).toBe("https://host/workbench/manager/task?taskNo=TK-1");
  });

  it("resolveManagerTaskDetailUrl builds manager task link with deep-link params", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://host/";
    const u = resolveManagerTaskDetailUrl("TK-1", {
      subtaskId: "task:plan-1:task_2",
      focus: "reassign",
    });
    expect(u).toContain("taskNo=TK-1");
    expect(u).toContain("subtaskId=");
    expect(u).toContain("focus=reassign");
  });

  it("buildManagerEmployeeActionMarkdown includes action and DingTalk in-app guidance (no markdown link)", () => {
    const md = buildManagerEmployeeActionMarkdown({
      employeeDisplayName: "李四",
      employeeUserId: "u-2",
      kind: "blocked",
      taskNo: "N-9",
      taskTitle: "主",
      subtaskTitle: "子",
      note: "缺料",
      workbenchTaskUrl: "https://x/w/workbench/manager/task?taskNo=N-9",
    });
    expect(md).toContain("标记阻塞");
    expect(md).toContain("钉钉内");
    expect(md).not.toMatch(/\[.*\]\(https?:\/\//);
    expect(md).toContain("缺料");
  });

  it("resolveManagerNotifyDetailFocus maps kinds to detail focus", () => {
    expect(resolveManagerNotifyDetailFocus("rejected")).toBe("reassign");
    expect(resolveManagerNotifyDetailFocus("changes_requested")).toBe("reassign");
    expect(resolveManagerNotifyDetailFocus("blocked")).toBe("blocked");
    expect(resolveManagerNotifyDetailFocus("done")).toBe("review");
    expect(resolveManagerNotifyDetailFocus("customize")).toBe("review");
  });
});
