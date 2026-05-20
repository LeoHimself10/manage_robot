import { createHash } from "node:crypto";
import type { PlanSession } from "../infra/plan-session-store";

export function hasPublishableDraftInSession(session: PlanSession): boolean {
  const draft = session.latestDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  const tasks = (draft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

/** Build prepare_publish_task args from session draft + assignment (scheme C). */
export function buildPreparePublishArgsFromSession(
  session: PlanSession,
): Record<string, unknown> | null {
  const draft = session.latestDraft;
  if (!hasPublishableDraftInSession(session)) return null;
  const draftObj = draft as Record<string, unknown>;
  const title = String(draftObj.title ?? "").trim();
  const description = String(draftObj.description ?? draftObj.summary ?? "").trim();
  if (!title || !description) return null;

  const assignByTaskId = new Map<string, { userId: string; collaborators?: string[] }>();
  const assignment = session.latestAssignment;
  if (assignment && typeof assignment === "object" && !Array.isArray(assignment)) {
    const rows = (assignment as { assignments?: unknown }).assignments;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const taskId = String(r.taskId ?? "").trim();
        const primary = r.primary as Record<string, unknown> | undefined;
        const userId = String(primary?.userId ?? "").trim();
        if (!taskId || !userId) continue;
        const collabRaw = r.collaborators;
        const collaborators = Array.isArray(collabRaw)
          ? collabRaw.map((c) => String(c ?? "").trim()).filter(Boolean)
          : undefined;
        assignByTaskId.set(taskId, { userId, collaborators });
      }
    }
  }

  const tasks = draftObj.tasks as Array<Record<string, unknown>>;
  const subtasks: Array<Record<string, unknown>> = [];
  for (const t of tasks) {
    const taskId = String(t.id ?? "").trim();
    const stTitle = String(t.title ?? "").trim();
    const assign = assignByTaskId.get(taskId);
    const assigneeUserId = assign?.userId ?? "";
    if (!taskId || !stTitle || !assigneeUserId) return null;
    const timeNode = t.timeNode as Record<string, unknown> | undefined;
    const dueAt = String(timeNode?.dueAt ?? "").trim() || undefined;
    subtasks.push({
      taskId,
      title: stTitle,
      assigneeUserId,
      objective: String(t.objective ?? "").trim() || undefined,
      dueAt,
      feedbackFrequency: String(t.feedbackFrequency ?? "").trim() || undefined,
      deliverables: Array.isArray(t.deliverables) ? t.deliverables : undefined,
      completionCriteria: Array.isArray(t.completionCriteria) ? t.completionCriteria : undefined,
      dependencyTaskIds: Array.isArray(t.dependencyTaskIds) ? t.dependencyTaskIds : undefined,
      checkpoints: Array.isArray(timeNode?.checkpoints) ? timeNode.checkpoints : undefined,
      risksAndOpenQuestions: Array.isArray(t.risksAndOpenQuestions) ? t.risksAndOpenQuestions : undefined,
      inputMaterials: Array.isArray(t.inputMaterials) ? t.inputMaterials : undefined,
      actions: Array.isArray(t.actions) ? t.actions : undefined,
      collaborators: assign?.collaborators,
      scope: t.scope,
    });
  }
  if (subtasks.length === 0) return null;

  return {
    planId: session.planId,
    title,
    description,
    subtasks,
  };
}

export function publishResultSucceeded(result: Record<string, unknown> | undefined): boolean {
  return !!result && String(result.ok ?? "") === "true";
}

const STAGING_META_KEYS = new Set([
  "stagedBy",
  "stagedAt",
  "stagedDraftHash",
  "stagedAssignmentHash",
  "updatedAt",
]);

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => !STAGING_META_KEYS.has(k)).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashDraftForStaging(draft: unknown): string {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return "";
  return createHash("sha256").update(stableStringify(draft)).digest("hex").slice(0, 16);
}

export function hashAssignmentForStaging(assignment: unknown): string {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return "";
  return createHash("sha256").update(stableStringify(assignment)).digest("hex").slice(0, 16);
}

export function isStagingStale(session: PlanSession): boolean {
  const draft = session.latestDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  const d = draft as Record<string, unknown>;
  if (String(d.stagedBy ?? "").trim() !== "prepare_publish_task") return false;
  const stagedDraftHash = String(d.stagedDraftHash ?? "").trim();
  const stagedAssignmentHash = String(d.stagedAssignmentHash ?? "").trim();
  if (!stagedDraftHash && !stagedAssignmentHash) return false;
  const currentDraftHash = hashDraftForStaging(session.latestDraft);
  const currentAssignmentHash = hashAssignmentForStaging(session.latestAssignment);
  if (stagedDraftHash && currentDraftHash !== stagedDraftHash) return true;
  if (stagedAssignmentHash && currentAssignmentHash !== stagedAssignmentHash) return true;
  return false;
}
