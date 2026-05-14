/** Human-readable due date + simple timeline progress for employee workbench cards. */

function parseMs(iso: string | undefined | null): number | undefined {
  if (!iso || !String(iso).trim()) return undefined;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Short Chinese label: overdue / within 24h / days remaining / unset.
 */
export function presentDueLabel(dueAt: string | undefined | null, now: Date): string {
  const due = parseMs(dueAt);
  if (due === undefined) return "未设置截止";
  const nowMs = now.getTime();
  if (nowMs > due) {
    const days = Math.ceil((nowMs - due) / (24 * 60 * 60 * 1000));
    return days <= 1 ? "已逾期" : `已逾期 ${days} 天`;
  }
  const hours = (due - nowMs) / (60 * 60 * 1000);
  if (hours <= 24) return "距截止不足 24 小时";
  const days = Math.ceil((due - nowMs) / (24 * 60 * 60 * 1000));
  return days <= 1 ? "今天内截止" : `还剩 ${days} 天`;
}

export type DueBarState = "normal" | "urgent" | "overdue" | "done";

/**
 * Ratio of elapsed time from `start` to `due` (0..1). Null when no due or invalid window.
 * For DONE tasks callers should pass status and skip bar or force full bar.
 */
export function presentDueProgress(
  startAt: string | undefined | null,
  dueAt: string | undefined | null,
  now: Date,
): number | null {
  const due = parseMs(dueAt);
  const start = parseMs(startAt);
  if (due === undefined) return null;
  const nowMs = now.getTime();
  const origin = start !== undefined ? Math.min(start, nowMs) : nowMs;
  const window = due - origin;
  if (window <= 0) return nowMs >= due ? 1 : 0;
  const elapsed = nowMs - origin;
  return Math.min(1, Math.max(0, elapsed / window));
}

export function presentDueBarState(
  dueAt: string | undefined | null,
  now: Date,
  status: string | undefined,
): DueBarState {
  if (status === "DONE") return "done";
  const due = parseMs(dueAt);
  if (due === undefined) return "normal";
  const nowMs = now.getTime();
  if (nowMs > due) return "overdue";
  if (due - nowMs <= 24 * 60 * 60 * 1000) return "urgent";
  return "normal";
}
