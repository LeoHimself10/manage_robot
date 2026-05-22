import { describe, expect, it } from "vitest";
import { stabilizeDraftTaskIds } from "../../../src/agent/draft-stabilize";
import { reconcileAssignmentWithDraft } from "../../../src/agent/assignment/reconcile-assignment";
import { extractLightAssignment } from "../../../src/agent/assignment/light-assignment";
import { findDraftTaskIndex } from "../../../src/agent/draft-task-ids";
import { fingerprintTask } from "../../../src/agent/draft-fingerprint";
import {
  assertDueAtCoverage,
  assertNoDuplicateTaskIds,
  assertOrdinalResolvesToDisplayIndex,
  assertRowAtDisplayIndex,
  assertSplitRowsInheritDueAt,
} from "../../../scripts/eval-assignment-assertions";

function taskDueAt(task: Record<string, unknown>): string {
  const tn = task.timeNode as { dueAt?: string } | undefined;
  return String(tn?.dueAt ?? "").trim();
}

describe("assignment gate invariants (deterministic)", () => {
  it("stabilizeDraftTaskIds preserves fingerprint-matched ids after split", () => {
    const previous = {
      tasks: [
        { id: "task_1", title: "Big", objective: "big", timeNode: { dueAt: "2026-06-10" } },
        { id: "task_2", title: "Second", objective: "second" },
      ],
    };
    const redraft = {
      tasks: [
        { title: "Part A", objective: "split-a" },
        { title: "Part B", objective: "split-b" },
        { id: "task_2", title: "Second", objective: "second" },
      ],
    };
    const stabilized = stabilizeDraftTaskIds(redraft, previous);
    const ids = (stabilized.tasks as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const keptSecond = (stabilized.tasks as Array<Record<string, unknown>>)[2]!;
    expect(String(keptSecond.id ?? "").trim().length).toBeGreaterThan(0);
    expect(fingerprintTask(keptSecond)).toBe(fingerprintTask({ title: "Second", objective: "second" }));
  });

  it("stabilizeDraftTaskIds does not blind inherit by display index", () => {
    const previous = {
      tasks: [
        { id: "task_1", title: "A", objective: "a" },
        { id: "task_2", title: "B", objective: "b" },
      ],
    };
    const redraft = {
      tasks: [
        { title: "New first", objective: "new" },
        { title: "B", objective: "b" },
      ],
    };
    const stabilized = stabilizeDraftTaskIds(redraft, previous);
    const ids = (stabilized.tasks as Array<{ id: string }>).map((t) => t.id);
    expect(ids[1]).toBe("task_2");
    expect(fingerprintTask((stabilized.tasks as Array<Record<string, unknown>>)[1]!)).toBe(
      fingerprintTask({ title: "B", objective: "b" }),
    );
  });

  it("reconcile inherits parent dueAt on positional split rows", () => {
    const previousDraft = {
      tasks: [
        {
          id: "task_1",
          title: "样品清单核对",
          objective: "核对",
          timeNode: { dueAt: "2026-06-10" },
        },
        { id: "task_2", title: "包装材料准备", objective: "包材" },
      ],
    };
    const currentDraft = {
      tasks: [
        { id: "task_1", title: "清单字段核对", objective: "split-a" },
        { id: "task_1a", title: "批次标签复核", objective: "split-b" },
        { id: "task_2", title: "包装材料准备", objective: "包材" },
      ],
    };
    reconcileAssignmentWithDraft({
      previousDraft,
      currentDraft,
      assignment: { assignments: [{ taskId: "task_1", primary: { userId: "u1" } }] },
    });
    expect(assertSplitRowsInheritDueAt(previousDraft, currentDraft, 1)).toEqual([]);
    expect(taskDueAt(currentDraft.tasks[0] as Record<string, unknown>)).toBe("2026-06-10");
    expect(taskDueAt(currentDraft.tasks[1] as Record<string, unknown>)).toBe("2026-06-10");
  });

  it("ordinal 任务2 hits display row 2 even when task_2 id is on row 3", () => {
    const tasks = [
      { id: "task_1", title: "Split A" },
      { id: "task_1a", title: "Split B" },
      { id: "task_2", title: "Second original" },
    ];
    expect(findDraftTaskIndex(tasks, "任务2")).toBe(1);
    expect(assertOrdinalResolvesToDisplayIndex({ tasks }, "任务2", 2)).toEqual([]);
    expect(assertOrdinalResolvesToDisplayIndex({ tasks }, "任务3", 3)).toEqual([]);
  });

  it("extractLightAssignment rejects partial coverage when requireFullCoverage", () => {
    const result = extractLightAssignment({
      rawAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "u1", displayName: "A" } }],
      },
      planId: "p1",
      traceId: "t1",
      modelName: "test",
      taskIds: ["task_1", "task_2"],
      employees: [
        { userId: "u1", displayName: "A" },
        { userId: "u2", displayName: "B" },
      ],
      requireFullCoverage: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/partial|missing|coverage/i);
  });

  it("assertNaturalUserMessage rejects tool names in user script", async () => {
    const { assertNaturalUserMessage } = await import("../../../scripts/dingtalk-turn-eval-harness");
    expect(assertNaturalUserMessage("请 bulk_assign_tasks 一次覆盖")).toHaveLength(1);
    expect(assertNaturalUserMessage("任务2改成5月28日截止")).toEqual([]);
  });

  it("assert helpers catch missing dueAt and duplicate ids", () => {
    const draft = {
      tasks: [
        { id: "task_1", title: "A" },
        { id: "task_1", title: "dup" },
        { id: "task_2", title: "B", timeNode: { dueAt: "2026-06-01" } },
      ],
    };
    expect(assertNoDuplicateTaskIds(draft)).toHaveLength(1);
    const cov = assertDueAtCoverage(draft, 0.5);
    expect(cov.ratio).toBeCloseTo(1 / 3);
    expect(assertRowAtDisplayIndex(draft, 3, { dueAt: "2026-06-01" })).toEqual([]);
    expect(assertRowAtDisplayIndex(draft, 1, { dueAt: "2026-06-01" })).toHaveLength(1);
  });
});
