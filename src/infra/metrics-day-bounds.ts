import { addDaysToYmd, formatDateInTz, zonedMidnightUtcIso } from "../agent/reminders/reminder-policy";

export function resolveMetricsTimezone(): string {
  return (
    process.env.WEEKLY_DASHBOARD_TIMEZONE?.trim()
    || process.env.FOLLOWUP_TIMEZONE?.trim()
    || "Asia/Shanghai"
  );
}

/** Local calendar day [start, next day) as UTC ISO bounds. */
export function localDayUtcRange(ymd: string, timezone: string): { fromIso: string; toIso: string } {
  return {
    fromIso: zonedMidnightUtcIso(ymd, timezone),
    toIso: zonedMidnightUtcIso(addDaysToYmd(ymd, 1), timezone),
  };
}

export function todayYmdInMetricsTz(now = new Date()): string {
  return formatDateInTz(now.toISOString(), resolveMetricsTimezone());
}
