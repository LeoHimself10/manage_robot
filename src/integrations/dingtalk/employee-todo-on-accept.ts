import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { logStructured } from "../../infra/logger";
import type { WorkbenchPublishNotifier } from "./workbench-notify";
import type { WorkbenchTaskStatus } from "../../infra/workbench-formal-task-store";

export type FormalTaskStore = Pick<
  ReturnType<typeof createWorkbenchFormalTaskStore>,
  "getSubtaskWithTask" | "appendTaskEvent"
>;

/**
 * 员工 accept 后，当 previousStatus === "ASSIGNED" 时创建钉钉待办。
 * 单一门禁：
 *   - 首次 accept：ASSIGNED → IN_PROGRESS，触发；
 *   - 重复点 accept：previousStatus 已是 IN_PROGRESS，跳过；
 *   - 改派后再 accept：reassign 重置为 ASSIGNED，可再次触发。
 */
export async function notifyEmployeeTodoOnAcceptAfterUpdate(input: {
  taskStore: FormalTaskStore;
  notifier: WorkbenchPublishNotifier | undefined;
  subtaskId: string;
  actorUserId: string;
  previousStatus: WorkbenchTaskStatus;
  action: "accept" | "reject" | "request_changes" | "customize";
  getContact?: (userId: string) => { unionId?: string } | undefined;
}): Promise<void> {
  if (
    input.action !== "accept" ||
    input.previousStatus !== "ASSIGNED" ||
    !input.notifier
  ) {
    return;
  }

  const pair = input.taskStore.getSubtaskWithTask(input.subtaskId);
  if (!pair) {
    logStructured({
      event: "employee_todo_create_skipped",
      reason: "subtask_not_found",
      subtaskId: input.subtaskId,
      userId: input.actorUserId,
    });
    return;
  }

  const unionId = input.getContact?.(input.actorUserId)?.unionId?.trim() || undefined;
  const { task, subtask } = pair;

  const result = await input.notifier.notifyEmployeeTodoOnAccept({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskId: input.subtaskId,
    subtaskTitle: subtask.title,
    assigneeUserId: input.actorUserId,
    unionId,
  });

  if (!result.enabled) {
    input.taskStore.appendTaskEvent({
      taskId: task.taskId,
      subtaskId: input.subtaskId,
      eventType: "EMPLOYEE_TODO_SKIPPED",
      actorUserId: input.actorUserId,
      note: result.skippedReason?.slice(0, 500),
    });
    logStructured({
      event: "employee_todo_create_skipped",
      reason: result.skippedReason,
      taskNo: task.taskNo,
      subtaskId: input.subtaskId,
      userId: input.actorUserId,
    });
  } else if (result.failedReason) {
    input.taskStore.appendTaskEvent({
      taskId: task.taskId,
      subtaskId: input.subtaskId,
      eventType: "EMPLOYEE_TODO_FAILED",
      actorUserId: input.actorUserId,
      note: result.failedReason.slice(0, 500),
      payload: { taskNo: task.taskNo, userId: input.actorUserId, unionId },
    });
    logStructured({
      event: "employee_todo_create_failed",
      taskNo: task.taskNo,
      subtaskId: input.subtaskId,
      userId: input.actorUserId,
      error: result.failedReason,
    });
  } else {
    input.taskStore.appendTaskEvent({
      taskId: task.taskId,
      subtaskId: input.subtaskId,
      eventType: "EMPLOYEE_TODO_CREATED",
      actorUserId: input.actorUserId,
      payload: {
        todoId: result.todoId,
        taskNo: task.taskNo,
        userId: input.actorUserId,
        unionId,
      },
    });
    logStructured({
      event: "employee_todo_create_ok",
      taskNo: task.taskNo,
      subtaskId: input.subtaskId,
      userId: input.actorUserId,
      todoId: result.todoId,
    });
  }
}
