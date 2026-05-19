export interface ReminderPolicy {
  enabled: boolean;
  scanIntervalMs: number;
  timezone: string;
  tier2AfterOverdueDays: number;
  quietHours: { startMin: number; endMin: number } | null;
  manualLlmEnabled: boolean;
  manualLlmTimeoutMs: number;
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

/** Parse "HH:MM-HH:MM" into minutes-from-midnight; supports overnight ranges. */
export function parseQuietHours(raw: string): { startMin: number; endMin: number } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (startMin < 0 || startMin >= 24 * 60 || endMin < 0 || endMin >= 24 * 60) return null;
  return { startMin, endMin };
}

export function isInQuietHours(now: Date, quiet: { startMin: number; endMin: number } | null): boolean {
  if (!quiet) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.FOLLOWUP_TIMEZONE?.trim() || "Asia/Shanghai",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const cur = hour * 60 + minute;
  const { startMin, endMin } = quiet;
  if (startMin <= endMin) {
    return cur >= startMin && cur < endMin;
  }
  return cur >= startMin || cur < endMin;
}

export function loadReminderPolicy(): ReminderPolicy {
  const quietRaw = env("FOLLOWUP_QUIET_HOURS") || "22:00-08:00";
  return {
    enabled: envFlag("FOLLOWUP_REMINDER_ENABLED", false),
    scanIntervalMs: envInt("FOLLOWUP_SCAN_INTERVAL_MS", 300_000),
    timezone: env("FOLLOWUP_TIMEZONE") || "Asia/Shanghai",
    tier2AfterOverdueDays: envInt("FOLLOWUP_TIER2_AFTER_OVERDUE_DAYS", 1),
    quietHours: parseQuietHours(quietRaw),
    manualLlmEnabled: envFlag("FOLLOWUP_MANUAL_LLM_ENABLED", true),
    manualLlmTimeoutMs: envInt("FOLLOWUP_MANUAL_LLM_TIMEOUT_MS", 5000),
  };
}

/** YYYY-MM-DD in policy timezone. */
export function formatDateInTz(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function startOfDayInTz(now: Date, timezone: string): string {
  const ymd = formatDateInTz(now.toISOString(), timezone);
  return `${ymd}T00:00:00.000Z`;
}
