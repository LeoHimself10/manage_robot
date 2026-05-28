import { parseDueAtMs, zonedDateTimeUtcMs } from "../reminders/due-at-parse";
import { addDaysToYmd } from "../reminders/reminder-policy";

export function todayYmdInTz(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Inclusive end of the last calendar day in a rolling horizon (today + horizonDays - 1). */
export function horizonEndMs(now: Date, horizonDays: number, timezone: string): number {
  const todayYmd = todayYmdInTz(now, timezone);
  const lastYmd = addDaysToYmd(todayYmd, horizonDays - 1);
  const endBase = zonedDateTimeUtcMs(lastYmd, 23, 59, timezone);
  if (endBase === undefined) return Number.MAX_SAFE_INTEGER;
  return endBase + 59_999;
}

export function isDueInHorizon(
  dueAt: string | undefined,
  horizonEnd: number,
  timezone: string,
): boolean {
  const dueMs = parseDueAtMs(dueAt, timezone);
  if (dueMs === undefined) return false;
  return dueMs <= horizonEnd;
}

export function isOverdueDue(dueAt: string | undefined, nowMs: number, timezone: string): boolean {
  const dueMs = parseDueAtMs(dueAt, timezone);
  return dueMs !== undefined && nowMs > dueMs;
}
