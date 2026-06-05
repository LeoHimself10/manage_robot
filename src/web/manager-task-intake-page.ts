import { renderWorkbenchPage } from "./workbench-shell";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";
import { buildWorkbenchContactComboClientJs } from "./workbench-contact-combo-snippet";

export function renderManagerTaskIntakePage(params: {
  userLabel?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
}): string {
  const portfolio = Boolean(params.portfolioEnabled);

  const tiCss = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Sora:wght@400;500;600&display=swap');

/* ── Design tokens ────────────────────────────────── */
.ti-root {
  --ti-ink:        var(--text,    #0f172a);
  --ti-ink-2:      #334155;
  --ti-ink-3:      var(--muted,   #64748b);
  --ti-accent:     var(--primary, #2563eb);
  --ti-accent-2:   var(--primary-hover, #1d4ed8);
  --ti-accent-pale:var(--primary-soft,  #eff6ff);
  --ti-bg:         var(--bg,      #f1f5f9);
  --ti-border:     var(--border,  #e2e8f0);
  --ti-surface:    var(--surface, #ffffff);
  --ti-mono:       'DM Mono', 'Courier New', monospace;
  --ti-sans:       'Sora', system-ui, -apple-system, sans-serif;
  --ti-req-color:  var(--danger,  #dc2626);
  font-family: var(--ti-sans);
  color: var(--ti-ink);
}

/* ── Stepper ──────────────────────────────────────── */
.ti-stepper {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 24px;
  user-select: none;
}
.ti-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
}
.ti-step-n {
  font-family: var(--ti-mono);
  font-size: 13px;
  font-weight: 500;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1.5px solid var(--ti-border);
  color: var(--ti-ink-3);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ti-surface);
  transition: background .2s, border-color .2s, color .2s;
  flex-shrink: 0;
}
.ti-step-lbl {
  font-family: var(--ti-sans);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .04em;
  color: var(--ti-ink-3);
  white-space: nowrap;
  transition: color .2s;
}
.ti-step.active .ti-step-n {
  background: var(--ti-accent);
  border-color: var(--ti-accent);
  color: #fff;
}
.ti-step.active .ti-step-lbl { color: var(--ti-accent); font-weight: 600; }
.ti-step-line {
  flex: 1;
  height: 1.5px;
  background: var(--ti-border);
  min-width: 24px;
  max-width: 64px;
  margin-bottom: 18px;
}
.ti-panel[hidden] { display: none !important; }

/* ── Panel wrapper ────────────────────────────────── */
.ti-panel-inner {
  background: var(--ti-surface);
  border: 1px solid var(--ti-border);
  border-radius: 12px;
  overflow: hidden;
}
.ti-section-head {
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--ti-border);
  background: var(--ti-cream);
}
.ti-section-head h2 {
  font-family: var(--ti-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--ti-ink);
  margin: 0;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.ti-section-body { padding: 20px; }

/* ── Field label style ────────────────────────────── */
.ti-lbl {
  display: block;
  font-family: var(--ti-sans);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ti-ink-3);
  margin-bottom: 5px;
}
.ti-lbl-req::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ti-req-color);
  vertical-align: super;
  margin-left: 4px;
}
.ti-lbl-hint {
  font-size: 10px;
  font-weight: 400;
  letter-spacing: .01em;
  text-transform: none;
  color: var(--ti-ink-3);
  margin-left: 4px;
  opacity: .8;
}
.ti-field-wrap { display: flex; flex-direction: column; }

/* ── Parent form inputs (box style) ──────────────── */
.ti-parent-form {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 680px) { .ti-parent-form { grid-template-columns: 1fr; } }
.ti-parent-form .ti-span2 { grid-column: 1 / -1; }

.ti-box-input, .ti-box-textarea, .ti-box-select {
  font-family: var(--ti-sans);
  font-size: 14px;
  color: var(--ti-ink);
  width: 100%;
  box-sizing: border-box;
  background: var(--ti-surface);
  border: 1.5px solid var(--ti-border);
  border-radius: 8px;
  padding: 9px 12px;
  transition: border-color .15s, box-shadow .15s;
}
.ti-box-input::placeholder, .ti-box-textarea::placeholder { color: var(--ti-ink-3); opacity: .7; }
.ti-box-input:focus, .ti-box-textarea:focus, .ti-box-select:focus {
  outline: none;
  border-color: var(--ti-accent);
  box-shadow: 0 0 0 3px rgba(37,99,235,.15);
}
.ti-box-textarea { min-height: 88px; resize: vertical; }

/* ── Paste textarea (step 1) ──────────────────────── */
.ti-paste-area {
  font-family: var(--ti-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--ti-ink);
  background: var(--ti-cream);
  border: 1.5px solid var(--ti-border);
  border-radius: 8px;
  padding: 14px 16px;
  width: 100%;
  min-height: 240px;
  box-sizing: border-box;
  resize: vertical;
  transition: border-color .15s;
}
.ti-paste-area::placeholder { color: var(--ti-ink-3); opacity: .65; font-size: 12px; }
.ti-paste-area:focus { outline: none; border-color: var(--ti-accent); box-shadow: 0 0 0 3px rgba(37,99,235,.15); }

/* ── Stats bar ────────────────────────────────────── */
.ti-stats {
  font-family: var(--ti-mono);
  font-size: 12px;
  color: var(--ti-ink-2);
  padding: 9px 16px;
  background: var(--ti-cream);
  border: 1px solid var(--ti-border);
  border-radius: 8px;
  margin: 0 0 16px;
  letter-spacing: .01em;
}

/* ── Subtask cards ────────────────────────────────── */
.ti-cards { display: flex; flex-direction: column; gap: 14px; }
.ti-card {
  border: 1px solid var(--ti-border);
  border-left: 3px solid var(--ti-accent);
  border-radius: 10px;
  background: var(--ti-surface);
  overflow: visible;
  transition: opacity .2s, filter .2s;
}
.ti-card.is-unchecked {
  opacity: .45;
  filter: grayscale(.5);
  border-left-color: var(--ti-border);
}
.ti-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  background: var(--ti-cream);
  border-bottom: 1px solid var(--ti-border);
}
.ti-card-num {
  font-family: var(--ti-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--ti-accent);
  background: var(--ti-accent-pale);
  padding: 2px 7px;
  border-radius: 4px;
  flex-shrink: 0;
  letter-spacing: .05em;
  min-width: 28px;
  text-align: center;
}
.ti-card.is-unchecked .ti-card-num { background: var(--ti-cream); color: var(--ti-ink-3); }
.ti-card-title {
  flex: 1;
  font-family: var(--ti-sans);
  font-size: 14px;
  font-weight: 500;
  color: var(--ti-ink);
  background: transparent;
  border: none;
  border-bottom: 1.5px solid transparent;
  padding: 4px 0;
  min-width: 0;
  transition: border-color .15s;
}
.ti-card-title:focus { outline: none; border-bottom-color: var(--ti-accent); }
.ti-card-title::placeholder { color: var(--ti-ink-3); opacity: .6; font-weight: 400; }
.ti-card-check {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
  accent-color: var(--ti-accent);
}
.ti-card-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

/* ── Card inline fields (bottom-border style) ─────── */
.ti-ifield { display: flex; flex-direction: column; gap: 3px; }
.ti-ifield input[type="text"],
.ti-ifield input[type="search"],
.ti-ifield input[type="date"],
.ti-ifield textarea {
  font-family: var(--ti-sans);
  font-size: 13px;
  color: var(--ti-ink);
  background: transparent;
  border: none;
  border-bottom: 1.5px solid var(--ti-border);
  border-radius: 0;
  padding: 5px 0;
  width: 100%;
  box-sizing: border-box;
  transition: border-color .15s;
}
.ti-ifield input::placeholder, .ti-ifield textarea::placeholder { color: var(--ti-ink-3); opacity: .6; font-size: 12px; }
.ti-ifield input:focus, .ti-ifield textarea:focus {
  outline: none;
  border-bottom-color: var(--ti-accent);
}
.ti-ifield textarea { min-height: 52px; resize: vertical; }
.ti-ifield input[type="date"] { cursor: pointer; }

/* ── Row layouts ──────────────────────────────────── */
.ti-row-assignee-due { display: grid; grid-template-columns: 1fr 130px; gap: 12px; align-items: start; }
@media (max-width: 480px) { .ti-row-assignee-due { grid-template-columns: 1fr; } }
.ti-fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .ti-fields-grid { grid-template-columns: 1fr; } }

/* ── Assignee combo ───────────────────────────────── */
.ti-assignee-wrap { position: relative; }
.combo-options {
  position: absolute;
  z-index: 10050;
  min-width: 220px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--ti-surface);
  border: 1px solid var(--ti-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15,23,42,.13), 0 2px 6px rgba(15,23,42,.06);
  list-style: none;
  margin: 4px 0 0;
  padding: 4px 0;
}
.combo-options[hidden] { display: none; }
.combo-options li {
  padding: 9px 14px;
  cursor: pointer;
  font-family: var(--ti-sans);
  font-size: 13px;
  color: var(--ti-ink-2);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background .1s;
}
.combo-options li:hover, .combo-options li[aria-selected="true"] {
  background: var(--ti-accent-pale);
  color: var(--ti-accent);
}
.combo-tag {
  font-size: 10px;
  background: #dbeafe;
  color: #1e40af;
  border-radius: 4px;
  padding: 1px 5px;
  font-family: var(--ti-mono);
}
.ti-assignee-hint {
  font-family: var(--ti-mono);
  font-size: 10.5px;
  color: var(--ti-ink-3);
  margin-top: 3px;
  min-height: 15px;
  letter-spacing: .01em;
}
.ti-assignee-hint.is-ok { color: #16a34a; }
.ti-assignee-hint.is-warn { color: #b45309; }

/* ── Optional divider ─────────────────────────────── */
.ti-optional-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ti-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ti-ink-3);
  margin: 2px 0;
}
.ti-optional-divider::before, .ti-optional-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ti-border);
}

