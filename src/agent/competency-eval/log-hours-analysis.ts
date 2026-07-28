import type {
  EvalWorkHourItem,
  EvalWorkHoursSummary,
} from "./daily-reports-for-eval";

export const EVAL_LOG_ANALYSIS_DIMENSIONS = [
  "project",
  "workModule",
  "taskType",
  "date",
  "template",
] as const;

export type EvalLogAnalysisDimension =
  (typeof EVAL_LOG_ANALYSIS_DIMENSIONS)[number];

export interface EvalLogAnalysisFilters {
  projectContains?: string;
  workModuleContains?: string;
  taskTypeContains?: string;
}

export interface EvalLogAnalysisGroup {
  dimensions: Partial<Record<EvalLogAnalysisDimension, string>>;
  hours: number;
  sharePct: number;
  itemCount: number;
}

export interface EvalLogHoursAnalysis {
  groupBy: EvalLogAnalysisDimension[];
  filters: EvalLogAnalysisFilters;
  sourceTotalHours: number;
  matchedHours: number;
  matchedItemCount: number;
  reportCount: number;
  reportsWithHours: number;
  unparsedHourFieldCount: number;
  groups: EvalLogAnalysisGroup[];
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeContains(value: string | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase("zh-Hans-CN");
}

function includesNormalized(value: string | undefined, query: string): boolean {
  if (!query) return true;
  return String(value ?? "").toLocaleLowerCase("zh-Hans-CN").includes(query);
}

function dimensionValue(
  item: EvalWorkHourItem,
  dimension: EvalLogAnalysisDimension,
): string {
  if (dimension === "project") return item.project?.trim() || "未填写项目";
  if (dimension === "workModule") return item.workModule?.trim() || "未填写工作模块";
  if (dimension === "taskType") return item.taskType?.trim() || "未填写任务类型";
  if (dimension === "template") return item.templateName.trim() || "日志";
  return item.date;
}

export function normalizeEvalLogAnalysisDimensions(
  raw: unknown,
): EvalLogAnalysisDimension[] {
  const values = Array.isArray(raw) ? raw : [];
  const allowed = new Set<string>(EVAL_LOG_ANALYSIS_DIMENSIONS);
  const normalized = values
    .map((value) => String(value ?? "").trim())
    .filter((value): value is EvalLogAnalysisDimension => allowed.has(value));
  const unique = [...new Set(normalized)];
  return unique.length > 0 ? unique.slice(0, 3) : ["project"];
}

export function analyzeEvalWorkHours(
  summary: EvalWorkHoursSummary,
  input?: {
    groupBy?: EvalLogAnalysisDimension[];
    filters?: EvalLogAnalysisFilters;
    limit?: number;
  },
): EvalLogHoursAnalysis {
  const groupBy = normalizeEvalLogAnalysisDimensions(input?.groupBy);
  const filters: EvalLogAnalysisFilters = {
    projectContains: String(input?.filters?.projectContains ?? "").trim() || undefined,
    workModuleContains: String(input?.filters?.workModuleContains ?? "").trim() || undefined,
    taskTypeContains: String(input?.filters?.taskTypeContains ?? "").trim() || undefined,
  };
  const projectQuery = normalizeContains(filters.projectContains);
  const workModuleQuery = normalizeContains(filters.workModuleContains);
  const taskTypeQuery = normalizeContains(filters.taskTypeContains);
  const matchedItems = summary.items.filter(
    (item) =>
      includesNormalized(item.project, projectQuery)
      && includesNormalized(item.workModule, workModuleQuery)
      && includesNormalized(item.taskType, taskTypeQuery),
  );
  const matchedHours = roundHours(
    matchedItems.reduce((sum, item) => sum + item.hours, 0),
  );

  const grouped = new Map<string, {
    dimensions: Partial<Record<EvalLogAnalysisDimension, string>>;
    hours: number;
    itemCount: number;
  }>();
  for (const item of matchedItems) {
    const dimensions = Object.fromEntries(
      groupBy.map((dimension) => [dimension, dimensionValue(item, dimension)]),
    ) as Partial<Record<EvalLogAnalysisDimension, string>>;
    const key = JSON.stringify(dimensions);
    const current = grouped.get(key) ?? { dimensions, hours: 0, itemCount: 0 };
    current.hours += item.hours;
    current.itemCount += 1;
    grouped.set(key, current);
  }

  const requestedLimit = Number(input?.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50;
  const groups = [...grouped.values()]
    .map((group) => ({
      dimensions: group.dimensions,
      hours: roundHours(group.hours),
      sharePct:
        matchedHours > 0
          ? Math.round((group.hours / matchedHours) * 1000) / 10
          : 0,
      itemCount: group.itemCount,
    }))
    .sort((a, b) => b.hours - a.hours || JSON.stringify(a.dimensions).localeCompare(JSON.stringify(b.dimensions)))
    .slice(0, limit);

  return {
    groupBy,
    filters,
    sourceTotalHours: summary.totalHours,
    matchedHours,
    matchedItemCount: matchedItems.length,
    reportCount: summary.reportCount,
    reportsWithHours: summary.coveredReportCount,
    unparsedHourFieldCount: summary.unparsedHourFieldCount,
    groups,
  };
}
