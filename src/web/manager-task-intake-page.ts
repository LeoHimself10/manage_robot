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
  position: relative;
  /* Above portaled contact dropdown (z-index 20000) so 移组 stays clickable */
  z-index: 30001;
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
.ti-row-assignee-due { display: grid; grid-template-columns: 1fr 220px; gap: 12px; align-items: start; }
@media (max-width: 480px) { .ti-row-assignee-due { grid-template-columns: 1fr; } }
.ti-fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .ti-fields-grid { grid-template-columns: 1fr; } }
.ti-due-mode-row { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.ti-due-mode-row label { font-size: 12px; color: var(--ti-ink-2); display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }

/* ── Assignee combo ───────────────────────────────── */
.ti-assignee-wrap { position: relative; }
/* Elevate stacking context while searching so dropdown paints above sibling fields */
.ti-assignee-wrap:focus-within { z-index: 200; }
.combo-options {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 201;
  min-width: 220px;
  max-height: 240px;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid var(--ti-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15,23,42,.13), 0 2px 6px rgba(15,23,42,.06);
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.combo-options.combo-options--fixed {
  position: fixed;
  right: auto;
  z-index: 20000;
  background: #ffffff;
}
.combo-options { pointer-events: none; }
.combo-options li { pointer-events: auto; }
.combo-options[hidden] { display: none !important; pointer-events: none !important; }
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

/* ── Per-card target badge ────────────────────── */
.ti-target-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px 2px 6px;
  border: 1px solid var(--ti-border); border-radius: 5px;
  font-family: var(--ti-mono); font-size: 10.5px; font-weight: 500;
  color: var(--ti-ink-3); background: var(--ti-bg);
  cursor: pointer; flex-shrink: 0; white-space: nowrap;
  transition: border-color .12s, color .12s, background .12s;
  user-select: none; max-width: 140px; overflow: hidden; text-overflow: ellipsis;
}
.ti-target-badge:hover { border-color: var(--ti-accent); color: var(--ti-accent); background: var(--ti-accent-pale); }
.ti-target-badge.is-append { border-color: var(--ti-accent); color: var(--ti-accent); background: var(--ti-accent-pale); }
.ti-target-badge .ti-tb-icon { font-size: 10px; }

/* ── Target picker popover ────────────────────── */
.ti-target-popover {
  position: fixed; z-index: 30100;
  width: 280px;
  background: var(--ti-surface);
  border: 1px solid var(--ti-border); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15,23,42,.15), 0 2px 8px rgba(15,23,42,.08);
  padding: 10px 0 6px;
}
.ti-target-popover[hidden] { display: none !important; }
.ti-tp-search {
  margin: 0 10px 6px;
  font-family: var(--ti-sans); font-size: 13px;
  border: 1.5px solid var(--ti-border); border-radius: 8px;
  padding: 7px 10px; width: calc(100% - 20px); box-sizing: border-box;
  background: var(--ti-bg);
}
.ti-tp-search:focus { outline: none; border-color: var(--ti-accent); }
.ti-tp-list { list-style: none; margin: 0; padding: 0; max-height: 200px; overflow-y: auto; }
.ti-tp-list li {
  padding: 8px 14px; cursor: pointer;
  font-family: var(--ti-sans); font-size: 13px; color: var(--ti-ink-2);
  display: flex; align-items: baseline; gap: 8px;
  transition: background .1s;
}
.ti-tp-list li:hover { background: var(--ti-accent-pale); color: var(--ti-accent); }
.ti-tp-list li.is-new { font-weight: 600; color: var(--ti-ink); border-bottom: 1px solid var(--ti-border); }
.ti-tp-no { font-family: var(--ti-mono); font-size: 10.5px; color: var(--ti-ink-3); flex-shrink: 0; }

