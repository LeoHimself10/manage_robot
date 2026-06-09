import { filterReportContentsWithBody } from "./daily-report-content-filter";
import type { ReportEntry } from "./dingtalk-report-client";
import type { OrgDigest } from "./daily-report-build";
import type { DailyReportMorningSummary } from "./daily-report-morning-llm";

export interface PersonWorkbookLink {
  orgLabel: string;
  name: string;
  url: string;
  error?: string;
}

/** 方案 B：每日一个总表，每人一个 sheet。 */
export interface DailyWorkbookResult {
  url: string;
  workbookId?: string;
  name: string;
  sheetCount: number;
  sheetErrors: Array<{ orgLabel: string; name: string; error: string }>;
  error?: string;
}

export interface MorningReportBuildResult {
  title: string;
  text: string;
  submittedCount: number;
  missingCount: number;
  dailyWorkbook?: DailyWorkbookResult;
  /** @deprecated 方案 A 遗留；morning 模式现用 dailyWorkbook */
  workbookLinks?: PersonWorkbookLink[];
}

/** 把单人的日报内容转为表格行（字段 | 内容）。 */
export function reportEntriesToSheetRows(reports: ReportEntry[]): string[][] {
  const rows: string[][] = [["字段", "内容"]];
  let hasBody = false;
  for (const report of reports) {
    const contents = filterReportContentsWithBody(report.contents);
    if (contents.length === 0) continue;
    if (reports.length > 1 && report.templateName) {
      rows.push([`【${report.templateName}】`, ""]);
    }
    for (const field of contents) {
      const k = field.key.trim();
      const v = field.value.trim();
      rows.push([k || "内容", v]);
      hasBody = true;
    }
  }
  if (!hasBody) {
    rows.push(["（无正文）", ""]);
  }
  return rows;
}

export function renderMorningReportMarkdown(input: {
  title: string;
  dateLabel: string;
  summary: DailyReportMorningSummary;
  orgDigests: OrgDigest[];
  dailyWorkbook?: DailyWorkbookResult;
}): MorningReportBuildResult {
  let submittedCount = 0;
  let missingCount = 0;
  const parts: string[] = [];
  parts.push(`## ${input.title}`);
  parts.push(`> ${input.dateLabel}`);

  parts.push("");
  parts.push("### 昨日综述");
  parts.push("**整体进展**");
  parts.push(input.summary.overview);
  if (input.summary.personBriefs.length > 0) {
    parts.push("");
    parts.push("**个人简述**");
    for (const p of input.summary.personBriefs) {
      parts.push(`- ${p.name}：${p.brief}`);
    }
  }
  parts.push("");
  parts.push("**总结**");
  parts.push(input.summary.closing);

  for (const org of input.orgDigests) {
    submittedCount += org.submitted.length;
    missingCount += org.missing.length;
  }

  parts.push("");
  parts.push(`**统计**：已交 ${submittedCount} · 未交 ${missingCount}`);

  const wb = input.dailyWorkbook;
  if (wb?.url && !wb.error) {
    parts.push("");
    parts.push("### 昨日日报总表");
    parts.push(`- [${wb.name}](${wb.url})（${wb.sheetCount} 人）`);
  } else if (wb?.error) {
    parts.push("");
    parts.push(`> 日报总表生成失败：${wb.error}`);
  }

  if (wb?.sheetErrors && wb.sheetErrors.length > 0) {
    parts.push("");
    parts.push(
      `> 部分 sheet 写入失败：${wb.sheetErrors.map((e) => `${e.orgLabel}·${e.name}`).join("、")}`,
    );
  }

  const missingNames: string[] = [];
  for (const org of input.orgDigests) {
    for (const m of org.missing) missingNames.push(`${org.label}·${m.name}`);
  }
  if (missingNames.length > 0) {
    parts.push("");
    parts.push(`**未提交**：${missingNames.join("、")}`);
  }

  return {
    title: input.title,
    text: parts.join("\n"),
    submittedCount,
    missingCount,
    dailyWorkbook: wb,
  };
}
