/**
 * Deterministic rendering layer for DingTalk outbound markdown.
 *
 * Unified main task table (scheme C): structure from draft, assignee/collaborator from latestAssignment.
 */

// ---------------------------------------------------------------------------
// hasTaskTableInMessage
// ---------------------------------------------------------------------------

export function hasTaskTableInMessage(markdown: string): boolean {
  const normalized = markdown.toLowerCase();
  return (
    normalized.includes("### 任务列表（结构化字段）") ||
    normalized.includes("### 任务草案（结构化字段）") ||
    normalized.includes("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |") ||
    normalized.includes("| 序号 | 任务名称 |") ||
    normalized.includes("| 负责人 | 协作人 |")
  );
}

function listField(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values.map((v) => String(v ?? "").trim()).filter(Boolean).join("；");
}

function escapeCell(text: string): string {
  return String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
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

function renderUnifiedTaskTable(draft: unknown, latestAssignment?: unknown): string {
  if (!draft || typeof draft !== "object") return "";
  const root = draft as Record<string, unknown>;
  const description = String(root.description ?? "").trim();
  const tasks = Array.isArray(root.tasks) ? (root.tasks as Array<Record<string, unknown>>) : [];
  if (tasks.length === 0) return "";

  const { assigneeByTaskId, collaboratorsByTaskId } = buildAssignmentMaps(latestAssignment);
  const taskTitleById = new Map<string, string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    const title = String(t?.title ?? "").trim();
    if (id) taskTitleById.set(id, title || id);
  }

  const lines: string[] = ["### 任务列表（结构化字段）"];
  if (description) {
    lines.push(`**任务背景**：${description.length > 500 ? `${description.slice(0, 500)}…` : description}`);
  }

  const header =
    "| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 | 负责人 | 协作人 | 前置依赖 | 检查点 | 风险 | 输入材料 | 执行动作 | 范围内 | 范围外 |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  lines.push(header, sep);

  tasks.forEach((t, idx) => {
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

    lines.push(
      `| ${idx + 1} `
      + `| ${escapeCell(String(t.title ?? ""))} `
      + `| ${escapeCell(String(t.objective ?? ""))} `
      + `| ${escapeCell(listField(t.deliverables) || "-")} `
      + `| ${escapeCell(listField(t.completionCriteria) || "-")} `
      + `| ${escapeCell(String(timeNode.dueAt ?? "待确认"))} `
      + `| ${escapeCell(String(t.feedbackFrequency ?? "待确认"))} `
      + `| ${escapeCell(assigneeByTaskId.get(taskId) ?? "")} `
      + `| ${escapeCell(collaboratorsByTaskId.get(taskId) ?? "")} `
      + `| ${escapeCell(depRendered || "-")} `
      + `| ${escapeCell(checkpoints || "-")} `
      + `| ${escapeCell(risks || "-")} `
      + `| ${escapeCell(listField(t.inputMaterials) || "-")} `
      + `| ${escapeCell(listField(t.actions) || "-")} `
      + `| ${escapeCell(listField(scope.inScope) || "-")} `
      + `| ${escapeCell(listField(scope.outOfScope) || "-")} |`,
    );
  });

  return lines.join("\n");
}

/** @deprecated Unified table replaces supplement section; kept for tests migrating off old layout. */
export function renderDraftSupplementSection(_draft: unknown): string {
  return "";
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

  let outboundMarkdown = modelMessage;

  if (shouldRenderRichSection) {
    const tasks = (currentDraft as any)?.tasks;
    if (
      appendStructuredTaskTable &&
      Array.isArray(tasks) &&
      tasks.length > 0 &&
      !hasTaskTableInMessage(outboundMarkdown)
    ) {
      const table = renderUnifiedTaskTable(currentDraft, latestAssignment);
      if (table) outboundMarkdown += `\n\n${table}`;
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
