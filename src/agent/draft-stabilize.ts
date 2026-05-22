import { allocTaskId } from "./draft-task-ids";
import { fingerprintTask } from "./draft-fingerprint";

/** Stabilize draft.tasks[].id across REDRAFT: fingerprint-first, never blind index inherit. */
export function stabilizeDraftTaskIds(
  draft: Record<string, unknown>,
  previous?: Record<string, unknown>,
): Record<string, unknown> {
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  if (tasks.length === 0) return draft;
  const previousTasks = Array.isArray((previous as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((previous as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const byFingerprint = new Map<string, string>();
  for (const task of previousTasks) {
    const id = String(task?.id ?? "").trim();
    if (!id) continue;
    byFingerprint.set(fingerprintTask(task), id);
  }
  const used = new Set<string>();
  const nextTasks = tasks.map((task, index) => {
    const cloned = { ...task };
    let id = String(cloned.id ?? "").trim();
    if (!id) {
      id = byFingerprint.get(fingerprintTask(cloned)) ?? "";
    }
    if (!id || used.has(id)) {
      id = allocTaskId(index, used);
    }
    used.add(id);
    cloned.id = id;
    return cloned;
  });
  return { ...draft, tasks: nextTasks };
}
