/** 渲染前 enrich / 判断草案展示形态（钉钉宽表、负责人列） */

export type AssigneeNameResolver = (userId: string) => string | undefined;

export function enrichDraftAssigneeDisplayNames(
  draft: Record<string, unknown>,
  resolveName: AssigneeNameResolver,
): Record<string, unknown> {
  const tasks = Array.isArray(draft.tasks)
    ? (draft.tasks as Array<Record<string, unknown>>)
    : [];
  if (tasks.length === 0) return draft;

  const enrichedTasks = tasks.map((task) => {
    const existing = String(task.assigneeDisplayName ?? "").trim();
    if (existing) return task;
    const userId = String(task.assigneeUserId ?? "").trim();
    if (!userId) return task;
    const name = resolveName(userId);
    if (!name) return task;
    return { ...task, assigneeDisplayName: name };
  });

  return { ...draft, tasks: enrichedTasks };
}

export function draftHasAssignedTasks(draft: unknown): boolean {
  if (!draft || typeof draft !== "object") return false;
  const tasks = Array.isArray((draft as Record<string, unknown>).tasks)
    ? ((draft as Record<string, unknown>).tasks as Array<Record<string, unknown>>)
    : [];
  return tasks.some((t) => {
    const uid = String(t?.assigneeUserId ?? "").trim();
    const name = String(t?.assigneeDisplayName ?? "").trim();
    return uid.length > 0 || name.length > 0;
  });
}

/** 模型在 message 里复述整张草案时，用短摘要替换（与下表去重） */
export function shouldSlimOrchestratorMessageForDraft(message: string): boolean {
  const text = message.trim();
  if (/以下是针对/.test(text)) return true;
  if (/子任务\s*\d+/.test(text) && text.length > 200) return true;
  if (text.length <= 400) return false;
  if (/子任务\s*\d+\s*[：:]/.test(text)) return true;
  if (/负责人\s*[：:]/.test(text)) return true;
  if (/交付物\s*[：:]/.test(text) && /完成标准/.test(text)) return true;
  if (/以下是.*完整草案/.test(text)) return true;
  return false;
}

export function draftHasRenderableTasks(draft: unknown): boolean {
  if (!draft || typeof draft !== "object") return false;
  const tasks = Array.isArray((draft as Record<string, unknown>).tasks)
    ? ((draft as Record<string, unknown>).tasks as unknown[])
    : [];
  return tasks.length > 0;
}

const DRAFT_MUTATING_TOOLS = new Set([
  "update_draft_task",
  "prepare_publish_task",
]);

/** 本轮应基于 session/currentDraft 追加宽表（增量改稿、分配后复核等） */
export function shouldAppendDraftTableFromSession(input: {
  freshDraft?: unknown;
  currentDraft?: unknown;
  toolInvocationNames?: string[];
  publishResult?: Record<string, unknown>;
}): boolean {
  if (input.freshDraft) return false;
  if (!draftHasRenderableTasks(input.currentDraft)) return false;
  const pr = input.publishResult;
  if (pr && String(pr.ok ?? "") === "true") return false;

  const tools = input.toolInvocationNames ?? [];
  if (tools.some((t) => DRAFT_MUTATING_TOOLS.has(t))) return true;
  if (draftHasAssignedTasks(input.currentDraft)) return true;
  return false;
}

const PUBLISH_CLAIM_PATTERN =
  /(?:任务)?已发布|发布成功|已正式下发|将收到通知|已通知.*员工/;

export function messageClaimsPublishedWithoutTool(input: {
  message: string;
  publishResult?: Record<string, unknown>;
  toolInvocationNames?: string[];
}): boolean {
  const text = input.message.trim();
  if (!text || !PUBLISH_CLAIM_PATTERN.test(text)) return false;
  if (input.toolInvocationNames?.includes("publish_task")) return false;
  const pr = input.publishResult;
  if (pr && String(pr.ok ?? "") === "true") return false;
  return true;
}

/** 模型口头「已发布」但未调 publish_task 时，改写 outbound，避免假发布 */
export function guardFalsePublishClaimInMessage(
  outboundMarkdown: string,
  input: {
    publishResult?: Record<string, unknown>;
    toolInvocationNames?: string[];
  },
): string {
  if (
    !messageClaimsPublishedWithoutTool({
      message: outboundMarkdown,
      publishResult: input.publishResult,
      toolInvocationNames: input.toolInvocationNames,
    })
  ) {
    return outboundMarkdown;
  }
  const trimmed = outboundMarkdown.trim();
  if (trimmed.length <= 120 && PUBLISH_CLAIM_PATTERN.test(trimmed)) {
    return (
      "**尚未正式发布**：系统未检测到 `publish_task` 成功执行。" +
      "请回复「确认发布」，我将调用发布工具写入正式任务并通知员工。"
    );
  }
  const stripped = trimmed
    .replace(/(?:任务)?已发布[^。\n]*[。]?/g, "")
    .replace(/发布成功[^。\n]*[。]?/g, "")
    .replace(/将收到通知[^。\n]*[。]?/g, "")
    .replace(/已通知[^。\n]*员工[^。\n]*[。]?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const prefix = stripped ? `${stripped}\n\n` : "";
  return (
    `${prefix}**尚未正式发布**：系统未检测到 \`publish_task\` 成功执行。` +
    `请回复「确认发布」，我将调用发布工具写入正式任务并通知员工。`
  );
}