/* ── Actions bar ──────────────────────────────────── */
.ti-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.ti-btn {
  font-family: var(--ti-sans);
  font-size: 14px;
  font-weight: 600;
  padding: 10px 24px;
  border-radius: 8px;
  cursor: pointer;
  border: none;
  min-height: 42px;
  transition: background .15s, transform .1s, box-shadow .15s;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ti-btn-primary {
  background: var(--ti-accent);
  color: #fff;
}
.ti-btn-primary:hover { background: var(--ti-accent-2); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(37,99,235,.25); }
.ti-btn-primary:active { transform: none; }
.ti-btn-ghost {
  background: transparent;
  color: var(--ti-ink-2);
  border: 1.5px solid var(--ti-border);
}
.ti-btn-ghost:hover { background: var(--ti-cream); border-color: var(--ti-ink-3); }
@media (max-width: 480px) {
  .ti-actions { flex-direction: column; }
  .ti-btn { width: 100%; }
}

/* ── Feedback ─────────────────────────────────────── */
.ti-feedback {
  margin-top: 10px;
  font-family: var(--ti-sans);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ti-ink-3);
  min-height: 18px;
}
.ti-feedback.is-err { color: var(--ti-accent); font-weight: 500; }

/* ── Result panel ─────────────────────────────────── */
.ti-result {
  padding: 24px 20px;
  font-family: var(--ti-sans);
  font-size: 14px;
  line-height: 1.7;
  color: var(--ti-ink-2);
}
.ti-result-icon { font-size: 28px; margin-bottom: 10px; }
.ti-result strong { color: var(--ti-ink); }
`;

  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-task-intake",
    title: "任务快录入库",
    pageTitle: "任务快录入库 · 主管工作台",
    description: "粘贴已拆好的任务清单，系统忠实映射为父任务 + 子任务，核对后直接入库。",
    userLabel: params.userLabel,
    portfolioEnabled: portfolio,
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: tiCss,
    mainHtml: `
