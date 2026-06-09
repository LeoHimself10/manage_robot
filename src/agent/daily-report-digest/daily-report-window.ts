import {
  addDaysToYmd,
  formatYmdDisplayInTz,
  getLocalTimeParts,
  previousCalendarDayRangeInTz,
  zonedMidnightUtcIso,
} from "../reminders/reminder-policy";
import type { DailyReportDigestConfig } from "./daily-report-config";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportTimeRange {
  /** Unix 毫秒，昨天 00:00（本地时区） */
  startTime: number;
  /** Unix 毫秒，昨天 23:59:59.999（本地时区，含晚交） */
  endTime: number;
  /** YYYY-MM-DD（昨天，本地时区） */
  labelYmd: string;
  /** 友好展示，如 "6月8日" */
  labelDisplay: string;
}

/** 是否处于「每天 sendHour:sendMinute」的发送窗口。
 * 规则：周二–周六 07:00 发「昨日」汇总；周六发周五；周日、周一不发。
 */
export function isDailyReportSendWindow(
  now: Date,
  config: DailyReportDigestConfig,
): boolean {
  const { hour, minute, weekday } = getLocalTimeParts(now, config.timezone);
  // 0=周日、1=周一不发；6=周六发（resolveReportRange 自然取周五）
  if (weekday === 0 || weekday === 1) return false;
  if (hour !== config.sendHour) return false;
  const windowEndMinute = config.sendMinute + Math.ceil(config.scanIntervalMs / 60_000);
  return minute >= config.sendMinute && minute < windowEndMinute;
}

/** 解析昨天全天的日志时间范围（含晚交）。 */
export function resolveReportRange(now: Date, timezone: string): ReportTimeRange {
  const range = previousCalendarDayRangeInTz(now, timezone);
  return {
    startTime: Date.parse(range.sinceIso),
    endTime: Date.parse(range.untilIso) - 1,
    labelYmd: range.labelYmd,
    labelDisplay: range.labelDisplay,
  };
}

/** 解析指定某一天（YYYY-MM-DD，本地时区）全天的日志时间范围。 */
export function resolveDayRangeForYmd(ymd: string, timezone: string): ReportTimeRange {
  if (!YMD_RE.test(ymd)) {
    throw new Error(`非法日期格式: ${ymd}（应为 YYYY-MM-DD）`);
  }
  const sinceIso = zonedMidnightUtcIso(ymd, timezone);
  const untilIso = zonedMidnightUtcIso(addDaysToYmd(ymd, 1), timezone);
  return {
    startTime: Date.parse(sinceIso),
    endTime: Date.parse(untilIso) - 1,
    labelYmd: ymd,
    labelDisplay: formatYmdDisplayInTz(ymd, timezone),
  };
}
