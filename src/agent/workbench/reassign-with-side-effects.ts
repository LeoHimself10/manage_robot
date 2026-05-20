import type { PlanSession } from "../../infra/plan-session-store";
import type { WorkbenchTaskRow, createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

type FormalTaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export interface ReassignTaskInput {
  planId: string;
  managerUserId: string;
  assigneeUserId: string;
  note?: string;
  actorName?: string;
  /**
   * 可选：仅改派单个子任务（subtaskId 形如 "task:{planId}:task_4"，也接受短码 "task_4"）。
   * 不传时回落到整 plan 改派（所有未完成子任务）。
   */
  subtaskId?: string;
}

export interface ReassignTaskDeps {
  taskStore: Pick<FormalTaskStore, "reassignTask">;
  findLatestSessionByPlanId: (planId: string) => (PlanSession & { chatKeyHash: string }) | undefined;
  planSessionStore: {
    save(session: PlanSession): void;
    appendEvent(input: {
      planId: string;
      chatKeyHash: string;
      eventType: string;
      payload?: Record<string, unknown>;
    }): void;
  };
  patchLatestAssignmentAssignee: (
    latest: Record<string, unknown> | undefined,
    assigneeUserId: string,
  ) => Record<string, unknown>;
}

export interface ReassignTaskResult {
  task: WorkbenchTaskRow;
  revisionEventWritten: boolean;
}

export function executeReassignWithSideEffects(
  input: ReassignTaskInput,
  deps: ReassignTaskDeps,
): ReassignTaskResult {
  const task = deps.taskStore.reassignTask({
    planId: input.planId,
    managerUserId: input.managerUserId,
    assigneeUserId: input.assigneeUserId,
    note: input.note,
    subtaskId: input.subtaskId,
  });

  const targetSession = deps.findLatestSessionByPlanId(input.planId);
  const occurredAt = new Date().toISOString();
  if (!targetSession) {
    return { task, revisionEventWritten: false };
  }

  const scopeIsSingleSubtask = Boolean(input.subtaskId?.trim());
  const eventRecord: Record<string, unknown> = {
    occurredAt,
    eventType: "MANAGER_REASSIGN_SAVED",
    planId: input.planId,
    actorUserId: input.managerUserId,
    actorName: input.actorName,
    assigneeUserId: input.assigneeUserId,
    note: input.note?.trim() || "",
    ...(scopeIsSingleSubtask
      ? { subtaskId: input.subtaskId?.trim(), scope: "subtask" as const }
      : { scope: "plan" as const }),
  };
  deps.planSessionStore.save({
    ...targetSession,
    revisionEvents: [...(targetSession.revisionEvents ?? []), eventRecord].slice(-60),
  });
  deps.planSessionStore.appendEvent({
    planId: input.planId,
    chatKeyHash: targetSession.chatKeyHash,
    eventType: "manager_reassign_saved",
    payload: {
      actorUserId: input.managerUserId,
      actorName: input.actorName,
      assigneeUserId: input.assigneeUserId,
      note: input.note?.trim() || "",
      ...(scopeIsSingleSubtask
        ? { subtaskId: input.subtaskId?.trim(), scope: "subtask" }
        : { scope: "plan" }),
    },
  });
  return { task, revisionEventWritten: true };
}
