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
  if (text.length <= 400) return false;
  if (/子任务\s*\d+\s*[：:]/.test(text)) return true;
  if (/负责人\s*[：:]/.test(text)) return true;
  if (/交付物\s*[：:]/.test(text) && /完成标准/.test(text)) return true;
  if (/以下是.*完整草案/.test(text)) return true;
  return false;
}
