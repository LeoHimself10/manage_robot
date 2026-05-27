/**
 * Deterministic rendering layer for DingTalk outbound markdown.
 *
 * Structured task drafts are rendered as GFM pipe tables (validated on DingTalk
 * mobile + desktop). Numbered-list fallback was removed after format spike.
 */

// ---------------------------------------------------------------------------
// hasTaskTableInMessage
// ---------------------------------------------------------------------------

export function hasTaskTableInMessage(markdown: string): boolean {
  return (
    markdown.includes("### 结构化任务表") ||
    markdown.includes("### 结构化任务表（列表）") ||
    markdown.includes("### 任务列表（结构化字段）") ||
    markdown.includes("### 任务草案（结构化字段）") ||
    markdown.includes("### 任务补充信息")
  );
}

/** Remove single-line pipe-table blobs the model sometimes inlines. */
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
    const looksLikeInlineRow = /\|\s*\d+\s*\|/.test(trimmed) || /\|\s*\|\s*\d+\s*\|/.test(trimmed);
    // Only strip when header + data are crammed onto one line (model glitch).
    return !(looksLikeTableHeader && looksLikeInlineRow && pipeCount >= 6);
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function listField(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values.map((v) => String(v ?? "").trim()).filter(Boolean).join("；");
}

function cellOrDash(value: string): string {
  const s = value.trim();
  return s || "—";
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
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

function buildTaskTitleById(tasks: Array<Record<string, unknown>>): Map<string, string> {
  const taskTitleById = new Map<string, string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    const title = String(t?.title ?? "").trim();
    if (id) taskTitleById.set(id, title || id);
  }
  return taskTitleById;
}

function renderDependencyCell(
  t: Record<string, unknown>,
  taskTitleById: Map<string, string>,
): string {
  const deps = Array.isArray(t.dependencyTaskIds) ? (t.dependencyTaskIds as unknown[]) : [];
  const rendered = deps
    .map((d) => {
      const id = String(d ?? "").trim();
      const tt = taskTitleById.get(id);
      return tt ? `${id}（${tt}）` : id;
    })
    .filter(Boolean)
    .join("；");
  return cellOrDash(rendered);
}

function renderTaskPipeTableSection(draft: unknown, latestAssignment?: unknown): string {
  if (!draft || typeof draft !== "object") return "";
  const root = draft as Record<string, unknown>;
  const description = String(root.description ?? "").trim();
  const tasks = Array.isArray(root.tasks) ? (root.tasks as Array<Record<string, unknown>>) : [];
  if (tasks.length === 0) return "";

  const { assigneeByTaskId } = buildAssignmentMaps(latestAssignment);
  const taskTitleById = buildTaskTitleById(tasks);

  const blocks: string[] = [];
  if (description) {
    blocks.push(
      `任务背景：${description.length > 500 ? `${description.slice(0, 500)}…` : description}`,
    );
  }

  const header =
    "| # | 任务 | 目标 | 交付物 | 完成标准 | 截止 | 执行动作 | 前置依赖 | 负责人 |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = tasks.map((t, idx) => {
    const taskId = String(t.id ?? "").trim();
    const timeNode = (t.timeNode ?? {}) as Record<string, unknown>;
    const cells = [
      String(idx + 1),
      cellOrDash(String(t.title ?? `#${idx + 1}`)),
      cellOrDash(String(t.objective ?? "")),
      cellOrDash(listField(t.deliverables)),
      cellOrDash(listField(t.completionCriteria)),
      cellOrDash(String(timeNode.dueAt ?? "")),
      cellOrDash(listField(t.actions)),
      renderDependencyCell(t, taskTitleById),
      cellOrDash(assigneeByTaskId.get(taskId) ?? ""),
    ].map(escapeTableCell);
    return `| ${cells.join(" | ")} |`;
  });

  blocks.push(["### 结构化任务表", header, sep, ...rows].join("\n"));
  return blocks.join("\n\n");
}

function collectMorePlanningCells(
  t: Record<string, unknown>,
  collaboratorsByTaskId: Map<string, string>,
): string[] {
  const timeNode = (t.timeNode ?? {}) as Record<string, unknown>;
  const scope = (t.scope ?? {}) as Record<string, unknown>;
  const taskId = String(t.id ?? "").trim();
  const draftCollab = listField(t.collaborators);
  const collab = cellOrDash(collaboratorsByTaskId.get(taskId) ?? draftCollab);
  return [
    cellOrDash(String(t.feedbackFrequency ?? "")),
    cellOrDash(listField(t.inputMaterials)),
    collab,
    cellOrDash(listField(scope.inScope)),
    cellOrDash(listField(scope.outOfScope)),
    cellOrDash(
      Array.isArray(timeNode.checkpoints)
        ? timeNode.checkpoints.map((c) => String(c ?? "").trim()).filter(Boolean).join("；")
        : "",
    ),
    cellOrDash(listField(t.risksAndOpenQuestions)),
  ];
}

function rowHasMorePlanning(values: string[]): boolean {
  return values.some((v) => v !== "—");
}

/** Deprecated: 更多规划 7 项已下线，不再追加第二表。 */
export function renderDraftSupplementSection(
  _draft: unknown,
  _latestAssignment?: unknown,
): string {
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
  const warningText = Array.isArray((publishResult as any).warnings)
    ? (publishResult as any).warnings.join("；")
    : "";
  const notifyStats = (publishResult as any).notifyStats as
    | { internalNotified?: number; externalSkipped?: number; failed?: number }
    | undefined;
  const assigneeCount = new Set<string>(
    Array.isArray((publishResult as any).subtasks)
      ? (publishResult as any).subtasks.map((s: any) => String(s?.assigneeUserId ?? "").trim()).filter(Boolean)
      : [],
  ).size;
  const internalNotified = notifyStats
    ? Number(notifyStats.internalNotified ?? 0)
    : assigneeCount;
  const externalSkipped = Number(notifyStats?.externalSkipped ?? 0);
  const failedCount = Number(notifyStats?.failed ?? 0);
  let notifyLine = `子任务 ${subtaskCount} 个 → 已钉钉通知 ${internalNotified} 名内部员工`;
  if (externalSkipped > 0) {
    notifyLine += `；${externalSkipped} 名外部执行者请登录网页工作台查看`;
  }
  if (failedCount > 0) {
    notifyLine += `；${failedCount} 人通知失败`;
  }
  let next = `${outboundMarkdown}\n\n【已发布】任务编号 ${publishTaskNo || "未知"}\n标题：${String((publishResult as any)?.task?.title ?? "未命名任务")}\n${notifyLine}`;
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
      const taskTable = renderTaskPipeTableSection(currentDraft, latestAssignment);
      if (taskTable) outboundMarkdown += `\n\n${taskTable}`;
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
