/**
 * Workbench draft Excel grid: column model + draft ↔ flat rows (shared by tests and browser bundle).
 */

export const DRAFT_EXCEL_COLUMN_KEYS = [
  "rowNum",
  "taskId",
  "title",
  "objective",
  "deliverables",
  "completionCriteria",
  "dueAt",
  "actions",
  "dependencyTaskIds",
  "assignee",
  "feedbackFrequency",
  "inputMaterials",
  "collaborators",
  "inScope",
  "outOfScope",
  "checkpoints",
  "risks",
] as const;

export type DraftExcelColumnKey = (typeof DRAFT_EXCEL_COLUMN_KEYS)[number];

export const DRAFT_EXCEL_COLUMN_HEADERS: Record<DraftExcelColumnKey, string> = {
  rowNum: "#",
  taskId: "taskId",
  title: "任务",
  objective: "目标",
  deliverables: "交付物",
  completionCriteria: "完成标准",
  dueAt: "截止",
  actions: "执行动作",
  dependencyTaskIds: "前置依赖",
  assignee: "负责人",
  feedbackFrequency: "反馈频率",
  inputMaterials: "输入材料",
  collaborators: "协作人",
  inScope: "范围内",
  outOfScope: "范围外",
  checkpoints: "检查点",
  risks: "风险",
};

export type DraftExcelRow = Record<DraftExcelColumnKey, string>;

