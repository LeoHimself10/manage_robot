import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { ManagerEmployeeNotifyKind, WorkbenchPublishNotifier } from "./workbench-notify";
import { resolveManagerTaskDetailUrl } from "./workbench-notify";

export type FormalTaskStoreLike = Pick<
  ReturnType<typeof createWorkbenchFormalTaskStore>,
  "getSubtaskWithTask" | "appendTaskEvent"
>;

/**
 * 员工子任务状态变更后，向主管发送钉钉 1:1 机器人通知；失败时写入 `MANAGER_NOTIFY_FAILED` 事件。
 */
export async function notifyManagerOfEmployeeActionAfterUpdate(input: {
  taskStore: FormalTaskStoreLike;
  notifier: WorkbenchPublishNotifier | undefined;
  subtaskId: string;
  actorUserId: string;
  kind: ManagerEmployeeNotifyKind;
  note?: string;
  getDisplayName?: (userId: string) => string | undefined;
}): Promise<void> {
  if (!input.notifier) return;
  const notifyFn = input.notifier.notifyManagerOfEmployeeAction;
  if (typeof notifyFn !== "function") return;

  const pair = input.taskStore.getSubtaskWithTask(input.subtaskId);
  if (!pair) return;
  const managerUserId = pair.task.managerUserId?.trim();
  if (!managerUserId) return;

  const employeeDisplayName =
    input.getDisplayName?.(input.actorUserId)?.trim() || input.actorUserId;
  const taskUrl = resolveManagerTaskDetailUrl(pair.task.taskNo, {
    subtaskId: pair.subtask.subtaskId,
    focus: "reassign",
  });

  let result: Awaited<ReturnType<WorkbenchPublishNotifier["notifyManagerOfEmployeeAction"]>>;
  try {
    result = await notifyFn.call(input.notifier, {
      managerUserId,
      employeeUserId: input.actorUserId,
      employeeDisplayName,
      taskNo: pair.task.taskNo,
      taskTitle: pair.task.title,
      subtaskId: pair.subtask.subtaskId,
      subtaskTitle: pair.subtask.title,
      kind: input.kind,
      note: input.note,
      workbenchTaskUrl: taskUrl,
    });
  } catch (err) {
    input.taskStore.appendTaskEvent({
      taskId: pair.task.taskId,
      subtaskId: pair.subtask.subtaskId,
      eventType: "MANAGER_NOTIFY_FAILED",
      actorUserId: input.actorUserId,
      note: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      payload: { phase: "notifyManagerOfEmployeeAction_throw", kind: input.kind },
    });
    return;
  }

  const notifiedOk = result.success.some((s) => s.userId === managerUserId);
  if (result.enabled && !notifiedOk) {
    const reasons = result.failed.map((f) => f.reason).join("; ") || "no success entry";
    input.taskStore.appendTaskEvent({
      taskId: pair.task.taskId,
      subtaskId: pair.subtask.subtaskId,
      eventType: "MANAGER_NOTIFY_FAILED",
      actorUserId: input.actorUserId,
      note: reasons.slice(0, 500),
      payload: { kind: input.kind, failed: result.failed, skippedReason: result.skippedReason },
    });
  }
}
