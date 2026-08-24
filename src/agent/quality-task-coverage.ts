import type { PlanSession } from "../infra/plan-session-store";

export interface QualityTaskCoverageResult {
  applicable: boolean;
  ok: boolean;
  requiredDeliverableIds: string[];
  coveredDeliverableIds: string[];
  missingDeliverableIds: string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizedName(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/**
 * Keep the quality handoff's stable deliverable IDs attached to planner tasks.
 *
 * Older workbench revisions flattened tasks to visible spreadsheet columns and
 * could therefore drop qualityDeliverableIds. For those already-saved drafts we
 * only recover an ID when the selected deliverable name has one exact, unique
 * match in the task's deliverables (or, for the one-deliverable starter task,
 * its title). Ambiguous/fuzzy matches stay uncovered and the publish gate blocks.
 */
export function restoreQualityTaskMappings(
  draft: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!draft) return undefined;
  const handoff = asRecord(draft.qualityHandoff);
  const taskPackage = asRecord(draft.qualityTaskPackage);
  const tasks = Array.isArray(draft.tasks)
    ? (draft.tasks as Array<Record<string, unknown>>)
    : undefined;
  if (!handoff || !taskPackage || !tasks) return draft;

  const required = stringList(handoff.requiredDeliverableIds);
  const packageDeliverables = Array.isArray(taskPackage.requiredDeliverables)
    ? (taskPackage.requiredDeliverables as Array<Record<string, unknown>>)
    : [];
  const selectedByName = new Map<string, string[]>();
  for (const item of packageDeliverables) {
    const id = String(item.deliverableId ?? "").trim();
    const name = normalizedName(item.name);
    if (!id || !name || !required.includes(id) || item.selected === false) continue;
    selectedByName.set(name, [...(selectedByName.get(name) ?? []), id]);
  }

  let changed = false;
  const nextTasks = tasks.map((task) => {
    const mapped = new Set(
      stringList(task.qualityDeliverableIds).filter((id) => required.includes(id)),
    );
    const taskDeliverables = stringList(task.deliverables).map(normalizedName);
    if (taskDeliverables.length === 1) taskDeliverables.push(normalizedName(task.title));
    for (const name of new Set(taskDeliverables.filter(Boolean))) {
      const ids = selectedByName.get(name) ?? [];
      if (ids.length === 1) mapped.add(ids[0]);
    }
    const nextIds = [...mapped];
    const beforeIds = stringList(task.qualityDeliverableIds);
    if (nextIds.length === beforeIds.length && nextIds.every((id) => beforeIds.includes(id))) {
      return task;
    }
    changed = true;
    return { ...task, qualityDeliverableIds: nextIds };
  });
  return changed ? { ...draft, tasks: nextTasks } : draft;
}

export function validateQualityTaskCoverage(session: Pick<PlanSession, "latestDraft">): QualityTaskCoverageResult {
  const draft = restoreQualityTaskMappings(session.latestDraft as Record<string, unknown> | undefined);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { applicable: false, ok: true, requiredDeliverableIds: [], coveredDeliverableIds: [], missingDeliverableIds: [] };
  }
  const handoff = (draft as Record<string, unknown>).qualityHandoff;
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return { applicable: false, ok: true, requiredDeliverableIds: [], coveredDeliverableIds: [], missingDeliverableIds: [] };
  }
  const required = stringList((handoff as Record<string, unknown>).requiredDeliverableIds);
  const covered = new Set<string>();
  const tasks = (draft as Record<string, unknown>).tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (!task || typeof task !== "object" || Array.isArray(task)) continue;
      for (const id of stringList((task as Record<string, unknown>).qualityDeliverableIds)) {
        if (required.includes(id)) covered.add(id);
      }
    }
  }
  const missing = required.filter((id) => !covered.has(id));
  return {
    applicable: true,
    ok: required.length > 0 && missing.length === 0,
    requiredDeliverableIds: required,
    coveredDeliverableIds: [...covered],
    missingDeliverableIds: missing,
  };
}
