/**
 * Mobile card-style draft editor (list → full-screen form per subtask).
 */
import {
  DRAFT_EXCEL_COLUMN_HEADERS,
  type DraftExcelColumnKey,
  type DraftExcelRow,
} from "./draft-excel-grid";
import type { OpenDraftEditorOpts } from "./workbench-draft-submit";
import { fetchEditableDraft, submitDraftRevise } from "./workbench-draft-submit";
import {
  mountContactComboInWrap,
  parseAssigneeCellDisplay,
} from "./workbench-contact-combo";
import {
  attachMobileInputScrollAll,
  lockBodyScroll,
  unlockBodyScroll,
} from "./workbench-keyboard-utils";

const CARD_FORM_KEYS: DraftExcelColumnKey[] = [
  "title",
  "objective",
  "deliverables",
  "completionCriteria",
  "dueAt",
  "actions",
  "dependencyTaskIds",
  "assignee",
];

const LONG_TEXT_KEYS = new Set<DraftExcelColumnKey>([
  "objective",
  "deliverables",
  "completionCriteria",
  "actions",
]);

let overlayEl: HTMLElement | null = null;
let detachInputScroll: (() => void) | null = null;

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

function formatAssigneeDisplay(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "未指派";
  const parsed = parseAssigneeCellDisplay(text);
  return parsed.display || text;
}

function hasAssignee(raw: string): boolean {
  const text = String(raw ?? "").trim();
  if (!text) return false;
  const parsed = parseAssigneeCellDisplay(text);
  return Boolean(parsed.userId || parsed.display);
}

function readAssigneeFromWrap(wrap: HTMLElement | null): string {
  if (!wrap) return "";
  const hidden = wrap.querySelector(".cell-assignee-user-id") as HTMLInputElement | null;
  const visible = wrap.querySelector(".draft-card-input--contact, .cell-input--contact") as
    | HTMLInputElement
    | null;
  const name = String(visible?.value ?? "").trim();
  const userId = String(hidden?.value ?? "").trim();
  if (name && userId) return `${name} (${userId})`;
  if (userId) return userId;
  return name;
}

function emptyRow(index: number): DraftExcelRow {
  const row = {
    rowNum: String(index + 1),
    taskId: `task_${index + 1}`,
    title: "新子任务",
  } as DraftExcelRow;
  CARD_FORM_KEYS.forEach((k) => {
    if (k !== "title") (row as Record<string, string>)[k] = "";
  });
  return row;
}

