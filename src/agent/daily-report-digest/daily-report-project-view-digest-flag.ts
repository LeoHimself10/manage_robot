function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isDailyReportProjectViewDigestEnabled(): boolean {
  return envFlag("DAILY_REPORT_PROJECT_VIEW_DIGEST_ENABLED", false);
}

export function parseProjectViewDigestExcludeUserIdsFromEnv(): string[] {
  const raw = String(process.env.DAILY_REPORT_PROJECT_VIEW_DIGEST_EXCLUDE_USER_IDS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
