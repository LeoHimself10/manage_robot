import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import { configHasLegacyDailyReportEmployees } from "./daily-report-config";
import type { ModuleProjectPairFilter } from "./daily-report-project-view-filter";
import { isDailyReportProjectViewsEnabled } from "./daily-report-project-view-flag";

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
  if (!isDailyReportProjectViewsEnabled()) return [];
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
  const hasLegacy = configHasLegacyDailyReportEmployees(config.orgs);
  const customViews = (caps.canAccessAdmin
    ? allViews
    : allViews.filter((v) => v.viewers.includes(userId))
  ).map((v) => ({ id: v.id, label: v.label }));
  const exclusive = isExclusiveCustomViewer(userId, allViews);
  const legacyAccess =
    hasLegacy && (caps.canAccessAdmin || (caps.canManage && !exclusive));
  const customOnly = !legacyAccess && customViews.length > 0;
  return { legacyAccess, customOnly, customViews };
}

export function findProjectViewById(
  config: DailyReportDigestConfig,
  viewId: string,
): (DailyReportProjectViewConfig & { orgLabel: string }) | undefined {
  return listProjectViewsFromConfig(config.orgs).find((v) => v.id === viewId);
}

export { collectProjectViewDigestForRange } from "./daily-report-project-view-collect";