export function closeDraftCardEditor(): void {
  detachInputScroll?.();
  detachInputScroll = null;
  if (overlayEl?.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  overlayEl = null;
  unlockBodyScroll();
}

export async function openDraftCardEditor(opts: OpenDraftEditorOpts): Promise<void> {
  closeDraftCardEditor();
  const loaded = await fetchEditableDraft(opts);
  let rows = loaded.rows.map((r, i) => ({ ...r, rowNum: String(i + 1) }));
  let titleText = loaded.title;
  let descText = loaded.description;
  let view: "list" | "form" = "list";
  let editIndex = 0;

  overlayEl = el("div", "draft-card-editor-overlay");
  const sheet = el("div", "draft-card-editor");
  const header = el("header", "draft-card-editor__head");
  const backBtn = el("button", "btn btn-ghost draft-card-editor__back");
  backBtn.type = "button";
  backBtn.textContent = "←";
  backBtn.setAttribute("aria-label", "返回");
  const headTitle = el("h2", "draft-card-editor__title");
  headTitle.textContent = "编辑草案";
  const closeBtn = el("button", "btn btn-ghost draft-card-editor__close");
  closeBtn.type = "button";
  closeBtn.textContent = "关闭";
  header.append(backBtn, headTitle, closeBtn);

  const main = el("div", "draft-card-editor__main");
  const errBox = el("div", "draft-card-editor__error");
  const submitOverlay = el("div", "draft-modal-submit-overlay");
  submitOverlay.hidden = true;
  submitOverlay.innerHTML =
    '<div class="draft-modal-spinner" aria-hidden="true"></div>' +
    '<div class="draft-modal-submit-title">Agent 校验中…</div>' +
    '<div class="draft-modal-submit-hint">通常需要 15–30 秒，请勿关闭</div>' +
    '<div class="draft-modal-submit-elapsed muted"></div>';

  const listView = el("div", "draft-card-list-view");
  const metaDetails = el("details", "draft-card-meta");
  metaDetails.open = false;
  const metaSummary = el("summary");
  metaSummary.textContent = "任务标题与背景";
  const metaForm = el("div", "draft-card-meta-form form-stack");
  const titleInput = document.createElement("input");
  titleInput.className = "draft-card-input";
  titleInput.placeholder = "任务标题";
  titleInput.value = titleText;
  const descInput = document.createElement("textarea");
  descInput.className = "draft-card-input";
  descInput.placeholder = "任务背景 / 描述";
  descInput.rows = 3;
  descInput.value = descText;
  const titleLbl = el("label");
  titleLbl.textContent = "任务标题";
  titleLbl.appendChild(titleInput);
  const descLbl = el("label");
  descLbl.textContent = "任务背景";
  descLbl.appendChild(descInput);
  metaForm.append(titleLbl, descLbl);
  metaDetails.append(metaSummary, metaForm);

  const listHint = el("p", "draft-card-list-hint muted");
  listHint.textContent = `${rows.length} 条子任务 · 点击进入编辑`;
  const listMount = el("div", "draft-card-list");
  const addBtn = el("button", "btn btn-secondary draft-card-add-btn");
  addBtn.type = "button";
  addBtn.textContent = "+ 新增子任务";
  listView.append(metaDetails, listHint, listMount, addBtn);

  const formView = el("div", "draft-card-form-view");
  formView.hidden = true;
  const formScroll = el("div", "draft-card-form-scroll");
  const formStack = el("div", "draft-card-form form-stack");
  const formFields: Partial<Record<DraftExcelColumnKey, HTMLElement>> = {};
  let assigneeWrap: HTMLElement | null = null;
  let assigneeComboDestroy: (() => void) | null = null;

  CARD_FORM_KEYS.forEach((key) => {
    const lbl = el("label");
    lbl.textContent = DRAFT_EXCEL_COLUMN_HEADERS[key];
    if (key === "assignee") {
      assigneeWrap = el("div");
      lbl.appendChild(assigneeWrap);
      formFields[key] = assigneeWrap;
    } else if (key === "dueAt") {
      const field = document.createElement("input");
      field.type = "date";
      field.className = "draft-card-input draft-card-input--date";
      lbl.appendChild(field);
      formFields[key] = field;
    } else if (LONG_TEXT_KEYS.has(key)) {
      const field = document.createElement("textarea");
      field.className = "draft-card-input";
      field.rows = 3;
      lbl.appendChild(field);
      formFields[key] = field;
    } else {
      const field = document.createElement("input");
      field.className = "draft-card-input";
      lbl.appendChild(field);
      formFields[key] = field;
    }
    formStack.appendChild(lbl);
  });
  formScroll.appendChild(formStack);
  const formFoot = el("footer", "draft-card-form-foot");
  const navRow = el("div", "draft-card-form-nav");
  const prevBtn = el("button", "btn btn-secondary");
  prevBtn.type = "button";
  prevBtn.textContent = "上一条";
  const navLabel = el("span", "draft-card-form-nav-label");
  navLabel.textContent = "1 / 1";
  const nextBtn = el("button", "btn btn-secondary");
  nextBtn.type = "button";
  nextBtn.textContent = "下一条";
  navRow.append(prevBtn, navLabel, nextBtn);
  const saveBackBtn = el("button", "btn btn-primary draft-card-save-back");
  saveBackBtn.type = "button";
  saveBackBtn.textContent = "保存并返回列表";
  const deleteRowBtn = el("button", "btn btn-danger btn-sm draft-card-delete-row");
  deleteRowBtn.type = "button";
  deleteRowBtn.textContent = "删除此条";
  formFoot.append(navRow, saveBackBtn, deleteRowBtn);
  formView.append(formScroll, formFoot);

  main.append(errBox, listView, formView);
  sheet.append(submitOverlay, header, main);

  const footer = el("footer", "draft-card-editor__foot");
  const submitBtn = el("button", "btn btn-primary draft-card-submit-btn");
  submitBtn.type = "button";
  submitBtn.textContent = "提交修改（Agent 校验）";
  footer.appendChild(submitBtn);
  sheet.appendChild(footer);

  overlayEl.appendChild(sheet);
  document.body.appendChild(overlayEl);
  lockBodyScroll();

  function syncMetaFromInputs() {
    titleText = titleInput.value.trim();
    descText = descInput.value.trim();
  }

  function renderList() {
    listMount.innerHTML = "";
    rows.forEach((row, idx) => {
      const item = el("button", "draft-card-item");
      item.type = "button";
      item.dataset.index = String(idx);
      const assigned = hasAssignee(row.assignee);
      item.classList.toggle("is-unassigned", !assigned);
      const titleEl = el("div", "draft-card-item__title");
      titleEl.textContent = row.title || `子任务 ${idx + 1}`;
      const metaEl = el("div", "draft-card-item__meta");
      const due = normalizeDateInputValue(row.dueAt) || "待确认";
      metaEl.textContent = `${formatAssigneeDisplay(row.assignee)} · 截止 ${due}`;
      item.append(titleEl, metaEl);
      item.addEventListener("click", () => {
        editIndex = idx;
        showForm();
      });
      listMount.appendChild(item);
    });
    listHint.textContent = `${rows.length} 条子任务 · 点击进入编辑`;
  }

  function readFormIntoRow(index: number) {
    const row = { ...rows[index] } as DraftExcelRow;
    CARD_FORM_KEYS.forEach((key) => {
      if (key === "assignee") {
        row[key] = readAssigneeFromWrap(assigneeWrap);
        return;
      }
      const field = formFields[key];
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        row[key] = String(field.value ?? "").trim();
      }
    });
    if (row.dueAt) row.dueAt = normalizeDateInputValue(row.dueAt) || row.dueAt;
    rows[index] = row;
  }

  function fillFormFromRow(index: number) {
    const row = rows[index];
    if (!row) return;
    CARD_FORM_KEYS.forEach((key) => {
      if (key === "assignee") {
        if (assigneeWrap) {
          assigneeComboDestroy?.();
          assigneeComboDestroy = null;
          const parsed = parseAssigneeCellDisplay(String(row.assignee ?? ""));
          const mounted = mountContactComboInWrap(
            assigneeWrap,
            parsed,
            (kw) => `/api/workbench/manager/contacts?keyword=${encodeURIComponent(kw)}`,
          );
          assigneeComboDestroy = mounted.destroy;
        }
        return;
      }
      const field = formFields[key];
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        if (key === "dueAt") {
          field.value = normalizeDateInputValue(String(row.dueAt ?? ""));
        } else {
          field.value = String(row[key] ?? "");
        }
      }
    });
    navLabel.textContent = `${index + 1} / ${rows.length}`;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= rows.length - 1;
    deleteRowBtn.disabled = rows.length <= 1;
  }

  function showList() {
    view = "list";
    readFormIntoRow(editIndex);
    syncMetaFromInputs();
    listView.hidden = false;
    formView.hidden = true;
    backBtn.hidden = false;
    backBtn.setAttribute("aria-label", "关闭编辑");
    headTitle.textContent = "编辑草案";
    footer.hidden = false;
    renderList();
    detachInputScroll?.();
    detachInputScroll = attachMobileInputScrollAll(listView, main);
  }

  function showForm() {
    view = "form";
    listView.hidden = true;
    formView.hidden = false;
    backBtn.hidden = false;
    backBtn.setAttribute("aria-label", "返回列表");
    headTitle.textContent = rows[editIndex]?.title || `子任务 ${editIndex + 1}`;
    footer.hidden = true;
    fillFormFromRow(editIndex);
    detachInputScroll?.();
    detachInputScroll = attachMobileInputScrollAll(formScroll, formScroll);
  }

  function setSubmitting(active: boolean) {
    submitOverlay.hidden = !active;
    sheet.classList.toggle("draft-card-editor--submitting", active);
    submitBtn.disabled = active;
    closeBtn.disabled = active;
    addBtn.disabled = active;
    saveBackBtn.disabled = active;
    prevBtn.disabled = active || editIndex <= 0;
    nextBtn.disabled = active || editIndex >= rows.length - 1;
  }

  backBtn.addEventListener("click", () => {
    if (view === "form") showList();
    else closeDraftCardEditor();
  });

  closeBtn.addEventListener("click", () => closeDraftCardEditor());

  addBtn.addEventListener("click", () => {
    syncMetaFromInputs();
    rows.push(emptyRow(rows.length));
    rows.forEach((r, i) => {
      r.rowNum = String(i + 1);
    });
    editIndex = rows.length - 1;
    showForm();
  });

  saveBackBtn.addEventListener("click", () => showList());

  prevBtn.addEventListener("click", () => {
    if (editIndex <= 0) return;
    readFormIntoRow(editIndex);
    editIndex -= 1;
    fillFormFromRow(editIndex);
    headTitle.textContent = rows[editIndex]?.title || `子任务 ${editIndex + 1}`;
    detachInputScroll?.();
    detachInputScroll = attachMobileInputScrollAll(formScroll, formScroll);
  });

  nextBtn.addEventListener("click", () => {
    if (editIndex >= rows.length - 1) return;
    readFormIntoRow(editIndex);
    editIndex += 1;
    fillFormFromRow(editIndex);
    headTitle.textContent = rows[editIndex]?.title || `子任务 ${editIndex + 1}`;
    detachInputScroll?.();
    detachInputScroll = attachMobileInputScrollAll(formScroll, formScroll);
  });

  deleteRowBtn.addEventListener("click", () => {
    if (rows.length <= 1) {
      errBox.textContent = "至少保留 1 条子任务";
      return;
    }
    rows.splice(editIndex, 1);
    rows.forEach((r, i) => {
      r.rowNum = String(i + 1);
    });
    editIndex = Math.min(editIndex, rows.length - 1);
    showList();
  });

  submitBtn.addEventListener("click", async () => {
    errBox.textContent = "";
    if (view === "form") readFormIntoRow(editIndex);
    syncMetaFromInputs();
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
      const normalizedRows = rows.map((r, i) => ({
        ...r,
        rowNum: String(i + 1),
      }));
      await submitDraftRevise({
        threadId: opts.threadId,
        threadKind: opts.threadKind,
        title: titleText,
        description: descText,
        rows: normalizedRows,
        previousDraft: loaded.previousDraft,
        previousAssignment: loaded.previousAssignment,
      });
      closeDraftCardEditor();
      if (opts.onRevised) await opts.onRevised();
    } catch (e) {
      errBox.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      window.clearInterval(elapsedTimer);
      setSubmitting(false);
    }
  });

  renderList();
  detachInputScroll = attachMobileInputScrollAll(listView, main);
}
