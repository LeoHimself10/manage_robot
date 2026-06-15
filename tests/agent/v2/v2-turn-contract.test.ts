import { describe, expect, it } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import {
  snapshotTurnState,
  restoreFromSnapshot,
  verifyRetryCommit,
  isRetryKindBlockedByGate,
  RETRY_KIND_GATES,
  type TurnStateSnapshot,
} from "../../../src/agent/v2/turn-contract";

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "p1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationHistory: [],
    knownFacts: [],
    ...overrides,
  };
}

function draftWithTasks(n: number): Record<string, unknown> {
  return {
    title: "草案",
    tasks: Array.from({ length: n }, (_, i) => ({
      id: `task_${i + 1}`,
      title: `子任务${i + 1}`,
    })),
  };
}

function assignmentForTasks(taskIds: string[]): Record<string, unknown> {
  return {
    assignments: taskIds.map((taskId) => ({
      taskId,
      primary: { userId: `user_${taskId}` },
    })),
  };
}

// ---------------------------------------------------------------------------
// snapshotTurnState
// ---------------------------------------------------------------------------

describe("snapshotTurnState", () => {
  it("captures task count and full coverage", () => {
    const draft = draftWithTasks(3);
    const assignment = assignmentForTasks(["task_1", "task_2", "task_3"]);
    const snap = snapshotTurnState(
      makeSession({ latestDraft: draft, latestAssignment: assignment }),
    );
    expect(snap.taskCount).toBe(3);
    expect(snap.coverage).toEqual({ total: 3, covered: 3, missingTaskIds: [] });
  });

  it("captures partial coverage", () => {
    const draft = draftWithTasks(4);
    const assignment = assignmentForTasks(["task_1", "task_2"]);
    const snap = snapshotTurnState(
      makeSession({ latestDraft: draft, latestAssignment: assignment }),
    );
    expect(snap.taskCount).toBe(4);
    expect(snap.coverage.covered).toBe(2);
    expect(snap.coverage.total).toBe(4);
  });

  it("deep-copies draft so mutations do not affect snapshot", () => {
    const draft = draftWithTasks(2);
    const session = makeSession({ latestDraft: draft });
    const snap = snapshotTurnState(session);
    // Mutate session after snapshot
    (session.latestDraft as { tasks: { title: string }[] }).tasks[0].title = "changed";
    expect((snap.latestDraft?.tasks as { title: string }[])[0].title).toBe("子任务1");
  });

  it("handles no draft gracefully", () => {
    const snap = snapshotTurnState(makeSession());
    expect(snap.taskCount).toBe(0);
    expect(snap.latestDraft).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// restoreFromSnapshot
// ---------------------------------------------------------------------------

describe("restoreFromSnapshot", () => {
  it("restores latestDraft and latestAssignment", () => {
    const original = draftWithTasks(3);
    const assignment = assignmentForTasks(["task_1", "task_2", "task_3"]);
    const session = makeSession({ latestDraft: original, latestAssignment: assignment });
    const snap = snapshotTurnState(session);

    // Simulate post-retry mutation
    const corrupted = makeSession({
      ...session,
      latestDraft: draftWithTasks(5),
      latestAssignment: undefined,
    });
    const restored = restoreFromSnapshot(corrupted, snap);
    expect(
      (restored.latestDraft as { tasks: unknown[] }).tasks.length,
    ).toBe(3);
    expect(restored.latestAssignment).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// verifyRetryCommit — invariant matrix
// ---------------------------------------------------------------------------

describe("verifyRetryCommit", () => {
  function snapWithCoverage(total: number, covered: number): TurnStateSnapshot {
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: `task_${i + 1}`,
      title: `t${i + 1}`,
    }));
    const assignedIds = tasks.slice(0, covered).map((t) => t.id);
    const latestDraft = { title: "d", tasks };
    const latestAssignment = assignmentForTasks(assignedIds);
    return {
      latestDraft,
      latestAssignment,
      taskCount: total,
      coverage: { total, covered, missingTaskIds: [] },
    };
  }

  it("allows when coverage and task count unchanged (assign kind)", () => {
    const pre = snapWithCoverage(3, 2);
    const session = makeSession({
      latestDraft: draftWithTasks(3),
      latestAssignment: assignmentForTasks(["task_1", "task_2", "task_3"]),
    });
    const result = verifyRetryCommit(pre, session, "assign");
    expect(result.commit).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects when coverage decreases (R5 cascade scenario)", () => {
    // Pre: 7/7 tasks assigned
    const pre = snapWithCoverage(7, 7);
    // Post: 9 tasks, only 7 assigned (split_draft_task added 2 unassigned rows)
    const postTasks = Array.from({ length: 9 }, (_, i) => ({
      id: `task_${i + 1}`,
      title: `t${i + 1}`,
    }));
    const session = makeSession({
      latestDraft: { title: "d", tasks: postTasks },
      latestAssignment: assignmentForTasks(postTasks.slice(0, 7).map((t) => t.id)),
    });
    const result = verifyRetryCommit(pre, session, "split");
    expect(result.commit).toBe(false);
    expect(result.violations.some((v) => v.startsWith("coverage_decreased"))).toBe(true);
  });

  it("rejects when task count increases for assign kind", () => {
    const pre = snapWithCoverage(3, 3);
    const session = makeSession({
      latestDraft: draftWithTasks(5), // gained 2 tasks — not allowed for assign
      latestAssignment: assignmentForTasks(["task_1", "task_2", "task_3", "task_4", "task_5"]),
    });
    const result = verifyRetryCommit(pre, session, "assign");
    expect(result.commit).toBe(false);
    expect(result.violations.some((v) => v.startsWith("task_count_changed"))).toBe(true);
  });

  it("allows task count increase for split kind", () => {
    const pre = snapWithCoverage(3, 3);
    const session = makeSession({
      latestDraft: draftWithTasks(4),
      latestAssignment: assignmentForTasks(["task_1", "task_2", "task_3", "task_4"]),
    });
    const result = verifyRetryCommit(pre, session, "split");
    expect(result.commit).toBe(true);
  });

  it("allows task count increase for draft kind", () => {
    const pre: TurnStateSnapshot = {
      latestDraft: undefined,
      latestAssignment: undefined,
      taskCount: 0,
      coverage: { total: 0, covered: 0, missingTaskIds: [] },
    };
    const session = makeSession({ latestDraft: draftWithTasks(5) });
    const result = verifyRetryCommit(pre, session, "draft");
    expect(result.commit).toBe(true);
  });

  it("rejects when task count decreases for patch kind", () => {
    const pre = snapWithCoverage(4, 4);
    const session = makeSession({
      latestDraft: draftWithTasks(2), // 2 tasks removed
      latestAssignment: assignmentForTasks(["task_1", "task_2"]),
    });
    const result = verifyRetryCommit(pre, session, "patch");
    expect(result.commit).toBe(false);
  });

  it("skips coverage check when pre.total is 0", () => {
    const pre: TurnStateSnapshot = {
      latestDraft: undefined,
      latestAssignment: undefined,
      taskCount: 0,
      coverage: { total: 0, covered: 0, missingTaskIds: [] },
    };
    const session = makeSession({ latestDraft: draftWithTasks(3) });
    const result = verifyRetryCommit(pre, session, "draft");
    expect(result.commit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRetryKindBlockedByGate — Rule 1 skip matrix
// ---------------------------------------------------------------------------

describe("isRetryKindBlockedByGate", () => {
  it("auto:whole_table_redraft blocks split and patch", () => {
    expect(isRetryKindBlockedByGate("split", "auto:whole_table_redraft")).toBe(true);
    expect(isRetryKindBlockedByGate("patch", "auto:whole_table_redraft")).toBe(true);
    expect(isRetryKindBlockedByGate("draft", "auto:whole_table_redraft")).toBe(false);
  });

  it("row_split_forced blocks assign, roster_assign, publish", () => {
    expect(isRetryKindBlockedByGate("assign", "row_split_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("roster_assign", "row_split_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("publish", "row_split_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("split", "row_split_forced")).toBe(false);
  });

  it("patch_required blocks split and draft", () => {
    expect(isRetryKindBlockedByGate("split", "patch_required")).toBe(true);
    expect(isRetryKindBlockedByGate("draft", "patch_required")).toBe(true);
    expect(isRetryKindBlockedByGate("patch", "patch_required")).toBe(false);
  });

  it("publish_forced blocks most retry kinds", () => {
    const blocked = ["split", "patch", "draft", "assign", "roster_assign"] as const;
    for (const kind of blocked) {
      expect(isRetryKindBlockedByGate(kind, "publish_forced")).toBe(true);
    }
    expect(isRetryKindBlockedByGate("publish", "publish_forced")).toBe(false);
  });

  it("roster_assign_forced blocks split, patch, draft, publish", () => {
    expect(isRetryKindBlockedByGate("split", "roster_assign_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("patch", "roster_assign_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("draft", "roster_assign_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("publish", "roster_assign_forced")).toBe(true);
    expect(isRetryKindBlockedByGate("assign", "roster_assign_forced")).toBe(false);
    expect(isRetryKindBlockedByGate("roster_assign", "roster_assign_forced")).toBe(false);
  });

  it("unknown gate reason does not block anything", () => {
    expect(isRetryKindBlockedByGate("split", "auto:no_match")).toBe(false);
    expect(isRetryKindBlockedByGate("publish", "auto:no_trusted_actor")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RETRY_KIND_GATES — each kind has a valid gate
// ---------------------------------------------------------------------------

describe("RETRY_KIND_GATES", () => {
  const kinds = [
    "scope_switch",
    "roster_assign",
    "publish",
    "split",
    "patch",
    "draft",
    "assign",
  ] as const;

  for (const kind of kinds) {
    it(`${kind} gate has toolChoice and non-empty frontier`, () => {
      const gate = RETRY_KIND_GATES[kind];
      expect(gate.toolChoice).toBeDefined();
      expect(gate.toolChoice).not.toBe("auto");
      expect(gate.frontier.length).toBeGreaterThan(0);
      expect(gate.reason).toContain("retry:");
    });
  }
});