/* ── Group view ───────────────────────────────── */
.ti-group { margin-bottom: 14px; border: 1.5px solid var(--ti-border); border-radius: 12px; overflow: visible; }
.ti-group-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ti-border);
  position: relative;
  z-index: 30001;
}
.ti-group-head.gtype-new   { background: #f0fdf4; border-left: 3px solid #16a34a; }
.ti-group-head.gtype-append { background: var(--ti-accent-pale); border-left: 3px solid var(--ti-accent); }
.ti-group-head.gtype-unassigned { background: #fffbeb; border-left: 3px solid #d97706; }
.ti-group-icon { font-size: 15px; flex-shrink: 0; }
.ti-group-title {
  flex: 1; min-width: 0;
  font-family: var(--ti-sans); font-size: 13px; font-weight: 600; color: var(--ti-ink);
}
.ti-group-title .ti-group-subtitle {
  font-weight: 400; font-size: 11px; color: var(--ti-ink-3); margin-left: 6px;
  font-family: var(--ti-mono);
}
.ti-group-badge { font-family: var(--ti-mono); font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e40af; flex-shrink: 0; }
.ti-group-bulk-btn {
  font-family: var(--ti-sans); font-size: 12px; font-weight: 500;
  padding: 4px 10px; border: 1.5px solid var(--ti-border); border-radius: 6px;
  background: var(--ti-surface); color: var(--ti-ink-3); cursor: pointer; flex-shrink: 0;
  transition: border-color .12s, color .12s;
}
.ti-group-bulk-btn:hover { border-color: var(--ti-accent); color: var(--ti-accent); }
.ti-move-trigger { position: relative; z-index: 1; pointer-events: auto; }
.ti-group-form { padding: 14px 16px 4px; border-bottom: 1px solid var(--ti-border); background: var(--ti-bg); }
.ti-group-cards-wrap { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.ti-group-empty { padding: 12px 16px; color: var(--ti-ink-3); font-size: 12px; font-family: var(--ti-sans); font-style: italic; }

/* AI suggestion badge on cards */
.ti-ai-badge {
  font-family: var(--ti-mono); font-size: 10px; font-weight: 500;
  padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
  white-space: nowrap;
}
.ti-ai-badge.ai-sure  { background: #dcfce7; color: #15803d; }
.ti-ai-badge.ai-mid   { background: #dbeafe; color: #1d4ed8; }
.ti-ai-badge.ai-none  { background: #fef3c7; color: #b45309; }
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

  <!-- Target picker popover (shared, positioned by JS) -->
  <div class="ti-target-popover" id="targetPopover" hidden>
    <input class="ti-tp-search" id="tpSearch" type="search" placeholder="搜索已有任务…" autocomplete="off" />
    <ul class="ti-tp-list" id="tpList"></ul>
  </div>

  <!-- Step 1 -->
  <div class="ti-panel" id="step1Panel">
    <div class="ti-panel-inner">
      <div class="ti-section-head"><h2>粘贴已拆好的任务清单</h2></div>
      <div class="ti-section-body" style="display:flex;flex-direction:column;gap:14px;">
        <div class="ti-field-wrap">
          <span class="ti-lbl">父任务标题 <span class="ti-lbl-hint">可选，留空由系统提炼；若全部子任务追加到已有任务可忽略</span></span>
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

  <!-- Step 2: group view -->
  <div class="ti-panel" id="step2Panel" hidden>
    <div class="ti-stats" id="previewStats"></div>
    <div id="groupsContainer"></div>
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

  /*
   * State:
   *   rows[i] — preview row extended with:
   *     targetPlanId?: string   → append to this existing task
   *     targetTitle/targetNo    → display for existing task
   *     newGroupId?: string     → belongs to this new-parent group ("ng_0", "ng_1", …)
   *     needsAssignment: bool   → AI was unsure; user must assign before commit
   *   newGroups — { [groupId]: { title, description, projectId, projectName } }
   *   newGroupCounter — auto-increment for generating new group IDs
   *   allTasks — cached existing tasks
   *   pickerForIdxs — row indices targeted by current popover
   */
  var DEFAULT_GROUP = "ng_0";
  var activeCombos = [];
  var state = {
    rows: [],
    newGroups: {},          // { [groupId]: { title, description, projectId, projectName } }
    newGroupCounter: 0,
    allTasks: null,
    pickerForIdxs: null,
  };

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
  function aiBadgeHtml(row) {
    var conf = row.suggestedConfidence || 0;
    if (!row.suggestedTargetPlanId && conf < 0.6) return "";
    if (conf >= 0.85) return '<span class="ti-ai-badge ai-sure">AI ✓</span>';
    if (conf >= 0.6)  return '<span class="ti-ai-badge ai-mid">AI ' + Math.round(conf * 100) + '%</span>';
    return '<span class="ti-ai-badge ai-none">AI 未分配</span>';
  }

  /* ── projects ── */
  var projectsLoaded = false;
  async function loadProjects() {
    if (!PORTFOLIO || projectsLoaded) return;
    projectsLoaded = true;
    try {
      var res = await fetch("/api/workbench/manager/projects");
      var data = await res.json();
      if (!data.ok) return;
      document.querySelectorAll(".ti-group-project-sel").forEach(function (sel) {
        var cur = sel.value;
        sel.innerHTML = '<option value="">不归档</option>';
        (data.projects || []).forEach(function (p) {
          var opt = document.createElement("option");
          opt.value = p.projectId;
          opt.textContent = p.name;
          sel.appendChild(opt);
        });
        if (cur) sel.value = cur;
      });
    } catch (e) { /* optional */ }
  }

  /* ── load existing tasks (cached) ── */
  async function loadAllTasks() {
    if (state.allTasks) return state.allTasks;
    try {
      var res = await fetch("/api/workbench/manager/tasks");
      var data = await res.json();
      if (!data.ok) return [];
      state.allTasks = (data.tasks || []).filter(function (t) {
        return t.status !== "DONE" && t.status !== "STOPPED";
      });
      return state.allTasks;
    } catch (e) { return []; }
  }

  /* ── helpers for new group management ── */
  function nextGroupId() {
    state.newGroupCounter++;
    return "ng_" + state.newGroupCounter;
  }
  function ensureGroup(gid, titleHint) {
    if (!state.newGroups[gid]) {
      state.newGroups[gid] = { title: titleHint || "", description: "", projectId: "", projectName: "" };
    }
  }

  /* ── derive groups from rows ── */
  function deriveGroups() {
    var newGroupMap = {};  // groupId → { type:"new", groupId, idxs[] }
    var appendMap = {};    // planId  → { type:"append", planId, taskTitle, taskNo, idxs[] }
    var unassigned = { type: "unassigned", idxs: [] };

    state.rows.forEach(function (row, idx) {
      if (row.needsAssignment) {
        unassigned.idxs.push(idx);
      } else if (row.targetPlanId) {
        if (!appendMap[row.targetPlanId]) {
          appendMap[row.targetPlanId] = { type: "append", planId: row.targetPlanId, taskTitle: row.targetTitle || row.targetPlanId, taskNo: row.targetNo || "", idxs: [] };
        }
        appendMap[row.targetPlanId].idxs.push(idx);
      } else {
        var gid = row.newGroupId || DEFAULT_GROUP;
        if (!newGroupMap[gid]) newGroupMap[gid] = { type: "new", groupId: gid, idxs: [] };
        newGroupMap[gid].idxs.push(idx);
      }
    });

    var groups = [];
    Object.keys(newGroupMap).sort().forEach(function (gid) { groups.push(newGroupMap[gid]); });
    Object.keys(appendMap).forEach(function (pid) { groups.push(appendMap[pid]); });
    if (unassigned.idxs.length) groups.push(unassigned);
    return groups;
  }

  /* ── render a single subtask card ── */
  function buildCard(row, idx) {
    var card = document.createElement("div");
    card.className = "ti-card";
    card.setAttribute("data-idx", String(idx));

    /* head */
    var head = document.createElement("div");
    head.className = "ti-card-head";
    head.innerHTML =
      '<input type="checkbox" class="ti-card-check row-selected" ' + (row.selected !== false ? "checked" : "") + ' aria-label="入库此条" />' +
      '<span class="ti-card-num">' + String(idx + 1).padStart(2, "0") + '</span>' +
      aiBadgeHtml(row) +
      '<input type="text" class="ti-card-title row-title" value="' + esc(row.title || "") + '" placeholder="子任务标题（必填）" />' +
      '<button type="button" class="ti-group-bulk-btn ti-move-trigger card-move-btn" title="移到其他组" style="font-size:11px;padding:3px 8px;">移组 ▾</button>';
    card.appendChild(head);

    head.querySelector(".card-move-btn").addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPopoverFor([idx], e.currentTarget);
    });

    /* body */
    var body = document.createElement("div");
    body.className = "ti-card-body";

    var topRow = document.createElement("div");
    topRow.className = "ti-row-assignee-due";

    var assigneeWrap = document.createElement("div");
    assigneeWrap.className = "ti-assignee-wrap ti-ifield";
    var aLbl = document.createElement("span");
    aLbl.className = "ti-lbl";
    var isAppend = Boolean(row.targetPlanId);
    aLbl.innerHTML = '负责人 <span style="color:var(--ti-req-color);font-weight:700;">·</span> <span class="ti-lbl-hint">' + (isAppend ? '追加模式必填' : '留空→暂存草案') + '</span>';
    var aInput = document.createElement("input");
    aInput.type = "search"; aInput.autocomplete = "off"; aInput.placeholder = "搜索姓名…";
    aInput.value = row.assigneeDisplayName || row.assigneeNameRaw || "";
    var aHidden = document.createElement("input");
    aHidden.type = "hidden"; aHidden.className = "row-assignee-id"; aHidden.value = row.assigneeUserId || "";
    var aUl = document.createElement("ul"); aUl.className = "combo-options"; aUl.hidden = true;
    var aHint = document.createElement("div");
    aHint.className = "ti-assignee-hint";
    if (row.assigneeDisplayName) { aHint.textContent = row.assigneeDisplayName + " (" + (row.assigneeUserId || "") + ")"; aHint.classList.add("is-ok"); }
    else if (row.needsConfirm && row.assigneeNameRaw) { aHint.textContent = "「" + row.assigneeNameRaw + "」未匹配，请重新搜索"; aHint.classList.add("is-warn"); }
    else { aHint.textContent = isAppend ? "追加模式必填" : "未指定 → 暂存草案"; }
    assigneeWrap.append(aLbl, aInput, aHidden, aUl, aHint);
    var combo = wbAttachContactCombo({ input: aInput, hiddenUserId: aHidden, optionsList: aUl,
      disablePortal: true,
      searchUrl: function (kw) { return "/api/workbench/manager/contacts?keyword=" + encodeURIComponent(kw); },
      onFeedback: function (msg) { aHint.textContent = msg; aHint.className = "ti-assignee-hint"; },
      onSelect: function (c) { aHidden.value = c.userId; aHint.textContent = c.name + " (" + c.userId + ")"; aHint.className = "ti-assignee-hint is-ok"; },
    });
    activeCombos.push(combo);
    topRow.appendChild(assigneeWrap);

    var dueWrap = document.createElement("div");
    dueWrap.className = "ti-ifield";
    var dueMode = (row.dueMode === "fixed" || row.dueMode === "self") ? row.dueMode : (row.dueAt ? "fixed" : "self");
    dueWrap.innerHTML =
      '<span class="ti-lbl ti-lbl-req">截止</span>'
      + '<div class="ti-due-mode-row">'
      +   '<label><input type="radio" name="due-mode-' + idx + '" class="row-due-mode" value="fixed" ' + (dueMode === "fixed" ? "checked" : "") + ' />指定日期</label>'
      +   '<label><input type="radio" name="due-mode-' + idx + '" class="row-due-mode" value="self" ' + (dueMode === "self" ? "checked" : "") + ' />负责人自报</label>'
      + '</div>'
      + '<input type="date" class="row-due" value="' + esc((row.dueAt || "").slice(0, 10)) + '" />'
      + '<input type="text" class="row-due-expectation" placeholder="期望时间（建议填写，如：三天左右）" value="' + esc(row.dueExpectation || "") + '" />';
    topRow.appendChild(dueWrap);
    var dueInput = dueWrap.querySelector(".row-due");
    var dueExpectationInput = dueWrap.querySelector(".row-due-expectation");
    function syncDueModeUi() {
      var checked = dueWrap.querySelector(".row-due-mode:checked");
      var mode = checked ? checked.value : "self";
      if (mode === "fixed") {
        dueInput.style.display = "";
        dueExpectationInput.style.display = "none";
      } else {
        dueInput.style.display = "none";
        dueExpectationInput.style.display = "";
      }
    }
    dueWrap.querySelectorAll(".row-due-mode").forEach(function (r) {
      r.addEventListener("change", syncDueModeUi);
    });
    syncDueModeUi();
    body.appendChild(topRow);

    var objWrap = document.createElement("div");
    objWrap.className = "ti-ifield";
    objWrap.innerHTML = '<span class="ti-lbl ti-lbl-req">目标 <span class="ti-lbl-hint">由模型提炼，可修改</span></span><input type="text" class="row-objective" value="' + esc(row.objective || "") + '" placeholder="由模型提炼，可修改" />';
    body.appendChild(objWrap);

    var g1 = document.createElement("div");
    g1.className = "ti-fields-grid";
    g1.innerHTML =
      '<div class="ti-ifield"><span class="ti-lbl ti-lbl-req">交付物 <span class="ti-lbl-hint">多项用；分隔</span></span><textarea class="row-deliverables" rows="2" placeholder="由模型提炼，可修改">' + esc(row.deliverables || "") + '</textarea></div>' +
      '<div class="ti-ifield"><span class="ti-lbl ti-lbl-req">完成标准 <span class="ti-lbl-hint">多项用；分隔</span></span><textarea class="row-completion" rows="2" placeholder="由模型提炼，可修改">' + esc(row.completionCriteria || "") + '</textarea></div>';
    body.appendChild(g1);

    var divider = document.createElement("div");
    divider.className = "ti-optional-divider"; divider.textContent = "选填";
    body.appendChild(divider);

    var g2 = document.createElement("div");
    g2.className = "ti-fields-grid";
    g2.innerHTML =
      '<div class="ti-ifield"><span class="ti-lbl">执行动作 <span class="ti-lbl-hint">多项用；分隔</span></span><textarea class="row-actions" rows="2" placeholder="可选">' + esc(row.actions || "") + '</textarea></div>' +
      '<div class="ti-ifield"><span class="ti-lbl">前置依赖 <span class="ti-lbl-hint">多项用；分隔</span></span><textarea class="row-depends" rows="2" placeholder="可选">' + esc(row.dependsOn || "") + '</textarea></div>';
    body.appendChild(g2);
    card.appendChild(body);

    var chk = head.querySelector(".row-selected");
    chk.addEventListener("change", function () {
      card.classList.toggle("is-unchecked", !chk.checked);
      state.rows[idx].selected = chk.checked;
      updateStats();
    });
    if (row.selected === false) card.classList.add("is-unchecked");
    return card;
  }

  function hideAllComboDropdowns() {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    document.querySelectorAll("ul.combo-options").forEach(function (ul) {
      ul.hidden = true;
      ul.innerHTML = "";
      ul.classList.remove("combo-options--fixed");
      ul.style.position = "";
      ul.style.left = "";
      ul.style.top = "";
      ul.style.width = "";
      ul.style.right = "";
      ul.style.maxHeight = "";
      ul.style.zIndex = "";
      ul.style.background = "";
      ul.style.border = "";
      ul.style.boxShadow = "";
    });
  }

  function destroyAllCombos() {
    activeCombos.forEach(function (c) { if (c && c.destroy) c.destroy(); });
    activeCombos = [];
    document.querySelectorAll("ul.combo-options").forEach(function (ul) {
      if (ul.parentNode === document.body) ul.remove();
    });
  }

  /* ── render all groups ── */
  function renderGroups() {
    destroyAllCombos();
    var container = document.getElementById("groupsContainer");
    container.innerHTML = "";
    var groups = deriveGroups();

    groups.forEach(function (grp) {
      var wrap = document.createElement("div");
      wrap.className = "ti-group";

      /* group head */
      var head = document.createElement("div");
      var headType = grp.type === "new" ? "gtype-new" : grp.type === "append" ? "gtype-append" : "gtype-unassigned";
      head.className = "ti-group-head " + headType;

      var icon = grp.type === "new" ? "＋" : grp.type === "append" ? "↪" : "⚠";
      var grpMeta = grp.type === "new" ? (state.newGroups[grp.groupId] || {}) : {};
      var titleText = grp.type === "new"
        ? (grpMeta.title ? esc(grpMeta.title) : '<span style="color:var(--ti-ink-3);font-weight:400;">新建父任务（标题待填）</span>')
        : grp.type === "append" ? esc(grp.taskTitle || grp.planId)
        : "未分配（需手动指定归属）";
      var noHtml = grp.type === "append" && grp.taskNo ? ' <span class="ti-group-badge">' + esc(grp.taskNo) + '</span>' : "";

      head.innerHTML =
        '<span class="ti-group-icon">' + icon + '</span>' +
        '<span class="ti-group-title">' + titleText + noHtml + '<span class="ti-group-subtitle">' + grp.idxs.length + ' 条</span></span>' +
        '<button type="button" class="ti-group-bulk-btn ti-move-trigger grp-bulk-btn">全部移到 ▾</button>';
      wrap.appendChild(head);

      /* bulk-move button */
      head.querySelector(".grp-bulk-btn").addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPopoverFor(grp.idxs.slice(), e.currentTarget);
      });

      /* new group: inline form */
      if (grp.type === "new") {
        var gid = grp.groupId;
        var meta = state.newGroups[gid] || { title: "", description: "", projectId: "", projectName: "" };
        var form = document.createElement("div");
        form.className = "ti-group-form";
        form.innerHTML =
          '<div class="ti-parent-form">' +
            '<div class="ti-field-wrap"><span class="ti-lbl ti-lbl-req">父任务标题</span>' +
            '<input type="text" class="ti-box-input new-parent-title" placeholder="必填" value="' + esc(meta.title) + '" /></div>' +
            '<div class="ti-field-wrap"><span class="ti-lbl ti-lbl-req">描述 / 背景 <span class="ti-lbl-hint">由模型提炼，可修改</span></span>' +
            '<textarea class="ti-box-textarea new-parent-desc" placeholder="任务整体目标、来由与验收口径">' + esc(meta.description) + '</textarea></div>' +
            (PORTFOLIO ? '<div class="ti-field-wrap ti-span2"><span class="ti-lbl">归属项目 <span class="ti-lbl-hint">可选</span></span><select class="ti-box-input ti-group-project-sel new-parent-project"><option value="">不归档</option></select></div>' : '') +
          '</div>';
        wrap.appendChild(form);
        /* closure over gid */
        (function (groupId) {
          form.querySelector(".new-parent-title").addEventListener("input", function () {
            if (!state.newGroups[groupId]) state.newGroups[groupId] = { title: "", description: "", projectId: "", projectName: "" };
            state.newGroups[groupId].title = this.value;
          });
          form.querySelector(".new-parent-desc").addEventListener("input", function () {
            if (!state.newGroups[groupId]) state.newGroups[groupId] = { title: "", description: "", projectId: "", projectName: "" };
            state.newGroups[groupId].description = this.value;
          });
          if (PORTFOLIO) {
            var psel = form.querySelector(".new-parent-project");
            if (psel) {
              psel.addEventListener("change", function () {
                if (!state.newGroups[groupId]) state.newGroups[groupId] = { title: "", description: "", projectId: "", projectName: "" };
                state.newGroups[groupId].projectId = this.value;
                state.newGroups[groupId].projectName = this.value ? (this.options[this.selectedIndex] || {}).text || "" : "";
              });
            }
            loadProjects();
          }
        }(gid));
      }

      /* unassigned group: warning note */
      if (grp.type === "unassigned") {
        var note = document.createElement("div");
        note.style.cssText = "padding:10px 16px;font-size:12px;color:#b45309;background:#fffbeb;border-bottom:1px solid #fde68a;";
        note.textContent = "AI 对以上子任务的归属不确定，请点击「移组 ▾」手动分配到「新建父任务」或某个已有任务，否则无法提交。";
        wrap.appendChild(note);
      }

      /* cards */
      var cardsWrap = document.createElement("div");
      cardsWrap.className = "ti-group-cards-wrap";
      grp.idxs.forEach(function (idx) {
        cardsWrap.appendChild(buildCard(state.rows[idx], idx));
      });
      if (!grp.idxs.length) {
        var empty = document.createElement("div");
        empty.className = "ti-group-empty";
        empty.textContent = "（空）";
        cardsWrap.appendChild(empty);
      }
      wrap.appendChild(cardsWrap);
      container.appendChild(wrap);
    });

    /* "＋ 新建父任务组" button */
    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ti-group-bulk-btn";
    addBtn.style.cssText = "display:block;margin:8px 0 4px;width:100%;text-align:left;padding:10px 16px;border-radius:8px;font-size:13px;";
    addBtn.textContent = "＋ 新建一个父任务组（手动添加）";
    addBtn.addEventListener("click", function () {
      var gid = nextGroupId();
      ensureGroup(gid, "");
      // Move unassigned rows to this new group (if any), otherwise just create empty group
      var unassignedIdxs = state.rows.map(function (r, i) { return r.needsAssignment ? i : -1; }).filter(function (i) { return i >= 0; });
      // Don't auto-assign — just create an empty group and let user move cards in
      renderGroups();
      // Scroll to the new group
      setTimeout(function () {
        var all = container.querySelectorAll(".ti-group");
        if (all.length) all[all.length - 2] && all[all.length - 2].scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });
    container.appendChild(addBtn);

    updateStats();
  }

  function updateStats() {
    var sel = state.rows.filter(function (r) { return r.selected !== false; });
    var newCount = sel.filter(function (r) { return !r.targetPlanId && !r.needsAssignment; }).length;
    var appendCount = sel.filter(function (r) { return Boolean(r.targetPlanId); }).length;
    var unCount = sel.filter(function (r) { return r.needsAssignment; }).length;
    var newGroupCount = Object.keys(state.newGroups).length || (newCount > 0 ? 1 : 0);
    var parts = [sel.length + " 条已勾选"];
    if (newCount) parts.push(newCount + " 条→新建（" + newGroupCount + " 个父任务）");
    if (appendCount) parts.push(appendCount + " 条→已有任务");
    if (unCount) parts.push(unCount + " 条待分配");
    document.getElementById("previewStats").textContent = parts.join(" · ");
  }

  /* ── target picker popover ── */
  var popover = document.getElementById("targetPopover");
  var tpSearch = document.getElementById("tpSearch");
  var tpList = document.getElementById("tpList");
  var tpSearchTimer = null;

  function closePopover() { popover.hidden = true; state.pickerForIdxs = null; tpSearch.value = ""; }

  function renderTpList(tasks, kw) {
    tpList.innerHTML = "";

    /* ── 新建父任务组 section ── */
    var secHdr1 = document.createElement("li");
    secHdr1.style.cssText = "padding:4px 14px 2px;font-size:10px;font-weight:700;color:var(--ti-ink-3);text-transform:uppercase;cursor:default;letter-spacing:.04em;";
    secHdr1.textContent = "新建父任务组";
    tpList.appendChild(secHdr1);

    Object.keys(state.newGroups).sort().forEach(function (gid) {
      var meta = state.newGroups[gid];
      var li = document.createElement("li");
      var label = meta.title ? esc(meta.title.length > 18 ? meta.title.slice(0, 18) + "…" : meta.title) : '<em style="color:var(--ti-ink-3);">（未命名组）</em>';
      li.innerHTML = '<span style="margin-right:6px;color:#16a34a;">＋</span>' + label;
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        applyTargetToIdxs(state.pickerForIdxs, { newGroupId: gid });
        closePopover();
      });
      tpList.appendChild(li);
    });

    var newGroupLi = document.createElement("li");
    newGroupLi.className = "is-new";
    newGroupLi.innerHTML = '<span style="margin-right:4px;">＋</span>新建一组（空组）';
    newGroupLi.addEventListener("mousedown", function (e) {
      e.preventDefault();
      var gid = nextGroupId();
      ensureGroup(gid, "");
      applyTargetToIdxs(state.pickerForIdxs, { newGroupId: gid });
      closePopover();
    });
    tpList.appendChild(newGroupLi);

    /* ── 追加到已有任务 section ── */
    if (tasks.length) {
      var secHdr2 = document.createElement("li");
      secHdr2.style.cssText = "padding:6px 14px 2px;font-size:10px;font-weight:700;color:var(--ti-ink-3);text-transform:uppercase;cursor:default;letter-spacing:.04em;border-top:1px solid var(--ti-border);margin-top:4px;";
      secHdr2.textContent = "追加到已有任务";
      tpList.appendChild(secHdr2);

      var filtered = kw ? tasks.filter(function (t) { return (t.title || "").includes(kw); }) : tasks;
      filtered.slice(0, 8).forEach(function (t) {
        var li = document.createElement("li");
        li.innerHTML = '<span class="ti-tp-no">' + esc(t.taskNo || "") + '</span>' + esc(t.title || "");
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          applyTargetToIdxs(state.pickerForIdxs, { planId: t.planId, title: t.title, taskNo: t.taskNo });
          closePopover();
        });
        tpList.appendChild(li);
      });
      if (!filtered.length && kw) {
        var empty = document.createElement("li");
        empty.style.cssText = "color:var(--ti-ink-3);cursor:default;padding:6px 14px;";
        empty.textContent = "无匹配任务";
        tpList.appendChild(empty);
      }
    }
  }

  async function openPopoverFor(idxs, anchorEl) {
    hideAllComboDropdowns();
    state.pickerForIdxs = idxs;
    tpSearch.value = "";
    var tasks = await loadAllTasks();
    renderTpList(tasks, "");
    var rect = anchorEl.getBoundingClientRect();
    var popoverH = 280;
    var gap = 4;
    var left = rect.left;
    var top = rect.bottom + gap;
    if (left + 300 > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 308);
    if (top + popoverH > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popoverH - gap);
    }
    popover.style.top = top + "px";
    popover.style.left = left + "px";
    popover.hidden = false;
    tpSearch.focus();
  }

  tpSearch.addEventListener("input", async function () {
    var kw = this.value.trim();
    clearTimeout(tpSearchTimer);
    tpSearchTimer = setTimeout(async function () {
      var tasks = await loadAllTasks();
      renderTpList(tasks, kw);
    }, 150);
  });

  document.addEventListener("mousedown", function (e) {
    if (popover.hidden) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".ti-move-trigger")) return;
    closePopover();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePopover(); });

  /*
   * target shapes:
   *   { planId, title, taskNo }  → append to existing task
   *   { newGroupId }             → move to this new-parent group
   *   null / undefined           → (unused, kept for safety; treat as DEFAULT_GROUP)
   */
  function applyTargetToIdxs(idxs, target) {
    if (!idxs || !idxs.length) return;
    idxs.forEach(function (idx) {
      if (idx < 0 || idx >= state.rows.length) return;
      var row = state.rows[idx];
      if (target && target.planId) {
        row.targetPlanId = target.planId;
        row.targetTitle = target.title;
        row.targetNo = target.taskNo;
        row.newGroupId = undefined;
      } else if (target && target.newGroupId) {
        row.targetPlanId = undefined;
        row.targetTitle = undefined;
        row.targetNo = undefined;
        row.newGroupId = target.newGroupId;
      } else {
        row.targetPlanId = undefined;
        row.newGroupId = DEFAULT_GROUP;
      }
      row.needsAssignment = false;
    });
    renderGroups();
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
        dueMode: ((card.querySelector(".row-due-mode:checked") || {}).value || "self"),
        dueAt: card.querySelector(".row-due").value || undefined,
        dueExpectation: (card.querySelector(".row-due-expectation").value || "").trim(),
        assigneeUserId: card.querySelector(".row-assignee-id").value.trim(),
        targetPlanId: base.targetPlanId || undefined,
        targetTitle: base.targetTitle || undefined,
        newGroupId: base.newGroupId || undefined,
      });
    });
    return out;
  }

  /* ── step 1: parse ── */
  document.getElementById("parseBtn").addEventListener("click", async function () {
    setFb("parseFeedback", "解析中（含 AI 归属建议，约 5-10 秒）…", false);
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
      var rows = data.rows || [];
      if (!rows.length) { setFb("parseFeedback", "未识别到任务，请检查粘贴内容", true); return; }

      // Determine if AI made any grouping suggestions
      var hasSuggestions = rows.some(function (r) {
        var conf = r.suggestedConfidence || 0;
        return conf >= 0.6 && (r.suggestedTargetPlanId || r.suggestedNewGroupId);
      });

      // Reset group state
      state.newGroups = {};
      state.newGroupCounter = 0;

      if (hasSuggestions) {
        // Build state.newGroups from AI suggestions (title + description per group)
        rows.forEach(function (r) {
          var conf = r.suggestedConfidence || 0;
          if (conf >= 0.6 && r.suggestedNewGroupId && !state.newGroups[r.suggestedNewGroupId]) {
            state.newGroups[r.suggestedNewGroupId] = {
              title: r.suggestedNewGroupTitle || "",
              description: r.suggestedNewGroupDescription || "",
              projectId: "",
              projectName: "",
            };
          }
        });
        // Keep newGroupCounter above AI-generated IDs
        Object.keys(state.newGroups).forEach(function (gid) {
          var n = parseInt(gid.replace("ng_", ""), 10);
          if (!isNaN(n) && n >= state.newGroupCounter) state.newGroupCounter = n;
        });
        // Fallback: single new group without per-group description → use structure parentDescription
        var sugGroupIds = Object.keys(state.newGroups);
        if (sugGroupIds.length === 1) {
          var onlyGid = sugGroupIds[0];
          if (!String(state.newGroups[onlyGid].description || "").trim()) {
            state.newGroups[onlyGid].description = data.parentDescription || "";
          }
          if (!String(state.newGroups[onlyGid].title || "").trim()) {
            state.newGroups[onlyGid].title = data.parentTitle || "";
          }
        }
      } else {
        // No AI suggestions — put everything in one default new group
        state.newGroups[DEFAULT_GROUP] = {
          title: data.parentTitle || "",
          description: data.parentDescription || "",
          projectId: "",
          projectName: "",
        };
      }

      state.rows = rows.map(function (r) {
        var conf = r.suggestedConfidence || 0;
        var hasSugExisting = Boolean(r.suggestedTargetPlanId) && conf >= 0.6;
        var hasSugNew = Boolean(r.suggestedNewGroupId) && conf >= 0.6;
        var dueMode = (r.dueMode === 'fixed' || r.dueMode === 'self') ? r.dueMode : (r.dueAt ? 'fixed' : 'self');
        return Object.assign({}, r, {
          targetPlanId: hasSugExisting ? r.suggestedTargetPlanId : undefined,
          targetTitle: hasSugExisting ? r.suggestedTargetTitle : undefined,
          targetNo: hasSugExisting ? r.suggestedTargetNo : undefined,
          newGroupId: hasSugNew ? r.suggestedNewGroupId : (hasSuggestions ? undefined : DEFAULT_GROUP),
          dueMode: dueMode,
          dueExpectation: r.dueExpectation || "",
          needsAssignment: hasSuggestions && !hasSugExisting && !hasSugNew,
        });
      });

      var warnMsg = (data.warnings && data.warnings.length) ? "提示：" + data.warnings.join("；") : "";
      if (hasSuggestions) {
        var ngCount = Object.keys(state.newGroups).length;
        warnMsg = (warnMsg ? warnMsg + "；" : "") + "AI 已完成归属建议（" + ngCount + " 个新建组），请核对后录入";
      }
      setFb("parseFeedback", warnMsg, false);
      renderGroups();
      setStep(2);
    } catch (err) {
      setFb("parseFeedback", err.message || String(err), true);
    }
  });

  /* ── step 2: commit ── */
  document.getElementById("commitBtn").addEventListener("click", async function () {
    setFb("commitFeedback", "", false);
    var rows = collectRows();
    var selected = rows.filter(function (r) { return r.selected; });

    var problems = [];
    var softHints = [];
    if (!selected.length) problems.push("请至少勾选 1 条子任务");

    // Build a map for quick lookup
    var stateByItemId = {};
    state.rows.forEach(function (r) { stateByItemId[r.itemId] = r; });

    // Unassigned check
    var unassignedSel = selected.filter(function (r) {
      var base = stateByItemId[r.itemId];
      return base && base.needsAssignment;
    });
    if (unassignedSel.length) problems.push(unassignedSel.length + " 条子任务尚未分配归属（请点「移组 ▾」）");

    var noTitle = selected.filter(function (r) { return !r.title; });
    if (noTitle.length) problems.push(noTitle.length + " 条子任务标题为空");
    var noObj = selected.filter(function (r) { return !String(r.objective || "").trim(); });
    if (noObj.length) problems.push(noObj.length + " 条子任务目标为空（必填）");
    var noDel = selected.filter(function (r) { return !String(r.deliverables || "").trim(); });
    if (noDel.length) problems.push(noDel.length + " 条子任务交付物为空（必填）");
    var noCrit = selected.filter(function (r) { return !String(r.completionCriteria || "").trim(); });
    if (noCrit.length) problems.push(noCrit.length + " 条子任务完成标准为空（必填）");
    var noDue = selected.filter(function (r) { return (r.dueMode || "self") === "fixed" && !r.dueAt; });
    if (noDue.length) problems.push(noDue.length + " 条子任务截止日期为空（必填）");
    var noDueExpectation = selected.filter(function (r) {
      return (r.dueMode || "self") === "self" && !String(r.dueExpectation || "").trim();
    });
    if (noDueExpectation.length) softHints.push(noDueExpectation.length + " 条负责人自报任务缺少期望时间提示（建议填写）");

    var appendRows = selected.filter(function (r) { return r.targetPlanId; });
    var noAssigneeAppend = appendRows.filter(function (r) { return !r.assigneeUserId; });
    if (noAssigneeAppend.length) problems.push(noAssigneeAppend.length + " 条追加到已有任务的子任务负责人为空（必填）");

    // Validate each new group's title/description
    var newGroupIds = [];
    selected.filter(function (r) { return !r.targetPlanId && !r.needsAssignment; }).forEach(function (r) {
      var gid = r.newGroupId || DEFAULT_GROUP;
      if (newGroupIds.indexOf(gid) < 0) newGroupIds.push(gid);
    });
    newGroupIds.forEach(function (gid) {
      var meta = state.newGroups[gid] || {};
      var label = meta.title ? "「" + meta.title.slice(0, 10) + "」" : "（未命名组）";
      if (!String(meta.title || "").trim()) problems.push("新建组 " + label + " 父任务标题必填");
      if (!String(meta.description || "").trim()) problems.push("新建组 " + label + " 描述/背景必填");
    });

    if (problems.length) {
      setFb("commitFeedback", "请先补齐：" + problems.join("；"), true);
      return;
    }

    if (softHints.length) {
      setFb("commitFeedback", "提示：" + softHints.join("；") + "。仍可提交，正在录入…", false);
    } else {
      setFb("commitFeedback", "提交中…", false);
    }
    try {
      var htmlParts = [];
      var firstTaskLink = "/workbench/manager/tasks";
      var firstLinkText = "查看任务";

      // Commit each new group separately
      for (var gi = 0; gi < newGroupIds.length; gi++) {
        var gid = newGroupIds[gi];
        var meta = state.newGroups[gid] || {};
        var grpRows = rows.filter(function (r) { return r.selected && !r.targetPlanId && ((r.newGroupId || DEFAULT_GROUP) === gid); });
        if (!grpRows.length) continue;
        var commitRes = await fetch("/api/workbench/manager/task-intake/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentTitle: String(meta.title || "").trim(),
            parentDescription: String(meta.description || "").trim(),
            projectId: meta.projectId || "",
            projectName: meta.projectName || "",
            rows: rows.map(function (r) {
              return Object.assign({}, r, { selected: r.selected && !r.targetPlanId && ((r.newGroupId || DEFAULT_GROUP) === gid) });
            }),
          }),
        });
        var cd = await commitRes.json();
        if (!cd.ok) throw new Error(cd.error || "新建父任务录入失败");
        var cr = cd.result || {};
        if (cr.mode === "invalid") {
          setFb("commitFeedback", "「" + esc(meta.title || "未命名组") + "」必填项未通过：" + (cr.errors || []).map(function (e) { return e.message; }).join("；"), true);
          return;
        }
        if (cr.mode === "published") {
          htmlParts.push('<p>✅ 已入库正式任务 <strong>' + esc(cr.task ? cr.task.title : "") + '</strong>（' + esc(cr.task ? cr.task.taskNo : "") + '），含 <strong>' + cr.subtaskCount + '</strong> 条子任务。</p>');
          if (cr.errors && cr.errors.length) {
            htmlParts.push('<p style="color:var(--ti-ink-3);font-size:12px;">' + cr.errors.map(function (e) { return esc(e.message); }).join("；") + '</p>');
          }
        } else if (cr.mode === "staged") {
          htmlParts.push('<p>📋 「' + esc(meta.title || "未命名") + '」' + grpRows.length + ' 条子任务有负责人缺项，已暂存草案。</p>');
          if (cr.errors && cr.errors.length) {
            htmlParts.push('<p style="color:var(--ti-ink-3);font-size:12px;">' + cr.errors.map(function (e) { return esc(e.message); }).join("；") + '</p>');
          }
          firstTaskLink = cr.stagedDeepLink || "/workbench/manager/chat?thread=main&openDraftEditor=1";
          firstLinkText = "去点将发布 →";
        }
      }

      var appendGroups = {};
      appendRows.forEach(function (r) {
        if (!appendGroups[r.targetPlanId]) appendGroups[r.targetPlanId] = [];
        appendGroups[r.targetPlanId].push(r);
      });
      for (var planId in appendGroups) {
        var grpRows = appendGroups[planId];
        var appendPayloadRows = rows.map(function (r) { return Object.assign({}, r, { selected: r.selected && r.targetPlanId === planId }); });
        var appendRes = await fetch("/api/workbench/manager/task-intake/append", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPlanId: planId, rows: appendPayloadRows }),
        });
        var ad = await appendRes.json();
        if (!ad.ok) { htmlParts.push('<p style="color:var(--ti-req-color);">追加失败：' + esc(ad.error || "未知错误") + '</p>'); continue; }
        var ar = ad.result || {};
        if (ar.mode === "invalid") { setFb("commitFeedback", "追加必填项未通过：" + (ar.errors || []).map(function (e) { return e.message; }).join("；"), true); return; }
        var tTitle = ar.targetTask ? ar.targetTask.title : (grpRows[0] && grpRows[0].targetTitle) || "";
        var tNo = ar.targetTask ? ar.targetTask.taskNo : "";
        var tPlanId = ar.targetTask ? ar.targetTask.planId : planId;
        htmlParts.push('<p>✅ 已追加 <strong>' + ar.appendedCount + '</strong> 条子任务到「<strong>' + esc(tTitle) + '</strong>」' + (tNo ? '（' + esc(tNo) + '）' : '') + '。</p>');
        if (firstTaskLink === "/workbench/manager/tasks") { firstTaskLink = "/workbench/manager/tasks?planId=" + encodeURIComponent(tPlanId); firstLinkText = "查看任务详情"; }
        if (ar.errors && ar.errors.length) { htmlParts.push('<p style="color:var(--ti-ink-3);font-size:12px;">' + ar.errors.map(function (e) { return esc(e.message); }).join("；") + '</p>'); }
      }

      document.getElementById("resultBody").innerHTML = htmlParts.length
        ? '<div class="ti-result-icon">✅</div>' + htmlParts.join("")
        : "<p>没有选中任何子任务。</p>";
      document.getElementById("tasksLink").href = firstTaskLink;
      document.getElementById("tasksLink").textContent = firstLinkText;
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
