import { describe, expect, it, vi } from "vitest";
import { notifyEmployeeTodoOnAcceptAfterUpdate } from "../../../src/integrations/dingtalk/employee-todo-on-accept";
import type { WorkbenchPublishNotifier } from "../../../src/integrations/dingtalk/workbench-notify";

function buildMockStore(overrides: Partial<{
  subtask: { subtaskId: string; title: string; status: string };
  task: { taskId: string; taskNo: string; title: string; planId: string; status: string };
}> = {}) {
  const subtask = overrides.subtask ?? {
    subtaskId: "task:plan-1:task_1",
    title: "子任务A",
    status: "IN_PROGRESS",
  };
  const task = overrides.task ?? {
    taskId: "task:plan-1",
    taskNo: "TK-001",
    title: "整单标题",
    planId: "plan-1",
    status: "IN_PROGRESS",
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSubtaskWithTask: vi.fn(() => ({ task, subtask })) as any,
    appendTaskEvent: vi.fn(),
  };
}

function buildMockNotifier(result: Awaited<ReturnType<WorkbenchPublishNotifier["notifyEmployeeTodoOnAccept"]>>): WorkbenchPublishNotifier {
  return {
    notifyPublishedTask: vi.fn(),
    notifyReassignedAssignee: vi.fn(),
    notifyManagerOfEmployeeAction: vi.fn(),
    notifySubtaskReminder: vi.fn(),
    notifyProgressDigest: vi.fn(),
    notifyEmployeeOfManagerAction: vi.fn(),
    notifyEmployeeTodoOnAccept: vi.fn(async () => result),
  } as unknown as WorkbenchPublishNotifier;
}

describe("notifyEmployeeTodoOnAcceptAfterUpdate", () => {
  it("does nothing when action is not accept", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({ enabled: true, todoId: "todo-1" });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "reject",
    });
    expect(notifier.notifyEmployeeTodoOnAccept).not.toHaveBeenCalled();
    expect(store.appendTaskEvent).not.toHaveBeenCalled();
  });

  it("does nothing when previousStatus is not ASSIGNED (idempotency guard)", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({ enabled: true, todoId: "todo-1" });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "IN_PROGRESS",
      action: "accept",
    });
    expect(notifier.notifyEmployeeTodoOnAccept).not.toHaveBeenCalled();
    expect(store.appendTaskEvent).not.toHaveBeenCalled();
  });

  it("does nothing when notifier is undefined", async () => {
    const store = buildMockStore();
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier: undefined,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "accept",
    });
    expect(store.appendTaskEvent).not.toHaveBeenCalled();
  });

  it("creates EMPLOYEE_TODO_CREATED event on success", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({ enabled: true, todoId: "todo-xyz" });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "accept",
      getContact: () => ({ unionId: "uni-1" }),
    });
    expect(notifier.notifyEmployeeTodoOnAccept).toHaveBeenCalledWith({
      taskNo: "TK-001",
      taskTitle: "整单标题",
      subtaskId: "task:plan-1:task_1",
      subtaskTitle: "子任务A",
      assigneeUserId: "emp-1",
      unionId: "uni-1",
    });
    expect(store.appendTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EMPLOYEE_TODO_CREATED",
        actorUserId: "emp-1",
        payload: expect.objectContaining({ todoId: "todo-xyz" }),
      }),
    );
  });

  it("creates EMPLOYEE_TODO_SKIPPED event when notify is disabled", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({
      enabled: false,
      skippedReason: "WORKBENCH_DINGTALK_NOTIFY_ENABLED is off",
    });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "accept",
    });
    expect(store.appendTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EMPLOYEE_TODO_SKIPPED",
        note: expect.stringContaining("WORKBENCH_DINGTALK_NOTIFY_ENABLED"),
      }),
    );
  });

  it("creates EMPLOYEE_TODO_FAILED event when todo API fails", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({
      enabled: true,
      failedReason: "unionId missing for emp-1",
    });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "accept",
      getContact: () => undefined,
    });
    expect(store.appendTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "EMPLOYEE_TODO_FAILED",
        note: expect.stringContaining("unionId missing"),
      }),
    );
  });

  it("passes unionId=undefined when getContact returns nothing", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({ enabled: true, todoId: "todo-2" });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-1",
      previousStatus: "ASSIGNED",
      action: "accept",
      getContact: () => undefined,
    });
    expect(notifier.notifyEmployeeTodoOnAccept).toHaveBeenCalledWith(
      expect.objectContaining({ unionId: undefined }),
    );
  });

  it("reassign scenario: triggers todo again after previousStatus reset to ASSIGNED", async () => {
    const store = buildMockStore();
    const notifier = buildMockNotifier({ enabled: true, todoId: "todo-reassign" });
    // First accept (normal)
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-2",
      previousStatus: "ASSIGNED",
      action: "accept",
      getContact: () => ({ unionId: "uni-2" }),
    });
    // Reassign resets to ASSIGNED; new employee accepts
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore: store,
      notifier,
      subtaskId: "task:plan-1:task_1",
      actorUserId: "emp-3",
      previousStatus: "ASSIGNED",
      action: "accept",
      getContact: () => ({ unionId: "uni-3" }),
    });
    expect(notifier.notifyEmployeeTodoOnAccept).toHaveBeenCalledTimes(2);
  });
});
