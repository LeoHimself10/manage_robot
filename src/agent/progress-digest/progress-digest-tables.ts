import type { DigestDueSoonItem } from "./progress-digest-facts";
import type {
  DigestAttentionItem,
  DigestInProgressItem,
  DigestRecentUpdate,
} from "./progress-digest-facts";

function clipCell(value: string | undefined, max: number): string {
  const t = String(value ?? "").trim().replace(/\|/g, "／").replace(/\n/g, " ");
  if (!t) return "—";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function escapePipeRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

export function renderDueSoonTable(
  items: DigestDueSoonItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const headers = opts.showAssignee
    ? ["任务", "子任务", "负责人", "截止", "状态"]
    : ["任务", "子任务", "截止", "状态"];
  const lines = [escapePipeRow(headers), escapePipeRow(headers.map(() => "---"))];
  const shown = items.slice(0, opts.maxLines);
  for (const item of shown) {
    const row = opts.showAssignee
      ? [
          clipCell(item.taskTitle, 18),
          clipCell(item.subtaskTitle, 16),
          clipCell(item.assigneeName, 10),
          clipCell(item.dueLabel, 12),
          clipCell(item.statusLabel, 12),
        ]
      : [
          clipCell(item.taskTitle, 20),
          clipCell(item.subtaskTitle, 18),
          clipCell(item.dueLabel, 12),
          clipCell(item.statusLabel, 12),
        ];
    lines.push(escapePipeRow(row));
  }
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

export function renderAttentionTable(
  items: DigestAttentionItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const headers = opts.showAssignee
    ? ["任务", "子任务", "负责人", "状态", "截止", "备注"]
    : ["任务", "子任务", "状态", "截止", "备注"];
  const lines = [escapePipeRow(headers), escapePipeRow(headers.map(() => "---"))];
  const shown = items.slice(0, opts.maxLines);
  for (const item of shown) {
    const who =
      item.assigneeNames && item.assigneeNames.length > 0
        ? item.assigneeNames.join("、")
        : "—";
    const status = item.overdue ? `${item.statusLabel}（已逾期）` : item.statusLabel;
    const note = clipCell(item.reasonHint ?? (item.overdue ? "子任务已逾期，请跟进" : undefined), 24);
    const row = opts.showAssignee
      ? [
          clipCell(item.taskTitle, 18),
          clipCell(item.subtaskTitle, 16),
          clipCell(who, 10),
          clipCell(status, 12),
          clipCell(item.dueLabel, 12),
          note,
        ]
      : [
          clipCell(item.taskTitle, 20),
          clipCell(item.subtaskTitle, 18),
          clipCell(status, 12),
          clipCell(item.dueLabel, 12),
          note,
        ];
    lines.push(escapePipeRow(row));
  }
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

export function renderInProgressTable(
  items: DigestInProgressItem[],
  opts: { maxLines: number; showAssignee: boolean },
): string[] {
  if (items.length === 0) return ["暂无"];
  const headers = opts.showAssignee
    ? ["任务", "子任务", "负责人", "状态", "截止"]
    : ["任务", "子任务", "状态", "截止"];
  const lines = [escapePipeRow(headers), escapePipeRow(headers.map(() => "---"))];
  const shown = items.slice(0, opts.maxLines);
  for (const item of shown) {
    const status = item.overdue ? `${item.statusLabel}（已逾期）` : item.statusLabel;
    const row = opts.showAssignee
      ? [
          clipCell(item.taskTitle, 18),
          clipCell(item.subtaskTitle, 16),
          clipCell(item.assigneeName, 10),
          clipCell(status, 12),
          clipCell(item.dueLabel, 12),
        ]
      : [
          clipCell(item.taskTitle, 20),
          clipCell(item.subtaskTitle, 18),
          clipCell(status, 12),
          clipCell(item.dueLabel, 12),
        ];
    lines.push(escapePipeRow(row));
  }
  if (items.length > shown.length) {
    lines.push(`另有 ${items.length - shown.length} 项，请打开工作台查看`);
  }
  return lines;
}

export function renderRecentUpdatesTable(updates: DigestRecentUpdate[]): string[] {
  if (updates.length === 0) return ["暂无"];
  const lines = [
    escapePipeRow(["时间", "人员", "动作", "任务", "说明"]),
    escapePipeRow(["---", "---", "---", "---", "---"]),
  ];
  for (const u of updates) {
    lines.push(
      escapePipeRow([
        clipCell(u.timeLabel, 8),
        clipCell(u.actorName, 10),
        clipCell(u.actionLabel, 10),
        clipCell(u.subtaskTitle ? `${u.taskTitle}/${u.subtaskTitle}` : u.taskTitle, 20),
        clipCell(u.note, 24),
      ]),
    );
  }
  return lines;
}

export function renderSuggestionsSection(suggestions: string[]): string[] {
  if (suggestions.length === 0) return [];
  const lines = ["### 后续建议", ""];
  for (const s of suggestions.slice(0, 3)) {
    lines.push(`- ${clipCell(s, 40)}`);
  }
  lines.push("");
  return lines;
}
