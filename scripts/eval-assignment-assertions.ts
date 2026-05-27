import type { PlanSession } from "../src/infra/plan-session-store";
import { getAssignmentCoverage } from "../src/agent/assignment/merge-assignment";
import { detectFalseAssign } from "../src/agent/assignment/false-assign";
import { findDraftTaskIndex } from "../src/agent/draft-task-ids";

export interface AssignmentCoverageResult {
  total: number;
  covered: number;
  ratio: number;
  missingTaskIds: string[];
}

export function draftTasks(draft: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!draft) return [];
  return Array.isArray(draft.tasks)
    ? (draft.tasks as Array<Record<string, unknown>>)
    : [];
}

export function taskDueAt(task: Record<string, unknown>): string {
  const tn = task.timeNode as { dueAt?: string } | undefined;
  return String(tn?.dueAt ?? "").trim();
}

export function assertAssignmentFullCoverage(
  draft: Record<string, unknown> | undefined,
  assignment: Record<string, unknown> | undefined,
): AssignmentCoverageResult {
  const cov = getAssignmentCoverage(draft, assignment);
  return {
    total: cov.total,
    covered: cov.covered,
    ratio: cov.total > 0 ? cov.covered / cov.total : 0,
    missingTaskIds: cov.missingTaskIds,
  };
}

export function assertDueAtCoverage(
  draft: Record<string, unknown> | undefined,
  minRatio: number,
): { ratio: number; missingIndexes: number[] } {
  const tasks = draftTasks(draft);
  if (tasks.length === 0) return { ratio: 0, missingIndexes: [] };
  const missingIndexes: number[] = [];
  for (let i = 0; i < tasks.length; i += 1) {
    if (!taskDueAt(tasks[i]!)) missingIndexes.push(i + 1);
  }
  const ratio = (tasks.length - missingIndexes.length) / tasks.length;
  return { ratio, missingIndexes };
}

export function assertMinDueAtCoverage(
  draft: Record<string, unknown> | undefined,
  minRatio: number,
): string[] {
  const { ratio, missingIndexes } = assertDueAtCoverage(draft, minRatio);
  if (ratio + 1e-9 < minRatio) {
    return [`dueAt coverage ${ratio.toFixed(2)}<${minRatio} missing rows=${missingIndexes.join(",")}`];
  }
  return [];
}

