import {
  formatFieldDisplayValue,
} from "../daily-report-digest/daily-report-attachments";
import { filterReportContentsWithBody } from "../daily-report-digest/daily-report-content-filter";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
  type DailyReportOrgConfig,
} from "../daily-report-digest/daily-report-config";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
  type ReportEntry,
} from "../daily-report-digest/dingtalk-report-client";
import type { DingTalkContactDirectory } from "../daily-report-digest/dingtalk-contact-search";
import { resolveDayRangeForYmd } from "../daily-report-digest/daily-report-window";
import { formatDateInTz } from "../reminders/reminder-policy";
import { findOrgsForEvalUser } from "./eval-roster";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface EvalReportItem {
  date: string;
  templateName: string;
  lines: string[];
}

export interface EvalWorkHourItem {
  date: string;
  templateName: string;
  slot: string;
  hours: number;
  project?: string;
  workModule?: string;
  taskType?: string;
}

export interface EvalWorkHourBreakdown {
  label: string;
  hours: number;
  sharePct: number;
}

export interface EvalWorkHoursSummary {
  totalHours: number;
  reportCount: number;
  coveredReportCount: number;
  loggedItemCount: number;
  unparsedHourFieldCount: number;
  byProject: EvalWorkHourBreakdown[];
  byWorkModule: EvalWorkHourBreakdown[];
  byTaskType: EvalWorkHourBreakdown[];
  items: EvalWorkHourItem[];
}

function ymdFromCreateTime(createTime: number, timezone: string): string {
  return formatDateInTz(new Date(createTime).toISOString(), timezone);
}

function formatReportEntryLines(report: ReportEntry): string[] {
  const lines: string[] = [];
  for (const field of filterReportContentsWithBody(report.contents)) {
    const key = field.key.trim();
    const display = formatFieldDisplayValue(field);
    if (key) {
      lines.push(`${key}：${display}`);
    } else {
      lines.push(display);
    }
  }
  if (lines.length === 0) lines.push("（无文本内容）");
  return lines;
}

/** Preserve every text log entry for evaluation; no character-based truncation. */
export function buildEvalReportLinesFromEntries(
  entries: ReportEntry[],
  timezone = "Asia/Shanghai",
): { reports: EvalReportItem[]; truncated: false; totalChars: number } {
  const sorted = [...entries].sort((a, b) => a.createTime - b.createTime);
  const reports: EvalReportItem[] = [];
  let totalChars = 0;

  for (const entry of sorted) {
    const lines = formatReportEntryLines(entry);
    reports.push({
      date: ymdFromCreateTime(entry.createTime, timezone),
      templateName: entry.templateName?.trim() || "日志",
      lines,
    });
    totalChars += lines.reduce((sum, line) => sum + line.length, 0);
  }

  return { reports, truncated: false, totalChars };
}

const HOUR_FIELD_PREFIX = "工时统计";
const WORK_MODULE_FIELD_PREFIX = "工作模块";
const PROJECT_FIELD_PREFIX = "成本归属项目";
const TASK_TYPE_FIELD_PREFIX = "任务类型";

function fieldSlot(key: string, prefix: string): string | null {
  const normalized = key.trim();
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length).trim() || "默认";
}

