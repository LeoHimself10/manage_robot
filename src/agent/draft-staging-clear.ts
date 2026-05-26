import type { PlanSession } from "../infra/plan-session-store";

const STAGING_KEYS = [
  "stagedBy",
  "stagedAt",
  "stagedDraftHash",
  "stagedAssignmentHash",
] as const;

/** Returns a copy of draft with prepare_publish_task staging fields removed. */
export function clearPublishStagingFieldsOnDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const d = { ...draft };
  if (String(d.stagedBy ?? "").trim() !== "prepare_publish_task") return d;
  for (const key of STAGING_KEYS) {
    delete d[key];
  }
  return d;
}

/** Clear prepare_publish_task staging metadata after structural draft edits. */
export function clearPublishStagingOnDraft(session: PlanSession): void {
  const draft = session.latestDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return;
  const d = draft as Record<string, unknown>;
  if (String(d.stagedBy ?? "").trim() !== "prepare_publish_task") return;
  for (const key of STAGING_KEYS) {
    delete d[key];
  }
}
