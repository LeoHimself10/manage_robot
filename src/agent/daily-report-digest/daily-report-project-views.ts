import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import type { OrgDigest } from "./daily-report-build";
import { filterReportEntry } from "./daily-report-content-filter";
import {
  filterReportEntryByModuleProjectPair,
  type ModuleProjectPairFilter,
} from "./daily-report-project-view-filter";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
} from "./dingtalk-report-client";
import { logStructured } from "../../infra/logger";
import type { ReportTimeRange } from "./daily-report-window";

export interface DailyReportProjectViewConfig {
  id: string;
  label: string;
  /** 可查看此视图的用户 userid 白名单 */
  viewers: string[];
  /** 为 true 时 viewers 即使具备主管/admin 角色也不可见 legacy 公司/项目视图 */
  exclusiveForViewers?: boolean;
  /** org-wide 发现扫描近 N 自然日；默认 30 */
  discoveryDays?: number;
  filters: ModuleProjectPairFilter;
}

export interface DailyReportsAccessInfo {
  legacyAccess: boolean;
  customOnly: boolean;
  customViews: Array<{ id: string; label: string }>;
}

export interface WorkbenchDailyReportsCaps {
  canAccessAdmin: boolean;
  canManage: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDiscoveryDays(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

export function parseProjectViewConfig(raw: unknown, orgLabel: string): DailyReportProjectViewConfig | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = asString(o.id);
  const label = asString(o.label);
  const viewersRaw = Array.isArray(o.viewers) ? o.viewers : [];
  const viewers = viewersRaw.map((v) => asString(v)).filter(Boolean);
  const filtersRaw = (o.filters ?? {}) as Record<string, unknown>;
  const workModuleContains = asString(filtersRaw.workModuleContains);
  const costProjectContains = asString(filtersRaw.costProjectContains);
  if (!id || !label || viewers.length === 0) return null;
  if (!workModuleContains || !costProjectContains) return null;
  return {
    id,
    label,
    viewers,
    exclusiveForViewers: o.exclusiveForViewers === true,
    discoveryDays: parseDiscoveryDays(o.discoveryDays),
    filters: { workModuleContains, costProjectContains },
  };
}

export function listProjectViewsFromConfig(
  orgs: DailyReportOrgConfig[],
): Array<DailyReportProjectViewConfig & { orgLabel: string }> {
  const out: Array<DailyReportProjectViewConfig & { orgLabel: string }> = [];
  for (const org of orgs) {
    for (const raw of org.projectViews ?? []) {
      const parsed = parseProjectViewConfig(raw, org.label);
      if (parsed) out.push({ ...parsed, orgLabel: org.label });
    }
  }
  return out;
}

export function isExclusiveCustomViewer(
  userId: string,
  views: Array<DailyReportProjectViewConfig & { orgLabel?: string }>,
): boolean {
  return views.some((v) => v.exclusiveForViewers && v.viewers.includes(userId));
}

export function resolveDailyReportsAccess(
  userId: string,
  config: DailyReportDigestConfig,
  caps: WorkbenchDailyReportsCaps,
): DailyReportsAccessInfo {
  const allViews = listProjectViewsFromConfig(config.orgs);
  const customViews = allViews
    .filter((v) => v.viewers.includes(userId))
    .map((v) => ({ id: v.id, label: v.label }));
  const exclusive = isExclusiveCustomViewer(userId, allViews);
  const legacyAccess =
    caps.canAccessAdmin || (caps.canManage && !exclusive);
  const customOnly = !legacyAccess && customViews.length > 0;
  return { legacyAccess, customOnly, customViews };
}

export function findProjectViewById(
  config: DailyReportDigestConfig,
  viewId: string,
): (DailyReportProjectViewConfig & { orgLabel: string }) | undefined {
  return listProjectViewsFromConfig(config.orgs).find((v) => v.id === viewId);
}

/** MVP：只拉指定组织全员日志，按 module+project 过滤，不统计未交/请假。 */
export async function collectCustomProjectViewDigest(
  org: DailyReportOrgConfig,
  view: DailyReportProjectViewConfig,
  range: ReportTimeRange,
  deps?: { reportClient?: DingTalkReportClient; fetchImpl?: typeof fetch },
): Promise<OrgDigest> {
  const client =
    deps?.reportClient ?? createDingTalkReportClient({ fetchImpl: deps?.fetchImpl });
  const submitted: OrgDigest["submitted"] = [];
  const errors: OrgDigest["errors"] = [];

  for (const emp of org.employees) {
    try {
      const reps = await client.fetchUserReports({
        appKey: org.appKey,
        appSecret: org.appSecret,
        userid: emp.userid,
        templateName: org.templateName,
        startTime: range.startTime,
        endTime: range.endTime,
      });
      const filteredReports = reps
        .map((r) => filterReportEntryByModuleProjectPair(r, view.filters))
        .map((r) => filterReportEntry(r))
        .filter((r) => r.contents.length > 0);
      if (filteredReports.length > 0) {
        const name =
          filteredReports[0]?.creatorName?.trim() || emp.name?.trim() || emp.userid;
        submitted.push({ userid: emp.userid, name, reports: filteredReports });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({
        userid: emp.userid,
        name: emp.name?.trim() || emp.userid,
        reason,
      });
      logStructured({
        event: "daily_report_custom_view_fetch_failed",
        org: org.label,
        viewId: view.id,
        userid: emp.userid,
        reason,
      });
    }
  }

  return { label: org.label, submitted, missing: [], onLeave: [], errors };
}
