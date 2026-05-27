import {
  addDaysToYmd,
  formatDateInTz,
  zonedMidnightUtcIso as reminderZonedMidnightUtcIso,
} from "../reminders/reminder-policy";

export { reminderZonedMidnightUtcIso as zonedMidnightUtcIso };

export interface WeekRange {
  id: string;
  label: string;
  mondayYmd: string;
  startIso: string;
  endIso: string;
}

export interface WeekSpanRange {
  center: WeekRange;
  weeks: Array<WeekRange & { isCenter: boolean }>;
  rangeStartIso: string;
  rangeEndIso: string;
  rangeStartYmd: string;
  rangeEndYmd: string;
}

function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function weekdayFromYmd(ymd: string): number {
  const day = ymdToUtcDate(ymd).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayYmdForLocalDate(ymd: string): string {
  return addDaysToYmd(ymd, 1 - weekdayFromYmd(ymd));
}

function isoWeekIdFromMonday(mondayYmd: string): string {
  const d = ymdToUtcDate(mondayYmd);
  d.setUTCDate(d.getUTCDate() + 3);
  const year = d.getUTCFullYear();
  const week1 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(week1);
  const week1Day = week1.getUTCDay() || 7;
  week1Monday.setUTCDate(week1.getUTCDate() + 1 - week1Day);
  const week = 1 + Math.round((d.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekLabel(mondayYmd: string): string {
  return `${mondayYmd} ~ ${addDaysToYmd(mondayYmd, 6)}`;
}

export function buildWeekRangeFromMonday(mondayYmd: string, timezone: string): WeekRange {
  const nextMondayYmd = addDaysToYmd(mondayYmd, 7);
  return {
    id: isoWeekIdFromMonday(mondayYmd),
    label: weekLabel(mondayYmd),
    mondayYmd,
    startIso: reminderZonedMidnightUtcIso(mondayYmd, timezone),
    endIso: reminderZonedMidnightUtcIso(nextMondayYmd, timezone),
  };
}

export function resolveCenterWeek(input: {
  week?: string;
  now?: Date;
  timezone: string;
}): WeekRange {
  const raw = String(input.week ?? "").trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : formatDateInTz((input.now ?? new Date()).toISOString(), input.timezone);
  return buildWeekRangeFromMonday(mondayYmdForLocalDate(ymd), input.timezone);
}

export function buildWeekSpanRange(input: {
  centerWeek?: string;
  span: number;
  now?: Date;
  timezone: string;
}): WeekSpanRange {
  const center = resolveCenterWeek({
    week: input.centerWeek,
    now: input.now,
    timezone: input.timezone,
  });
  const weeks: Array<WeekRange & { isCenter: boolean }> = [];
  for (let i = -input.span; i <= input.span; i += 1) {
    const monday = addDaysToYmd(center.mondayYmd, i * 7);
    weeks.push({ ...buildWeekRangeFromMonday(monday, input.timezone), isCenter: i === 0 });
  }
  return {
    center,
    weeks,
    rangeStartYmd: weeks[0]?.mondayYmd ?? center.mondayYmd,
    rangeEndYmd: addDaysToYmd(weeks[weeks.length - 1]?.mondayYmd ?? center.mondayYmd, 7),
    rangeStartIso: weeks[0]?.startIso ?? center.startIso,
    rangeEndIso: weeks[weeks.length - 1]?.endIso ?? center.endIso,
  };
}

export function isCurrentWeek(input: { center: WeekRange; now?: Date; timezone: string }): boolean {
  const current = resolveCenterWeek({ now: input.now, timezone: input.timezone });
  return current.mondayYmd === input.center.mondayYmd;
}

export function nextWeekRange(center: WeekRange, timezone: string): WeekRange {
  return buildWeekRangeFromMonday(addDaysToYmd(center.mondayYmd, 7), timezone);
}
