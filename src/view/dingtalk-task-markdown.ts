/**
 * Deterministic rendering layer for DingTalk outbound markdown.
 *
 * DingTalk session webhook does not reliably render GFM pipe tables. The
 * canonical「结构化任务表」is rendered as plain numbered lists (not pipe tables).
 */

// ---------------------------------------------------------------------------
// hasTaskTableInMessage
// ---------------------------------------------------------------------------

export function hasTaskTableInMessage(markdown: string): boolean {
  return (
    markdown.includes("### 结构化任务表（列表）") ||
    markdown.includes("### 任务列表（结构化字段）") ||
    markdown.includes("### 任务草案（结构化字段）") ||
    markdown.includes("### 任务补充信息")
  );
}

/** Remove single-line pipe-table blobs the model sometimes inlines (DingTalk cannot render them). */
export function stripBrokenInlineTaskTable(message: string): string {
  const lines = message.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) return true;
    const pipeCount = (trimmed.match(/\|/g) ?? []).length;
    const looksLikeTableHeader =
      trimmed.includes("| # | 任务 |") ||
      trimmed.includes("| 序号 | 任务名称 |") ||
      trimmed.includes("|---|---|");
    return !(looksLikeTableHeader && pipeCount >= 4);
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function listField(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values.map((v) => String(v ?? "").trim()).filter(Boolean).join("；");
}

function buildAssignmentMaps(latestAssignment: unknown): {
  assigneeByTaskId: Map<string, string>;
  collaboratorsByTaskId: Map<string, string>;
} {
  const assigneeByTaskId = new Map<string, string>();
  const collaboratorsByTaskId = new Map<string, string>();
  if (!latestAssignment || typeof latestAssignment !== "object" || Array.isArray(latestAssignment)) {
    return { assigneeByTaskId, collaboratorsByTaskId };
  }
  const rows = (latestAssignment as { assignments?: unknown }).assignments;
  if (!Array.isArray(rows)) return { assigneeByTaskId, collaboratorsByTaskId };
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const taskId = String(r.taskId ?? "").trim();
    if (!taskId) continue;
    const primary = r.primary as Record<string, unknown> | undefined;
    const displayName = String(primary?.displayName ?? "").trim();
    const userId = String(primary?.userId ?? "").trim();
    if (displayName) assigneeByTaskId.set(taskId, displayName);
    else if (userId) assigneeByTaskId.set(taskId, userId);
    const collab = Array.isArray(r.collaborators)
      ? r.collaborators.map((c) => String(c ?? "").trim()).filter(Boolean).join("；")
      : "";
    if (collab) collaboratorsByTaskId.set(taskId, collab);
  }
  return { assigneeByTaskId, collaboratorsByTaskId };
}

function renderTaskListSection(draft: unknown, latestAssignment?: unknown): string {
  if (!draft || typeof draft !== "object") return "";
  const root = draft as Record<string, unknown>;
  const description = String(root.description ?? "").trim();
  const tasks = Array.isArray(root.tasks) ? (root.tasks as Array<Record<string, unknown>>) : [];
  if (tasks.length === 0) return "";

  const { assigneeByTaskId } = buildAssignmentMaps(latestAssignment);

  const blocks: string[] = ["### 结构化任务表（列表）"];
  if (description) {
    blocks.push(
      `任务背景：${description.length > 500 ? `${description.slice(0, 500)}…` : description}`,
    );
  }

  tasks.forEach((t, idx) => {
    const taskId = String(t.id ?? "").trim();
    const timeNode = (t.timeNode ?? {}) as Record<string, unknown>;
    const title = String(t.title ?? `#${idx + 1}`).trim();
    const objective = String(t.objective ?? "").trim();
    const dueAt = String(timeNode.dueAt ?? "").trim() || "待确认";
    const assignee = assigneeByTaskId.get(taskId) ?? "";
    const feedback = String(t.feedbackFrequency ?? "").trim() || "待确认";

    const lines: string[] = [`${idx + 1}. ${title}`];
    if (objective) lines.push(`目标：${objective}`);
    lines.push(`截止：${dueAt}`);
    if (assignee) lines.push(`负责人：${assignee}`);
    lines.push(`反馈频率：${feedback}`);
    blocks.push(lines.join("\n"));
  });

  return blocks.join("\n\n");
}

function renderTaskRichCard(
  t: Record<string, unknown>,
  idx: number,
  taskTitleById: Map<string, string>,
  assigneeByTaskId: Map<string, string>,
  collaboratorsByTaskId: Map<string, string>,
): string {
  const taskId = String(t.id ?? "").trim();
  const timeNode = (t.timeNode ?? {}) as Record<string, unknown>;
  const scope = (t.scope ?? {}) as Record<string, unknown>;
  const deps = Array.isArray(t.dependencyTaskIds) ? (t.dependencyTaskIds as unknown[]) : [];
  const depRendered = deps
    .map((d) => {
      const id = String(d ?? "").trim();
      const tt = taskTitleById.get(id);
      return tt ? `${id}（${tt}）` : id;
    })
    .filter(Boolean)
    .join("；");
  const checkpoints = Array.isArray(timeNode.checkpoints)
    ? timeNode.checkpoints.map((c) => String(c ?? "").trim()).filter(Boolean).join("；")
    : "";
  const risks = Array.isArray(t.risksAndOpenQuestions)
    ? (t.risksAndOpenQuestions as unknown[]).map((r) => String(r ?? "").trim()).filter(Boolean).join("；")
    : "";

  const assignee = assigneeByTaskId.get(taskId) ?? "";
  const collab = collaboratorsByTaskId.get(taskId) ?? "";
  const title = String(t.title ?? (taskId || `#${idx + 1}`)).trim();
  const header = assignee
    ? `**[#${idx + 1}] ${title}** — 负责人：${assignee}${collab ? `；协作：${collab}` : ""}`
    : `**[#${idx + 1}] ${title}**`;

  const bullets: string[] = [header];
  const objective = String(t.objective ?? "").trim();
  if (objective) bullets.push(`- 目标：${objective}`);
  const deliverables = listField(t.deliverables);
  if (deliverables) bullets.push(`- 交付物：${deliverables}`);
  const completion = listField(t.completionCriteria);
  if (completion) bullets.push(`- 完成标准：${completion}`);
  const actions = listField(t.actions);
  if (actions) bullets.push(`- 执行动作：${actions}`);
  const inputs = listField(t.inputMaterials);
  if (inputs) bullets.push(`- 输入材料：${inputs}`);
  if (depRendered) bullets.push(`- 前置依赖：${depRendered}`);
  if (checkpoints) bullets.push(`- 检查点：${checkpoints}`);
  if (risks) bullets.push(`- 风险：${risks}`);
  const inScope = listField(scope.inScope);
  if (inScope) bullets.push(`- 范围内：${inScope}`);
  const outScope = listField(scope.outOfScope);
  if (outScope) bullets.push(`- 范围外：${outScope}`);

  return bullets.join("\n");
}

