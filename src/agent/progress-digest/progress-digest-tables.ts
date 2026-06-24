import type { DigestDueSoonItem } from "./progress-digest-facts";
import type {
  DigestAttentionItem,
  DigestInProgressItem,
  DigestRecentUpdate,
} from "./progress-digest-facts";

/** DingTalk ActionCard（sampleActionCard）不支持 GFM 管道表格，用列表块渲染。 */
function clipCell(value: string | undefined, max: number): string {
  const t = String(value ?? "").trim().replace(/\n/g, " ");
  if (!t) return "—";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function itemHeading(taskTitle: string, subtaskTitle?: string): string {
  const task = clipCell(taskTitle, 28);
  const sub = String(subtaskTitle ?? "").trim();
  if (!sub) return task;
  return `${task} · ${clipCell(sub, 20)}`;
}

function renderDueSoonItem(
  item: DigestDueSoonItem,
  index: number,
  showAssignee: boolean,
): string[] {
  const lines = [`#### ${index}. ${itemHeading(item.taskTitle, item.subtaskTitle)}`];
  if (showAssignee) {
    lines.push(`- **负责人**：${clipCell(item.assigneeName, 16)}`);
  }
  lines.push(`- **截止**：${clipCell(item.dueLabel, 16)}`);
  lines.push(`- **状态**：${clipCell(item.statusLabel, 16)}`);
  lines.push("");
  return lines;
}

export function renderDueSoonTable(
  items: DigestDueSoonItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const lines: string[] = [];
  const shown = items.slice(0, opts.maxLines);
  shown.forEach((item, idx) => {
    lines.push(...renderDueSoonItem(item, idx + 1, opts.showAssignee));
  });
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

function renderAttentionItem(
  item: DigestAttentionItem,
  index: number,
  showAssignee: boolean,
): string[] {
  const status = item.overdue ? `${item.statusLabel}（已逾期）` : item.statusLabel;
  const note = clipCell(item.reasonHint ?? (item.overdue ? "子任务已逾期，请跟进" : undefined), 48);
  const who =
    item.assigneeNames && item.assigneeNames.length > 0
      ? item.assigneeNames.join("、")
      : "—";
  const lines = [`#### ${index}. ${itemHeading(item.taskTitle, item.subtaskTitle)}`];
  if (showAssignee) {
    lines.push(`- **负责人**：${clipCell(who, 16)}`);
  }
  lines.push(`- **状态**：${clipCell(status, 16)}`);
  lines.push(`- **截止**：${clipCell(item.dueLabel, 16)}`);
  if (note !== "—") {
    lines.push(`- **备注**：${note}`);
  }
  lines.push("");
  return lines;
}

export function renderAttentionTable(
  items: DigestAttentionItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const lines: string[] = [];
  const shown = items.slice(0, opts.maxLines);
  shown.forEach((item, idx) => {
    lines.push(...renderAttentionItem(item, idx + 1, opts.showAssignee));
  });
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

function renderInProgressItem(
  item: DigestInProgressItem,
  index: number,
  showAssignee: boolean,
): string[] {
  const status = item.overdue ? `${item.statusLabel}（已逾期）` : item.statusLabel;
  const lines = [`#### ${index}. ${itemHeading(item.taskTitle, item.subtaskTitle)}`];
  if (showAssignee) {
    lines.push(`- **负责人**：${clipCell(item.assigneeName, 16)}`);
  }
  lines.push(`- **状态**：${clipCell(status, 16)}`);
  lines.push(`- **截止**：${clipCell(item.dueLabel, 16)}`);
  lines.push("");
  return lines;
}

export function renderInProgressTable(
  items: DigestInProgressItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const lines: string[] = [];
  const shown = items.slice(0, opts.maxLines);
  shown.forEach((item, idx) => {
    lines.push(...renderInProgressItem(item, idx + 1, opts.showAssignee));
  });
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

export function renderRecentUpdatesTable(updates: DigestRecentUpdate[]): string[] {
  if (updates.length === 0) return ["暂无"];
  const lines: string[] = [];
  for (const u of updates) {
    const taskLabel = u.subtaskTitle
      ? `${clipCell(u.taskTitle, 20)}/${clipCell(u.subtaskTitle, 16)}`
      : clipCell(u.taskTitle, 28);
    const note = clipCell(u.note, 32);
    const noteSuffix = note !== "—" ? ` — ${note}` : "";
    lines.push(
      `- **${clipCell(u.timeLabel, 8)}** ${clipCell(u.actorName, 10)} · ${clipCell(u.actionLabel, 10)} · ${taskLabel}${noteSuffix}`,
    );
  }
  return lines;
}

export function renderSuggestionsSection(suggestions: string[]): string[] {
  if (suggestions.length === 0) return [];
  const lines = ["### 后续建议", ""];
  for (const s of suggestions.slice(0, 3)) {
    lines.push(`- ${clipCell(s, 80)}`);
  }
  lines.push("");
  return lines;
}
