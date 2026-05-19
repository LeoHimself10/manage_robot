/**
 * Deterministic rendering layer for DingTalk outbound markdown.
 *
 * Keeps all markdown assembly logic out of dingtalk-bot.ts so it can be
 * unit-tested independently and reused by other entry-points.
 *
 * Correct assembly order (per plan block D3):
 *   1. modelMessage
 *   2. rich-field supplement (renderDraftSupplementSection, guarded by shouldRenderRichSection)
 *   3. assignmentSection (assignment suggestion)
 *   4. publishSummary (appendPublishSummaryMarkdown)
 *   5. rotatePlanHintTail (post-publish rotate hint)
 */

// ---------------------------------------------------------------------------
// hasTaskTableInMessage
// ---------------------------------------------------------------------------

/**
 * Returns true if the markdown already contains a task table rendered by the
 * model (prompt-drift guard: we log when this happens but the table stays).
 */
export function hasTaskTableInMessage(markdown: string): boolean {
  const normalized = markdown.toLowerCase();
  return (
    normalized.includes("### 任务列表（结构化字段）") ||
    normalized.includes("### 任务草案（结构化字段）") ||
    normalized.includes("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |") ||
    normalized.includes("| 序号 | 任务名称 |")
  );
}

// ---------------------------------------------------------------------------
// renderDraftSupplementSection
// ---------------------------------------------------------------------------

function listField(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values.map((v) => String(v ?? "").trim()).filter(Boolean).join("；");
}

/**
 * Renders the "任务补充信息" block from a draft object (background + rich per-task fields).
 *
 * The main structured task table is rendered only by renderDingtalkTaskMarkdown
 * ("### 任务列表（结构化字段）"); this function must not duplicate that table.
 * Returns empty string when draft has no supplement content.
 */
export function renderDraftSupplementSection(draft: unknown): string {
  if (!draft || typeof draft !== "object") return "";
  const root = draft as Record<string, unknown>;
  const description = String(root.description ?? "").trim();
  const tasks = Array.isArray(root.tasks) ? (root.tasks as Array<Record<string, unknown>>) : [];
  const taskTitleById = new Map<string, string>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    const title = String(t?.title ?? "").trim();
    if (id) taskTitleById.set(id, title || id);
  }
  const lines: string[] = [];
  if (description) {
    lines.push(`**任务背景**：${description.length > 500 ? description.slice(0, 500) + "…" : description}`);
  }
  const supplementBlocks: string[] = [];
  tasks.forEach((t, idx) => {
    const title = String(t?.title ?? "").trim() || `任务 ${idx + 1}`;
    const deps = Array.isArray(t?.dependencyTaskIds) ? (t.dependencyTaskIds as unknown[]) : [];
    const timeNode = (t?.timeNode ?? {}) as Record<string, unknown>;
    const checkpoints = Array.isArray(timeNode.checkpoints) ? (timeNode.checkpoints as unknown[]) : [];
    const risks = Array.isArray(t?.risksAndOpenQuestions) ? (t.risksAndOpenQuestions as unknown[]) : [];
    const inputMaterials = listField(t?.inputMaterials);
    const actions = listField(t?.actions);
    const collaborators = listField(t?.collaborators);
    const scope = (t?.scope ?? {}) as Record<string, unknown>;
    const inScope = listField(scope?.inScope);
    const outOfScope = listField(scope?.outOfScope);
    const hasAnyDetail =
      deps.length > 0
      || checkpoints.length > 0
      || risks.length > 0
      || Boolean(inputMaterials)
      || Boolean(actions)
      || Boolean(collaborators)
      || Boolean(inScope)
      || Boolean(outOfScope);
    if (!hasAnyDetail) return;
    const block: string[] = [`**${idx + 1}. ${title}**`];
    if (inputMaterials) block.push(`- 输入材料：${inputMaterials}`);
    if (actions) block.push(`- 执行动作：${actions}`);
    if (collaborators) block.push(`- 协作人：${collaborators}`);
    if (inScope) block.push(`- 范围内：${inScope}`);
    if (outOfScope) block.push(`- 范围外：${outOfScope}`);
    if (deps.length) {
      const rendered = deps
        .map((d) => {
          const id = String(d ?? "").trim();
          const tt = taskTitleById.get(id);
          return tt ? `${id}（${tt}）` : id;
        })
        .filter(Boolean)
        .join("；");
      if (rendered) block.push(`- 前置依赖：${rendered}`);
    }
    if (checkpoints.length) {
      block.push(`- 检查点：${checkpoints.map((c) => String(c ?? "").trim()).filter(Boolean).join("；")}`);
    }
    if (risks.length) {
      block.push(`- 风险与待澄清：${risks.map((r) => String(r ?? "").trim()).filter(Boolean).join("；")}`);
    }
    supplementBlocks.push(block.join("\n"));
  });
  if (lines.length === 0 && supplementBlocks.length === 0) return "";
  const sections = ["### 任务补充信息"];
  if (lines.length) sections.push(lines.join("\n"));
  if (supplementBlocks.length) sections.push(supplementBlocks.join("\n\n"));
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// appendPublishSummaryMarkdown
// ---------------------------------------------------------------------------

