/**
 * Scheme C: planning-phase assignee/collaborator live only in latestAssignment.
 * Strip person fields from draft.tasks when persisting orchestrator or tool output.
 */

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
    next.tasks = (next.tasks as Array<Record<string, unknown>>).map(stripPlanningPersonFieldsFromTask);
  }
  return next;
}
