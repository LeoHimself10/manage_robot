import { describe, expect, it } from "vitest";
import { reconcileAssignmentWithDraft } from "../../../src/agent/assignment/reconcile-assignment";

describe("reconcileAssignmentWithDraft", () => {
  it("prunes assignment rows for removed tasks", () => {
    const result = reconcileAssignmentWithDraft({
      previousDraft: {
        tasks: [
          { id: "task_1", title: "A", objective: "a" },
          { id: "task_2", title: "B", objective: "b" },
        ],
      },
      currentDraft: {
        tasks: [{ id: "task_1", title: "A", objective: "a" }],
      },
      assignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "u1" } },
          { taskId: "task_2", primary: { userId: "u2" } },
        ],
      },
    });
    expect(result.assignment?.assignments).toHaveLength(1);
    expect((result.assignment?.assignments as Array<{ taskId: string }>)[0]?.taskId).toBe("task_1");
  });

  it("migrates assignment via fingerprint when task id changes", () => {
    const result = reconcileAssignmentWithDraft({
      previousDraft: {
        tasks: [{ id: "task_2", title: "Keep", objective: "same" }],
      },
      currentDraft: {
        tasks: [
          { id: "task_1", title: "New split", objective: "x" },
          { id: "task_3", title: "Keep", objective: "same" },
        ],
      },
      assignment: {
        assignments: [{ taskId: "task_2", primary: { userId: "u2" } }],
      },
    });
    const rows = result.assignment?.assignments as Array<{ taskId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe("task_3");
    expect(result.migratedTaskIds).toEqual([{ from: "task_2", to: "task_3" }]);
  });

  it("inherits parent dueAt on split and assigns to first split row", () => {
    const currentDraft = {
      tasks: [
        { id: "task_1", title: "Part A", objective: "split-a" },
        { id: "task_2", title: "Part B", objective: "split-b" },
        { id: "task_3", title: "Second", objective: "second" },
      ],
    };
    const result = reconcileAssignmentWithDraft({
      previousDraft: {
        tasks: [
          {
            id: "task_1",
            title: "Big",
            objective: "big",
            timeNode: { dueAt: "2026-06-01" },
          },
          { id: "task_2", title: "Second", objective: "second" },
        ],
      },
      currentDraft,
      assignment: {
        assignments: [{ taskId: "task_2", primary: { userId: "u2" } }],
      },
    });
    const rows = result.assignment?.assignments as Array<{ taskId: string; primary: { userId: string } }>;
    expect(rows.some((r) => r.taskId === "task_3" && r.primary.userId === "u2")).toBe(true);
    const splitA = currentDraft.tasks[0] as { timeNode?: { dueAt?: string } };
    expect(splitA.timeNode?.dueAt).toBe("2026-06-01");
  });
});
