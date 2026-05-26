import {
  applyDraftScalarsFromForm,
  excelRowsToDraft,
  type DraftExcelRow,
} from "../../web/draft-excel-grid";
import { stabilizeDraftTaskIds } from "../draft-stabilize";
import { reconcileAssignmentWithDraft } from "../assignment/reconcile-assignment";
import { clearPublishStagingFieldsOnDraft } from "../draft-staging-clear";

export interface DraftRevisePrevalidateInput {
  draft: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  previousDraft?: Record<string, unknown>;
  previousAssignment?: Record<string, unknown>;
}

export interface DraftRevisePrevalidateResult {
  ok: true;
  draft: Record<string, unknown>;
  assignment: Record<string, unknown>;
}

export interface DraftRevisePrevalidateError {
  ok: false;
  errors: string[];
}

export function prevalidateWorkbenchDraftRevision(
  input: DraftRevisePrevalidateInput,
): DraftRevisePrevalidateResult | DraftRevisePrevalidateError {
  const errors: string[] = [];
  const tasks = Array.isArray(input.draft.tasks)
    ? (input.draft.tasks as Array<Record<string, unknown>>)
    : [];
  if (tasks.length === 0) {
    errors.push("draft.tasks 不能为空");
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const id = String(t?.id ?? "").trim();
    const title = String(t?.title ?? "").trim();
    if (!title) errors.push(`第 ${i + 1} 行：任务名称不能为空`);
    if (!id) errors.push(`第 ${i + 1} 行：缺少 taskId`);
    else if (ids.has(id)) errors.push(`taskId 重复：${id}`);
    else ids.add(id);
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const id = String(t?.id ?? "").trim();
    const deps = Array.isArray(t.dependencyTaskIds)
      ? (t.dependencyTaskIds as string[]).map((d) => String(d).trim()).filter(Boolean)
      : [];
    for (const dep of deps) {
      if (!ids.has(dep)) {
        errors.push(`第 ${i + 1} 行：前置依赖 ${dep} 不存在`);
      }
      if (dep === id) errors.push(`第 ${i + 1} 行：不能依赖自身`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  let draft = stabilizeDraftTaskIds(
    clearPublishStagingFieldsOnDraft({ ...input.draft, tasks }),
    input.previousDraft,
  );
  const reconciled = reconcileAssignmentWithDraft({
    previousDraft: input.previousDraft,
    currentDraft: draft,
    assignment: input.assignment,
  });
  let assignment = (reconciled.assignment ?? input.assignment ?? {}) as Record<string, unknown>;

  const taskIds = new Set(
    (Array.isArray(draft.tasks) ? (draft.tasks as Array<{ id?: string }>) : [])
      .map((t) => String(t?.id ?? "").trim())
      .filter(Boolean),
  );
  const rows = Array.isArray((assignment as { assignments?: unknown[] }).assignments)
    ? ((assignment as { assignments: Array<Record<string, unknown>> }).assignments)
    : [];
  for (const row of rows) {
    const tid = String(row?.taskId ?? "").trim();
    if (tid && !taskIds.has(tid)) {
      errors.push(`assignment 含未知 taskId：${tid}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, draft, assignment };
}

export function prevalidateFromExcelRows(input: {
  rows: DraftExcelRow[];
  title: string;
  description: string;
  previousDraft?: Record<string, unknown>;
  previousAssignment?: Record<string, unknown>;
}): DraftRevisePrevalidateResult | DraftRevisePrevalidateError {
  const { draft: rawDraft, assignment: rawAssignment } = excelRowsToDraft({
    rows: input.rows,
    previousDraft: input.previousDraft,
    previousAssignment: input.previousAssignment,
  });
  const draft = applyDraftScalarsFromForm(rawDraft, input.title, input.description);
  return prevalidateWorkbenchDraftRevision({
    draft,
    assignment: rawAssignment,
    previousDraft: input.previousDraft,
    previousAssignment: input.previousAssignment,
  });
}
