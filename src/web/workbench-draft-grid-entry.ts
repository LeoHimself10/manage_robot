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
import {
  mountContactComboInCell,
  parseAssigneeCellDisplay,
} from "./workbench-contact-combo";

const VISIBLE_KEYS = DRAFT_EXCEL_COLUMN_KEYS.filter(
  (k) => k !== "taskId",
) as DraftExcelColumnKey[];

const COL_WIDTH_STORAGE_KEY = "workbench-draft-excel-col-widths-v1";
const DEFAULT_COL_WIDTHS: Partial<Record<DraftExcelColumnKey, number>> = {
  rowNum: 36,
  title: 140,
  objective: 120,
  deliverables: 120,
  completionCriteria: 140,
  dueAt: 120,
  actions: 120,
  dependencyTaskIds: 100,
  assignee: 140,
  feedbackFrequency: 100,
  inputMaterials: 120,
  collaborators: 100,
  inScope: 100,
  outOfScope: 100,
  checkpoints: 100,
  risks: 100,
};

const LONG_TEXT_KEYS = new Set<DraftExcelColumnKey>([
  "objective",
  "deliverables",
  "completionCriteria",
  "actions",
  "inputMaterials",
  "inScope",
  "outOfScope",
  "checkpoints",
  "risks",
]);

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

function normalizeDateInputValue(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "待确认") return "";
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readAssigneeFromCell(cell: HTMLTableCellElement | undefined): string {
  if (!cell) return "";
  const hidden = cell.querySelector(".cell-assignee-user-id") as HTMLInputElement | null;
  const visible = cell.querySelector(".cell-input--contact") as HTMLInputElement | null;
  const name = String(visible?.value ?? "").trim();
  const userId = String(hidden?.value ?? "").trim();
  if (name && userId) return `${name} (${userId})`;
  if (userId) return userId;
  return name;
}

function readRowFromTr(tr: HTMLTableRowElement): DraftExcelRow {
  const row = {} as DraftExcelRow;
  VISIBLE_KEYS.forEach((key, colIdx) => {
    const cell = tr.cells[colIdx];
    if (key === "assignee") {
      row[key] = readAssigneeFromCell(cell);
      return;
    }
    const input = cell?.querySelector("textarea, input") as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    row[key] = input ? String(input.value ?? "").trim() : "";
  });
  row.taskId = tr.dataset.taskId ?? "";
  row.rowNum = tr.dataset.rowNum ?? "";
  return row;
}

function buildRowTr(row: DraftExcelRow, index: number): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.taskId = row.taskId || `task_${index + 1}`;
  tr.dataset.rowNum = String(index + 1);
  VISIBLE_KEYS.forEach((key) => {
    const td = document.createElement("td");
    if (key === "rowNum") {
      td.className = "cell-readonly col-frozen";
      td.textContent = String(index + 1);
    } else if (key === "title") {
      td.className = "col-frozen";
      const field = document.createElement("input");
      field.className = "cell-input";
      field.value = String(row[key] ?? "");
      td.appendChild(field);
    } else if (key === "dueAt") {
      const field = document.createElement("input");
      field.type = "date";
      field.className = "cell-input cell-input--date";
      field.value = normalizeDateInputValue(String(row.dueAt ?? ""));
      td.appendChild(field);
    } else if (key === "assignee") {
      const parsed = parseAssigneeCellDisplay(String(row.assignee ?? ""));
      mountContactComboInCell(
        td,
        { display: parsed.display, userId: parsed.userId },
        (kw) => `/api/workbench/manager/contacts?keyword=${encodeURIComponent(kw)}`,
      );
    } else if (LONG_TEXT_KEYS.has(key)) {
      const field = document.createElement("textarea");
      field.className = "cell-input";
      field.rows = 3;
      field.value = String(row[key] ?? "");
      td.appendChild(field);
    } else {
      const field = document.createElement("input");
      field.className = "cell-input";
      field.value = String(row[key] ?? "");
      td.appendChild(field);
    }
    tr.appendChild(td);
  });
  return tr;
}

