import { describe, expect, it, vi } from "vitest";
import { buildReassignTaskHandler } from "../../../src/agent/tools/reassign-task";

function makeStubDeps() {
  const taskRow = {
    taskId: "tid-1",
    taskNo: "TASK-1",
    planId: "plan-1",
    title: "Titled",
    status: "ASSIGNED" as const,
    initiatorUserId: "mgr-1",
    initiatorDepartment: "研发",
    managerUserId: "mgr-1",
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const reassignTask = vi.fn(() => ({ ...taskRow }));
  const getTaskDetail = vi.fn(() => ({
    task: { ...taskRow },
    subtasks: [
      {
        subtaskId: "task:plan-1:task_4",
        taskId: "tid-1",
        planId: "plan-1",
        title: "Sub",
        assigneeUserId: "emp-2",
        status: "ASSIGNED" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    events: [],
  }));
  const appendTaskEvent = vi.fn();
  return {
    deps: {
      taskStore: { reassignTask, getTaskDetail, appendTaskEvent } as any,
      planSessionStore: {
        save: vi.fn(),
        appendEvent: vi.fn(),
      } as any,
      findSessionByPlanId: () => ({
        chatKeyHash: "hash",
        planId: "plan-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        knownFacts: [],
        conversationHistory: [],
      }),
      patchAssignment: () => ({}),
    },
    reassignTask,
  };
}

describe("reassign_task tool", () => {
  it("plan-wide reassign when subtaskId omitted (legacy behavior)", () => {
    const { deps, reassignTask } = makeStubDeps();
    const handler = buildReassignTaskHandler(deps);
    const result = handler({
      actorUserId: "mgr-1",
      planId: "plan-1",
      assigneeUserId: "emp-2",
      note: "调配",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.revisionEventWritten).toBe(true);
    expect(result.scope).toBe("plan");
    expect(result.subtaskId).toBeNull();
    expect(reassignTask).toHaveBeenCalledWith(
      expect.objectContaining({ subtaskId: undefined }),
    );
  });

  it("single-subtask reassign when subtaskId passed (short form)", () => {
    const { deps, reassignTask } = makeStubDeps();
    const handler = buildReassignTaskHandler(deps);
    const result = handler({
      actorUserId: "mgr-1",
      planId: "plan-1",
      assigneeUserId: "emp-2",
      subtaskId: "task_4",
      note: "原负责人调走",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("subtask");
    expect(result.subtaskId).toBe("task_4");
    expect(reassignTask).toHaveBeenCalledWith(
      expect.objectContaining({ subtaskId: "task_4" }),
    );
  });

  it("single-subtask reassign accepts full form task:{planId}:task_X", () => {
    const { deps, reassignTask } = makeStubDeps();
    const handler = buildReassignTaskHandler(deps);
    const fullId = "task:plan-1:task_4";
    const result = handler({
      actorUserId: "mgr-1",
      planId: "plan-1",
      assigneeUserId: "emp-2",
      subtaskId: fullId,
    }) as any;
    expect(result.scope).toBe("subtask");
    expect(result.subtaskId).toBe(fullId);
    expect(reassignTask).toHaveBeenCalledWith(
      expect.objectContaining({ subtaskId: fullId }),
    );
  });

  it("rejects when required fields are missing", () => {
    const { deps } = makeStubDeps();
    const handler = buildReassignTaskHandler(deps);
    expect(() =>
      handler({ actorUserId: "mgr-1", planId: "", assigneeUserId: "emp-2" }),
    ).toThrow(/required/);
  });

  it("fires notifyReassignedAssignee when notifier and getContact are provided", async () => {
    const notifyReassignedAssignee = vi.fn(async () => ({
      enabled: false,
      success: [],
      failed: [],
    }));
    const { deps } = makeStubDeps();
    const handler = buildReassignTaskHandler({
      ...deps,
      notifier: { notifyPublishedTask: vi.fn(), notifyReassignedAssignee } as any,
      getContact: () => ({ unionId: "u-1" }),
    });
    handler({
      actorUserId: "mgr-1",
      planId: "plan-1",
      assigneeUserId: "emp-2",
      subtaskId: "task_4",
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(notifyReassignedAssignee).toHaveBeenCalled();
    expect(notifyReassignedAssignee.mock.calls[0][0].scope).toBe("subtask");
  });
});
