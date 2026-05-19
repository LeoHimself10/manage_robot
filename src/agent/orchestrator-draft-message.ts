/** 模型只返回 draft、message 为空时，生成简短用户可见摘要（避免钉钉只显示空行+表） */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

/**
 * 终轮 JSON 无 message、或流式 content 解析后为空时，从 rawContent / 工具痕迹恢复用户可见文案。
 * 避免钉钉落到「已收到，正在处理中。」
 */
export function recoverOrchestratorUserMessage(input: {
  message: string;
  rawContent?: string;
  lastAssistantContent?: string;
  toolInvocationNames?: string[];
  draft?: Record<string, unknown>;
}): string {
  const existing = String(input.message ?? "").trim();
  if (existing) return existing;

  for (const candidate of [
    String(input.rawContent ?? "").trim(),
    String(input.lastAssistantContent ?? "").trim(),
  ]) {
    if (!candidate) continue;
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const jsonText = (fenced ?? candidate).trim();
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const fromMsg = String(
        parsed.message ?? parsed.assistantMessage ?? "",
      ).trim();
      if (fromMsg) return fromMsg;
      if (isPlainObject(parsed.draft)) {
        const d = parsed.draft;
        const tasks = Array.isArray(d.tasks) ? d.tasks : [];
        if (tasks.length > 0) return synthesizeMessageFromDraft(d);
      }
    } catch {
      if (!jsonText.startsWith("{") && jsonText.length > 0) {
        return jsonText.slice(0, 8000);
      }
    }
  }

  const tools = input.toolInvocationNames ?? [];
  if (tools.includes("update_known_facts") && !tools.includes("search_employees")) {
    return "已记录您补充的信息。若关键信息已齐，我将继续为您生成或更新任务草案。";
  }
  const searchCount = tools.filter((t) => t === "search_employees").length;
  if (searchCount >= 2) {
    return (
      "已完成人员检索（本轮搜索次数较多，未再自动展开）。\n\n" +
      "请直接回复要指派的人员姓名，或发送「分配吧」让我按当前草案给出分配建议。"
    );
  }
  if (input.draft && Array.isArray((input.draft as { tasks?: unknown }).tasks)) {
    return synthesizeMessageFromDraft(input.draft);
  }

  return "已记录您的消息，正在根据当前会话继续编排；请稍候或再发一句「继续」。";
}
