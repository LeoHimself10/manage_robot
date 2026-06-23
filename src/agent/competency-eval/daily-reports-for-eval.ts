import {
  formatAttachmentSummary,
  formatFieldDisplayValue,
} from "../daily-report-digest/daily-report-attachments";
import { filterReportContentsWithBody } from "../daily-report-digest/daily-report-content-filter";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../daily-report-digest/daily-report-config";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
  type ReportEntry,
} from "../daily-report-digest/dingtalk-report-client";
import { resolveDayRangeForYmd } from "../daily-report-digest/daily-report-window";
import { formatDateInTz } from "../reminders/reminder-policy";
import { findOrgsForEvalUser, isUserInEvalRoster } from "./eval-roster";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface EvalReportItem {
  date: string;
  templateName: string;
  lines: string[];
}

export function getCompetencyEvalReportMaxChars(): number {
  const n = Number(process.env.COMPETENCY_EVAL_REPORT_MAX_CHARS ?? 48000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 48000;
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
  if ((report.images?.length ?? 0) > 0) {
    lines.push(`图片：${formatAttachmentSummary(report.images!)}`);
  }
  if (lines.length === 0) lines.push("（无内容）");
  return lines;
}

/** Pure formatter + truncator for eval LLM injection. */
export function buildEvalReportLinesFromEntries(
  entries: ReportEntry[],
  maxChars: number,
  timezone = "Asia/Shanghai",
): { reports: EvalReportItem[]; truncated: boolean; totalChars: number } {
  const sorted = [...entries].sort((a, b) => a.createTime - b.createTime);
  const reports: EvalReportItem[] = [];
  let totalChars = 0;
  let truncated = false;

  outer: for (const entry of sorted) {
    const lines = formatReportEntryLines(entry);
    const item: EvalReportItem = {
      date: ymdFromCreateTime(entry.createTime, timezone),
      templateName: entry.templateName?.trim() || "日志",
      lines: [],
    };

    for (const line of lines) {
      if (totalChars + line.length > maxChars) {
        const remaining = maxChars - totalChars;
        if (remaining > 0) {
          item.lines.push(line.slice(0, remaining));
          totalChars += remaining;
        }
        truncated = true;
        if (item.lines.length > 0) reports.push(item);
        break outer;
      }
      item.lines.push(line);
      totalChars += line.length;
    }

    if (item.lines.length > 0) reports.push(item);
  }

  return { reports, truncated, totalChars };
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
    fetchImpl?: typeof fetch;
  },
): Promise<
  | { ok: true; reports: EvalReportItem[]; truncated: boolean; totalChars: number }
  | { ok: false; reason: string; message: string }
> {
  const userId = String(input.userId ?? "").trim();
  const startYmd = String(input.startYmd ?? "").trim();
  const endYmd = String(input.endYmd ?? "").trim();
  const config = deps?.config ?? loadDailyReportDigestConfig().config;

  if (!isUserInEvalRoster(userId, config)) {
    return {
      ok: false,
      reason: "not_in_eval_roster",
      message: "该员工不在可评估日报名单内",
    };
  }

  if (!YMD_RE.test(startYmd) || !YMD_RE.test(endYmd)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "日期格式应为 YYYY-MM-DD",
    };
  }

  const matchingOrgs = findOrgsForEvalUser(userId, config);
  if (matchingOrgs.length === 0) {
    return {
      ok: false,
      reason: "not_in_eval_roster",
      message: "该员工不在可评估日报名单内",
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
  const maxChars = getCompetencyEvalReportMaxChars();
  const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(
    merged,
    maxChars,
    timezone,
  );

  return { ok: true, reports, truncated, totalChars };
}
