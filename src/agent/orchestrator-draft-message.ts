/** 模型只返回 draft、message 为空时，生成简短用户可见摘要（避免钉钉只显示空行+表） */

export function synthesizeMessageFromDraft(draft: Record<string, unknown>): string {
  const title = String(draft.title ?? "").trim() || "任务草案";
  const objective = String(draft.objective ?? "").trim();
  const tasks = Array.isArray(draft.tasks) ? (draft.tasks as Array<Record<string, unknown>>) : [];
  const lines: string[] = [`已生成任务草案：**${title}**。`];
  if (objective) {
    const short =
      objective.length > 120 ? `${objective.slice(0, 120)}…` : objective;
    lines.push(`- **目标**：${short}`);
  }
  if (tasks.length > 0) {
    lines.push(`- **子任务**：共 ${tasks.length} 条（详见下表）`);
    const firstDue = tasks
      .map((t) => {
        const tn = (t.timeNode ?? {}) as Record<string, unknown>;
        return String(tn.dueAt ?? "").trim();
      })
      .find((d) => d && d !== "待确认");
    if (firstDue) lines.push(`- **截止**：${firstDue}`);
  }
  lines.push("- 如需调整请直接说明；确认发布请回复「确认发布」。");
  return lines.join("\n");
}
