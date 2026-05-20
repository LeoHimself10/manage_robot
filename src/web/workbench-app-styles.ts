/** Shared CSS for manager / employee standalone workbench apps (SSR HTML). */
export const WORKBENCH_APP_BASE_CSS = `
:root {
  --bg: #f1f5f9;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --danger: #dc2626;
  --success: #059669;
  --warn: #d97706;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  min-height: 100vh;
}
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.app-shell { max-width: 1200px; margin: 0 auto; padding: 20px 18px 48px; }
.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.topbar.topbar--compact { margin-bottom: 14px; }
.brand { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); text-transform: uppercase; }
.page-title { margin: 4px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.page-desc { margin: 6px 0 0; font-size: 14px; color: var(--muted); max-width: 560px; }
.topbar.topbar--compact .page-title { font-size: 22px; }
.topbar.topbar--compact .page-desc { max-width: 480px; }
.top-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.nav-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.nav-pills a {
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
}
.nav-pills a:hover { border-color: #cbd5e1; text-decoration: none; }
.nav-pills a.active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--primary-hover);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  gap: 4px;
}
.btn-primary { background: var(--primary); color: #fff; border-color: var(--primary-hover); }
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
.btn-secondary { background: var(--surface); color: var(--text); border-color: var(--border); }
.btn-secondary:hover:not(:disabled) { background: #f8fafc; }
.btn-ghost { background: transparent; color: var(--muted); border-color: transparent; }
.btn-danger { background: #fef2f2; color: var(--danger); border-color: #fecaca; }
.btn-danger:hover:not(:disabled) { background: #fee2e2; }
.feedback {
  min-height: 22px;
  font-size: 13px;
  margin-top: 10px;
}
.feedback.ok { color: var(--success); }
.feedback.err { color: var(--danger); }
.feedback.muted { color: var(--muted); }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px;
  margin-bottom: 16px;
}
.card h2 { margin: 0 0 12px; font-size: 17px; font-weight: 650; }
.card h3 { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: var(--text); }
.form-stack { display: grid; gap: 12px; }
.form-stack label { display: grid; gap: 6px; font-size: 13px; font-weight: 500; color: #334155; }
.form-stack input, .form-stack select, .form-stack textarea {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  width: 100%;
}
.form-stack textarea { min-height: 88px; resize: vertical; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.kpis.kpis--5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.kpis.kpis--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 480px; }
@media (max-width: 1020px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1020px) { .kpis.kpis--5 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mgr-list-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.info-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--muted);
}
.task-card-field { margin: 4px 0 0; line-height: 1.45; }
.task-card-lbl { font-weight: 600; color: #475569; margin-right: 4px; }
.subtask-more-details { margin-top: 10px; }
.subtask-more-details summary { cursor: pointer; font-size: 13px; font-weight: 600; color: #475569; }
.mgr-employee-dynamic {
  border-left: 4px solid #2563eb;
  background: #f8fafc;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.mgr-feedback-tag {
  font-size: 11px;
  font-weight: 600;
  color: #c2410c;
  background: #ffedd5;
  padding: 2px 8px;
  border-radius: 999px;
  margin-left: 6px;
}
.emp-detail-action-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 -4px 12px rgba(15, 23, 42, 0.06);
  margin-top: 16px;
  z-index: 5;
}
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
@media (max-width: 720px) { .kpis { grid-template-columns: 1fr; } }
.kpi {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
.kpi .lbl { font-size: 12px; color: var(--muted); font-weight: 500; }
.kpi .val { font-size: 28px; font-weight: 700; margin-top: 4px; letter-spacing: -0.02em; }
.table-wrap { overflow-x: auto; border-radius: var(--radius-sm); border: 1px solid var(--border); }
table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
table.data th, table.data td { padding: 11px 12px; text-align: left; border-bottom: 1px solid #f1f5f9; }
table.data th { background: #f8fafc; color: #475569; font-weight: 600; white-space: nowrap; }
table.data td { vertical-align: top; }
table.data tr:last-child td { border-bottom: none; }
table.data code { font-size: 12px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
.badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.badge.blocked { color:#b91c1c; background:#fee2e2; border:1px solid #fca5a5; }
.badge.assigned { color:#7c3aed; background:#ede9fe; border:1px solid #c4b5fd; }
.badge.pending { color:#c2410c; background:#ffedd5; border:1px solid #fdba74; }
.badge.progress { color:#1d4ed8; background:#dbeafe; border:1px solid #93c5fd; }
.badge.done { color:#15803d; background:#dcfce7; border:1px solid #86efac; }
.badge.rejected { color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; }
.combo-options {
  position:absolute;
  top:calc(100% + 4px);
  left:0;
  right:0;
  max-height:240px;
  overflow:auto;
  background:#fff;
  border:1px solid #cbd5e1;
  border-radius:8px;
  z-index:20;
  padding:4px 0;
  margin:0;
  list-style:none;
  box-shadow:0 6px 16px rgba(15,23,42,.08);
}
.combo-options li {
  padding:8px 12px;
  font-size:14px;
  cursor:pointer;
  display:flex;
  gap:8px;
  align-items:center;
  justify-content:space-between;
}
.combo-options li:hover, .combo-options li[aria-selected="true"] { background:#eff6ff; }
.combo-tag { font-size:12px; color:#475569; background:#e2e8f0; border-radius:999px; padding:1px 8px; white-space:nowrap; }
.due-bar { height:6px; background:#e2e8f0; border-radius:999px; overflow:hidden; margin-top:8px; }
.due-bar-fill { height:100%; background:#2563eb; transition:width .2s ease; }
.due-bar[data-state="urgent"] .due-bar-fill { background:#f59e0b; }
.due-bar[data-state="overdue"] .due-bar-fill { background:#dc2626; }
.due-bar[data-state="done"] .due-bar-fill { background:#15803d; }
.due-meta { font-size:12px; margin:4px 0 0; }
.event-list { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
.event-list .event {
  border:1px solid var(--border);
  border-radius:var(--radius-sm);
  padding:10px 12px;
  background:#fafbfc;
  border-left:4px solid #cbd5e1;
}
.event-list .event.info { border-left-color:#94a3b8; }
.event-list .event.warn { border-left-color:#f59e0b; background:#fffbeb; }
.event-list .event.error { border-left-color:#dc2626; background:#fef2f2; }
.event-row { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; font-size:13px; }
.event-time { color:var(--muted); font-size:12px; }
.event-title { font-weight:650; }
.event-summary { color:#334155; flex:1 1 200px; }
.event-list details { margin-top:6px; font-size:12px; }
.event-list pre {
  white-space:pre-wrap;
  word-break:break-word;
  max-width:100%;
  font-size:11px;
  background:#0f172a;
  color:#e2e8f0;
  padding:8px;
  border-radius:6px;
  overflow:auto;
}
.progress-cell {
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
  max-width:100%;
}
.empty-state {
  padding: 36px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: #fafbfc;
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.tabs[role="tablist"] { border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.tabs-btn {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tabs-btn[aria-selected="true"] {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--primary-hover);
}
.tab-panel[hidden] { display: none; }
.panel-stack { display: grid; gap: 16px; }
.inline-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.page-shell--chat {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
.page-shell--chat .app-shell {
  height: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 18px 24px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.page-shell--chat .topbar {
  flex-shrink: 0;
}
.chat-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.chat-message-pane {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}
.chat-message-pane > *:not(.chat-stream) {
  flex-shrink: 0;
}
.chat-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid #f1f5f9;
  border-bottom: 1px solid #f1f5f9;
  padding: 12px;
}
.msg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg-list li.msg-row {
  border: none;
  background: transparent;
  padding: 0;
}
.msg-list li:not(.msg-row) {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 13px;
  background: #fff;
}
.msg-row--user {
  display: flex;
  justify-content: flex-end;
}
.msg-row--assistant {
  display: flex;
  justify-content: flex-start;
}
.msg-bubble {
  padding: 10px 12px;
  word-break: break-word;
  max-width: min(640px, 92%);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.msg-meta {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
  font-weight: 600;
}
.msg-body {
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.msg-body--assistant {
  white-space: normal;
}
.msg-body--assistant .msg-md-p {
  margin: 0 0 8px;
}
.msg-body--assistant .msg-md-p:last-child {
  margin-bottom: 0;
}
.msg-body--assistant .msg-md-h {
  margin: 10px 0 6px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--text);
}
.msg-body--assistant .msg-md-h1 { font-size: 1.25rem; }
.msg-body--assistant .msg-md-h2 { font-size: 1.12rem; }
.msg-body--assistant .msg-md-h3 { font-size: 1.05rem; }
.msg-body--assistant .msg-md-ul,
.msg-body--assistant .msg-md-ol {
  margin: 6px 0 10px;
  padding-left: 1.35rem;
}
.msg-body--assistant .msg-md-li {
  margin: 3px 0;
}
.msg-body--assistant .msg-md-ul {
  list-style: disc;
}
.msg-body--assistant .msg-md-ol {
  list-style: decimal;
}
.msg-body--assistant .msg-md-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.86em;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.msg-body--assistant .msg-md-pre {
  margin: 8px 0;
  padding: 10px 12px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.45;
}
.msg-body--assistant .msg-md-pre code {
  font-family: inherit;
  font-size: inherit;
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
}
.msg-body--assistant .msg-md-bq {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 4px solid #cbd5e1;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.msg-body--assistant .msg-md-table-wrap {
  margin: 8px 0;
  overflow-x: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.msg-body--assistant .msg-md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: #fff;
}
.msg-body--assistant .msg-md-table th,
.msg-body--assistant .msg-md-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}
.msg-body--assistant .msg-md-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
}
.msg-body--assistant .msg-md-table tr:last-child td {
  border-bottom: none;
}
.msg-body--assistant .msg-md-hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.msg-body--assistant .msg-md-a {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.msg-body--assistant .msg-md-strong { font-weight: 650; }
.msg-body--assistant .msg-md-em { font-style: italic; }
.msg-bubble--user { background: #eff6ff; }
.msg-bubble--assistant { background: #fff; }
.msg-bubble--system { background: #f8fafc; }
.chat-composer {
  padding: 8px 12px;
  background: #fcfdff;
  flex-shrink: 0;
}
.chat-composer .form-stack { gap: 6px; }
.chat-composer textarea { min-height: 56px; }
.chat-composer .feedback { min-height: 0; }
.chat-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
@media (max-width: 860px) {
  .topbar.topbar--compact .page-title { font-size: 20px; }
}
.task-cards { display: grid; gap: 12px; }
.task-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  background: #fafbfc;
}
.task-card .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
.task-card .title { font-weight: 650; font-size: 15px; margin: 0 0 6px; word-break: break-word; }
.task-card .meta { font-size: 12px; color: var(--muted); }
.task-card .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.task-card-clickable { cursor: pointer; }
.task-card-clickable:hover { border-color: #bfdbfe; background: #f8fbff; }
.task-desc {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}
.task-desc.muted { background: var(--surface); color: var(--muted); }
.task-desc-body { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.subs-section-h { margin: 0 0 10px; font-size: 15px; font-weight: 650; color: var(--text); }
.subtask-detail-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--surface);
}
.subtask-detail-dl { margin: 0; display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; font-size: 13px; }
.subtask-detail-dl dt { color: var(--muted); font-weight: 600; }
.subtask-detail-dl dd { margin: 0; word-break: break-word; }
.task-card-desc { margin-top: 8px; line-height: 1.45; }
.task-card .task-detail-readonly-link {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.task-card .task-detail-readonly-link:hover {
  color: var(--text);
}
.task-card.is-rejected {
  opacity: 0.92;
  border-color: #e2e8f0;
  background: #f8fafc;
}
.task-card.is-rejected .title { text-decoration: line-through; color: var(--muted); }
.subtask-detail-card.is-rejected-sub {
  border-color: #fecaca;
  background: #fef2f2;
}
.subtask-rejected-hint { color: #991b1b; }
.emp-rejected-wait { color: #64748b; }
.banner-plan {
  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
}
.banner-plan code { font-size: 13px; }
.reassign-subtask-pick {
  font-size: 13px;
  line-height: 1.45;
}
.reassign-subtask-pick option {
  white-space: normal;
  padding: 6px 0;
}

/* 任务详情 · 主管处理卡片（驳回 / 已知悉） */
.mgr-signal-card .mgr-signal-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.mgr-signal-card .mgr-signal-sub {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.45;
  max-width: 720px;
}
.mgr-callout {
  font-size: 13px;
  color: #334155;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin: 0 0 14px;
  line-height: 1.5;
}
.mgr-section-h {
  font-size: 12px;
  font-weight: 650;
  color: #64748b;
  margin: 0 0 6px;
  letter-spacing: 0.01em;
}
.mgr-pending-readonly {
  font-size: 14px;
  color: var(--text);
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin: 0 0 12px;
  min-height: 48px;
}
.mgr-pending-readonly .mgr-p-meta {
  margin: 0;
  font-size: 13px;
  color: #92400e;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.mgr-pending-readonly .mgr-p-note {
  margin: 10px 0 0;
  font-size: 13px;
  color: #78350f;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.mgr-pending-readonly .mgr-p-note.muted {
  color: #a16207;
}
.mgr-req {
  color: #b45309;
  font-weight: 600;
}
.mgr-decline-stack select#mgrDeclineSubtask {
  font-size: 14px;
}
.mgr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 4px;
}
.mgr-actions #mgrDeclineConfirmWrap {
  display: none;
  align-items: center;
  gap: 8px;
  margin: 0;
  flex: 1 1 220px;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}
.mgr-signal-card .mgr-decline-stack textarea#mgrDeclineNote,
.mgr-signal-card .form-stack textarea#mgrAckNote {
  min-height: 64px;
  max-height: 200px;
}
.mgr-ack-h {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  font-weight: 650;
  color: var(--text);
}

/* 任务详情 · 主管布局 C：筛选条 + 可展开子任务行 + 行内驳回/已知悉 */
.mgr-sub-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.mgr-sub-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #f8fafc;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
}
.mgr-sub-filter-chip:hover {
  border-color: #94a3b8;
  background: #fff;
}
.mgr-sub-filter-chip[aria-pressed="true"] {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--primary-hover);
  font-weight: 650;
}
.mgr-sub-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #1e293b;
  font-size: 11px;
  font-weight: 700;
}
.mgr-sub-filter-chip[aria-pressed="true"] .mgr-sub-filter-count {
  background: var(--primary-hover);
  color: #fff;
}
.mgr-sub-filter-chip--alert .mgr-sub-filter-count {
  background: #fde68a;
  color: #92400e;
}
.mgr-sub-filter-chip--alert[aria-pressed="true"] .mgr-sub-filter-count {
  background: var(--warn);
  color: #fff;
}
details.sub-row-mgr {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  overflow: hidden;
}
details.sub-row-mgr[open] {
  border-color: #94a3b8;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}
details.sub-row-mgr.mgr-sub-row--hidden {
  display: none !important;
}
.mgr-sub-summary {
  list-style: none;
  cursor: pointer;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}
.mgr-sub-summary-row1 {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 10px 12px;
  align-items: center;
  min-width: 0;
}
.mgr-sub-summary-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 46px;
}
.mgr-sub-summary::-webkit-details-marker {
  display: none;
}
.mgr-sub-summary:hover {
  background: #f8fafc;
}
.mgr-sub-idx {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.mgr-sub-main {
  min-width: 0;
}
.mgr-sub-title {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mgr-sub-meta {
  font-size: 12px;
  margin-top: 2px;
  line-height: 1.4;
  white-space: normal;
}
.mgr-sub-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}
.mgr-sub-rows {
  display: grid;
  gap: 10px;
  margin-top: 4px;
}
.mgr-sub-body {
  padding: 0 14px 14px;
  border-top: 1px dashed #e2e8f0;
}
.mgr-employee-info {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  border-radius: var(--radius-sm);
}
.mgr-employee-info-h {
  font-size: 12px;
  font-weight: 700;
  color: #1e3a8a;
  margin-bottom: 6px;
  letter-spacing: 0.01em;
}
.mgr-employee-signal {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 600;
  color: #92400e;
  background: #ffedd5;
  border: 1px solid #fdba74;
  margin-bottom: 6px;
}
.mgr-employee-signal--quiet {
  color: #64748b;
  background: #f1f5f9;
  border-color: #e2e8f0;
  font-weight: 500;
}
.mgr-rejected-pool-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: #9a3412;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.mgr-sub-summary--rejected-pool {
  border-left: 3px solid #f97316;
  padding-left: 8px;
  margin-left: -2px;
}
.mgr-sub-body-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  padding-top: 12px;
}
@media (max-width: 760px) {
  .mgr-sub-body-grid {
    grid-template-columns: 1fr;
  }
  .mgr-sub-summary-row1 {
    grid-template-columns: 32px 1fr;
    grid-template-rows: auto auto;
  }
  .mgr-sub-summary-row1 > .mgr-sub-idx {
    grid-column: 1;
    grid-row: 1;
  }
  .mgr-sub-summary-row1 > .mgr-sub-main {
    grid-column: 2;
    grid-row: 1;
  }
  .mgr-sub-summary-row1 > .badge {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
  }
  .mgr-sub-summary-actions {
    padding-left: 0;
    justify-content: flex-start;
  }
}
.mgr-events-mini {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: #475569;
}
.mgr-events-empty {
  margin: 0;
  font-size: 12px;
}
.mgr-ev time {
  display: block;
  font-size: 11px;
  margin-bottom: 2px;
}
.mgr-inline-panel {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: var(--radius-sm);
}
.mgr-inline-panel--danger {
  border-color: #fecaca;
  background: #fef2f2;
}
.mgr-inline-h {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 650;
  color: #92400e;
}
.mgr-inline-panel--danger .mgr-inline-h {
  color: #b91c1c;
}
.mgr-inline-ctx {
  font-size: 13px;
  color: #78350f;
  margin: 0 0 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.mgr-inline-panel--danger .mgr-inline-ctx {
  color: #7f1d1d;
}
.mgr-inline-label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
  margin-top: 8px;
}
.mgr-inline-label select,
.mgr-inline-label textarea {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  width: 100%;
}
.mgr-inline-label textarea {
  min-height: 56px;
  resize: vertical;
}
.mgr-inline-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  font-weight: 500;
  color: #334155;
}
.mgr-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
}

@media (max-width: 640px) {
  .app-shell { padding: 12px 12px 32px; }
  .topbar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .top-actions {
    width: 100%;
    justify-content: flex-start;
    gap: 8px;
  }
  .nav-pills {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }
  .nav-pills a {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    font-size: 13px;
    padding: 8px 10px;
  }
  .page-title { font-size: 20px; }
  .page-desc { font-size: 13px; max-width: none; }
  .banner-plan {
    font-size: 13px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .banner-plan code { word-break: break-all; font-size: 12px; }
  .card { padding: 14px 14px; }
  .tabs { gap: 6px; }
  .tabs-btn {
    flex: 1 1 0;
    min-width: 0;
    text-align: center;
    font-size: 12px;
    padding: 8px 8px;
  }
  table.data { font-size: 12px; }
  table.data th, table.data td { padding: 8px 8px; }
  .reassign-subtask-pick { font-size: 14px; }
}
`;
