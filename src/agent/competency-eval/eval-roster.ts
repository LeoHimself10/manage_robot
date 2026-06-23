import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
  type DailyReportOrgConfig,
} from "../daily-report-digest/daily-report-config";
import { parseProjectViewConfig } from "../daily-report-digest/daily-report-project-views";
import {
  createProjectViewRosterStore,
  listProjectViewRoster,
} from "../daily-report-digest/daily-report-project-view-roster-store";

function resolveConfig(config?: DailyReportDigestConfig): DailyReportDigestConfig {
  return config ?? loadDailyReportDigestConfig().config;
}

function loadDigestEmployeeUserIds(config: DailyReportDigestConfig): string[] {
  const ids = new Set<string>();
  for (const org of config.orgs) {
    for (const emp of org.employees) {
      const userid = String(emp.userid ?? "").trim();
      if (userid) ids.add(userid);
    }
  }
  return [...ids];
}

/** managebot 项目组视图名单（SQLite roster，与 legacy org.employees 互补）。 */
export function loadProjectViewRosterUserIds(): string[] {
  const store = createProjectViewRosterStore();
  try {
    const rows = store.db
      .prepare("SELECT DISTINCT user_id FROM daily_report_project_view_roster")
      .all() as Array<{ user_id: string }>;
    return rows.map((r) => String(r.user_id ?? "").trim()).filter(Boolean);
  } finally {
    store.close();
  }
}

/**
 * 可评估名单：digest `org.employees` ∪ 全部 projectView roster。
 * managebot 侧通常只有后者（employees 为空）。
 */
export function loadEvalRosterUserIds(config?: DailyReportDigestConfig): string[] {
  const cfg = resolveConfig(config);
  const ids = new Set<string>(loadDigestEmployeeUserIds(cfg));
  for (const uid of loadProjectViewRosterUserIds()) ids.add(uid);
  return [...ids];
}

export function isUserInEvalRoster(userId: string, config?: DailyReportDigestConfig): boolean {
  const id = String(userId ?? "").trim();
  if (!id) return false;
  return loadEvalRosterUserIds(config).includes(id);
}

/** 为拉日报解析钉钉 org 凭证：employees 命中或 projectView roster 命中。 */
export function findOrgsForEvalUser(
  userId: string,
  config?: DailyReportDigestConfig,
): DailyReportOrgConfig[] {
  const cfg = resolveConfig(config);
  const id = String(userId ?? "").trim();
  if (!id) return [];

  const fromEmployees = cfg.orgs.filter((org) =>
    org.employees.some((emp) => emp.userid === id),
  );
  if (fromEmployees.length > 0) return fromEmployees;

  const views: Array<{ id: string; orgLabel: string }> = [];
  for (const org of cfg.orgs) {
    for (const raw of org.projectViews ?? []) {
      const parsed = parseProjectViewConfig(raw, org.label);
      if (parsed) views.push({ id: parsed.id, orgLabel: org.label });
    }
  }
  const store = createProjectViewRosterStore();
  try {
    const orgLabels = new Set<string>();
    for (const view of views) {
      const members = listProjectViewRoster(view.id, store);
      if (members.some((m) => m.userid === id)) {
        orgLabels.add(view.orgLabel);
      }
    }
    if (orgLabels.size === 0) return [];
    return cfg.orgs.filter((org) => orgLabels.has(org.label));
  } finally {
    store.close();
  }
}
