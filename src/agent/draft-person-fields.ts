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
  return stripDeprecatedPlanningFieldsOnDraft(stripPlanningPersonFieldsFromDraft(normalizeQualityPlanningPlaceholder(draft)));
}

/** Promote the first quality starter row only once it contains a real execution task.
 * Never treat arbitrary dangling task IDs as row numbers or remove dependencies.
 */
export function normalizeQualityPlanningPlaceholder(draft: Record<string, unknown>): Record<string, unknown> {
  const handoff = asRecord(draft.qualityHandoff);
  const tasks = Array.isArray(draft.tasks) ? draft.tasks as Array<Record<string, unknown>> : [];
  const first = tasks[0];
  if (!handoff || handoff.planning || !first || first.id !== "__quality_planning__"
    || tasks.filter(task => task.id === "__quality_planning__").length !== 1
    || tasks.some(task => task.id === "task_1")
    || !String(first.title ?? "").trim() || first.title === "待规划执行任务"
    || !Array.isArray(first.deliverables) || !first.deliverables.some(value => String(value ?? "").trim())
    || !Array.isArray(first.completionCriteria) || !first.completionCriteria.some(value => String(value ?? "").trim())) return draft;
  return {...draft, tasks: tasks.map(task => ({...task,
    id: task.id === "__quality_planning__" ? "task_1" : task.id,
    ...(Array.isArray(task.dependencyTaskIds) ? {dependencyTaskIds: task.dependencyTaskIds.map(id => id === "__quality_planning__" ? "task_1" : id)} : {}),
  }))};
}