<div class="ti-root">

  <!-- Stepper -->
  <nav class="ti-stepper" aria-label="步骤">
    <div class="ti-step active" data-step-label="1">
      <div class="ti-step-n">01</div>
      <span class="ti-step-lbl">粘贴</span>
    </div>
    <div class="ti-step-line"></div>
    <div class="ti-step" data-step-label="2">
      <div class="ti-step-n">02</div>
      <span class="ti-step-lbl">核对</span>
    </div>
    <div class="ti-step-line"></div>
    <div class="ti-step" data-step-label="3">
      <div class="ti-step-n">03</div>
      <span class="ti-step-lbl">结果</span>
    </div>
  </nav>

  <!-- Step 1 -->
  <div class="ti-panel" id="step1Panel">
    <div class="ti-panel-inner">
      <div class="ti-section-head"><h2>粘贴已拆好的任务清单</h2></div>
      <div class="ti-section-body" style="display:flex;flex-direction:column;gap:14px;">
        <div class="ti-field-wrap">
          <span class="ti-lbl">父任务标题 <span class="ti-lbl-hint">可选，留空由系统提炼</span></span>
          <input id="parentTitle" type="text" class="ti-box-input" placeholder="如：6月注册申报准备" />
        </div>
        <div class="ti-field-wrap">
          <span class="ti-lbl ti-lbl-req">任务清单</span>
          <textarea id="pastedText" class="ti-paste-area" placeholder="每行一条任务，可带负责人、截止日期、交付物等信息。&#10;系统不会重新拆解，只忠实录入。&#10;&#10;示例：&#10;1. 整理临床资料 — 负责人：张三 — 截止 06-10&#10;2. 撰写技术要求 — 负责人：李四 — 截止 06-12"></textarea>
        </div>
        <div class="ti-feedback" id="parseFeedback"></div>
        <div class="ti-actions">
          <button type="button" class="ti-btn ti-btn-primary" id="parseBtn">解析任务 →</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Step 2 -->
  <div class="ti-panel" id="step2Panel" hidden>
    <!-- Parent task form -->
    <div class="ti-panel-inner" style="margin-bottom:16px;">
      <div class="ti-section-head"><h2>父任务信息</h2></div>
      <div class="ti-section-body">
        <div class="ti-parent-form" id="parentForm">
          <div class="ti-field-wrap">
            <span class="ti-lbl ti-lbl-req">标题</span>
            <input id="parentTitle2" type="text" class="ti-box-input" placeholder="必填" />
          </div>
          <div class="ti-field-wrap">
            <span class="ti-lbl ti-lbl-req">描述 / 背景 <span class="ti-lbl-hint">由模型提炼，可修改</span></span>
            <textarea id="parentDesc2" class="ti-box-textarea" placeholder="任务整体目标、来由与验收口径（与 Agent 发布一致）"></textarea>
          </div>
          ${portfolio ? `<div class="ti-field-wrap ti-span2">
            <span class="ti-lbl">归属项目 <span class="ti-lbl-hint">可选</span></span>
            <select id="projectSelect" class="ti-box-input"><option value="">不归档</option></select>
          </div>` : ""}
        </div>
      </div>
    </div>

    <!-- Subtask cards -->
    <div class="ti-stats" id="previewStats"></div>
    <div class="ti-cards" id="tiCards"></div>

    <div class="ti-actions">
      <button type="button" class="ti-btn ti-btn-ghost" id="backTo1Btn">← 上一步</button>
      <button type="button" class="ti-btn ti-btn-primary" id="commitBtn">确认录入</button>
    </div>
    <div class="ti-feedback" id="commitFeedback"></div>
  </div>

  <!-- Step 3 -->
  <div class="ti-panel" id="step3Panel" hidden>
    <div class="ti-panel-inner">
      <div class="ti-result" id="resultBody"></div>
    </div>
    <div class="ti-actions">
      <a class="ti-btn ti-btn-primary" id="tasksLink" href="/workbench/manager/tasks">查看任务</a>
      <button type="button" class="ti-btn ti-btn-ghost" id="restartBtn">再录一批</button>
    </div>
  </div>

