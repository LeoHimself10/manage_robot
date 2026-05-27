/**
 * Scheme C: planning-phase assignee/collaborator live only in latestAssignment.
 * Strip person + deprecated "更多规划" fields from draft.tasks when persisting session.
 */

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

/** Remove deprecated draft planning fields (7 项); keep execution core including dueAt/actions/deps. */
export function stripDeprecatedPlanningFieldsOnTask(
  task: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...task };
  delete next.feedbackFrequency;
  delete next.inputMaterials;
  delete next.risksAndOpenQuestions;

  const timeNode = asRecord(next.timeNode);
  if (timeNode) {
    const dueAt = String(timeNode.dueAt ?? "").trim();
    if (dueAt) next.timeNode = { dueAt };
    else delete next.timeNode;
  }

  const scope = asRecord(next.scope);
  if (scope) {
    delete scope.inScope;
    delete scope.outOfScope;
    if (Object.keys(scope).length === 0) delete next.scope;
    else next.scope = scope;
  }

  return next;
}

export function stripDeprecatedPlanningFieldsOnDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...draft };
  if (Array.isArray(next.tasks)) {
    next.tasks = (next.tasks as Array<Record<string, unknown>>).map(
      stripDeprecatedPlanningFieldsOnTask,
    );
  }
  return next;
}

export function stripPlanningPersonFieldsFromTask(
  task: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...task };
  delete next.assigneeUserId;
  delete next.collaborators;
  return next;
}

export function stripPlanningPersonFieldsFromDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...draft };
  if (Array.isArray(next.tasks)) {
    next.tasks = (next.tasks as Array<Record<string, unknown>>).map(
      stripPlanningPersonFieldsFromTask,
    );
  }
  return next;
}

/** Single entry for all session.latestDraft writes. */
export function normalizeDraftTasksForSession(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  return stripDeprecatedPlanningFieldsOnDraft(stripPlanningPersonFieldsFromDraft(draft));
}
