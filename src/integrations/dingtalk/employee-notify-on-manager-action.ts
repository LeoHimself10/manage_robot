import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type {
  EmployeeManagerNotifyKind,
  WorkbenchPublishNotifier,
} from "./workbench-notify";

export type FormalTaskStoreLike = Pick<
  ReturnType<typeof createWorkbenchFormalTaskStore>,
  "getSubtaskWithTask" | "appendTaskEvent"
>;

/**
 * 主管对员工子任务执行驳回 / 接受拒绝等动作后，向员工发送钉钉 1:1 机器人通知；
 * 失败时写入 `EMPLOYEE_NOTIFY_FAILED` 事件。
 */
export async function notifyEmployeeOfManagerActionAfterUpdate(input: {
  taskStore: FormalTaskStoreLike;
  notifier: WorkbenchPublishNotifier | undefined;
  subtaskId: string;
  managerUserId: string;
  managerDisplayName?: string;
  kind: EmployeeManagerNotifyKind;
  note?: string;
}): Promise<void> {
  if (!input.notifier) return;
  const notifyFn = input.notifier.notifyEmployeeOfManagerAction;
  if (typeof notifyFn !== "function") return;

  const pair = input.taskStore.getSubtaskWithTask(input.subtaskId);
  if (!pair) return;
  const employeeUserId = pair.subtask.assigneeUserId?.trim();
  if (!employeeUserId) return;

  const managerDisplayName =
    String(input.managerDisplayName ?? "").trim() || input.managerUserId;

  let result: Awaited<ReturnType<WorkbenchPublishNotifier["notifyEmployeeOfManagerAction"]>>;
  try {
    result = await notifyFn.call(input.notifier, {
      employeeUserId,
      managerUserId: input.managerUserId,
      managerDisplayName,
      taskNo: pair.task.taskNo,
      taskTitle: pair.task.title,
      subtaskId: pair.subtask.subtaskId,
      subtaskTitle: pair.subtask.title,
      kind: input.kind,
      note: input.note,
    });
  } catch (err) {
    input.taskStore.appendTaskEvent({
      taskId: pair.task.taskId,
      subtaskId: pair.subtask.subtaskId,
      eventType: "EMPLOYEE_NOTIFY_FAILED",
      actorUserId: input.managerUserId,
      note: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      payload: { phase: "notifyEmployeeOfManagerAction_throw", kind: input.kind },
    });
    return;
  }

  const notifiedOk = result.success.some((s) => s.userId === employeeUserId);
  if (result.enabled && !notifiedOk) {
    const reasons = result.failed.map((f) => f.reason).join("; ") || "no success entry";
    input.taskStore.appendTaskEvent({
      taskId: pair.task.taskId,
      subtaskId: pair.subtask.subtaskId,
      eventType: "EMPLOYEE_NOTIFY_FAILED",
      actorUserId: input.managerUserId,
      note: reasons.slice(0, 500),
      payload: { kind: input.kind, failed: result.failed, skippedReason: result.skippedReason },
    });
  }
}
