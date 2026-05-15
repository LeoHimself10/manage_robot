import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { logStructured } from "../../infra/logger";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

type FormalTaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

/** 与 `reassignTask` / `reassign_task` 工具一致的子任务 id 归一化。 */
export function normalizeReassignSubtaskId(planId: string, raw?: string): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  return t.startsWith("task:") ? t : `task:${planId}:${t}`;
}

export function voidFireReassignAssigneeNotify(input: {
  notifier: WorkbenchPublishNotifier;
  getContact: (userId: string) => { unionId?: string; name?: string } | undefined;
  appendTaskEvent?: FormalTaskStore["appendTaskEvent"];
  taskStore: Pick<FormalTaskStore, "getTaskDetail">;
  taskId: string;
  planId: string;
  managerUserId: string;
  assigneeUserId: string;
  subtaskIdRaw?: string;
}): void {
  const normalizedSubtaskId = normalizeReassignSubtaskId(input.planId, input.subtaskIdRaw);
  const scope = normalizedSubtaskId ? ("subtask" as const) : ("plan" as const);

  void (async () => {
    try {
      const detail = input.taskStore.getTaskDetail(input.planId);
      if (!detail) {
        logStructured({
          event: "workbench_reassign_notify_skipped",
          reason: "task_detail_missing",
          planId: input.planId,
        });
        return;
      }
      const { task } = detail;
      let subtaskTitle: string | undefined;
      if (normalizedSubtaskId) {
        const sub = detail.subtasks.find((s) => s.subtaskId === normalizedSubtaskId);
        subtaskTitle = sub?.title;
      }
      const contact = input.getContact(input.assigneeUserId);
      const unionId = contact?.unionId?.trim() || undefined;
      const managerContact = input.getContact(input.managerUserId);
      const notifyInput = {
        taskNo: task.taskNo,
        taskTitle: task.title,
        managerUserId: input.managerUserId,
        managerDisplayName: managerContact?.name?.trim() || undefined,
        assigneeUserId: input.assigneeUserId,
        unionId,
        subtaskId: normalizedSubtaskId,
        subtaskTitle,
        scope,
      };

      const result = await input.notifier.notifyReassignedAssignee(notifyInput);
      input.appendTaskEvent?.({
        taskId: input.taskId,
        subtaskId: normalizedSubtaskId,
        eventType: "REASSIGN_NOTIFY_OK",
        actorUserId: input.managerUserId,
        payload: {
          enabled: result.enabled,
          skippedReason: result.skippedReason,
          success: result.success,
          failed: result.failed,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logStructured({
        event: "workbench_reassign_notify_error",
        planId: input.planId,
        taskId: input.taskId,
        error: msg,
      });
      input.appendTaskEvent?.({
        taskId: input.taskId,
        subtaskId: normalizedSubtaskId,
        eventType: "REASSIGN_NOTIFY_FAILED",
        actorUserId: input.managerUserId,
        note: msg,
      });
    }
  })();
}
