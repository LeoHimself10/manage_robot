/** 从 draft.tasks 推断/补全 startAt（避免一律「待确认」） */

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function needsInferDate(s: string): boolean {
  const t = s.trim();
  return !t || t === "待确认";
}

function asTaskArray(draft: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(draft.tasks) ? (draft.tasks as Array<Record<string, unknown>>) : [];
}

/**
 * 按 task 顺序补全 timeNode.startAt：
 * - 无依赖：默认 anchor 当天
 * - 有依赖：默认 = 所有前置任务 dueAt 中最晚者 + 1 天
 */
export function inferDraftTaskStartDates(
  draft: Record<string, unknown>,
  anchorIso?: string,
): Record<string, unknown> {
  const tasks = asTaskArray(draft);
  if (tasks.length === 0) return draft;

  const anchor = anchorIso ? new Date(anchorIso) : new Date();
  const anchorYmd = formatYmd(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
  const dueById = new Map<string, string>();

  for (const task of tasks) {
    const id = String(task.id ?? "").trim();
    const timeNode =
      task.timeNode && typeof task.timeNode === "object" && !Array.isArray(task.timeNode)
        ? { ...(task.timeNode as Record<string, unknown>) }
        : ({} as Record<string, unknown>);

    const deps = Array.isArray(task.dependencyTaskIds)
      ? (task.dependencyTaskIds as unknown[])
          .map((d) => String(d ?? "").trim())
          .filter(Boolean)
      : [];

    let startAt = String(timeNode.startAt ?? "").trim();
    if (needsInferDate(startAt)) {
      if (deps.length === 0) {
        startAt = anchorYmd;
      } else {
        let latestPred: Date | null = null;
        for (const depId of deps) {
          const predDue = dueById.get(depId);
          if (!predDue || needsInferDate(predDue)) continue;
          const pd = parseYmd(predDue);
          if (pd && (!latestPred || pd > latestPred)) latestPred = pd;
        }
        startAt = latestPred ? formatYmd(addDays(latestPred, 1)) : anchorYmd;
      }
      timeNode.startAt = startAt;
      task.timeNode = timeNode;
    }

    const dueAt = String(timeNode.dueAt ?? "").trim();
    if (id) dueById.set(id, dueAt || "待确认");
  }

  return { ...draft, tasks };
}