export function splitListCell(value: string): string[] {
  return String(value ?? "")
    .split(/[\n；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinListCell(values: unknown): string {
  if (!Array.isArray(values)) return "";
  return values.map((v) => String(v ?? "").trim()).filter(Boolean).join("；");
}

function readAssigneeDisplay(
  taskId: string,
  assignment: Record<string, unknown> | undefined,
): string {
  const rows = Array.isArray((assignment as { assignments?: unknown[] } | undefined)?.assignments)
    ? ((assignment as { assignments: Array<Record<string, unknown>> }).assignments)
    : [];
  const row = rows.find((r) => String(r?.taskId ?? "").trim() === taskId);
  if (!row) return "";
  const primary = row.primary as Record<string, unknown> | undefined;
  const name = String(primary?.displayName ?? "").trim();
  const uid = String(primary?.userId ?? "").trim();
  if (name && uid) return `${name} (${uid})`;
  return name || uid;
}

export function draftToExcelRows(input: {
  draft: Record<string, unknown>;
  assignment?: Record<string, unknown>;
}): DraftExcelRow[] {
  const root = input.draft;
  const tasks = Array.isArray(root.tasks)
    ? (root.tasks as Array<Record<string, unknown>>)
    : [];
  return tasks.map((t, idx) => {
    const taskId = String(t.id ?? "").trim();
    const timeNode = (t.timeNode ?? {}) as Record<string, unknown>;
    const scope = (t.scope ?? {}) as Record<string, unknown>;
    return {
      rowNum: String(idx + 1),
      taskId,
      title: String(t.title ?? "").trim(),
      objective: String(t.objective ?? "").trim(),
      deliverables: joinListCell(t.deliverables),
      completionCriteria: joinListCell(t.completionCriteria),
      dueAt: String(timeNode.dueAt ?? t.dueAt ?? "").trim(),
      actions: joinListCell(t.actions),
      dependencyTaskIds: joinListCell(t.dependencyTaskIds),
      assignee: readAssigneeDisplay(taskId, input.assignment),
      feedbackFrequency: String(t.feedbackFrequency ?? "").trim(),
      inputMaterials: joinListCell(t.inputMaterials),
      collaborators: joinListCell(t.collaborators),
      inScope: joinListCell(scope.inScope),
      outOfScope: joinListCell(scope.outOfScope),
      checkpoints: joinListCell(timeNode.checkpoints),
      risks: joinListCell(t.risksAndOpenQuestions),
    };
  });
}

export function excelRowsToDraft(input: {
  rows: DraftExcelRow[];
  previousDraft?: Record<string, unknown>;
  previousAssignment?: Record<string, unknown>;
}): { draft: Record<string, unknown>; assignment: Record<string, unknown> } {
  const prev = input.previousDraft ?? {};
  const prevTasks = Array.isArray(prev.tasks)
    ? (prev.tasks as Array<Record<string, unknown>>)
    : [];
  const prevById = new Map(
    prevTasks.map((t) => [String(t.id ?? "").trim(), t] as const).filter(([id]) => id),
  );

  const assignmentBase = (input.previousAssignment ?? {}) as Record<string, unknown>;
  const assignmentRows = Array.isArray(assignmentBase.assignments)
    ? [...(assignmentBase.assignments as Array<Record<string, unknown>>)]
    : [];

  const tasks: Array<Record<string, unknown>> = [];
  const usedIds = new Set<string>();

  input.rows.forEach((row, index) => {
    const title = String(row.title ?? "").trim();
    if (!title && !String(row.objective ?? "").trim()) return;

    let taskId = String(row.taskId ?? "").trim();
    const prevTask = taskId ? prevById.get(taskId) : undefined;
    if (!taskId) {
      taskId = `task_${index + 1}`;
      while (usedIds.has(taskId)) {
        const n = Number.parseInt(taskId.replace(/^task_/, ""), 10) + 1;
        taskId = `task_${n}`;
      }
    }
    while (usedIds.has(taskId)) {
      taskId = `${taskId}_${index + 1}`;
    }
    usedIds.add(taskId);

    const base = prevTask ? { ...prevTask } : {};
    const timeNode = { ...((base.timeNode as Record<string, unknown>) ?? {}) };
    const dueAt = String(row.dueAt ?? "").trim();
    if (dueAt) timeNode.dueAt = dueAt;

    const scope = { ...((base.scope as Record<string, unknown>) ?? {}) };
    const inScope = splitListCell(row.inScope);
    const outOfScope = splitListCell(row.outOfScope);
    if (inScope.length) scope.inScope = inScope;
    if (outOfScope.length) scope.outOfScope = outOfScope;

    const task: Record<string, unknown> = {
      ...base,
      id: taskId,
      title,
      objective: String(row.objective ?? "").trim() || title,
      deliverables: splitListCell(row.deliverables),
      completionCriteria: splitListCell(row.completionCriteria),
      actions: splitListCell(row.actions),
      dependencyTaskIds: splitListCell(row.dependencyTaskIds),
      feedbackFrequency: String(row.feedbackFrequency ?? "").trim() || base.feedbackFrequency || "",
      inputMaterials: splitListCell(row.inputMaterials),
      collaborators: splitListCell(row.collaborators),
      risksAndOpenQuestions: splitListCell(row.risks),
      timeNode: {
        ...timeNode,
        checkpoints: splitListCell(row.checkpoints),
        dueAt: dueAt || timeNode.dueAt || "待确认",
      },
      scope,
    };
    tasks.push(task);

    const assigneeRaw = String(row.assignee ?? "").trim();
    if (assigneeRaw) {
      const uidMatch = assigneeRaw.match(/\(([^)]+)\)\s*$/);
      const userId = uidMatch?.[1]?.trim() ?? "";
      const displayName = uidMatch
        ? assigneeRaw.replace(/\s*\([^)]+\)\s*$/, "").trim()
        : assigneeRaw;
      let aRow = assignmentRows.find((r) => String(r.taskId ?? "").trim() === taskId);
      if (!aRow) {
        aRow = { taskId, primary: {}, confidence: "HIGH" };
        assignmentRows.push(aRow);
      }
      const primary = (aRow.primary as Record<string, unknown>) ?? {};
      if (displayName) primary.displayName = displayName;
      if (userId) primary.userId = userId;
      else if (!primary.userId && displayName) primary.displayName = displayName;
      aRow.primary = primary;
    }
  });

  const draft: Record<string, unknown> = {
    ...prev,
    title: String(prev.title ?? "").trim() || "任务草案",
    description: String(prev.description ?? prev.summary ?? "").trim(),
    tasks,
  };

  return {
    draft,
    assignment: { ...assignmentBase, assignments: assignmentRows },
  };
}

export function applyDraftScalarsFromForm(
  draft: Record<string, unknown>,
  title: string,
  description: string,
): Record<string, unknown> {
  const next = { ...draft };
  const t = String(title ?? "").trim();
  const d = String(description ?? "").trim();
  if (t) next.title = t;
  if (d) {
    next.description = d;
    if (!next.summary) next.summary = d;
  }
  return next;
}
