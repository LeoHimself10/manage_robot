/** Shared task id allocation for draft.tasks[] mutations. */

export function allocTaskId(index: number, used: Set<string>): string {
  const base = `task_${index + 1}`;
  if (!used.has(base)) return base;
  let seq = index + 1;
  while (used.has(`task_${seq}`)) seq += 1;
  return `task_${seq}`;
}

export function collectUsedTaskIds(tasks: Array<Record<string, unknown>>): Set<string> {
  const used = new Set<string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    if (id) used.add(id);
  }
  return used;
}

export function findDraftTaskIndex(
  tasks: Array<Record<string, unknown>>,
  subtaskId: string,
): number {
  const needle = subtaskId.trim();
  if (!needle) return -1;
  return tasks.findIndex((t) => {
    const id = String((t as { id?: unknown }).id ?? "").trim();
    return id === needle || id.endsWith(`:${needle}`) || needle.endsWith(`:${id}`);
  });
}
