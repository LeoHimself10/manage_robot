import type { DailyReportMorningSummary } from "./daily-report-morning-llm";
import type { OrgDigest } from "./daily-report-build";

export interface ProjectViewMorningRenderResult {
  title: string;
  text: string;
  submittedCount: number;
  rosterCount: number;
}

const MODULE_INDICES = ["①", "②", "③", "④", "⑤", "⑥"] as const;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** 汇总每位相关人员登记在已过滤项目模块中的工时，不把原始日志全文复制进卡片。 */
export function sumProjectViewPersonHours(digest: OrgDigest): Map<string, number> {
  const hoursByName = new Map<string, number>();
  for (const person of digest.submitted) {
    let total = 0;
    for (const report of person.reports) {
      for (const idx of MODULE_INDICES) {
        const raw = compact(
          report.contents.find((field) => field.key.includes("工时统计") && field.key.includes(idx))?.value ?? "",
        );
        const amounts = raw.match(/\d+(?:\.\d+)?/g) ?? [];
        total += amounts.reduce((sum, value) => sum + Number(value), 0);
      }
    }
    if (total > 0) hoursByName.set(person.name, total);
  }
  return hoursByName;
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function renderProjectViewMorningMarkdown(input: {
  viewLabel: string;
  dateLabel: string;
  dateYmd: string;
  summary: DailyReportMorningSummary;
  submittedCount: number;
  rosterCount: number;
  orgDigest?: OrgDigest;
  workbenchUrl?: string;
}): ProjectViewMorningRenderResult {
  const parts: string[] = [];
  parts.push(`## ${input.viewLabel} · 项目组早报`);
  parts.push(`> ${input.dateLabel}`);

  parts.push("");
  parts.push("### 昨日综述");
  parts.push("**整体进展**");
  parts.push(input.summary.overview);
  const hoursByName = input.orgDigest
    ? sumProjectViewPersonHours(input.orgDigest)
    : new Map<string, number>();
  const submittedNames = input.orgDigest?.submitted.map((person) => person.name) ?? [];
  const briefByName = new Map(input.summary.personBriefs.map((person) => [person.name, person.brief]));
  if (submittedNames.length > 0) {
    parts.push("");
    parts.push("**个人简述与工时**");
    for (const name of submittedNames) {
      const brief = briefByName.get(name) || "已提交相关日报，详情见工作台原日志。";
      const hours = hoursByName.get(name);
      parts.push(`- ${name}：${brief}${hours == null ? "" : `（工时：${formatHours(hours)}小时）`}`);
    }
  }
  parts.push("");
  parts.push("**总结**");
  parts.push(input.summary.closing);

  parts.push("");
  parts.push(`**统计**：昨日与「${input.viewLabel}」相关的日报共 ${input.submittedCount} 人提交`);

  if (input.workbenchUrl) {
    parts.push("");
    parts.push("### 查看昨日日报");
    parts.push(`- [工作台日报汇总（${input.viewLabel}）](${input.workbenchUrl})`);
  }

  return {
    title: `${input.viewLabel} · 项目组早报`,
    text: parts.join("\n"),
    submittedCount: input.submittedCount,
    rosterCount: input.rosterCount,
  };
}
