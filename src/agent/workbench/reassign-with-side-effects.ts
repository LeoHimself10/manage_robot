import type { PlanSession } from "../../infra/plan-session-store";
import type { WorkbenchTaskRow, createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

type FormalTaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export interface ReassignTaskInput {
  planId: string;
  managerUserId: string;
  assigneeUserId: string;
  note?: string;
  actorName?: string;
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
  });

  const targetSession = deps.findLatestSessionByPlanId(input.planId);
  const occurredAt = new Date().toISOString();
  if (!targetSession) {
    return { task, revisionEventWritten: false };
  }

  const eventRecord: Record<string, unknown> = {
    occurredAt,
    eventType: "MANAGER_REASSIGN_SAVED",
    planId: input.planId,
    actorUserId: input.managerUserId,
    actorName: input.actorName,
    assigneeUserId: input.assigneeUserId,
    note: input.note?.trim() || "",
  };
  deps.planSessionStore.save({
    ...targetSession,
    latestAssignment: deps.patchLatestAssignmentAssignee(
      targetSession.latestAssignment,
      input.assigneeUserId,
    ),
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
    },
  });
  return { task, revisionEventWritten: true };
}
