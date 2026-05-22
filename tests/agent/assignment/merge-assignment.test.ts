import { describe, expect, it } from "vitest";
import { getAssignmentCoverage, mergeAssignmentRows } from "../../../src/agent/assignment/merge-assignment";

describe("mergeAssignmentRows", () => {
  it("upserts by taskId without dropping other rows", () => {
    const merged = mergeAssignmentRows(
      { assignments: [{ taskId: "task_1", primary: { userId: "u1" } }] },
      { assignments: [{ taskId: "task_2", primary: { userId: "u2" } }] },
    );
    const rows = merged.assignments as Array<{ taskId: string }>;
    expect(rows).toHaveLength(2);
  });
});

describe("getAssignmentCoverage", () => {
  it("reports missing assignees", () => {
    const cov = getAssignmentCoverage(
      { tasks: [{ id: "task_1" }, { id: "task_2" }] },
      { assignments: [{ taskId: "task_1", primary: { userId: "u1" } }] },
    );
    expect(cov.total).toBe(2);
    expect(cov.covered).toBe(1);
    expect(cov.missingTaskIds).toEqual(["task_2"]);
  });
});
