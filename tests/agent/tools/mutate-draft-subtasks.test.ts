import { describe, expect, it } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import {
  buildAddDraftSubtaskHandler,
  buildRemoveDraftSubtaskHandler,
} from "../../../src/agent/tools/mutate-draft-subtasks";

function sessionWithDraft(tasks: Array<Record<string, unknown>>): PlanSession {
  return {
    planId: "plan-1",
    latestDraft: {
      title: "测试",
      tasks,
    },
    latestAssignment: {
      assignments: tasks.map((t) => ({
        taskId: String(t.id),
        primary: { userId: "u1", displayName: "张三" },
      })),
    },
  } as PlanSession;
}

describe("mutate-draft-subtasks", () => {
  it("add_draft_subtask appends with new task id", () => {
    const session = sessionWithDraft([
      { id: "task_1", title: "A", objective: "a" },
    ]);
    const out = buildAddDraftSubtaskHandler({ currentSession: session })({
      title: "B",
      objective: "b",
    }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    const tasks = (session.latestDraft as { tasks: Array<{ id: string; title: string }> }).tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[1]?.title).toBe("B");
    expect(String(tasks[1]?.id)).toMatch(/^task_/);
  });

  it("remove_draft_subtask removes task and assignment row", () => {
    const session = sessionWithDraft([
      { id: "task_1", title: "A", objective: "a", dependencyTaskIds: [] },
      { id: "task_2", title: "B", objective: "b", dependencyTaskIds: ["task_1"] },
    ]);
    const out = buildRemoveDraftSubtaskHandler({ currentSession: session })({
      subtaskId: "task_2",
    }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    const tasks = (session.latestDraft as { tasks: Array<{ id: string }> }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task_1");
    const assignments = (
      session.latestAssignment as { assignments: Array<{ taskId: string }> }
    ).assignments;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.taskId).toBe("task_1");
  });

  it("remove_draft_subtask rejects deleting last task", () => {
    const session = sessionWithDraft([{ id: "task_1", title: "A" }]);
    const out = buildRemoveDraftSubtaskHandler({ currentSession: session })({
      subtaskId: "task_1",
    }) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("last_subtask");
  });
});
