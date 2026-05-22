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

const ORDINAL_LABEL_RE = /^(?:任务|第)\s*(\d+)\s*(?:条|项|个|行)?$/i;

export function resolveDraftTaskDisplayIndex(
  tasks: Array<Record<string, unknown>>,
  subtaskId: string,
): number {
  const needle = subtaskId.trim();
  if (!needle) return -1;

  const labelMatch = needle.match(ORDINAL_LABEL_RE);
  if (labelMatch) {
    const n = Number.parseInt(labelMatch[1] ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= tasks.length) return n - 1;
  }

  if (needle.startsWith("#")) {
    const n = Number.parseInt(needle.slice(1), 10);
    if (Number.isFinite(n) && n >= 1 && n <= tasks.length) return n - 1;
  }

  if (/^\d+$/.test(needle)) {
    const n = Number.parseInt(needle, 10);
    if (n >= 1 && n <= tasks.length) return n - 1;
  }

  return -1;
}

export function findDraftTaskIndex(
  tasks: Array<Record<string, unknown>>,
  subtaskId: string,
): number {
  const needle = subtaskId.trim();
  if (!needle) return -1;

  const displayIdx = resolveDraftTaskDisplayIndex(tasks, needle);
  if (displayIdx >= 0) return displayIdx;

  const idIdx = tasks.findIndex((t) => {
    const id = String((t as { id?: unknown }).id ?? "").trim();
    return id === needle || id.endsWith(`:${needle}`) || needle.endsWith(`:${id}`);
  });

  // After REDRAFT/split, task_K id may drift off display row K — prefer table row K.
  const taskOrdinal = needle.match(/^task_(\d+)$/i);
  if (taskOrdinal) {
    const n = Number.parseInt(taskOrdinal[1] ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= tasks.length) {
      const rowIdx = n - 1;
      const rowId = String(tasks[rowIdx]?.id ?? "").trim();
      if (rowId !== needle && (idIdx < 0 || idIdx !== rowIdx)) {
        return rowIdx;
      }
    }
  }

  return idIdx;
}
