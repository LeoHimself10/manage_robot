import type { ReportEntry } from "./dingtalk-report-client";
import type { OrgDigest } from "./daily-report-build";
import type { DailyReportMorningSummary } from "./daily-report-morning-llm";
import type { CreatedWorkbook } from "./dingtalk-workbook-client";

export interface PersonWorkbookLink {
  orgLabel: string;
  name: string;
  url: string;
  error?: string;
}

export interface MorningReportBuildResult {
  title: string;
  text: string;
  submittedCount: number;
  missingCount: number;
  workbookLinks: PersonWorkbookLink[];
}

/** 把单人的日报内容转为表格行（字段 | 内容）。 */
export function reportEntriesToSheetRows(reports: ReportEntry[]): string[][] {
  const rows: string[][] = [["字段", "内容"]];
  for (const report of reports) {
    if (reports.length > 1 && report.templateName) {
      rows.push([`【${report.templateName}】`, ""]);
    }
    for (const field of report.contents) {
      const k = field.key.trim();
      const v = field.value.trim();
      if (!k && !v) continue;
      rows.push([k || "内容", v || k]);
    }
    if (report.contents.length === 0) {
      rows.push(["（无正文）", ""]);
    }
  }
  return rows;
}

export function renderMorningReportMarkdown(input: {
  title: string;
  dateLabel: string;
  summary: DailyReportMorningSummary;
  orgDigests: OrgDigest[];
  workbookLinks: PersonWorkbookLink[];
}): MorningReportBuildResult {
  let submittedCount = 0;
  let missingCount = 0;
  const parts: string[] = [];
  parts.push(`## ${input.title}`);
  parts.push(`> ${input.dateLabel}`);

  parts.push("");
  parts.push("### 昨日综述");
  parts.push(input.summary.headline);
  if (input.summary.highlights.length > 0) {
    parts.push("");
    for (const h of input.summary.highlights) {
      parts.push(`- ${h}`);
    }
  }
  if (input.summary.attention) {
    parts.push("");
    parts.push(`> ⚠️ ${input.summary.attention}`);
  }

  for (const org of input.orgDigests) {
    submittedCount += org.submitted.length;
    missingCount += org.missing.length;
  }

  parts.push("");
  parts.push(`**统计**：已交 ${submittedCount} · 未交 ${missingCount}`);

  const okLinks = input.workbookLinks.filter((l) => l.url && !l.error);
  const failLinks = input.workbookLinks.filter((l) => l.error);

  if (okLinks.length > 0) {
    parts.push("");
    parts.push("### 个人日报表格");
    for (const link of okLinks) {
      parts.push(`- [${link.orgLabel} · ${link.name}](${link.url})`);
    }
  }

  if (failLinks.length > 0) {
    parts.push("");
    parts.push(`> 表格生成失败 ${failLinks.length} 人：${failLinks.map((l) => l.name).join("、")}`);
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
    workbookLinks: input.workbookLinks,
  };
}