/** Per-task rich-field cards (DingTalk-friendly). */
export function renderDraftSupplementSection(
  draft: unknown,
  latestAssignment?: unknown,
): string {
  if (!draft || typeof draft !== "object") return "";
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  if (tasks.length === 0) return "";

  const { assigneeByTaskId, collaboratorsByTaskId } = buildAssignmentMaps(latestAssignment);
  const taskTitleById = new Map<string, string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    const title = String(t?.title ?? "").trim();
    if (id) taskTitleById.set(id, title || id);
  }

  const cards = tasks.map((t, idx) =>
    renderTaskRichCard(t, idx, taskTitleById, assigneeByTaskId, collaboratorsByTaskId),
  );
  return ["### 任务补充信息", ...cards].join("\n\n");
}

// ---------------------------------------------------------------------------
// appendPublishSummaryMarkdown
// ---------------------------------------------------------------------------

export function appendPublishSummaryMarkdown(
  outboundMarkdown: string,
  publishResult?: Record<string, unknown>,
): string {
  if (!publishResult || String((publishResult as any).ok ?? "") !== "true") return outboundMarkdown;
  const publishTaskNo = String((publishResult as any)?.task?.taskNo ?? "").trim();
  if (String((publishResult as any).alreadyPublished ?? "") === "true") {
    if (publishTaskNo) {
      return `${outboundMarkdown}\n\n【已发布】此计划已发布过（任务编号 ${publishTaskNo}），未重复推送。`;
    }
    return `${outboundMarkdown}\n\n【已发布】此计划已发布过，未重复推送。`;
  }
  const subtaskCount = Array.isArray((publishResult as any).subtasks)
    ? (publishResult as any).subtasks.length
    : 0;
  const assignees = new Set<string>(
    Array.isArray((publishResult as any).subtasks)
      ? (publishResult as any).subtasks.map((s: any) => String(s?.assigneeUserId ?? "").trim()).filter(Boolean)
      : [],
  );
  const warningText = Array.isArray((publishResult as any).warnings)
    ? (publishResult as any).warnings.join("；")
    : "";
  let next = `${outboundMarkdown}\n\n【已发布】任务编号 ${publishTaskNo || "未知"}\n标题：${String((publishResult as any)?.task?.title ?? "未命名任务")}\n子任务 ${subtaskCount} 个 → 已通知 ${assignees.size} 名员工`;
  if (warningText) next += `\n${warningText}`;
  return next;
}

// ---------------------------------------------------------------------------
// renderDingtalkTaskMarkdown
// ---------------------------------------------------------------------------

export interface RenderDingtalkTaskMarkdownInput {
  modelMessage: string;
  currentDraft: unknown;
  latestAssignment?: unknown;
  shouldRenderRichSection: boolean;
  appendStructuredTaskTable: boolean;
  onModelDrewTable?: () => void;
  assignmentSection?: string;
  publishResult?: Record<string, unknown>;
  rotatePlanHintTail?: string;
}

export function renderDingtalkTaskMarkdown(input: RenderDingtalkTaskMarkdownInput): string {
  const {
    modelMessage,
    currentDraft,
    latestAssignment,
    shouldRenderRichSection,
    appendStructuredTaskTable,
    onModelDrewTable,
    assignmentSection = "",
    publishResult,
    rotatePlanHintTail = "",
  } = input;

  let outboundMarkdown = stripBrokenInlineTaskTable(modelMessage);

  if (shouldRenderRichSection) {
    const tasks = (currentDraft as any)?.tasks;
    if (
      appendStructuredTaskTable &&
      Array.isArray(tasks) &&
      tasks.length > 0 &&
      !hasTaskTableInMessage(outboundMarkdown)
    ) {
      const taskList = renderTaskListSection(currentDraft, latestAssignment);
      if (taskList) outboundMarkdown += `\n\n${taskList}`;
      const supplement = renderDraftSupplementSection(currentDraft, latestAssignment);
      if (supplement) outboundMarkdown += `\n\n${supplement}`;
    } else if (hasTaskTableInMessage(outboundMarkdown)) {
      onModelDrewTable?.();
    }
  }

  if (assignmentSection) {
    outboundMarkdown += assignmentSection;
  }
  outboundMarkdown = appendPublishSummaryMarkdown(outboundMarkdown, publishResult);
  if (rotatePlanHintTail) {
    outboundMarkdown += rotatePlanHintTail;
  }

  return outboundMarkdown;
}
