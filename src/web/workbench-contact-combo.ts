/**
 * Shared contact search combo: 1-char min, debounce, keyboard navigation.
 * Used by draft Excel grid bundle and inline workbench pages (via snippet).
 */

export interface ContactComboRow {
  userId: string;
  name: string;
  departmentSummary?: string;
  departmentName?: string;
  matchedField?: string;
}

export interface ContactComboAttachOptions {
  input: HTMLInputElement;
  hiddenUserId?: HTMLInputElement | null;
  optionsList: HTMLElement;
  /** Full URL or builder receiving trimmed lowercase keyword */
  searchUrl: string | ((keyword: string) => string);
  /** Response key: "contacts" (manager) or "employees" (admin) */
  resultKey?: "contacts" | "employees";
  minLength?: number;
  debounceMs?: number;
  onFeedback?: (message: string, kind: "muted" | "ok" | "err") => void;
  onSelect?: (row: ContactComboRow) => void;
  escapeHtml?: (value: string) => string;
}

function defaultEscapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeRow(raw: Record<string, unknown>): ContactComboRow {
  return {
    userId: String(raw.userId ?? "").trim(),
    name: String(raw.name ?? raw.userId ?? "").trim(),
    departmentSummary: String(raw.departmentSummary ?? "").trim() || undefined,
    departmentName: String(raw.departmentName ?? "").trim() || undefined,
    matchedField: String(raw.matchedField ?? "").trim() || undefined,
  };
}

export function attachContactCombo(opts: ContactComboAttachOptions): { destroy: () => void } {
  const escape = opts.escapeHtml ?? defaultEscapeHtml;
  const minLen = opts.minLength ?? 1;
  const debounceMs = opts.debounceMs ?? 250;
  const resultKey = opts.resultKey ?? "contacts";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function close() {
    opts.optionsList.hidden = true;
    opts.optionsList.innerHTML = "";
  }

  function feedback(msg: string, kind: "muted" | "ok" | "err" = "muted") {
    opts.onFeedback?.(msg, kind);
  }

  function renderOptions(rows: ContactComboRow[]) {
    if (!rows.length) {
      close();
      feedback("无匹配结果", "muted");
      return;
    }
    opts.optionsList.innerHTML = rows
      .map((c) => {
        const dept = escape(c.departmentSummary || c.departmentName || "");
        const tag =
          c.matchedField === "department"
            ? '<span class="combo-tag">按部门匹配</span>'
            : "";
        return (
          `<li role="option" tabindex="-1" data-user-id="${escape(c.userId)}"` +
          ` data-name="${escape(c.name)}">` +
          `<span>${escape(c.name || c.userId)} · ${dept}</span>${tag}</li>`
        );
      })
      .join("");
    opts.optionsList.querySelectorAll("li[role='option']").forEach((li) => {
      li.removeAttribute("aria-selected");
    });
    opts.optionsList.hidden = false;
    feedback("点击选择负责人", "ok");
    opts.optionsList.querySelectorAll("li[role='option']").forEach((li) => {
      li.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        selectLi(li as HTMLLIElement);
      });
    });
  }

  function selectLi(li: HTMLLIElement) {
    const uid = li.getAttribute("data-user-id") || "";
    const name = li.getAttribute("data-name") || li.textContent?.replace(/按部门匹配/g, "").trim() || "";
    if (opts.hiddenUserId) opts.hiddenUserId.value = uid;
    opts.input.value = name.split("·")[0]?.trim() || name;
    close();
    opts.onSelect?.({
      userId: uid,
      name,
    });
  }

  async function runSearch() {
    if (destroyed) return;
    const kw = String(opts.input.value ?? "").trim().toLowerCase();
    if (kw.length < minLen) {
      close();
      if (opts.hiddenUserId) opts.hiddenUserId.value = "";
      return;
    }
    feedback("查找中…", "muted");
    try {
      const url =
        typeof opts.searchUrl === "function"
          ? opts.searchUrl(kw)
          : opts.searchUrl;
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !data.ok) {
        throw new Error(String(data.error ?? `HTTP ${res.status}`));
      }
      const rawRows = Array.isArray(data[resultKey]) ? (data[resultKey] as unknown[]) : [];
      renderOptions(
        rawRows
          .slice(0, 40)
          .map((r) => normalizeRow(r as Record<string, unknown>))
          .filter((r) => r.userId),
      );
    } catch (e) {
      close();
      feedback(e instanceof Error ? e.message : String(e), "err");
    }
  }

  function scheduleSearch() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void runSearch();
    }, debounceMs);
  }

  const onInput = () => {
    if (opts.hiddenUserId) opts.hiddenUserId.value = "";
    scheduleSearch();
  };

  const onBlur = () => {
    setTimeout(close, 200);
  };

  const onKeydown = (ev: KeyboardEvent) => {
    const ul = opts.optionsList;
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      return;
    }
    if (!ul || ul.hidden) return;
    const items = Array.from(ul.querySelectorAll("li[role='option']")) as HTMLLIElement[];
    if (!items.length) return;
    let cur = items.findIndex((li) => li.getAttribute("aria-selected") === "true");
    if (cur < 0) cur = 0;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      cur = (cur + 1) % items.length;
      items.forEach((li, i) => {
        li.setAttribute("aria-selected", i === cur ? "true" : "false");
      });
      items[cur]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      cur = (cur - 1 + items.length) % items.length;
      items.forEach((li, i) => {
        li.setAttribute("aria-selected", i === cur ? "true" : "false");
      });
      items[cur]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (ev.key === "Enter" && !ul.hidden) {
      const pick =
        items.find((li) => li.getAttribute("aria-selected") === "true") ?? items[0];
      if (!pick) return;
      ev.preventDefault();
      selectLi(pick);
    }
  };

  opts.input.addEventListener("input", onInput);
  opts.input.addEventListener("blur", onBlur);
  opts.input.addEventListener("keydown", onKeydown);

  return {
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      opts.input.removeEventListener("input", onInput);
      opts.input.removeEventListener("blur", onBlur);
      opts.input.removeEventListener("keydown", onKeydown);
      close();
    },
  };
}

/** Mount combo inside a table cell; returns hidden userId input. */
export function mountContactComboInCell(
  td: HTMLTableCellElement,
  assignee: { display: string; userId: string },
  searchUrl: string | ((keyword: string) => string),
): HTMLInputElement {
  td.innerHTML = "";
  td.className = "cell-contact-combo";
  const wrap = document.createElement("div");
  wrap.className = "contact-combo-wrap";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "cell-input cell-input--contact";
  input.autocomplete = "off";
  input.value = assignee.display.split("(")[0]?.trim() || assignee.display || "";
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.className = "cell-assignee-user-id";
  hidden.value = assignee.userId || "";
  const ul = document.createElement("ul");
  ul.className = "combo-options contact-combo-dropdown";
  ul.hidden = true;
  wrap.append(input, hidden, ul);
  td.appendChild(wrap);
  attachContactCombo({
    input,
    hiddenUserId: hidden,
    optionsList: ul,
    searchUrl,
    onSelect: (c) => {
      hidden.value = c.userId;
    },
  });
  return hidden;
}

export function parseAssigneeCellDisplay(raw: string): { display: string; userId: string } {
  const text = String(raw ?? "").trim();
  const uidMatch = text.match(/\(([^)]+)\)\s*$/);
  const userId = uidMatch?.[1]?.trim() ?? "";
  const display = uidMatch ? text.replace(/\s*\([^)]+\)\s*$/, "").trim() : text;
  return { display, userId };
}
