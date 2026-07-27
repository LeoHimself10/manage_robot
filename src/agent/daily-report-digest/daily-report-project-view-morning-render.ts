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

/** 直接使用已过滤的日志字段，确保卡片明确列出每个人昨天做了什么和登记工时。 */
export function renderProjectViewPersonWorkHours(digest: OrgDigest): string[] {
  return digest.submitted.flatMap((person) => {
    const items = person.reports.flatMap((report) =>
      MODULE_INDICES.flatMap((idx) => {
        const result = compact(
          report.contents.find((field) => field.key.includes("事项-结果") && field.key.includes(idx))?.value ?? "",
        );
        const hours = compact(
          report.contents.find((field) => field.key.includes("工时统计") && field.key.includes(idx))?.value ?? "",
        );
        if (!result && !hours) return [];
        if (result && hours) return [`${result}（工时：${hours}）`];
        return [result || `工时：${hours}`];
      }),
    );
    return items.length > 0 ? [`- ${person.name}：${items.join("；")}`] : [];
  });
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
  const personWorkHours = input.orgDigest
    ? renderProjectViewPersonWorkHours(input.orgDigest)
    : [];
  if (personWorkHours.length > 0) {
    parts.push("");
    parts.push("**昨日工作与工时**");
    parts.push(...personWorkHours);
  }
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

  parts.push("");
  parts.push(
    `**统计**：统计名单内 ${input.rosterCount} 人 · 昨日有 ${input.submittedCount} 人提交了与「${input.viewLabel}」相关的日报`,
  );

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