/**
 * Appends a publish receipt block to the outbound markdown.
 * Returns the unchanged markdown if no successful publish result is provided.
 */
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
// renderDingtalkTaskMarkdown (aggregated entry point)
// ---------------------------------------------------------------------------

export interface RenderDingtalkTaskMarkdownInput {
  /** Raw model message (already sanitized) */
  modelMessage: string;
  /** Current draft in session (may differ from freshDraft when model only sent a message) */
  currentDraft: unknown;
  /** Whether to render the rich supplement section (false when planRotatedAfterPublish) */
  shouldRenderRichSection: boolean;
  /** Whether to prepend the structured task table when not already present */
  appendStructuredTaskTable: boolean;
  /** Optional callback to log when model drew its own table (audit / prompt-drift detection) */
  onModelDrewTable?: () => void;
  /** Rendered assignment suggestion section (already formatted markdown) */
  assignmentSection?: string;
  /** Publish result object for the receipt block */
  publishResult?: Record<string, unknown>;
  /** Rotate-plan hint tail appended after the receipt block */
  rotatePlanHintTail?: string;
}

/**
 * Assembles the final outbound DingTalk markdown in the correct order:
 *   modelMessage → richSupplementSection → assignmentSection → publishSummary → rotatePlanHintTail
 *
 * Fixed ordering bug from before: assignmentSection used to appear *after* the
 * publish receipt, making users see "已发布" before the assignment suggestion.
 */
export function renderDingtalkTaskMarkdown(input: RenderDingtalkTaskMarkdownInput): string {
  const {
    modelMessage,
    currentDraft,
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
      const rows = tasks.map((t: any, i: number) =>
        `| ${i + 1} | ${t.title ?? ""} | ${t.objective ?? ""} | ${(t.deliverables ?? []).join("；") || "-"} | ${(t.completionCriteria ?? []).join("；") || "-"} | ${t.timeNode?.dueAt ?? "待确认"} | ${t.feedbackFrequency ?? "待确认"} |`
      );
      outboundMarkdown +=
        "\n\n### 任务列表（结构化字段）\n| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |\n|---|---|---|---|---|---|---|\n" +
        rows.join("\n");
    } else if (hasTaskTableInMessage(outboundMarkdown)) {
      onModelDrewTable?.();
    }
    const supplement = renderDraftSupplementSection(currentDraft);
    if (supplement) {
      outboundMarkdown += `\n\n${supplement}`;
    }
  }

  // Correct order: assignment suggestion → publish receipt → rotate hint
  if (assignmentSection) {
    outboundMarkdown += assignmentSection;
  }
  outboundMarkdown = appendPublishSummaryMarkdown(outboundMarkdown, publishResult);
  if (rotatePlanHintTail) {
    outboundMarkdown += rotatePlanHintTail;
  }

  return outboundMarkdown;
}
