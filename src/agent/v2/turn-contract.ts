/**
 * Turn Contract: snapshot, invariant verification, and RETRY_KIND_GATES.
 *
 * Implements the three rules of transactional retries:
 *   Rule 1 – isRetryKindBlockedByGate: skip retries incompatible with the first-run gate decision.
 *   Rule 2 – RETRY_KIND_GATES: every retry kind carries a narrow explicit gate (no bare `auto`).
 *   Rule 3 – verifyRetryCommit: state changes are monotonic; violations trigger rollback.
 */
import type { PlanSession } from "../../infra/plan-session-store";
import { getAssignmentCoverage } from "../assignment/merge-assignment";
import type { V2ToolChoice } from "./tool-choice-gate";

// ---------------------------------------------------------------------------
// RetryKind
// ---------------------------------------------------------------------------

export type RetryKind =
  | "scope_switch"
  | "roster_assign"
  | "publish"
  | "split"
  | "patch"
  | "draft"
  | "assign";

// ---------------------------------------------------------------------------
// State snapshot (Rule 3 prerequisite)
// ---------------------------------------------------------------------------

export interface TurnStateSnapshot {
  latestDraft: Record<string, unknown> | undefined;
  latestAssignment: Record<string, unknown> | undefined;
  taskCount: number;
  coverage: { covered: number; total: number; missingTaskIds: string[] };
}

function countTasks(draft: Record<string, unknown> | undefined): number {
  const tasks = (draft as { tasks?: unknown } | undefined)?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

/** Deep-copy the mutable parts of session state into a snapshot. */
export function snapshotTurnState(session: PlanSession): TurnStateSnapshot {
  const latestDraft = session.latestDraft
    ? (JSON.parse(JSON.stringify(session.latestDraft)) as Record<string, unknown>)
    : undefined;
  const latestAssignment = session.latestAssignment
    ? (JSON.parse(JSON.stringify(session.latestAssignment)) as Record<string, unknown>)
    : undefined;
  const taskCount = countTasks(latestDraft);
  const coverage = getAssignmentCoverage(latestDraft, latestAssignment);
  return { latestDraft, latestAssignment, taskCount, coverage };
}

/** Restore a session to a previously taken snapshot (rollback path). */
export function restoreFromSnapshot(
  session: PlanSession,
  snapshot: TurnStateSnapshot,
): PlanSession {
  return {
    ...session,
    latestDraft: snapshot.latestDraft as PlanSession["latestDraft"],
    latestAssignment: snapshot.latestAssignment as PlanSession["latestAssignment"],
  };
}

// ---------------------------------------------------------------------------
// Rule 3: verify-then-commit invariants
// ---------------------------------------------------------------------------

export interface VerifyRetryCommitResult {
  commit: boolean;
  violations: string[];
}

/**
 * Check whether the retry result is safe to commit.
 *
 * Invariants:
 *  1. Assignment coverage must not decrease (±1% tolerance for rounding).
 *  2. Task count must not change unless the retry kind is `split` or `draft`
 *     (or `scope_switch` which can legitimately produce a fresh draft).
 */
export function verifyRetryCommit(
  pre: TurnStateSnapshot,
  session: PlanSession,
  retryKind: RetryKind,
): VerifyRetryCommitResult {
  const violations: string[] = [];

  const postDraft = session.latestDraft as Record<string, unknown> | undefined;
  const postAssignment = session.latestAssignment as Record<string, unknown> | undefined;
  const postCoverage = getAssignmentCoverage(postDraft, postAssignment);

  // Invariant 1: coverage must not regress
  if (pre.coverage.total > 0 && postCoverage.total > 0) {
    const preRate = pre.coverage.covered / pre.coverage.total;
    const postRate = postCoverage.covered / postCoverage.total;
    if (postRate < preRate - 0.01) {
      violations.push(
        `coverage_decreased: ${pre.coverage.covered}/${pre.coverage.total}` +
          ` → ${postCoverage.covered}/${postCoverage.total}`,
      );
    }
  }

  // Invariant 2: task count must be stable except for split/draft/scope_switch
  const postTaskCount = countTasks(postDraft);
  const taskCountCanGrow = retryKind === "split" || retryKind === "draft" || retryKind === "scope_switch";
  if (!taskCountCanGrow && pre.taskCount > 0 && postTaskCount !== pre.taskCount) {
    violations.push(
      `task_count_changed: ${pre.taskCount} → ${postTaskCount} (kind=${retryKind})`,
    );
  }

  return { commit: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Rule 2: narrow explicit gate per retry kind
// ---------------------------------------------------------------------------

export interface ExplicitGate {
  toolChoice: V2ToolChoice;
  frontier: string[];
  reason: string;
}

/**
 * Each retry kind carries its own narrow gate so that retry runs are never
 * unconstrained (old `disableToolChoiceGate` anti-pattern).
 */
export const RETRY_KIND_GATES: Record<RetryKind, ExplicitGate> = {
  assign: {
    toolChoice: { type: "function", function: { name: "bulk_assign_tasks" } },
    frontier: ["bulk_assign_tasks", "search_employees"],
    reason: "retry:assign_forced",
  },
  roster_assign: {
    toolChoice: { type: "function", function: { name: "assign_from_roster" } },
    frontier: ["assign_from_roster"],
    reason: "retry:roster_assign_forced",
  },
  publish: {
    toolChoice: { type: "function", function: { name: "publish_task" } },
    frontier: ["publish_task"],
    reason: "retry:publish_forced",
  },
  split: {
    toolChoice: { type: "function", function: { name: "split_draft_task" } },
    frontier: ["split_draft_task"],
    reason: "retry:split_forced",
  },
  patch: {
    toolChoice: "required",
    frontier: ["update_draft_task", "bulk_assign_tasks", "search_employees"],
    reason: "retry:patch_required",
  },
  draft: {
    toolChoice: "required",
    frontier: ["replace_draft", "update_draft_task", "add_draft_subtask"],
    reason: "retry:draft_required",
  },
  scope_switch: {
    toolChoice: "required",
    frontier: ["replace_draft", "update_draft_task", "add_draft_subtask"],
    reason: "retry:scope_switch_required",
  },
};

// ---------------------------------------------------------------------------
// Rule 1: gate-consistent skip matrix
// ---------------------------------------------------------------------------

/**
 * Maps first-run gate reasons to the retry kinds they block.
 * The gate reason encodes the first-run intent; a retry that contradicts it
 * must be skipped to prevent cascading failures (e.g. R5 split misfire).
 */
const GATE_REASON_BLOCKED_KINDS: Record<string, RetryKind[]> = {
  "auto:whole_table_redraft": ["split", "patch"],
  "row_split_forced": ["assign", "roster_assign", "publish"],
  "patch_required": ["split", "draft"],
  "publish_forced": ["split", "patch", "draft", "assign", "roster_assign"],
  "roster_assign_forced": ["split", "patch", "draft", "publish"],
};

/**
 * Returns true when the given retryKind is incompatible with the gate reason
 * produced on the first run (Rule 1).
 */
export function isRetryKindBlockedByGate(retryKind: RetryKind, gateReason: string): boolean {
  const blockedKinds = GATE_REASON_BLOCKED_KINDS[gateReason];
  if (blockedKinds) return blockedKinds.includes(retryKind);
  return false;
}
