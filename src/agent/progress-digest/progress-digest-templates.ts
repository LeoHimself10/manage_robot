import type {
  DigestInProgressItem,
  DigestRecentUpdate,
  ProgressDigestFacts,
  ProgressDigestFactsCore,
} from "./progress-digest-facts";
import { PROGRESS_DIGEST_MARKDOWN_MAX } from "./progress-digest-shared";

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

function renderHeadline(core: ProgressDigestFactsCore, role: "manager" | "employee"): string {
  const { needsYouCount, inProgressCount } = core.summary;
  const running = inProgressCount + core.summary.waitingAcceptCount;
  if (role === "manager") {
    if (needsYouCount > 0 && running > 0) {
      return `**有 ${needsYouCount} 项需要您处理，另有 ${running} 项员工正常推进。**`;
    }
    if (needsYouCount > 0) return `**有 ${needsYouCount} 项需要您处理。**`;
    if (running > 0) return `**${running} 项任务正常推进中，暂无待您处理项。**`;
    return "**当前无进行中的任务。**";
  }
  if (needsYouCount > 0 && running > 0) {
    return `**您有 ${needsYouCount} 项待处理，另有 ${running} 项执行中。**`;
  }
  if (needsYouCount > 0) return `**您有 ${needsYouCount} 项待处理。**`;
  if (running > 0) return `**${running} 项任务执行中，请按计划推进。**`;
  return "**当前无进行中的任务。**";
}

function renderAttentionItem(item: {
  taskTitle: string;
  assigneeNames?: string[];
  assigneeName?: string;
  statusLabel: string;
  dueLabel?: string;
  reasonHint?: string;
  subtaskTitle?: string;
}): string[] {
  const who =
    item.assigneeNames && item.assigneeNames.length > 0
      ? item.assigneeNames.join("、")
      : item.assigneeName;
  const meta = [who, item.statusLabel, item.dueLabel].filter(Boolean).join(" · ");
  const title = item.subtaskTitle && item.subtaskTitle !== item.taskTitle
    ? `**${item.taskTitle}**（${item.subtaskTitle}）`
    : `**${item.taskTitle}**`;
  const lines = [`- ${title}${meta ? `（${meta}）` : ""}`];
  if (item.reasonHint) lines.push(`  ${item.reasonHint}`);
  return lines;
}

function renderInProgressItem(item: DigestInProgressItem): string {
  const meta = [item.assigneeName, item.statusLabel, item.dueLabel].filter(Boolean).join(" · ");
  const title =
    item.subtaskTitle && item.subtaskTitle !== item.taskTitle
      ? `**${item.taskTitle}**（${item.subtaskTitle}）`
      : `**${item.taskTitle}**`;
  const overdueHint = item.overdue ? " · 已逾期" : "";
  return `- ${title}（${meta}${overdueHint}）`;
}

function renderRecentUpdates(updates: DigestRecentUpdate[]): string[] {
  if (updates.length === 0) return ["- 暂无新的任务动态。"];
  return updates.map((u) => {
    const target = u.subtaskTitle ? `「${u.subtaskTitle}」` : `「${u.taskTitle}」`;
    const note = u.note ? `：${u.note}` : "";
    return `- ${u.timeLabel} ${u.actorName}${u.actionLabel}${target}${note}`;
  });
}

function renderCoreSection(
  core: ProgressDigestFactsCore,
  role: "manager" | "employee",
  maxLines: number,
): string[] {
  const lines: string[] = [];
  lines.push(renderHeadline(core, role), "");

  lines.push("**需您处理**", "");
  if (core.needsAttention.length === 0) {
    lines.push("- 暂无", "");
  } else {
    const shown = core.needsAttention.slice(0, maxLines);
    for (const item of shown) lines.push(...renderAttentionItem(item));
    if (core.needsAttention.length > shown.length) {
      lines.push(`- 另有 ${core.needsAttention.length - shown.length} 项，请打开工作台查看`);
    }
    lines.push("");
  }

  lines.push("**正常推进**", "");
  if (core.inProgress.length === 0) {
    lines.push("- 暂无", "");
  } else {
    const shown = core.inProgress.slice(0, maxLines);
    lines.push(...shown.map(renderInProgressItem));
    if (core.inProgress.length > shown.length) {
      lines.push(`- 另有 ${core.inProgress.length - shown.length} 项，请打开工作台查看`);
    }
    lines.push("");
  }

  lines.push("**最近更新**（过去 24 小时）", "");
  lines.push(...renderRecentUpdates(core.recentUpdates));
  lines.push("");
  return lines;
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
): { subject: string; markdown: string } {
  if (facts.isBrief) return renderBriefDigestTemplate(facts);

  const title =
    facts.audience === "employee"
      ? `### 我的任务一览 · ${facts.dateDisplay}`
      : `### 今日任务一览 · ${facts.dateDisplay}`;

  const lines: string[] = [title, ""];

  if (facts.audience === "combined" && facts.managerCore && facts.employeeCore) {
    lines.push("#### 我主管的任务", "");
    lines.push(...renderCoreSection(facts.managerCore, "manager", maxLines));
    lines.push("#### 我负责的任务", "");
    lines.push(...renderCoreSection(facts.employeeCore, "employee", maxLines));
  } else {
    const role = facts.audience === "employee" ? "employee" : "manager";
    lines.push(...renderCoreSection(facts.core, role, maxLines));
  }

  lines.push("> 详情请点击下方按钮打开工作台");

  let markdown = lines.join("\n");
  if (markdown.length > PROGRESS_DIGEST_MARKDOWN_MAX) {
    markdown = `${markdown.slice(0, PROGRESS_DIGEST_MARKDOWN_MAX - 40)}\n\n…内容已截断，完整列表见工作台。`;
  }

  return { subject: buildDigestSubject(facts), markdown };
}
