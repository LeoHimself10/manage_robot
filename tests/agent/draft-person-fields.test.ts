import { describe, expect, it } from "vitest";
import {
  normalizeDraftTasksForSession,
  stripDeprecatedPlanningFieldsOnTask,
} from "../../src/agent/draft-person-fields";

describe("stripDeprecatedPlanningFieldsOnTask", () => {
  it("removes deprecated planning fields and keeps execution core", () => {
    const out = stripDeprecatedPlanningFieldsOnTask({
      id: "task_1",
      title: "T",
      objective: "O",
      feedbackFrequency: "每周",
      inputMaterials: ["a"],
      collaborators: ["u2"],
      risksAndOpenQuestions: ["r"],
      scope: { inScope: ["x"], outOfScope: ["y"] },
      timeNode: { dueAt: "2026-06-01", checkpoints: ["M1"] },
      actions: ["act"],
      dependencyTaskIds: ["task_0"],
    });
    expect(out.feedbackFrequency).toBeUndefined();
    expect(out.inputMaterials).toBeUndefined();
    expect(out.risksAndOpenQuestions).toBeUndefined();
    expect(out.scope).toBeUndefined();
    expect(out.timeNode).toEqual({ dueAt: "2026-06-01" });
    expect(out.actions).toEqual(["act"]);
    expect(out.dependencyTaskIds).toEqual(["task_0"]);
  });
});

describe("normalizeDraftTasksForSession", () => {
  it("strips person fields from draft.tasks", () => {
    const draft = normalizeDraftTasksForSession({
      title: "P",
      tasks: [
        {
          id: "task_1",
          title: "T",
          assigneeUserId: "u1",
          collaborators: ["c"],
          feedbackFrequency: "每日",
        },
      ],
    });
    const t = (draft.tasks as Array<Record<string, unknown>>)[0];
    expect(t.assigneeUserId).toBeUndefined();
    expect(t.collaborators).toBeUndefined();
    expect(t.feedbackFrequency).toBeUndefined();
  });
});
