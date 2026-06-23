export interface CtoRollupProjectLine {
  viewId: string;
  viewLabel: string;
  rosterCount: number;
  submittedCount: number;
  /** 一行摘要（项目整体 overview） */
  line: string;
}

export interface CtoRollupMorningRenderResult {
  title: string;
  text: string;
  projectLines: CtoRollupProjectLine[];
}

/** 去掉 overview 中与卡片重复的日期、提交人数等套话。 */
export function sanitizeCtoRollupOverviewLine(raw: string, viewLabel?: string): string {
  let t = String(raw ?? "").trim();
  if (!t || t === "暂无相关记录") return t;

  t = t.replace(/^\d{1,2}月\d{1,2}日(（\d{4}-\d{2}-\d{2}）)?[，,、：:\s]*/u, "");
  if (viewLabel) {
    const escaped = viewLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^${escaped}[，,、：:\\s]*`, "u"), "");
  }
  t = t.replace(/^[^。；]+?(共有|仅有|共)\s*\d+\s*[^。；]*?(提交|日报|成员|人次)[^。；]*?[，,、；;\s]*/u, "");
  t = t.replace(/^共\s*\d+\s*人提交日报[，,、；;\s]*/u, "");
  t = t.replace(/^统计名单内[^。；]*?[，,、；;\s]*/u, "");
  t = t.replace(/^昨日[^。；]*?(提交|暂无|有)[^。；]*?[，,、；;\s]*/u, "");

  t = t.replace(/\r\n/g, "\n").replace(/\s+/g, " ");
  return t.trim();
}

export function buildCtoRollupProjectLine(input: {
  viewId: string;
  viewLabel: string;
  rosterCount: number;
  submittedCount: number;
  overviewLine: string;
}): CtoRollupProjectLine {
  let line =
    input.submittedCount === 0
      ? "暂无相关记录"
      : sanitizeCtoRollupOverviewLine(input.overviewLine, input.viewLabel) ||
        "详见工作台日报汇总";
  return {
    viewId: input.viewId,
    viewLabel: input.viewLabel,
    rosterCount: input.rosterCount,
    submittedCount: input.submittedCount,
    line,
  };
}

export function renderCtoRollupMorningMarkdown(input: {
  dateLabel: string;
  dateYmd: string;
  projectLines: CtoRollupProjectLine[];
  workbenchUrl?: string;
}): CtoRollupMorningRenderResult {
  const parts: string[] = [];
  parts.push("## 微光研发 · 昨日项目日报");
  parts.push(`> ${input.dateLabel}`);

  parts.push("");
  parts.push("### 各项目昨日");
  for (const p of input.projectLines) {
    parts.push(
      `- **${p.viewLabel}** · ${p.submittedCount}/${p.rosterCount} 人 · ${p.line}`,
    );
  }

  const totalSubmitted = input.projectLines.reduce((n, p) => n + p.submittedCount, 0);
  parts.push("");
  parts.push(
    `**合计**：${input.projectLines.length} 个项目 · 昨日共 ${totalSubmitted} 人次提交相关日报`,
  );

  if (input.workbenchUrl) {
    parts.push("");
    parts.push("### 查看详情");
    parts.push(`- [工作台 · 全部项目](${input.workbenchUrl})`);
  }

  return {
    title: "微光研发 · 昨日项目日报",
    text: parts.join("\n"),
    projectLines: input.projectLines,
  };
}
