/** Parse subtask due_at TEXT; date-only values default to 18:00 Asia/Shanghai. */

export const DEFAULT_DUE_TIMEZONE = "Asia/Shanghai";
export const DEFAULT_DUE_HOUR = 18;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function localYmdAndMinutes(ms: number, timezone: string): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(pick("minute"));
  return {
    ymd: `${pick("year")}-${pick("month")}-${pick("day")}`,
    minutes: hour * 60 + minute,
  };
}

/** UTC instant for local `hour:minute` on calendar `ymd` in `timezone`. */
export function zonedDateTimeUtcMs(
  ymd: string,
  hour: number,
  minute: number,
  timezone: string = DEFAULT_DUE_TIMEZONE,
): number | undefined {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const targetMinutes = hour * 60 + minute;
  let lo = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, m - 1, d + 2, 0, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { ymd: midYmd, minutes: midMinutes } = localYmdAndMinutes(mid, timezone);
    if (midYmd < ymd || (midYmd === ymd && midMinutes < targetMinutes)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function parseDueAtMs(
  raw: string | undefined | null,
  timezone: string = DEFAULT_DUE_TIMEZONE,
): number | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "待确认") return undefined;
  if (DATE_ONLY_RE.test(s)) {
    return zonedDateTimeUtcMs(s, DEFAULT_DUE_HOUR, 0, timezone);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

export function isDueAtParseable(raw: string | undefined | null): boolean {
  return parseDueAtMs(raw) !== undefined;
}

/** Normalize for DB storage: date-only → explicit +08:00 ISO at 18:00. */
export function formatDueAtForStorage(
  raw: string | undefined | null,
  timezone: string = DEFAULT_DUE_TIMEZONE,
): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "待确认") return undefined;
  if (DATE_ONLY_RE.test(s)) {
    const ms = zonedDateTimeUtcMs(s, DEFAULT_DUE_HOUR, 0, timezone);
    return ms === undefined ? undefined : new Date(ms).toISOString();
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** Calendar YMD of due_at in timezone (for T-1 / overdue day math). */
export function dueAtYmdInTz(
  raw: string | undefined | null,
  timezone: string = DEFAULT_DUE_TIMEZONE,
): string | undefined {
  const ms = parseDueAtMs(raw, timezone);
  if (ms === undefined) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
