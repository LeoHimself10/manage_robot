import { getAssignmentCoverage } from "../src/agent/assignment/merge-assignment";
import { publishResultSucceeded } from "../src/agent/publish-helpers";
import { canonicalMainChatKey } from "../src/web/canonical-main-session";
import { hashChatKey } from "../src/infra/plan-session-store";
import type { PlanSession } from "../src/infra/plan-session-store";
import { draftTasks, taskDueAt } from "./eval-assignment-assertions";

export function assertCanonicalHash(session: PlanSession, userId: string): string[] {
  const expected = hashChatKey(canonicalMainChatKey(userId));
  if (session.chatKeyHash !== expected) {
    return [`chatKeyHash ${session.chatKeyHash} != canonical ${expected}`];
  }
  return [];
}

export function assertDraftTitle(
  draft: Record<string, unknown> | undefined,
  expected: string,
): string[] {
  if (String(draft?.title ?? "") !== expected) {
    return [`draft.title=${String(draft?.title ?? "")} expected=${expected}`];
  }
  return [];
}

export function assertTaskDueAtById(
  draft: Record<string, unknown> | undefined,
  taskId: string,
  dueAt: string,
): string[] {
  const tasks = draftTasks(draft);
  const row = tasks.find((t) => String(t.id ?? "").trim() === taskId);
  if (!row) return [`missing task ${taskId}`];
  const got = taskDueAt(row);
  if (got !== dueAt) return [`${taskId}.dueAt=${got} expected=${dueAt}`];
  return [];
}

export function assertAssignmentCoverageMin(
  draft: Record<string, unknown> | undefined,
  assignment: Record<string, unknown> | undefined,
  minRatio: number,
): string[] {
  const cov = getAssignmentCoverage(draft, assignment);
  const ratio = cov.total > 0 ? cov.covered / cov.total : 0;
  if (ratio + 1e-9 < minRatio) {
    return [
      `assignment coverage ${cov.covered}/${cov.total} missing=${cov.missingTaskIds.join(",")}`,
    ];
  }
  return [];
}

export function assertPublishTurn(input: {
  publishResult?: Record<string, unknown>;
  tools: string[];
}): string[] {
  const reasons: string[] = [];
  if (!input.tools.includes("publish_task")) {
    reasons.push("missing publish_task tool");
  }
  if (!publishResultSucceeded(input.publishResult)) {
    reasons.push(`publish not ok: ${JSON.stringify(input.publishResult ?? {})}`);
  }
  return reasons;
}

export function countFormalTasksForManager(
  list: Array<{ managerUserId?: string }>,
  managerUserId: string,
): number {
  return list.filter((t) => t.managerUserId === managerUserId).length;
}
