import type {
  ProgressDigestFacts,
  ProgressDigestFactsCore,
} from "./progress-digest-facts";
import { PROGRESS_DIGEST_MARKDOWN_MAX } from "./progress-digest-shared";
import {
  renderAttentionTable,
  renderInProgressTable,
  renderRecentUpdatesTable,
  renderSuggestionsSection,
} from "./progress-digest-tables";

export function buildDigestSubject(facts: ProgressDigestFacts): string {
  if (facts.isBrief) return `今日任务一览 · ${facts.dateDisplay}`;

  if (facts.audience === "combined") {
    const mgrNeeds = facts.managerCore?.summary.needsYouCount ?? 0;
    const empNeeds = facts.employeeCore?.summary.needsYouCount ?? 0;
    const total = mgrNeeds + empNeeds;
    if (total > 0) return `今日任务 · ${total}项需您处理`;
    return `今日任务一览 · ${facts.dateDisplay}`;
  }

  const needs = facts.core.summary.needsYouCount;
  if (needs > 0) return `今日任务 · ${needs}项需您处理`;
  return `今日任务一览 · ${facts.dateDisplay}`;
}

export function renderHeadline(core: ProgressDigestFactsCore, role: "manager" | "employee"): string {
  const { needsYouCount, inProgressCount } = core.summary;
  const running = inProgressCount + core.summary.waitingAcceptCount;
  if (role === "manager") {
    if (needsYouCount > 0 && running > 0) {
      return `有 ${needsYouCount} 项需要您处理，另有 ${running} 项员工正常推进。`;
    }
    if (needsYouCount > 0) return `有 ${needsYouCount} 项需要您处理。`;
    if (running > 0) return `${running} 项任务正常推进中，暂无待您处理项。`;
    return "当前无进行中的任务。";
  }
  if (needsYouCount > 0 && running > 0) {
    return `您有 ${needsYouCount} 项待处理，另有 ${running} 项执行中。`;
  }
  if (needsYouCount > 0) return `您有 ${needsYouCount} 项待处理。`;
  if (running > 0) return `${running} 项任务执行中，请按计划推进。`;
  return "当前无进行中的任务。";
}

function renderCoreSection(
  core: ProgressDigestFactsCore,
  role: "manager" | "employee",
  maxLines: number,
  activityLabel: string,
): string[] {
  const showAssignee = role === "manager";
  return [
    "### 需您处理",
    "",
    ...renderAttentionTable(core.needsAttention, { maxLines, showAssignee }),
    "",
    "### 正常推进",
    "",
    ...renderInProgressTable(core.inProgress, { maxLines, showAssignee }),
    "",
    `### 昨日动态（${activityLabel}）`,
    "",
    ...renderRecentUpdatesTable(core.recentUpdates),
    "",
  ];
}

export function renderBriefDigestTemplate(facts: ProgressDigestFacts): { subject: string; markdown: string } {
  const greeting = facts.recipientDisplayName ? `${facts.recipientDisplayName}，您好。` : "您好。";
  const markdown = [
    `### 今日任务一览 · ${facts.dateDisplay}`,
    "",
    greeting,
    "",
    "当前没有需要跟进的活跃任务。历史记录可在工作台查看。",
    "",
    "> 详情请点击下方按钮打开工作台",
  ].join("\n");
  return { subject: buildDigestSubject(facts), markdown };
}

export function renderProgressDigestTemplate(
  facts: ProgressDigestFacts,
  maxLines = 8,
  opts?: { headlineOverride?: string; suggestions?: string[] },
): { subject: string; markdown: string } {
  if (facts.isBrief) return renderBriefDigestTemplate(facts);

  const title =
    facts.audience === "employee"
      ? `### 我的任务一览 · ${facts.dateDisplay}`
      : `### 今日任务一览 · ${facts.dateDisplay}`;

  const lines: string[] = [title, "", "### 今日概览", ""];

  if (facts.audience === "combined" && facts.managerCore && facts.employeeCore) {
    lines.push(
      opts?.headlineOverride?.trim() ||
        `${renderHeadline(facts.managerCore, "manager")} ${renderHeadline(facts.employeeCore, "employee")}`.trim(),
      "",
    );
    const activityLabel = facts.activityWindow.labelDisplay;
    lines.push("### 我主管的任务", "");
    lines.push(...renderCoreSection(facts.managerCore, "manager", maxLines, activityLabel));
    lines.push("### 我负责的任务", "");
    lines.push(...renderCoreSection(facts.employeeCore, "employee", maxLines, activityLabel));
  } else {
    const role = facts.audience === "employee" ? "employee" : "manager";
    lines.push(opts?.headlineOverride?.trim() || renderHeadline(facts.core, role), "");
    lines.push(...renderCoreSection(facts.core, role, maxLines, facts.activityWindow.labelDisplay));
  }

  if (opts?.suggestions?.length) {
    lines.push(...renderSuggestionsSection(opts.suggestions));
  }

  lines.push("> 详情请点击下方按钮打开工作台");

  let markdown = lines.join("\n");
  if (markdown.length > PROGRESS_DIGEST_MARKDOWN_MAX) {
    markdown = `${markdown.slice(0, PROGRESS_DIGEST_MARKDOWN_MAX - 40)}\n\n…内容已截断，完整列表见工作台。`;
  }

  return { subject: buildDigestSubject(facts), markdown };
}
