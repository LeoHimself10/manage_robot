/**
 * Browser bundle: Excel-style draft editor modal for manager chat.
 * Build: npm run build:workbench-draft-grid
 */
import {
  applyDraftScalarsFromForm,
  DRAFT_EXCEL_COLUMN_HEADERS,
  DRAFT_EXCEL_COLUMN_KEYS,
  draftToExcelRows,
  excelRowsToDraft,
  type DraftExcelColumnKey,
  type DraftExcelRow,
} from "./draft-excel-grid";

const VISIBLE_KEYS = DRAFT_EXCEL_COLUMN_KEYS.filter(
  (k) => k !== "taskId",
) as DraftExcelColumnKey[];

export interface OpenDraftExcelModalOpts {
  threadId: string;
  threadKind: "main" | "side";
  onRevised?: () => void | Promise<void>;
}

let overlayEl: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function readRowFromTr(tr: HTMLTableRowElement): DraftExcelRow {
  const row = {} as DraftExcelRow;
  VISIBLE_KEYS.forEach((key, colIdx) => {
    const cell = tr.cells[colIdx];
    const input = cell?.querySelector("textarea, input") as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    row[key] = input ? String(input.value ?? "").trim() : "";
  });
  const taskId = tr.dataset.taskId ?? "";
  row.taskId = taskId;
  row.rowNum = tr.dataset.rowNum ?? "";
  return row;
}

function buildRowTr(row: DraftExcelRow, index: number): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.taskId = row.taskId || `task_${index + 1}`;
  tr.dataset.rowNum = String(index + 1);
  VISIBLE_KEYS.forEach((key) => {
    const td = document.createElement("td");
    const readonly = key === "rowNum";
    if (readonly) {
      td.className = "cell-readonly";
      td.textContent = String(index + 1);
    } else {
      const isLong =
        key === "objective" ||
        key === "deliverables" ||
        key === "completionCriteria" ||
        key === "actions" ||
        key === "inputMaterials" ||
        key === "inScope" ||
        key === "outOfScope" ||
        key === "checkpoints" ||
        key === "risks";
      const field = isLong
        ? document.createElement("textarea")
        : document.createElement("input");
      field.className = "cell-input";
      field.value = String(row[key] ?? "");
      if (isLong) {
        (field as HTMLTextAreaElement).rows = 2;
      }
      td.appendChild(field);
    }
    tr.appendChild(td);
  });
  return tr;
}