function loadColWidths(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(COL_WIDTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveColWidths(widths: Record<string, number>): void {
  try {
    sessionStorage.setItem(COL_WIDTH_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* ignore quota */
  }
}

function applyColumnWidths(table: HTMLTableElement, colgroup: HTMLTableColElement[]): void {
  const saved = loadColWidths();
  VISIBLE_KEYS.forEach((key, idx) => {
    const width = saved[key] ?? DEFAULT_COL_WIDTHS[key] ?? 100;
    const col = colgroup[idx];
    if (col) {
      col.style.width = `${width}px`;
      col.dataset.colKey = key;
    }
    table.querySelectorAll("tr").forEach((tr) => {
      const cell = tr.cells[idx];
      if (cell) {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
      }
    });
  });
}

function attachColumnResize(
  table: HTMLTableElement,
  headTr: HTMLTableRowElement,
  colgroup: HTMLTableColElement[],
): void {
  const widths: Record<string, number> = {};
  VISIBLE_KEYS.forEach((key, idx) => {
    widths[key] =
      loadColWidths()[key] ?? DEFAULT_COL_WIDTHS[key] ?? 100;
  });

  headTr.querySelectorAll("th").forEach((th, idx) => {
    const key = VISIBLE_KEYS[idx];
    if (!key || key === "rowNum") return;
    const handle = document.createElement("span");
    handle.className = "col-resize-handle";
    handle.title = "拖拽调整列宽";
    th.style.position = "sticky";
    th.appendChild(handle);

    let startX = 0;
    let startW = 0;

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(60, startW + (ev.clientX - startX));
      widths[key] = next;
      const col = colgroup[idx];
      if (col) col.style.width = `${next}px`;
      table.querySelectorAll("tr").forEach((tr) => {
        const cell = tr.cells[idx];
        if (cell) {
          cell.style.width = `${next}px`;
          cell.style.minWidth = `${next}px`;
          cell.style.maxWidth = `${next}px`;
        }
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveColWidths(widths);
    };

    handle.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      startX = ev.clientX;
      startW = widths[key] ?? DEFAULT_COL_WIDTHS[key] ?? 100;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
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
  const submitOverlay = el("div", "draft-modal-submit-overlay");
  submitOverlay.hidden = true;
  submitOverlay.innerHTML =
    '<div class="draft-modal-spinner" aria-hidden="true"></div>' +
    '<div class="draft-modal-submit-title">Agent 校验中…</div>' +
    '<div class="draft-modal-submit-hint">通常需要 15–30 秒，请勿关闭</div>' +
    '<div class="draft-modal-submit-elapsed muted"></div>';

  const scroll = el("div", "draft-excel-scroll");
  const table = el("table", "draft-excel-table");
  const colgroup = document.createElement("colgroup");
  VISIBLE_KEYS.forEach(() => {
    colgroup.appendChild(document.createElement("col"));
  });
  table.appendChild(colgroup);
  const thead = document.createElement("thead");
  const headTr = document.createElement("tr");
  VISIBLE_KEYS.forEach((key) => {
    const th = document.createElement("th");
    th.textContent = DRAFT_EXCEL_COLUMN_HEADERS[key];
    th.dataset.colKey = key;
    if (key === "rowNum" || key === "title") th.className = "col-frozen";
    headTr.appendChild(th);
  });
  thead.appendChild(headTr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  initialRows.forEach((row, i) => tbody.appendChild(buildRowTr(row, i)));
  table.appendChild(tbody);
  scroll.appendChild(table);
  gridWrap.append(submitOverlay, scroll);

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

  const colEls = Array.from(colgroup.querySelectorAll("col"));
  applyColumnWidths(table, colEls);
  attachColumnResize(table, headTr, colEls);

  let selectedTr: HTMLTableRowElement | null = tbody.rows[0] ?? null;
  if (selectedTr) selectedTr.classList.add("selected");

  function setSubmitting(active: boolean) {
    submitOverlay.hidden = !active;
    modal.classList.toggle("draft-modal--submitting", active);
    submitBtn.disabled = active;
    cancelBtn.disabled = active;
    insertBtn.disabled = active;
    deleteBtn.disabled = active;
    discardBtn.disabled = active;
    closeBtn.disabled = active;
    fullscreenBtn.disabled = active;
  }

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
    if ((ev.target as HTMLElement).closest(".col-resize-handle")) return;
    Array.from(tbody.rows).forEach((r) => r.classList.remove("selected"));
    tr.classList.add("selected");
    selectedTr = tr;
  });

  insertBtn.addEventListener("click", () => {
    const empty: DraftExcelRow = { rowNum: "", taskId: "", title: "新子任务" } as DraftExcelRow;
    VISIBLE_KEYS.forEach((k) => {
      if (k !== "rowNum" && k !== "title" && k !== "taskId") {
        (empty as Record<string, string>)[k] = "";
      }
    });
    tbody.appendChild(buildRowTr(empty, tbody.rows.length));
    renumber();
    applyColumnWidths(table, colEls);
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
    if (ev.target === overlayEl && !modal.classList.contains("draft-modal--submitting")) close();
  });

  submitBtn.addEventListener("click", async () => {
    errBox.textContent = "";
    setSubmitting(true);
    const elapsedEl = submitOverlay.querySelector(".draft-modal-submit-elapsed");
    const started = Date.now();
    const elapsedTimer = window.setInterval(() => {
      if (elapsedEl) {
        const sec = Math.floor((Date.now() - started) / 1000);
        elapsedEl.textContent = `已等待 ${sec} 秒`;
      }
    }, 1000);
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
      window.clearInterval(elapsedTimer);
      setSubmitting(false);
    }
  });
}

if (typeof window !== "undefined") {
  (window as unknown as { WorkbenchDraftGrid?: unknown }).WorkbenchDraftGrid = {
    openDraftExcelModal,
    closeDraftExcelModal,
  };
}
