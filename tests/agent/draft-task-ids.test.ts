import { describe, expect, it } from "vitest";
import { findDraftTaskIndex, resolveDraftTaskDisplayIndex } from "../../src/agent/draft-task-ids";

const tasks = [
  { id: "task_1", title: "First" },
  { id: "task_2", title: "Second" },
  { id: "task_3", title: "Third" },
];

describe("findDraftTaskIndex ordinal resolution", () => {
  it("resolves 任务2 to second row", () => {
    expect(findDraftTaskIndex(tasks, "任务2")).toBe(1);
    expect(findDraftTaskIndex(tasks, "第2条")).toBe(1);
    expect(findDraftTaskIndex(tasks, "#2")).toBe(1);
    expect(findDraftTaskIndex(tasks, "2")).toBe(1);
  });

  it("task_2 prefers display row 2 when id drifted after split", () => {
    const splitTasks = [
      { id: "task_1", title: "Split A" },
      { id: "task_1b", title: "Split B" },
      { id: "task_2", title: "Second original" },
    ];
    expect(findDraftTaskIndex(splitTasks, "task_2")).toBe(1);
    expect(findDraftTaskIndex(splitTasks, "task_3")).toBe(2);
  });

  it("task_2 still hits row when id stays on display row", () => {
    expect(findDraftTaskIndex(tasks, "task_2")).toBe(1);
  });

  it("resolveDraftTaskDisplayIndex matches display labels", () => {
    expect(resolveDraftTaskDisplayIndex(tasks, "任务2")).toBe(1);
    expect(resolveDraftTaskDisplayIndex(tasks, "task_3")).toBe(-1);
  });
});
