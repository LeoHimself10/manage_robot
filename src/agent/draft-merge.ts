/**
 * Draft merge utilities for preserving rich fields when a "thin" draft
 * update would otherwise overwrite previously gathered rich fields.
 *
 * Rule: non-empty arrays in `prev` are preserved when `next` supplies an
 * empty array (or omits the field entirely). Non-array fields are taken from
 * `next` as long as they are defined.
 */

const RICH_ARRAY_FIELDS = [
  "deliverables",
  "completionCriteria",
  "dependencyTaskIds",
  "actions",
] as const;

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

/**
 * Merge two subtask objects. Rich array fields from `prev` are kept when
 * `next` omits them or provides an empty array.
 */
function mergeSubtask(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev, ...next };

  for (const field of RICH_ARRAY_FIELDS) {
    const prevVal = prev[field];
    const nextVal = next[field];
    if (isNonEmptyArray(prevVal) && !isNonEmptyArray(nextVal)) {
      merged[field] = prevVal;
    }
  }

  // timeNode: preserve dueAt from prev when next omits it
  const prevTimeNode = asRecord(prev.timeNode);
  const nextTimeNode = asRecord(next.timeNode);
  const nextDue = String(nextTimeNode?.dueAt ?? "").trim();
  const prevDue = String(prevTimeNode?.dueAt ?? "").trim();
  const dueAt = nextDue || prevDue;
  if (dueAt) {
    merged.timeNode = { dueAt };
  } else if (prevTimeNode || nextTimeNode) {
    delete merged.timeNode;
  }

  delete merged.scope;
  delete merged.feedbackFrequency;
  delete merged.inputMaterials;
  delete merged.risksAndOpenQuestions;
  delete merged.collaborators;

  return merged;
}

/**
 * Deep-merge a new draft onto the previous draft, preserving rich fields
 * from `prev` when `next` supplies empty arrays or omits them.
 *
 * Top-level scalar fields (title, description, classification, etc.) are
 * taken from `next`. tasks[] is merged per-taskId.
 */
export function deepMergePreserveRichFields(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!prev) return next;

  const merged: Record<string, unknown> = { ...prev, ...next };

  const prevTasks = Array.isArray(prev.tasks)
    ? (prev.tasks as Array<Record<string, unknown>>)
    : [];
  const nextTasks = Array.isArray(next.tasks)
    ? (next.tasks as Array<Record<string, unknown>>)
    : [];

  if (nextTasks.length > 0) {
    const prevById = new Map<string, Record<string, unknown>>();
    for (const t of prevTasks) {
      const id = String(t?.id ?? "");
      if (id) prevById.set(id, t);
    }
    merged.tasks = nextTasks.map((nextTask) => {
      const id = String(nextTask?.id ?? "");
      const prevTask = prevById.get(id);
      if (!prevTask) return nextTask;
      return mergeSubtask(prevTask, nextTask);
    });
  } else if (prevTasks.length > 0) {
    // next has no tasks; preserve prev's tasks
    merged.tasks = prevTasks;
  }

  return merged;
}

const ORCHESTRATOR_DRAFT_SCALAR_KEYS = ["title", "description", "summary", "stagedBy", "projectId", "projectName"] as const;

/**
 * coerceLlmPlanPayload strips orchestrator draft scalars (title, description).
 * Re-attach them from the model's raw draft object so prepare/publish can read them.
 */
export function preserveOrchestratorDraftScalars(
  rawDraft: unknown,
  coerced: Record<string, unknown>,
): Record<string, unknown> {
  const raw =
    rawDraft && typeof rawDraft === "object" && !Array.isArray(rawDraft)
      ? (rawDraft as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...coerced };
  for (const key of ORCHESTRATOR_DRAFT_SCALAR_KEYS) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v.trim() : String(v).trim();
    if (s) out[key] = typeof v === "string" ? s : v;
  }
  return out;
}