function parseHours(raw: string): number | null {
  const normalized = raw.trim().replaceAll("，", ".");
  const matched = normalized.match(/\d+(?:\.\d+)?/);
  if (!matched) return null;
  const hours = Number(matched[0]);
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildBreakdown(
  items: EvalWorkHourItem[],
  totalHours: number,
  labelOf: (item: EvalWorkHourItem) => string,
): EvalWorkHourBreakdown[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const label = labelOf(item).trim();
    totals.set(label, (totals.get(label) ?? 0) + item.hours);
  }
  return [...totals.entries()]
    .map(([label, hours]) => ({
      label,
      hours: roundHours(hours),
      sharePct: totalHours > 0 ? Math.round((hours / totalHours) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label, "zh-Hans-CN"));
}

/** Deterministic work-hour aggregation; the LLM explains these numbers but never guesses them. */
export function buildEvalWorkHoursSummary(
  entries: ReportEntry[],
  timezone = "Asia/Shanghai",
): EvalWorkHoursSummary {
  const items: EvalWorkHourItem[] = [];
  let coveredReportCount = 0;
  let unparsedHourFieldCount = 0;

  for (const entry of entries) {
    const fieldsBySlot = new Map<string, {
      project?: string;
      workModule?: string;
      taskType?: string;
    }>();
    const hourFields: Array<{ slot: string; raw: string }> = [];

    for (const field of entry.contents) {
      const key = field.key.trim();
      const display = formatFieldDisplayValue(field).trim();
      const hourSlot = fieldSlot(key, HOUR_FIELD_PREFIX);
      if (hourSlot) {
        hourFields.push({ slot: hourSlot, raw: display });
        continue;
      }
      const workModuleSlot = fieldSlot(key, WORK_MODULE_FIELD_PREFIX);
      const projectSlot = fieldSlot(key, PROJECT_FIELD_PREFIX);
      const taskTypeSlot = fieldSlot(key, TASK_TYPE_FIELD_PREFIX);
      const slot = workModuleSlot ?? projectSlot ?? taskTypeSlot;
      if (!slot || !display) continue;
      const grouped = fieldsBySlot.get(slot) ?? {};
      if (workModuleSlot) grouped.workModule = display;
      if (projectSlot) grouped.project = display;
      if (taskTypeSlot) grouped.taskType = display;
      fieldsBySlot.set(slot, grouped);
    }

    let reportCovered = false;
    for (const hourField of hourFields) {
      const hours = parseHours(hourField.raw);
      if (hours == null) {
        if (hourField.raw) unparsedHourFieldCount += 1;
        continue;
      }
      reportCovered = true;
      items.push({
        date: ymdFromCreateTime(entry.createTime, timezone),
        templateName: entry.templateName?.trim() || "日志",
        slot: hourField.slot,
        hours: roundHours(hours),
        ...fieldsBySlot.get(hourField.slot),
      });
    }
    if (reportCovered) coveredReportCount += 1;
  }

  const totalHours = roundHours(items.reduce((sum, item) => sum + item.hours, 0));
  return {
    totalHours,
    reportCount: entries.length,
    coveredReportCount,
    loggedItemCount: items.length,
    unparsedHourFieldCount,
    byProject: buildBreakdown(items, totalHours, (item) => item.project ?? "未填写项目"),
    byWorkModule: buildBreakdown(items, totalHours, (item) => item.workModule ?? "未填写工作模块"),
    byTaskType: buildBreakdown(items, totalHours, (item) => item.taskType ?? "未填写任务类型"),
    items,
  };
}

function dedupeReportEntries(entries: ReportEntry[]): ReportEntry[] {
  const seen = new Set<string>();
  const out: ReportEntry[] = [];
  for (const entry of entries) {
    const key =
      entry.reportId?.trim() ||
      `${entry.createTime}:${entry.templateName}:${entry.creatorUserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export async function fetchEmployeeDailyReportsForEval(
  input: { userId: string; startYmd: string; endYmd: string },
  deps?: {
    config?: DailyReportDigestConfig;
    reportClient?: DingTalkReportClient;
    contactDirectory?: DingTalkContactDirectory;
    fetchImpl?: typeof fetch;
  },
): Promise<
  | {
      ok: true;
      reports: EvalReportItem[];
      workHours: EvalWorkHoursSummary;
      truncated: false;
      totalChars: number;
    }
  | { ok: false; reason: string; message: string }
> {
  const userId = String(input.userId ?? "").trim();
  const startYmd = String(input.startYmd ?? "").trim();
  const endYmd = String(input.endYmd ?? "").trim();
  const config = deps?.config ?? loadDailyReportDigestConfig().config;

  if (!YMD_RE.test(startYmd) || !YMD_RE.test(endYmd)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "日期格式应为 YYYY-MM-DD",
    };
  }

  let matchingOrgs: DailyReportOrgConfig[];
  try {
    matchingOrgs = await findOrgsForEvalUser(userId, config, {
      directory: deps?.contactDirectory,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "directory_lookup_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (matchingOrgs.length === 0) {
    return {
      ok: false,
      reason: "not_in_configured_org",
      message: "未在已配置的钉钉组织通讯录中找到该员工",
    };
  }

  const timezone = config.timezone;
  const rangeOpts = {
    cutoffHour: config.reportDayCutoffHour,
    cutoffMinute: config.reportDayCutoffMinute,
  };
  const startRange = resolveDayRangeForYmd(startYmd, timezone, rangeOpts);
  const endRange = resolveDayRangeForYmd(endYmd, timezone, rangeOpts);
  if (startRange.startTime > endRange.endTime) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "开始日期不能晚于结束日期",
    };
  }

  const client =
    deps?.reportClient ?? createDingTalkReportClient({ fetchImpl: deps?.fetchImpl });
  const allEntries: ReportEntry[] = [];

  for (const org of matchingOrgs) {
    try {
      const reps = await client.fetchUserReports({
        appKey: org.appKey,
        appSecret: org.appSecret,
        userid: userId,
        templateName: org.templateName,
        startTime: startRange.startTime,
        endTime: endRange.endTime,
      });
      allEntries.push(...reps);
    } catch (err) {
      return {
        ok: false,
        reason: "fetch_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const merged = dedupeReportEntries(allEntries);
  const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(
    merged,
    timezone,
  );
  const workHours = buildEvalWorkHoursSummary(merged, timezone);

  return { ok: true, reports, workHours, truncated, totalChars };
}
