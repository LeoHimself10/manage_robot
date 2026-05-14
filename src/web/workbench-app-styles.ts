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
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
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
.page-shell--chat { min-height: 100vh; min-height: 100dvh; }
.page-shell--chat .app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.chat-main {
  display: grid;
  grid-template-columns: minmax(230px, 300px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  flex: 1;
}
.chat-thread-pane,
.chat-message-pane {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.chat-thread-pane {
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-message-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-pane-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 650;
}
.thread-toolbar {
  display: none;
  margin-bottom: 10px;
}
.thread-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.thread-list li {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
  background: #fafbfc;
  font-size: 13px;
}
.thread-list li:hover { border-color: #cbd5e1; background: #fff; }
.thread-list li.active { border-color: #93c5fd; background: #eff6ff; }
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
.msg-bubble--user { background: #eff6ff; }
.msg-bubble--assistant { background: #fff; }
.msg-bubble--system { background: #f8fafc; }
.chat-composer {
  padding: 12px;
  background: #fcfdff;
}
.chat-composer .form-stack { gap: 10px; }
.chat-composer textarea { min-height: 96px; }
.chat-composer-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.chat-mobile-sheet[hidden] { display: none; }
html.sheet-open,
html.sheet-open body {
  overflow: hidden;
  height: 100%;
}
.chat-mobile-sheet {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 20;
  touch-action: none;
}
.chat-mobile-sheet-inner {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 70vh;
  background: #fff;
  border-radius: 14px 14px 0 0;
  padding: 12px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chat-mobile-sheet .thread-list { max-height: 48vh; }
.split-chat {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 16px;
  min-height: 520px;
}
@media (max-width: 860px) {
  .chat-main { grid-template-columns: 1fr; }
  .chat-thread-pane { display: none; }
  .thread-toolbar { display: flex; }
  .topbar.topbar--compact .page-title { font-size: 20px; }
  .split-chat { grid-template-columns: 1fr; min-height: auto; }
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
.banner-plan {
  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
}
.banner-plan code { font-size: 13px; }
`;
