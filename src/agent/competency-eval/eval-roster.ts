import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../daily-report-digest/daily-report-config";

function resolveConfig(config?: DailyReportDigestConfig): DailyReportDigestConfig {
  return config ?? loadDailyReportDigestConfig().config;
}

/** Union of all `org.employees[].userid` from daily-report digest config. */
export function loadEvalRosterUserIds(config?: DailyReportDigestConfig): string[] {
  const cfg = resolveConfig(config);
  const ids = new Set<string>();
  for (const org of cfg.orgs) {
    for (const emp of org.employees) {
      const userid = String(emp.userid ?? "").trim();
      if (userid) ids.add(userid);
    }
  }
  return [...ids];
}

export function isUserInEvalRoster(userId: string, config?: DailyReportDigestConfig): boolean {
  const id = String(userId ?? "").trim();
  if (!id) return false;
  return loadEvalRosterUserIds(config).includes(id);
}