export function assertNoDuplicateTaskIds(draft: Record<string, unknown> | undefined): string[] {
  const tasks = draftTasks(draft);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of tasks) {
    const id = String(t.id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  return dupes.length ? [`duplicate task ids: ${dupes.join(",")}`] : [];
}

export function assertTasksIncreasedBy(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  minIncrease: number,
): string[] {
  const b = draftTasks(before).length;
  const a = draftTasks(after).length;
  if (a < b + minIncrease) {
    return [`task count ${a} did not increase by ${minIncrease} (was ${b})`];
  }
  return [];
}

export function assertRowAtDisplayIndex(
  draft: Record<string, unknown> | undefined,
  displayIndex1: number,
  expect: { dueAt?: string; titleContains?: string },
): string[] {
  const tasks = draftTasks(draft);
  const idx = displayIndex1 - 1;
  if (idx < 0 || idx >= tasks.length) {
    return [`display row ${displayIndex1} out of range (tasks=${tasks.length})`];
  }
  const row = tasks[idx]!;
  const reasons: string[] = [];
  if (expect.dueAt !== undefined) {
    const got = taskDueAt(row);
    if (got !== expect.dueAt) {
      reasons.push(`row ${displayIndex1} dueAt=${got || "(empty)"} expected ${expect.dueAt}`);
    }
  }
  if (expect.titleContains !== undefined) {
    const title = String(row.title ?? "");
    if (!title.includes(expect.titleContains)) {
      reasons.push(`row ${displayIndex1} title missing "${expect.titleContains}"`);
    }
  }
  return reasons;
}

export function assigneeForTaskId(
  assignment: Record<string, unknown> | undefined,
  taskId: string,
): { userId: string; displayName: string } | undefined {
  const rows = Array.isArray(assignment?.assignments)
    ? (assignment!.assignments as Array<Record<string, unknown>>)
    : [];
  const row = rows.find((r) => String(r.taskId ?? "").trim() === taskId);
  const primary = row?.primary as { userId?: string; displayName?: string } | undefined;
  const userId = String(primary?.userId ?? "").trim();
  if (!userId) return undefined;
  return { userId, displayName: String(primary?.displayName ?? "").trim() };
}

export function assertAssigneeAtDisplayIndex(
  draft: Record<string, unknown> | undefined,
  assignment: Record<string, unknown> | undefined,
  displayIndex1: number,
  expect: { userId?: string; displayNameContains?: string },
): string[] {
  const tasks = draftTasks(draft);
  const idx = displayIndex1 - 1;
  if (idx < 0 || idx >= tasks.length) {
    return [`display row ${displayIndex1} out of range for assignee check`];
  }
  const taskId = String(tasks[idx]!.id ?? "").trim();
  const assignee = assigneeForTaskId(assignment, taskId);
  const reasons: string[] = [];
  if (expect.userId !== undefined) {
    if (assignee?.userId !== expect.userId) {
      reasons.push(
        `row ${displayIndex1} (${taskId}) assignee=${assignee?.userId ?? "(none)"} expected ${expect.userId}`,
      );
    }
  }
  if (expect.displayNameContains !== undefined) {
    const name = assignee?.displayName ?? "";
    if (!name.includes(expect.displayNameContains)) {
      reasons.push(
        `row ${displayIndex1} assignee name "${name}" missing "${expect.displayNameContains}"`,
      );
    }
  }
  return reasons;
}

/** 任务2 等序号应命中第 N 行，而非 task_N 字面 id（若 id 已漂移）。 */
export function assertOrdinalResolvesToDisplayIndex(
  draft: Record<string, unknown> | undefined,
  ordinalToken: string,
  expectedDisplayIndex1: number,
): string[] {
  const tasks = draftTasks(draft);
  const idx = findDraftTaskIndex(tasks, ordinalToken);
  const expected0 = expectedDisplayIndex1 - 1;
  if (idx !== expected0) {
    return [`ordinal "${ordinalToken}" resolved index ${idx} expected display row ${expectedDisplayIndex1}`];
  }
  return [];
}

export function assertNoPartialAssignmentInSession(session: PlanSession): string[] {
  return assertAssignmentFullCoverage(
    session.latestDraft as Record<string, unknown> | undefined,
    session.latestAssignment as Record<string, unknown> | undefined,
  ).missingTaskIds;
}

export function assertNoToolError(
  tools: ReadonlyArray<{ toolName?: string; ok?: boolean; reason?: string } | string>,
  reason: string,
): boolean {
  for (const t of tools) {
    if (typeof t === "string") continue;
    if (String(t.reason ?? "") === reason) return false;
  }
  return true;
}

export function assertNoMaxTurnsExceeded(result: {
  stopReason?: string;
  toolInvocationNames?: string[];
}): boolean {
  if (String(result.stopReason ?? "").includes("max_turns")) return false;
  return true;
}

export function assertEvalNoFakeAssign(input: {
  userMessage: string;
  draft?: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  message: string;
  extractOk?: boolean;
}): boolean {
  return !detectFalseAssign({
    userMessage: input.userMessage,
    latestDraft: input.draft,
    latestAssignment: input.assignment,
    outboundMarkdown: input.message,
    hasFullAssignmentJson: input.extractOk,
  });
}

export function assertSplitRowsInheritDueAt(
  previousDraft: Record<string, unknown> | undefined,
  currentDraft: Record<string, unknown> | undefined,
  parentDisplayIndex1: number,
): string[] {
  const prevTasks = draftTasks(previousDraft);
  const curTasks = draftTasks(currentDraft);
  const pIdx = parentDisplayIndex1 - 1;
  if (pIdx < 0 || pIdx >= prevTasks.length) return ["parent row out of range"];
  const parentDue = taskDueAt(prevTasks[pIdx]!);
  if (!parentDue) return [];
  if (curTasks.length <= prevTasks.length) return [];
  const splitCount = curTasks.length - prevTasks.length + 1;
  for (let i = 0; i < splitCount; i += 1) {
    const row = curTasks[i]!;
    if (!taskDueAt(row)) {
      return [`split row ${i + 1} missing inherited dueAt (parent was ${parentDue})`];
    }
  }
  return [];
}

export function assertNoStaleAssigneeNamesInMarkdown(
  markdown: string,
  staleNames: readonly string[],
): string[] {
  const reasons: string[] = [];
  for (const name of staleNames) {
    const trimmed = String(name ?? "").trim();
    if (trimmed && markdown.includes(trimmed)) {
      reasons.push(`stale assignee name in markdown: ${trimmed}`);
    }
  }
  return reasons;
}

export function assertSessionAssignmentCleared(session: PlanSession): string[] {
  return session.latestAssignment ? ["expected session.latestAssignment to be undefined"] : [];
}

export function assertAssignmentPlanMatchesSession(session: PlanSession): string[] {
  const assignment = session.latestAssignment as { planId?: string } | undefined;
  const assignmentPlanId = String(assignment?.planId ?? "").trim();
  if (!assignmentPlanId) return [];
  if (assignmentPlanId !== session.planId) {
    return [`assignment.planId=${assignmentPlanId} !== session.planId=${session.planId}`];
  }
  return [];
}

export function assertScopeSwitchClearedAssignment(
  tools: readonly string[],
  preTurnPlanId: string,
  session: PlanSession,
): string[] {
  if (tools.includes("start_new_task")) {
    return assertSessionAssignmentCleared(session);
  }
  if (preTurnPlanId && session.planId && preTurnPlanId !== session.planId) {
    return assertSessionAssignmentCleared(session);
  }
  return [];
}
