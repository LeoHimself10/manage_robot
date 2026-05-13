import { describe, expect, it, vi } from "vitest";
import { executeReassignWithSideEffects } from "../../../src/agent/workbench/reassign-with-side-effects";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSession(): PlanSession & { chatKeyHash: string } {
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    senderStaffId: "mgr-1",
    knownFacts: [],
    conversationHistory: [],
    latestAssignment: {
      assignments: [{ taskId: "task_1", primary: { userId: "emp-1" } }],
    },
  };
}

describe("executeReassignWithSideEffects", () => {
  it("writes both store and session side-effects when session exists", () => {
    const reassignTask = vi.fn(() => ({
      taskId: "task:plan-1",
      taskNo: "TASK-1",
      planId: "plan-1",
      title: "任务A",
      status: "ASSIGNED" as const,
      initiatorUserId: "mgr-1",
      initiatorDepartment: "研发",
      managerUserId: "mgr-1",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const save = vi.fn();
    const appendEvent = vi.fn();
    const session = makeSession();
    const result = executeReassignWithSideEffects(
      {
        planId: "plan-1",
        managerUserId: "mgr-1",
        assigneeUserId: "emp-2",
        note: "工作量调整",
        actorName: "主管A",
      },
      {
        taskStore: { reassignTask },
        findLatestSessionByPlanId: () => session,
        planSessionStore: { save, appendEvent },
        patchLatestAssignmentAssignee: () => ({ assignments: [{ primary: { userId: "emp-2" } }] }),
      },
    );
    expect(result.revisionEventWritten).toBe(true);
    expect(reassignTask).toHaveBeenCalledWith({
      planId: "plan-1",
      managerUserId: "mgr-1",
      assigneeUserId: "emp-2",
      note: "工作量调整",
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        eventType: "manager_reassign_saved",
      }),
    );
  });

  it("only reassigns store when session is missing", () => {
    const reassignTask = vi.fn(() => ({
      taskId: "task:plan-1",
      taskNo: "TASK-1",
      planId: "plan-1",
      title: "任务A",
      status: "ASSIGNED" as const,
      initiatorUserId: "mgr-1",
      initiatorDepartment: "研发",
      managerUserId: "mgr-1",
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const save = vi.fn();
    const appendEvent = vi.fn();
    const result = executeReassignWithSideEffects(
      {
        planId: "plan-1",
        managerUserId: "mgr-1",
        assigneeUserId: "emp-2",
      },
      {
        taskStore: { reassignTask },
        findLatestSessionByPlanId: () => undefined,
        planSessionStore: { save, appendEvent },
        patchLatestAssignmentAssignee: () => ({}),
      },
    );
    expect(result.revisionEventWritten).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