export function closeDraftExcelModal(): void {
  if (overlayEl?.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  overlayEl = null;
  document.body.style.overflow = "";
}

export async function openDraftExcelModal(opts: OpenDraftExcelModalOpts): Promise<void> {
  closeDraftExcelModal();
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
  const previousDraft = draftData.draft as Record<string, unknown>;
  const previousAssignment = draftData.assignment as Record<string, unknown> | undefined;

  overlayEl = el("div", "draft-modal-overlay");
  const modal = el("div", "draft-modal");
  const top = el("div", "draft-modal-top");
  const titleInput = document.createElement("input");
  titleInput.className = "draft-meta-input";
  titleInput.value = String(draftData.title ?? "");
  titleInput.placeholder = "任务标题";
  const descInput = document.createElement("textarea");
  descInput.className = "draft-meta-textarea";
  descInput.value = String(draftData.description ?? "");
  descInput.placeholder = "任务背景 / 描述";
  const topLeft = el("div", "draft-modal-top-left");
  topLeft.appendChild(el("h2")).textContent = "编辑草案表格";
  const metaRow = el("div", "draft-meta-row");
  const titleLbl = el("label");
  titleLbl.textContent = "任务标题";
  titleLbl.appendChild(titleInput);
  const descLbl = el("label");
  descLbl.textContent = "任务背景";
  descLbl.appendChild(descInput);
  metaRow.append(titleLbl, descLbl);
  topLeft.append(metaRow);
  const topRight = el("div", "draft-modal-top-right");
  const fullscreenBtn = el("button", "btn btn-ghost btn-sm");
  fullscreenBtn.textContent = "全屏";
  const closeBtn = el("button", "btn btn-ghost btn-sm");
  closeBtn.textContent = "关闭";
  topRight.append(fullscreenBtn, closeBtn);
  top.append(topLeft, topRight);

  const toolbar = el("div", "draft-modal-toolbar");
  const insertBtn = el("button", "btn btn-secondary btn-sm");
  insertBtn.textContent = "+ 插入行";
  const deleteBtn = el("button", "btn btn-danger btn-sm");
  deleteBtn.textContent = "删除选中行";
  const discardBtn = el("button", "btn btn-secondary btn-sm");
  discardBtn.textContent = "放弃更改";
  toolbar.append(insertBtn, deleteBtn, discardBtn);

  const gridWrap = el("div", "draft-modal-grid-wrap");
  const scroll = el("div", "draft-excel-scroll");
  const table = el("table", "draft-excel-table");
  const thead = document.createElement("thead");
  const headTr = document.createElement("tr");
  VISIBLE_KEYS.forEach((key) => {
    const th = document.createElement("th");
    th.textContent = DRAFT_EXCEL_COLUMN_HEADERS[key];
    if (key === "rowNum" || key === "title") th.className = "col-frozen";
    headTr.appendChild(th);
  });
  thead.appendChild(headTr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  initialRows.forEach((row, i) => tbody.appendChild(buildRowTr(row, i)));
  table.appendChild(tbody);
  scroll.appendChild(table);
  gridWrap.appendChild(scroll);

  const footer = el("div", "draft-modal-footer");
  const errBox = el("div", "draft-modal-error");
  const cancelBtn = el("button", "btn btn-secondary");
  cancelBtn.textContent = "取消";
  const submitBtn = el("button", "btn btn-primary");
  submitBtn.textContent = "提交修改（Agent 校验）";
  footer.append(errBox, el("div", "draft-modal-footer-actions"));
  footer.querySelector(".draft-modal-footer-actions")?.append(cancelBtn, submitBtn);

  modal.append(top, toolbar, gridWrap, footer);
  overlayEl.appendChild(modal);
  document.body.appendChild(overlayEl);
  document.body.style.overflow = "hidden";

  let selectedTr: HTMLTableRowElement | null = tbody.rows[0] ?? null;
  if (selectedTr) selectedTr.classList.add("selected");

  function renumber() {
    Array.from(tbody.rows).forEach((tr, i) => {
      tr.dataset.rowNum = String(i + 1);
      const first = tr.cells[0];
      if (first) first.textContent = String(i + 1);
    });
  }

  tbody.addEventListener("click", (ev) => {
    const tr = (ev.target as HTMLElement).closest("tr");
    if (!tr || tr.parentElement !== tbody) return;
    Array.from(tbody.rows).forEach((r) => r.classList.remove("selected"));
    tr.classList.add("selected");
    selectedTr = tr;
  });

  insertBtn.addEventListener("click", () => {
    const empty: DraftExcelRow = { rowNum: "", taskId: "", title: "新子任务" } as DraftExcelRow;
    VISIBLE_KEYS.forEach((k) => {
      if (k !== "rowNum" && k !== "title" && k !== "taskId") (empty as Record<string, string>)[k] = "";
    });
    tbody.appendChild(buildRowTr(empty, tbody.rows.length));
    renumber();
  });

  deleteBtn.addEventListener("click", () => {
    if (tbody.rows.length <= 1) {
      errBox.textContent = "至少保留 1 行";
      return;
    }
    if (selectedTr) selectedTr.remove();
    else tbody.deleteRow(tbody.rows.length - 1);
    selectedTr = tbody.rows[0] ?? null;
    if (selectedTr) selectedTr.classList.add("selected");
    renumber();
  });

  discardBtn.addEventListener("click", () => {
    void openDraftExcelModal(opts);
  });

  fullscreenBtn.addEventListener("click", () => {
    modal.classList.toggle("draft-modal--fullscreen");
    fullscreenBtn.textContent = modal.classList.contains("draft-modal--fullscreen")
      ? "退出全屏"
      : "全屏";
  });

  const close = () => closeDraftExcelModal();
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlayEl.addEventListener("click", (ev) => {
    if (ev.target === overlayEl) close();
  });

  submitBtn.addEventListener("click", async () => {
    errBox.textContent = "";
    submitBtn.disabled = true;
    try {
      const rows = Array.from(tbody.rows).map((tr, i) => {
        const r = readRowFromTr(tr);
        r.rowNum = String(i + 1);
        return r;
      });
      const { draft: rawDraft, assignment } = excelRowsToDraft({
        rows,
        previousDraft,
        previousAssignment,
      });
      const draft = applyDraftScalarsFromForm(
        rawDraft,
        titleInput.value.trim(),
        descInput.value.trim(),
      );
      const res = await fetch("/api/workbench/conversation/draft/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: opts.threadId,
          threadKind: opts.threadKind,
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          draft,
          assignment,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !data.ok) {
        const errs = Array.isArray(data.errors) ? (data.errors as string[]).join("；") : "";
        throw new Error(
          String(data.error ?? "提交失败") + (errs ? `：${errs}` : ""),
        );
      }
      close();
      if (opts.onRevised) await opts.onRevised();
    } catch (e) {
      errBox.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

if (typeof window !== "undefined") {
  (window as unknown as { WorkbenchDraftGrid?: unknown }).WorkbenchDraftGrid = {
    openDraftExcelModal,
    closeDraftExcelModal,
  };
}
