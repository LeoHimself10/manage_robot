export const REMINDER_TEMPLATE_VERSION = "followup-v1";

export type ReminderTier = "day1" | "day2plus";

export interface ReminderTemplateInput {
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  managerDisplayName?: string;
  overdueDays: number;
  tone?: "polite" | "firm";
  customMessage?: string;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildReminderMarkdown(input: ReminderTemplateInput): { subject: string; markdown: string } {
  if (input.customMessage?.trim()) {
    const subject = clip(`[催办] ${input.taskNo} · ${input.subtaskTitle}`, 120);
    return { subject, markdown: clip(input.customMessage.trim(), 2000) };
  }
  const mgr = input.managerDisplayName?.trim() || "主管";
  const days = Math.max(1, input.overdueDays);
  const firm = input.tone === "firm";
  const subject = clip(
    days <= 1 ? `[待办提醒] ${input.taskNo} · ${input.subtaskTitle}` : `[逾期催办] ${input.taskNo} · ${input.subtaskTitle}`,
    120,
  );
  const intro =
    days <= 1
      ? firm
        ? `**${mgr}** 提醒您：以下子任务已到期，请尽快处理。`
        : `**${mgr}** 提醒您：以下子任务已到截止日期，请安排推进。`
      : firm
        ? `**${mgr}** 催办：以下子任务已逾期 **${days}** 天，请今日内反馈进展。`
        : `**${mgr}** 跟进：以下子任务已逾期 **${days}** 天，请更新进度或说明阻塞。`;
  const markdown = [
    `### ${subject}`,
    intro,
    `- **任务**：${input.taskTitle}`,
    `- **子任务**：${input.subtaskTitle}`,
    `- **任务编号**：${input.taskNo}`,
  ].join("\n");
  return { subject, markdown: clip(markdown, 2000) };
}

export function resolveTierFromOverdueDays(overdueDays: number, tier2After: number): ReminderTier {
  return overdueDays > tier2After ? "day2plus" : "day1";
}

export function buildPreDueMarkdown(input: {
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  managerDisplayName?: string;
  dueDisplay?: string;
}): { subject: string; markdown: string } {
  const mgr = input.managerDisplayName?.trim() || "主管";
  const dueHint = input.dueDisplay ? `（${input.dueDisplay}）` : "";
  const subject = clip(`[明日截止] ${input.taskNo} · ${input.subtaskTitle}`, 120);
  const markdown = [
    `### ${subject}`,
    `**${mgr}** 提醒您：以下子任务**明日截止**${dueHint}，请提前安排推进。`,
    `- **任务**：${input.taskTitle}`,
    `- **子任务**：${input.subtaskTitle}`,
    `- **任务编号**：${input.taskNo}`,
  ].join("\n");
  return { subject, markdown: clip(markdown, 2000) };
}

export function buildManagerOverdueMarkdown(input: {
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  assigneeDisplayName?: string;
  dueDisplay?: string;
}): { subject: string; markdown: string } {
  const who = input.assigneeDisplayName?.trim() || "员工";
  const subject = clip(`[逾期提醒] ${input.taskNo} · ${input.subtaskTitle}`, 120);
  const markdown = [
    `### ${subject}`,
    `**${who}** 负责的执行中子任务已逾期，请关注并协调推进。`,
    `- **任务**：${input.taskTitle}`,
    `- **子任务**：${input.subtaskTitle}`,
    `- **截止**：${input.dueDisplay ?? "—"}`,
    `- **任务编号**：${input.taskNo}`,
  ].join("\n");
  return { subject, markdown: clip(markdown, 2000) };
}
