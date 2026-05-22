import { describe, expect, it } from "vitest";
import { buildBulkAssignTasksHandler } from "../../../src/agent/tools/bulk-assign-tasks";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSession(): PlanSession {
  const now = new Date().toISOString();
  return {
    planId: "plan_1",
    chatKeyHash: "hash",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    lastEmployeeSearchHits: [
      { userId: "u1", displayName: "张三", hitAt: now },
      { userId: "u2", displayName: "李四", hitAt: now },
    ],
    latestDraft: {
      tasks: [
        { id: "task_1", title: "A" },
        { id: "task_2", title: "B" },
      ],
    },
  } as unknown as PlanSession;
}

describe("bulk_assign_tasks", () => {
  it("writes all N rows in one call", () => {
    const session = makeSession();
    const handler = buildBulkAssignTasksHandler({ currentSession: session });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "u1" },
        { taskId: "task_2", assigneeUserId: "u2" },
      ],
    }) as { ok: boolean; assignedCount?: number };
    expect(result.ok).toBe(true);
    expect(result.assignedCount).toBe(2);
    const rows = (session.latestAssignment as { assignments: Array<{ taskId: string }> }).assignments;
    expect(rows).toHaveLength(2);
  });

  it("rejects partial coverage", () => {
    const session = makeSession();
    const handler = buildBulkAssignTasksHandler({ currentSession: session });
    const result = handler({
      assignments: [{ taskId: "task_1", assigneeUserId: "u1" }],
    }) as { ok: boolean; reason?: string; missingTaskIds?: string[] };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("partial_assignment");
    expect(result.missingTaskIds).toEqual(["task_2"]);
  });

  it("rejects assignee not from search", () => {
    const session = makeSession();
    const handler = buildBulkAssignTasksHandler({ currentSession: session });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "ghost" },
        { taskId: "task_2", assigneeUserId: "u2" },
      ],
    }) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("assignee_not_from_search");
  });
});
