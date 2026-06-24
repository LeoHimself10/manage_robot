import { filterReportEntryForView } from "./daily-report-project-view-filter";
import {
  isOthersProjectView,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import type { ReportEntry } from "./dingtalk-report-client";

/** 微光 CTO 日报统计：三类研发模板优先参与统一日筛与分桶。 */
export const RD_DAILY_TEMPLATE_MATCHERS = [
  "研发中心日志",
  "研发管理者日志",
  "研发试用期日志",
] as const;

export function isRdDailyTemplate(templateName: string): boolean {
  const n = String(templateName ?? "").trim();
  if (!n) return false;
  return RD_DAILY_TEMPLATE_MATCHERS.some((m) => n.includes(m));
}

export function isMedicalAffairsTemplate(templateName: string): boolean {
  return String(templateName ?? "").trim().includes("医学事务");
}

export function reportMatchesAnyProjectKeyword(
  entry: ReportEntry,
  projectViews: Array<DailyReportProjectViewConfig & { orgLabel?: string }>,
): boolean {
  for (const view of projectViews) {
    if (isOthersProjectView(view)) continue;
    const hasFilter =
      view.filters.keyword?.trim()
      || (view.filters.workModuleContains?.trim()
        && view.filters.costProjectContains?.trim());
    if (!hasFilter) continue;
    const filtered = filterReportEntryForView(entry, view.filters);
    if (filtered.contents.length > 0) return true;
  }
  return false;
}

/**
 * 统一日筛准入：排除医学事务部；三类研发模板全收；
 * 其他模板若模块命中任一项目关键词/成对过滤也纳入（与改版前 per-view 行为一致）。
 */
export function reportEligibleForUnifiedPartition(
  entry: ReportEntry,
  projectViews: Array<DailyReportProjectViewConfig & { orgLabel?: string }>,
): boolean {
  if (isMedicalAffairsTemplate(entry.templateName)) return false;
  if (isRdDailyTemplate(entry.templateName)) return true;
  return reportMatchesAnyProjectKeyword(entry, projectViews);
}
