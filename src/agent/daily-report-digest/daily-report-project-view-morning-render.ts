import type { DailyReportMorningSummary } from "./daily-report-morning-llm";

export interface ProjectViewMorningRenderResult {
  title: string;
  text: string;
  submittedCount: number;
  rosterCount: number;
}

export function renderProjectViewMorningMarkdown(input: {
  viewLabel: string;
  dateLabel: string;
  dateYmd: string;
  summary: DailyReportMorningSummary;
  submittedCount: number;
  rosterCount: number;
  workbenchUrl?: string;
}): ProjectViewMorningRenderResult {
  const parts: string[] = [];
  parts.push(`## ${input.viewLabel} · 项目组早报`);
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