</div>`,
    scriptHtml: `<script>
${buildWorkbenchViewSwitchClientJs()}
${buildWorkbenchContactComboClientJs()}
(function () {
  var PORTFOLIO = ${portfolio ? "true" : "false"};
  var state = { rows: [], parentTitle: "", parentDescription: "" };

  /* ── utils ── */
  function setStep(n) {
    document.querySelectorAll(".ti-step").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-step-label") === String(n));
    });
    ["step1Panel", "step2Panel", "step3Panel"].forEach(function (id, i) {
      document.getElementById(id).hidden = i + 1 !== n;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function setFb(id, msg, isErr) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.className = "ti-feedback" + (isErr ? " is-err" : "");
  }

  /* ── projects ── */
  async function loadProjects() {
    if (!PORTFOLIO) return;
    try {
      var res = await fetch("/api/workbench/manager/projects");
      var data = await res.json();
      if (!data.ok) return;
      var sel = document.getElementById("projectSelect");
      if (!sel) return;
      (data.projects || []).forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = p.projectId;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
    } catch (e) { /* optional */ }
  }

  /* ── render subtask cards ── */
  function renderCards() {
    var container = document.getElementById("tiCards");
    container.innerHTML = "";

    state.rows.forEach(function (row, idx) {
      var card = document.createElement("div");
      card.className = "ti-card";
      card.setAttribute("data-idx", String(idx));

      /* ── head ── */
      var head = document.createElement("div");
      head.className = "ti-card-head";
      head.innerHTML =
        '<input type="checkbox" class="ti-card-check row-selected" ' + (row.selected !== false ? "checked" : "") + ' aria-label="入库此条" />' +
        '<span class="ti-card-num">' + String(idx + 1).padStart(2, "0") + '</span>' +
        '<input type="text" class="ti-card-title row-title" value="' + esc(row.title || "") + '" placeholder="子任务标题（必填）" />';
      card.appendChild(head);

      /* ── body ── */
      var body = document.createElement("div");
      body.className = "ti-card-body";

      /* assignee + due (due is required) */
      var topRow = document.createElement("div");
      topRow.className = "ti-row-assignee-due";

      var assigneeWrap = document.createElement("div");
      assigneeWrap.className = "ti-assignee-wrap ti-ifield";
      var aLbl = document.createElement("span");
      aLbl.className = "ti-lbl";
      aLbl.innerHTML = '负责人 <span style="color:var(--ti-req-color);font-weight:700;">·</span> <span class="ti-lbl-hint">输入姓名 1 字起搜索；留空→暂存草案</span>';
      var aInput = document.createElement("input");
      aInput.type = "search";
      aInput.autocomplete = "off";
      aInput.placeholder = "搜索姓名…";
      aInput.value = row.assigneeDisplayName || row.assigneeNameRaw || "";
      var aHidden = document.createElement("input");
      aHidden.type = "hidden";
      aHidden.className = "row-assignee-id";
      aHidden.value = row.assigneeUserId || "";
      var aUl = document.createElement("ul");
      aUl.className = "combo-options";
      aUl.hidden = true;
      var aHint = document.createElement("div");
      aHint.className = "ti-assignee-hint";
      if (row.assigneeDisplayName) {
        aHint.textContent = row.assigneeDisplayName + " (" + (row.assigneeUserId || "") + ")";
        aHint.classList.add("is-ok");
      } else if (row.needsConfirm && row.assigneeNameRaw) {
        aHint.textContent = "「" + row.assigneeNameRaw + "」未匹配，请重新搜索";
        aHint.classList.add("is-warn");
      } else {
        aHint.textContent = "未指定 → 暂存草案";
      }
      assigneeWrap.append(aLbl, aInput, aHidden, aUl, aHint);

      wbAttachContactCombo({
        input: aInput,
        hiddenUserId: aHidden,
        optionsList: aUl,
        searchUrl: function (kw) { return "/api/workbench/manager/contacts?keyword=" + encodeURIComponent(kw); },
        onFeedback: function (msg) { aHint.textContent = msg; aHint.className = "ti-assignee-hint"; },
        onSelect: function (c) {
          aHidden.value = c.userId;
          aHint.textContent = c.name + " (" + c.userId + ")";
          aHint.className = "ti-assignee-hint is-ok";
        },
      });
      topRow.appendChild(assigneeWrap);

      var dueWrap = document.createElement("div");
      dueWrap.className = "ti-ifield";
      dueWrap.innerHTML = '<span class="ti-lbl ti-lbl-req">截止</span>' +
        '<input type="date" class="row-due" value="' + esc((row.dueAt || "").slice(0, 10)) + '" />';
      topRow.appendChild(dueWrap);
      body.appendChild(topRow);

      /* objective (full width, required — model drafts) */
      var objWrap = document.createElement("div");
      objWrap.className = "ti-ifield";
      objWrap.innerHTML = '<span class="ti-lbl ti-lbl-req">目标 <span class="ti-lbl-hint">由模型提炼，可修改</span></span>' +
        '<input type="text" class="row-objective" value="' + esc(row.objective || "") + '" placeholder="由模型提炼，可修改" />';
      body.appendChild(objWrap);

      /* deliverables + completionCriteria (required) */
      var g1 = document.createElement("div");
      g1.className = "ti-fields-grid";
      g1.innerHTML =
        '<div class="ti-ifield"><span class="ti-lbl ti-lbl-req">交付物 <span class="ti-lbl-hint">多项用；分隔</span></span>' +
        '<textarea class="row-deliverables" rows="2" placeholder="由模型提炼，可修改">' + esc(row.deliverables || "") + "</textarea></div>" +
        '<div class="ti-ifield"><span class="ti-lbl ti-lbl-req">完成标准 <span class="ti-lbl-hint">多项用；分隔</span></span>' +
        '<textarea class="row-completion" rows="2" placeholder="由模型提炼，可修改">' + esc(row.completionCriteria || "") + "</textarea></div>";
      body.appendChild(g1);

      /* optional divider */
      var divider = document.createElement("div");
      divider.className = "ti-optional-divider";
      divider.textContent = "选填";
      body.appendChild(divider);

      /* actions + dependsOn (optional) */
      var g2 = document.createElement("div");
      g2.className = "ti-fields-grid";
      g2.innerHTML =
        '<div class="ti-ifield"><span class="ti-lbl">执行动作 <span class="ti-lbl-hint">多项用；分隔</span></span>' +
        '<textarea class="row-actions" rows="2" placeholder="可选">' + esc(row.actions || "") + "</textarea></div>" +
        '<div class="ti-ifield"><span class="ti-lbl">前置依赖 <span class="ti-lbl-hint">多项用；分隔</span></span>' +
        '<textarea class="row-depends" rows="2" placeholder="可选">' + esc(row.dependsOn || "") + "</textarea></div>";
      body.appendChild(g2);

      card.appendChild(body);

      /* toggle unchecked */
      var chk = head.querySelector(".row-selected");
      chk.addEventListener("change", function () {
        card.classList.toggle("is-unchecked", !chk.checked);
      });
      if (row.selected === false) card.classList.add("is-unchecked");

      container.appendChild(card);
    });

    document.getElementById("previewStats").textContent =
      state.rows.length + " 条子任务 · 全部有负责人 → 直接入库正式任务 · 有缺项 → 暂存草案供点将后发布";
  }

  function collectRows() {
    var out = [];
    document.querySelectorAll(".ti-card[data-idx]").forEach(function (card) {
      var idx = Number(card.getAttribute("data-idx"));
      var base = state.rows[idx];
      if (!base) return;
      out.push({
        itemId: base.itemId,
        selected: card.querySelector(".row-selected").checked,
        title: card.querySelector(".row-title").value.trim(),
        objective: card.querySelector(".row-objective").value,
        deliverables: card.querySelector(".row-deliverables").value,
        completionCriteria: card.querySelector(".row-completion").value,
        actions: card.querySelector(".row-actions").value,
        dependsOn: card.querySelector(".row-depends").value,
        dueAt: card.querySelector(".row-due").value || undefined,
        assigneeUserId: card.querySelector(".row-assignee-id").value.trim(),
      });
    });
    return out;
  }

  /* ── step 1: parse ── */
  document.getElementById("parseBtn").addEventListener("click", async function () {
    setFb("parseFeedback", "解析中…", false);
    try {
      var res = await fetch("/api/workbench/manager/task-intake/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pastedText: document.getElementById("pastedText").value,
          parentTitle: document.getElementById("parentTitle").value,
        }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "解析失败");
      state.rows = data.rows || [];
      state.parentTitle = data.parentTitle || "";
      state.parentDescription = data.parentDescription || "";
      if (!state.rows.length) { setFb("parseFeedback", "未识别到任务，请检查粘贴内容", true); return; }
      setFb("parseFeedback", (data.warnings && data.warnings.length) ? "提示：" + data.warnings.join("；") : "", false);
      document.getElementById("parentTitle2").value = state.parentTitle;
      document.getElementById("parentDesc2").value = state.parentDescription;
      await loadProjects();
      renderCards();
      setStep(2);
    } catch (err) {
      setFb("parseFeedback", err.message || String(err), true);
    }
  });

  /* ── step 2: commit ── */
  document.getElementById("commitBtn").addEventListener("click", async function () {
    setFb("commitFeedback", "", false);
    var parentTitle = document.getElementById("parentTitle2").value.trim();
    var parentDescription = document.getElementById("parentDesc2").value.trim();
    var rows = collectRows();
    var selected = rows.filter(function (r) { return r.selected; });

    var problems = [];
    if (!parentTitle) problems.push("父任务标题必填");
    if (!parentDescription) problems.push("父任务描述/背景必填");
    if (!selected.length) problems.push("请至少勾选 1 条子任务");
    var noTitle = selected.filter(function (r) { return !r.title; });
    if (noTitle.length) problems.push(noTitle.length + " 条子任务标题为空");
    var noObj = selected.filter(function (r) { return !String(r.objective || "").trim(); });
    if (noObj.length) problems.push(noObj.length + " 条子任务目标为空（必填，可修改模型草稿）");
    var noDel = selected.filter(function (r) { return !String(r.deliverables || "").trim(); });
    if (noDel.length) problems.push(noDel.length + " 条子任务交付物为空（必填，可修改模型草稿）");
    var noCrit = selected.filter(function (r) { return !String(r.completionCriteria || "").trim(); });
    if (noCrit.length) problems.push(noCrit.length + " 条子任务完成标准为空（必填，可修改模型草稿）");
    var noDue = selected.filter(function (r) { return !r.dueAt; });
    if (noDue.length) problems.push(noDue.length + " 条子任务截止日期为空（必填）");
    if (problems.length) {
      setFb("commitFeedback", "请先补齐：" + problems.join("；"), true);
      return;
    }

    setFb("commitFeedback", "提交中…", false);
    try {
      var projectSel = document.getElementById("projectSelect");
      var res = await fetch("/api/workbench/manager/task-intake/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentTitle: parentTitle,
          parentDescription: parentDescription,
          projectId: projectSel ? projectSel.value : "",
          projectName: projectSel && projectSel.value ? ((projectSel.options[projectSel.selectedIndex] || {}).text || "") : "",
          rows: rows,
        }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "录入失败");
      var r = data.result || {};
      if (r.mode === "invalid") {
        setFb("commitFeedback", "必填项未通过：" + (r.errors || []).map(function (e) { return e.message; }).join("；"), true);
        return;
      }
      var html = "";
      if (r.mode === "published") {
        html = '<div class="ti-result-icon">✅</div>' +
          '<p>已入库正式任务 <strong>' + esc(r.task ? r.task.title : "") + '</strong>' +
          '（' + esc(r.task ? r.task.taskNo : "") + '），含 <strong>' + r.subtaskCount + '</strong> 条子任务。</p>' +
          (r.errors && r.errors.length ? '<p style="color:var(--ti-ink-3);font-size:12px;">' + r.errors.map(function (e) { return esc(e.message); }).join("；") + '</p>' : '');
        document.getElementById("tasksLink").href = "/workbench/manager/tasks";
        document.getElementById("tasksLink").textContent = "查看任务";
      } else if (r.mode === "staged") {
        html = '<div class="ti-result-icon">📋</div>' +
          '<p>有子任务未指定负责人，已将草案（<strong>' + r.subtaskCount + '</strong> 条子任务）暂存至智能规划助手，请在 Excel 编辑器中点将后发布。</p>' +
          (r.errors && r.errors.length ? '<p style="color:var(--ti-ink-3);font-size:12px;">' + r.errors.map(function (e) { return esc(e.message); }).join("；") + '</p>' : '');
        document.getElementById("tasksLink").href = r.stagedDeepLink || "/workbench/manager/chat?thread=main&openDraftEditor=1";
        document.getElementById("tasksLink").textContent = "去点将发布 →";
      } else {
        html = "<p>没有选中任何子任务。</p>";
      }
      document.getElementById("resultBody").innerHTML = html;
      setStep(3);
    } catch (err) {
      setFb("commitFeedback", err.message || String(err), true);
    }
  });

  document.getElementById("backTo1Btn").addEventListener("click", function () { setStep(1); });
  document.getElementById("restartBtn").addEventListener("click", function () { location.reload(); });
  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", function () {
    fetch("/api/workbench/logout", { method: "POST" }).finally(function () { location.href = "/workbench/login"; });
  });
  if (typeof wbBindViewSwitchLink === "function") wbBindViewSwitchLink("navMyTasks", "employee", "/workbench/employee?view=new");
})();
</script>`,
  });
}
