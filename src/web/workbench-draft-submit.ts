/**
 * Shared draft revise submit logic (Excel modal + card editor).
 */
import {
  applyDraftScalarsFromForm,
  draftToExcelRows,
  excelRowsToDraft,
  type DraftExcelRow,
} from "./draft-excel-grid";

export interface DraftReviseSubmitOpts {
  threadId: string;
  threadKind: "main" | "side";
  title: string;
  description: string;
  rows: DraftExcelRow[];
  previousDraft: Record<string, unknown>;
  previousAssignment: Record<string, unknown> | undefined;
}

export interface OpenDraftEditorOpts {
  threadId: string;
  threadKind: "main" | "side";
  onRevised?: () => void | Promise<void>;
}

export async function submitDraftRevise(opts: DraftReviseSubmitOpts): Promise<void> {
  const { draft: rawDraft, assignment } = excelRowsToDraft({
    rows: opts.rows,
    previousDraft: opts.previousDraft,
    previousAssignment: opts.previousAssignment,
  });
  const draft = applyDraftScalarsFromForm(rawDraft, opts.title, opts.description);
  const res = await fetch("/api/workbench/conversation/draft/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: opts.threadId,
      threadKind: opts.threadKind,
      title: opts.title,
      description: opts.description,
      draft,
      assignment,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.ok) {
    const errs = Array.isArray(data.errors) ? (data.errors as string[]).join("；") : "";
    throw new Error(String(data.error ?? "提交失败") + (errs ? `：${errs}` : ""));
  }
}

export async function fetchEditableDraft(opts: {
  threadId: string;
  threadKind: "main" | "side";
}): Promise<{
  title: string;
  description: string;
  rows: DraftExcelRow[];
  previousDraft: Record<string, unknown>;
  previousAssignment: Record<string, unknown> | undefined;
}> {
  const q =
    opts.threadKind === "side" && opts.threadId !== "main"
      ? `thread=side&threadId=${encodeURIComponent(opts.threadId)}`
      : "thread=main";
  const draftRes = await fetch(`/api/workbench/conversation/draft?${q}`);
  const draftData = (await draftRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!draftRes.ok || !draftData.ok) {
    throw new Error(String(draftData.error ?? `加载草案失败 HTTP ${draftRes.status}`));
  }
  if (!draftData.editable) {
    throw new Error("当前会话没有可编辑的草案");
  }
  const initialRows = Array.isArray(draftData.rows)
    ? (draftData.rows as DraftExcelRow[])
    : draftToExcelRows({
        draft: draftData.draft as Record<string, unknown>,
        assignment: draftData.assignment as Record<string, unknown> | undefined,
      });
  return {
    title: String(draftData.title ?? ""),
    description: String(draftData.description ?? ""),
    rows: initialRows,
    previousDraft: draftData.draft as Record<string, unknown>,
    previousAssignment: draftData.assignment as Record<string, unknown> | undefined,
  };
}
