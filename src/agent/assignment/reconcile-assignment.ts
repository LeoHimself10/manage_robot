import { fingerprintTask } from "../draft-fingerprint";

export interface ReconcileAssignmentWarning {
  taskId: string;
  missingDueAt?: boolean;
  missingAssignee?: boolean;
}

export interface ReconcileAssignmentResult {
  assignment: Record<string, unknown> | undefined;
  warnings: ReconcileAssignmentWarning[];
  migratedTaskIds: Array<{ from: string; to: string }>;
}

function getTasks(draft: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!draft || !Array.isArray((draft as { tasks?: unknown[] }).tasks)) return [];
  return (draft as { tasks: Array<Record<string, unknown>> }).tasks;
}

function getTaskDueAt(task: Record<string, unknown>): string | undefined {
  const tn = task.timeNode as Record<string, unknown> | undefined;
  const due = tn?.dueAt ?? task.dueAt;
  return typeof due === "string" && due.trim() ? due.trim() : undefined;
}

function setTaskDueAt(task: Record<string, unknown>, dueAt: string): void {
  const tn = (task.timeNode as Record<string, unknown> | undefined) ?? {};
  tn.dueAt = dueAt;
  task.timeNode = tn;
}

function getAssignmentRows(
  assignment: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  if (!assignment || !Array.isArray((assignment as { assignments?: unknown[] }).assignments)) {
    return [];
  }
  return [...(assignment as { assignments: Array<Record<string, unknown>> }).assignments];
}

/**
 * Keep latestAssignment aligned with latestDraft after REDRAFT / split / id changes.
 */
export function reconcileAssignmentWithDraft(input: {
  previousDraft?: Record<string, unknown>;
  currentDraft: Record<string, unknown>;
  assignment?: Record<string, unknown>;
}): ReconcileAssignmentResult {
  const currentTasks = getTasks(input.currentDraft);
  const currentIds = new Set(
    currentTasks.map((t) => String(t?.id ?? "").trim()).filter(Boolean),
  );

  const prevTasks = getTasks(input.previousDraft);
  const prevById = new Map(
    prevTasks
      .map((t) => [String(t?.id ?? "").trim(), t] as const)
      .filter(([id]) => id.length > 0),
  );

  const currentByFingerprint = new Map<string, string[]>();
  for (const t of currentTasks) {
    const id = String(t?.id ?? "").trim();
    if (!id) continue;
    const fp = fingerprintTask(t);
    const arr = currentByFingerprint.get(fp) ?? [];
    arr.push(id);
    currentByFingerprint.set(fp, arr);
  }

  const migratedTaskIds: Array<{ from: string; to: string }> = [];
  const usedTargetIds = new Set<string>();
  const nextRows: Array<Record<string, unknown>> = [];

  for (const row of getAssignmentRows(input.assignment)) {
    const taskId = String(row?.taskId ?? "").trim();
    if (!taskId) continue;

    const currentTask = currentTasks.find((t) => String(t?.id ?? "").trim() === taskId);
    const prevTask = prevById.get(taskId);
    const fingerprintStale =
      currentTask
      && prevTask
      && fingerprintTask(currentTask) !== fingerprintTask(prevTask);

    if (currentIds.has(taskId) && !fingerprintStale) {
      nextRows.push({ ...row });
      usedTargetIds.add(taskId);
      continue;
    }

    const sourceTask = prevTask ?? prevById.get(taskId);
    if (!sourceTask) continue;

    const fp = fingerprintTask(sourceTask);
    const candidates = currentByFingerprint.get(fp) ?? [];

    if (candidates.length === 1) {
      const newId = candidates[0]!;
      if (!usedTargetIds.has(newId)) {
        nextRows.push({ ...row, taskId: newId });
        usedTargetIds.add(newId);
        migratedTaskIds.push({ from: taskId, to: newId });
      }
      continue;
    }

    if (candidates.length > 1) {
      const newId = candidates.find((c) => !usedTargetIds.has(c)) ?? candidates[0]!;
      nextRows.push({ ...row, taskId: newId });
      usedTargetIds.add(newId);
      migratedTaskIds.push({ from: taskId, to: newId });

      const parentDueAt = getTaskDueAt(sourceTask);
      if (parentDueAt) {
        for (const cid of candidates) {
          const ct = currentTasks.find((t) => String(t?.id ?? "").trim() === cid);
          if (ct && !getTaskDueAt(ct)) {
            setTaskDueAt(ct, parentDueAt);
          }
        }
      }
    }
  }

  const pruned = nextRows.filter((r) => currentIds.has(String(r?.taskId ?? "").trim()));

  // Positional split: parent row removed/replaced at index → inherit dueAt to new leading rows
  if (prevTasks.length > 0 && currentTasks.length > prevTasks.length) {
    const extraCount = currentTasks.length - prevTasks.length;
    for (let i = 0; i < prevTasks.length; i += 1) {
      const prevTask = prevTasks[i]!;
      const prevId = String(prevTask?.id ?? "").trim();
      const parentDueAt = getTaskDueAt(prevTask);
      if (!parentDueAt) continue;
      const currentAtIndex = currentTasks[i];
      const idReusedWithNewContent =
        Boolean(currentAtIndex)
        && Boolean(prevId)
        && String(currentAtIndex?.id ?? "").trim() === prevId
        && fingerprintTask(currentAtIndex!) !== fingerprintTask(prevTask);
      if (idReusedWithNewContent || !prevId || !currentIds.has(prevId)) {
        for (let j = i; j <= i + extraCount && j < currentTasks.length; j += 1) {
          const ct = currentTasks[j]!;
          if (!getTaskDueAt(ct)) {
            setTaskDueAt(ct, parentDueAt);
          }
        }
        break;
      }
    }
  }

  const warnings: ReconcileAssignmentWarning[] = [];
  for (const t of currentTasks) {
    const id = String(t?.id ?? "").trim();
    if (!id) continue;
    const hasAssignee = pruned.some((r) => {
      if (String(r?.taskId ?? "").trim() !== id) return false;
      const primary = r.primary as Record<string, unknown> | undefined;
      return Boolean(String(primary?.userId ?? "").trim());
    });
    const w: ReconcileAssignmentWarning = { taskId: id };
    if (!getTaskDueAt(t)) w.missingDueAt = true;
    if (!hasAssignee) w.missingAssignee = true;
    if (w.missingDueAt || w.missingAssignee) warnings.push(w);
  }

  const assignment =
    pruned.length > 0 || input.assignment
      ? { ...(input.assignment ?? {}), assignments: pruned }
      : undefined;

  return { assignment, warnings, migratedTaskIds };
}
