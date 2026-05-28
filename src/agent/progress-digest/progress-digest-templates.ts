import type {
  DeliveryReminderCore,
  DigestDueSoonItem,
  ProgressDigestFacts,
  ProgressDigestFactsCore,
} from "./progress-digest-facts";
import { dedupeCombinedManagerDueSoon } from "./progress-digest-facts";
import { PROGRESS_DIGEST_MARKDOWN_MAX } from "./progress-digest-shared";
import {
  renderAttentionTable,
  renderDueSoonTable,
  renderInProgressTable,
  renderRecentUpdatesTable,
  renderSuggestionsSection,
} from "./progress-digest-tables";

export function buildDeliveryDigestSubject(facts: ProgressDigestFacts): string {
  if (facts.isBrief) return `近一周交付 · ${facts.dateDisplay}`;

  const userId = facts.recipientUserId ?? "";

  if (facts.audience === "employee") {
    const count = facts.deliveryReminder?.core?.dueSoon.length ?? 0;
    return count > 0 ? `我的近一周交付 · ${count}项` : `近一周交付 · ${facts.dateDisplay}`;
  }

  if (facts.audience === "combined" && facts.deliveryReminder?.manager && facts.deliveryReminder.employee) {
    const team = dedupeCombinedManagerDueSoon(
      facts.deliveryReminder.manager,
      facts.deliveryReminder.employee,
      userId,
    );
    const total = facts.deliveryReminder.employee.dueSoon.length + team.length;
    return total > 0 ? `近一周交付 · ${total}项` : `近一周交付 · ${facts.dateDisplay}`;
  }

  const count = facts.deliveryReminder?.core?.dueSoon.length ?? facts.deliveryReminder?.manager?.dueSoon.length ?? 0;
  return count > 0 ? `近一周交付 · ${count}项` : `近一周交付 · ${facts.dateDisplay}`;
}

function skippedSummaryLine(core: DeliveryReminderCore): string | undefined {
  const parts: string[] = [];
  if (core.skippedBeyondHorizon > 0) {
    parts.push(`${core.skippedBeyondHorizon} 项截止在更晚`);
  }
  if (core.skippedNoDueDate > 0) {
    parts.push(`${core.skippedNoDueDate} 项未设截止`);
  }
  if (parts.length === 0) return undefined;
  return `另有 ${parts.join("、")}，见工作台。`;
}

function renderDeliverySection(
  title: string | undefined,
  intro: string,
  items: DigestDueSoonItem[],
  core: DeliveryReminderCore,
  maxLines: number,
  showAssignee: boolean,
): string[] {
  const lines: string[] = [];
  if (title) lines.push(title, "");
  lines.push(intro, "");
  lines.push(...renderDueSoonTable(items, { maxLines, showAssignee }));
  const skipped = skippedSummaryLine(core);
  if (skipped) {
    lines.push("", skipped);
  }
  lines.push("");
  return lines;
}

export function renderDeliveryBriefDigestTemplate(facts: ProgressDigestFacts): {
  subject: string;
  markdown: string;
} {
  const greeting = facts.recipientDisplayName ? `${facts.recipientDisplayName}，您好。` : "您好。";
  const markdown = [
    `### 近一周交付提醒 · ${facts.dateDisplay}`,
    "",
    greeting,
    "",
    "近一周暂无到期子任务。更多任务请在工作台查看。",
    "",
    "> 详情请点击下方按钮打开工作台",
  ].join("\n");
  return { subject: buildDeliveryDigestSubject(facts), markdown };
}

export function renderDeliveryReminderTemplate(
  facts: ProgressDigestFacts,
  maxLines = 8,
): { subject: string; markdown: string } {
  if (facts.isBrief) return renderDeliveryBriefDigestTemplate(facts);

  const userId = facts.recipientUserId ?? "";

  const title =
    facts.audience === "employee"
      ? `### 我的近一周交付 · ${facts.dateDisplay}`
      : `### 近一周交付提醒 · ${facts.dateDisplay}`;

  const lines: string[] = [title, ""];

  if (facts.audience === "combined" && facts.deliveryReminder?.manager && facts.deliveryReminder.employee) {
    const employeeCore = facts.deliveryReminder.employee;
    const teamItems = dedupeCombinedManagerDueSoon(
      facts.deliveryReminder.manager,
      employeeCore,
      userId,
    );
    if (employeeCore.dueSoon.length > 0) {
      lines.push(
        ...renderDeliverySection(
          "### 我负责的任务",
          `以下任务已逾期或将在一周内到期（共 ${employeeCore.dueSoon.length} 项）：`,
          employeeCore.dueSoon,
          employeeCore,
          maxLines,
          false,
        ),
      );
    }
    if (teamItems.length > 0) {
      lines.push(
        ...renderDeliverySection(
          "### 我主管的任务",
          `以下子任务已逾期或将在一周内到期（团队共 ${teamItems.length} 项）：`,
          teamItems,
          facts.deliveryReminder.manager,
          maxLines,
          true,
        ),
      );
    }
  } else {
    const core =
      facts.deliveryReminder?.core ??
      (facts.audience === "manager" ? facts.deliveryReminder?.manager : facts.deliveryReminder?.employee);
    if (!core) {
      return renderDeliveryBriefDigestTemplate(facts);
    }
    const showAssignee = facts.audience !== "employee";
    const intro =
      facts.audience === "employee"
        ? `以下任务已逾期或将在一周内到期（共 ${core.dueSoon.length} 项）：`
        : `以下子任务已逾期或将在一周内到期（共 ${core.dueSoon.length} 项）：`;
    lines.push(...renderDeliverySection(undefined, intro, core.dueSoon, core, maxLines, showAssignee));
  }

  lines.push("> 详情请点击下方按钮打开工作台");

  let markdown = lines.join("\n");
  if (markdown.length > PROGRESS_DIGEST_MARKDOWN_MAX) {
    markdown = `${markdown.slice(0, PROGRESS_DIGEST_MARKDOWN_MAX - 40)}\n\n…内容已截断，完整列表见工作台。`;
  }

  return { subject: buildDeliveryDigestSubject(facts), markdown };
}

export function buildDigestSubject(facts: ProgressDigestFacts): string {
  if (facts.contentMode === "delivery_reminder") return buildDeliveryDigestSubject(facts);
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
