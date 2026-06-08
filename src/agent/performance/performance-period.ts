/**
 * 绩效统计周期：滚动 N 天 / 自然月 / 自然季 / 自然年（北京时间）。
 * 子任务纳入条件：截止时间在 [rangeStartMs, rangeEndMs] 内（与滚动窗口一致，按 due_at）。
 */
import { addDaysToYmd, formatDateInTz, zonedMidnightUtcIso } from "../reminders/reminder-policy";

export const PERFORMANCE_DEFAULT_WINDOW_DAYS = 30;

export type PerformancePeriodKind = "rolling" | "month" | "quarter" | "year";

export interface PerformancePeriodInput {
  windowDays?: unknown;
  periodKind?: unknown;
  periodAnchor?: unknown;
  asOf?: string | number;
  timezone?: string;
}

export interface ResolvedPerformancePeriod {
  kind: PerformancePeriodKind;
  label: string;
  /** rolling 时有值；日历周期为 null。 */
  windowDays: number | null;
  periodAnchor: string;
  rangeStartMs: number;
  rangeEndMs: number;
  asOf: string;
  timezone: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function performanceTimezone(): string {
  return String(
    process.env.PERFORMANCE_TIMEZONE
    ?? process.env.FOLLOWUP_TIMEZONE
    ?? "Asia/Shanghai",
  ).trim() || "Asia/Shanghai";
}

export function parsePerformancePeriodKind(raw: unknown): PerformancePeriodKind {
  const k = String(raw ?? "").trim().toLowerCase();
  if (k === "month" || k === "quarter" || k === "year") return k;
  return "rolling";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthStartYmd(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function lastDayOfMonthYmd(year: number, month: number): string {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return addDaysToYmd(monthStartYmd(nextYear, nextMonth), -1);
}

function quarterIndex(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function quarterStartYmd(year: number, quarter: number): string {
  return monthStartYmd(year, (quarter - 1) * 3 + 1);
}

function quarterEndYmd(year: number, quarter: number): string {
  return lastDayOfMonthYmd(year, quarter * 3);
}

function parseYmdParts(ymd: string): { year: number; month: number; day: number } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

function endOfYmdMs(ymd: string, timezone: string): number {
  const nextYmd = addDaysToYmd(ymd, 1);
  const nextMidnight = Date.parse(zonedMidnightUtcIso(nextYmd, timezone));
  return nextMidnight - 1;
}

function parseMonthAnchor(raw: string): { year: number; month: number } | undefined {
  const m = /^(\d{4})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return undefined;
  return { year, month };
}

function parseQuarterAnchor(raw: string): { year: number; quarter: number } | undefined {
  const m = /^(\d{4})-?Q([1-4])$/i.exec(raw.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const quarter = Number(m[2]);
  if (!year || quarter < 1 || quarter > 4) return undefined;
  return { year, quarter };
}

function parseYearAnchor(raw: string): number | undefined {
  const m = /^(\d{4})$/.exec(raw.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1970 && year <= 9999 ? year : undefined;
}

function calendarBounds(
  kind: Exclude<PerformancePeriodKind, "rolling">,
  anchorRaw: string,
  asOfMs: number,
  timezone: string,
): { startYmd: string; endYmd: string; anchor: string; label: string } {
  const asOfYmd = formatDateInTz(new Date(asOfMs).toISOString(), timezone);
  const asOfParts = parseYmdParts(asOfYmd)!;

  if (kind === "month") {
    const parsed = anchorRaw ? parseMonthAnchor(anchorRaw) : undefined;
    const year = parsed?.year ?? asOfParts.year;
    const month = parsed?.month ?? asOfParts.month;
    const startYmd = monthStartYmd(year, month);
    const periodEndYmd = lastDayOfMonthYmd(year, month);
    const endYmd = asOfYmd <= periodEndYmd ? asOfYmd : periodEndYmd;
    const anchor = `${year}-${pad2(month)}`;
    const isCurrent = year === asOfParts.year && month === asOfParts.month;
    return {
      startYmd,
      endYmd,
      anchor,
      label: isCurrent ? "本月" : `${year}年${month}月`,
    };
  }

  if (kind === "quarter") {
    const parsed = anchorRaw ? parseQuarterAnchor(anchorRaw) : undefined;
    const year = parsed?.year ?? asOfParts.year;
    const quarter = parsed?.quarter ?? quarterIndex(asOfParts.month);
    const startYmd = quarterStartYmd(year, quarter);
    const periodEndYmd = quarterEndYmd(year, quarter);
    const endYmd = asOfYmd <= periodEndYmd ? asOfYmd : periodEndYmd;
    const anchor = `${year}-Q${quarter}`;
    const isCurrent = year === asOfParts.year && quarter === quarterIndex(asOfParts.month);
    return {
      startYmd,
      endYmd,
      anchor,
      label: isCurrent ? "本季度" : `${year}年Q${quarter}`,
    };
  }

  const parsedYear = anchorRaw ? parseYearAnchor(anchorRaw) : undefined;
  const year = parsedYear ?? asOfParts.year;
  const startYmd = `${year}-01-01`;
  const periodEndYmd = `${year}-12-31`;
  const endYmd = asOfYmd <= periodEndYmd ? asOfYmd : periodEndYmd;
  const anchor = String(year);
  const isCurrent = year === asOfParts.year;
  return {
    startYmd,
    endYmd,
    anchor,
    label: isCurrent ? "本年" : `${year}年`,
  };
}

export function resolvePerformanceWindowDays(raw?: unknown): number {
  const fromArg = Number(raw);
  if (Number.isFinite(fromArg) && fromArg >= 1) return Math.floor(fromArg);
  const fromEnv = Number(String(process.env.PERFORMANCE_WINDOW_DAYS ?? "").trim());
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return PERFORMANCE_DEFAULT_WINDOW_DAYS;
}

export function resolvePerformancePeriod(input: PerformancePeriodInput = {}): ResolvedPerformancePeriod {
  const timezone = String(input.timezone ?? performanceTimezone()).trim() || "Asia/Shanghai";
  const asOfMs = input.asOf === undefined
    ? Date.now()
    : typeof input.asOf === "number"
      ? input.asOf
      : Date.parse(String(input.asOf));
  const asOf = new Date(asOfMs).toISOString();
  const kind = parsePerformancePeriodKind(input.periodKind);
  const anchorRaw = String(input.periodAnchor ?? "").trim();

  if (kind === "rolling") {
    const windowDays = resolvePerformanceWindowDays(input.windowDays);
    const rangeEndMs = asOfMs;
    const rangeStartMs = asOfMs - windowDays * MS_PER_DAY;
    return {
      kind,
      label: `近 ${windowDays} 天`,
      windowDays,
      periodAnchor: "",
      rangeStartMs,
      rangeEndMs,
      asOf,
      timezone,
    };
  }

  const bounds = calendarBounds(kind, anchorRaw, asOfMs, timezone);
  const rangeStartMs = Date.parse(zonedMidnightUtcIso(bounds.startYmd, timezone));
  const rangeEndMs = endOfYmdMs(bounds.endYmd, timezone);
  return {
    kind,
    label: bounds.label,
    windowDays: null,
    periodAnchor: bounds.anchor,
    rangeStartMs,
    rangeEndMs,
    asOf,
    timezone,
  };
}

export function periodOptionsFromInput(input: PerformancePeriodInput): {
  windowDays?: number;
  periodKind?: PerformancePeriodKind;
  periodAnchor?: string;
  asOf?: string | number;
} {
  const period = resolvePerformancePeriod(input);
  if (period.kind === "rolling") {
    return { windowDays: period.windowDays ?? PERFORMANCE_DEFAULT_WINDOW_DAYS, asOf: period.asOf };
  }
  return {
    periodKind: period.kind,
    periodAnchor: period.periodAnchor,
    asOf: period.asOf,
  };
}
