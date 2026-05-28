export type ProgressDigestContentMode = "delivery_reminder" | "full";

export interface ProgressDigestPolicy {
  enabled: boolean;
  scanIntervalMs: number;
  timezone: string;
  digestHour: number;
  digestMinute: number;
  weekdaysOnly: boolean;
  /** @deprecated No longer used for activity window; dynamic section uses previous calendar day in timezone. */
  lookbackHours: number;
  maxTaskLines: number;
  contentMode: ProgressDigestContentMode;
  horizonDays: number;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, defaultValue: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

function envContentMode(name: string, defaultValue: ProgressDigestContentMode): ProgressDigestContentMode {
  const raw = env(name).toLowerCase();
  if (raw === "full") return "full";
  if (raw === "delivery_reminder" || raw === "delivery") return "delivery_reminder";
  return defaultValue;
}

export function loadProgressDigestPolicy(): ProgressDigestPolicy {
  return {
    enabled: envFlag("PROGRESS_DIGEST_ENABLED", false),
    scanIntervalMs: envInt("PROGRESS_DIGEST_SCAN_INTERVAL_MS", 300_000),
    timezone: env("PROGRESS_DIGEST_TIMEZONE") || "Asia/Shanghai",
    digestHour: Math.min(23, Math.max(0, Number(env("PROGRESS_DIGEST_HOUR") || 9) | 0)),
    digestMinute: Math.min(59, Math.max(0, Number(env("PROGRESS_DIGEST_MINUTE") || 0) | 0)),
    weekdaysOnly: envFlag("PROGRESS_DIGEST_WEEKDAYS_ONLY", true),
    lookbackHours: envInt("PROGRESS_DIGEST_LOOKBACK_HOURS", 24),
    maxTaskLines: envInt("PROGRESS_DIGEST_MAX_TASK_LINES", 8),
    contentMode: envContentMode("PROGRESS_DIGEST_MODE", "delivery_reminder"),
    horizonDays: envInt("PROGRESS_DIGEST_HORIZON_DAYS", 7),
  };
}

export function getLocalTimeParts(
  now: Date,
  timezone: string,
): { hour: number; minute: number; weekday: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const weekdayRaw = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return { hour, minute, weekday: weekdayMap[weekdayRaw] ?? 0, ymd };
}

export function isDigestSendWindow(now: Date, policy: ProgressDigestPolicy): boolean {
  const { hour, minute, weekday } = getLocalTimeParts(now, policy.timezone);
  if (policy.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  const windowEndMinute = policy.digestMinute + Math.ceil(policy.scanIntervalMs / 60_000);
  if (hour !== policy.digestHour) return false;
  return minute >= policy.digestMinute && minute < windowEndMinute;
}
