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
.info-banner.info-banner--note {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1e3a8a;
}
.account-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  margin-bottom: 14px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.account-strip__who { font-size: 14px; font-weight: 650; color: var(--text); }
.account-strip__meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.badge-soft {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
}
.pwd-rules {
  display: grid;
  gap: 4px;
  margin: 4px 0 14px;
  font-size: 12px;
  color: var(--muted);
}
.pwd-rules .is-ok { color: var(--success); font-weight: 600; }
.pwd-rules .is-invalid { color: var(--danger); font-weight: 600; }
.security-form-card { max-width: 520px; }
.pwd-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pwd-field input { flex: 1; min-width: 0; }
.pwd-field__toggle {
  flex: 0 0 auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.pwd-field__toggle:hover { background: #f8fafc; color: var(--text); }
.form-stack label.is-field-error { color: var(--danger); }
.form-stack label.is-field-error input { border-color: #fca5a5; background: #fef2f2; }
.status-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.5;
}
.status-banner[hidden] { display: none !important; }
.status-banner--success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}
.status-banner__close {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
  font-family: inherit;
}
.account-strip--loading .account-strip__who { color: var(--muted); font-weight: 500; }
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
.badge.stopped { color:#64748b; background:#e2e8f0; border:1px solid #94a3b8; }
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
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px 14px 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.page-shell--chat .topbar {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.page-shell--chat .topbar .page-desc { display: none; }
.chat-main {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 240px;
  flex: 1;
  min-height: 0;
  gap: 12px;
}
.chat-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.chat-sidebar-head {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
.chat-thread-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chat-sidebar-tip {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
  background: #fafbfc;
  flex-shrink: 0;
}
.chat-sidebar-error {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--danger);
}
.chat-thread-item {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  cursor: pointer;
  background: #fff;
}
.chat-thread-item:hover { background: #f8fafc; }
.chat-thread-item.active {
  border-color: #bfdbfe;
  background: #eff6ff;
}
.chat-thread-item.pinned .chat-thread-title { font-weight: 650; }
.chat-thread-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.chat-thread-title {
  font-size: 13px;
  line-height: 1.35;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-thread-preview {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-thread-badge {
  font-size: 11px;
  color: #475569;
  background: #e2e8f0;
  border-radius: 999px;
  padding: 1px 7px;
  white-space: nowrap;
  flex-shrink: 0;
}
.chat-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.chat-pane-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.chat-pane-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}
.draft-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: #f0fdf4;
  font-size: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.draft-context-bar.is-muted {
  background: #f8fafc;
  color: var(--muted);
}
.draft-context-bar--mobile { display: none; }
.draft-context-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}
.draft-context-panel h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}
.draft-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.draft-stat {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: #f8fafc;
  border: 1px solid var(--border);
}
.draft-stat .lbl {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.draft-stat .val {
  font-size: 20px;
  font-weight: 800;
  margin-top: 2px;
}
.draft-stat .val.warn { color: var(--warn); }
.draft-preview-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: var(--muted);
}
.draft-preview-list li { margin-bottom: 4px; }
.chat-pane-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.chat-edit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}
.chat-edit-chips button {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
}
.chat-edit-chips button:hover { background: #eff6ff; border-color: #93c5fd; }
@media (max-width: 959px) {
  .chat-main {
    grid-template-columns: 1fr;
  }
  .draft-context-panel { display: none !important; }
  .draft-context-bar--mobile { display: flex !important; }
  .chat-sidebar {
    width: 100%;
    max-height: min(40vh, 280px);
  }
}
@media (max-width: 860px) {
  .topbar.topbar--compact .page-title { font-size: 20px; }
}
.chat-message-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.chat-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}
.chat-stream[aria-busy="true"] { opacity: 0.92; }
.msg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-welcome-wrap {
  list-style: none;
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}
.chat-welcome {
  max-width: 400px;
  width: 100%;
  text-align: center;
  padding: 8px 12px 4px;
}
.chat-welcome__icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 50%, #f0fdf4 100%);
  border: 1px solid #bfdbfe;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  line-height: 1;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.12);
}
.chat-welcome__title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.chat-welcome__lead {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}
.chat-welcome__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  margin: 0 auto;
  max-width: 320px;
}
.chat-welcome__step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: #334155;
  box-shadow: var(--shadow);
}
.chat-welcome__step-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #eff6ff;
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-welcome__hint {
  margin: 18px 0 0;
  font-size: 11px;
  color: #94a3b8;
}
.chat-welcome__hint kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: #f8fafc;
  font-size: 10px;
  font-family: inherit;
}
.chat-thread-lost-wrap {
  list-style: none;
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
.chat-thread-lost {
  max-width: 380px;
  width: 100%;
  text-align: center;
  padding: 24px 20px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius);
}
.chat-thread-lost__icon {
  font-size: 28px;
  margin-bottom: 10px;
  line-height: 1;
}
.chat-thread-lost h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: #991b1b;
}
.chat-thread-lost p {
  margin: 0 0 16px;
  font-size: 13px;
  color: #b91c1c;
  line-height: 1.55;
}
.chat-thread-lost__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.chat-skeleton-msg {
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: chat-shimmer 1.2s infinite;
}
.chat-skeleton-msg:nth-child(2) { width: 75%; }
.chat-skeleton-msg:nth-child(3) { width: 60%; }
@keyframes chat-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.msg-bubble--pending {
  background: #f8fafc !important;
  border-style: dashed !important;
  color: var(--muted);
}
.msg-bubble--error {
  background: #fef2f2 !important;
  border-color: #fecaca !important;
  color: var(--danger);
}
.typing-dots {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-right: 6px;
  vertical-align: middle;
}
.typing-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing-dots span:nth-child(2) { animation-delay: 0.15s; }
.typing-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
}
.msg-elapsed { font-size: 11px; color: #94a3b8; margin-top: 4px; }
.chat-composer-wrap {
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: #fafbfc;
  flex-shrink: 0;
}
.chat-composer-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  box-shadow: var(--shadow);
}
.chat-composer-card textarea {
  width: 100%;
  min-height: 72px;
  border: none;
  outline: none;
  resize: vertical;
  font: inherit;
  font-size: 13px;
  background: transparent;
  font-family: inherit;
}
.chat-composer-card .composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.chat-composer-card .composer-secondary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 13px;
}
.composer-status {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
}
.composer-status.ok { background: #ecfdf5; color: var(--success); border: 1px solid #a7f3d0; }
.composer-status.err { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; }
.composer-status.busy { background: #eff6ff; color: var(--primary); border: 1px solid #bfdbfe; }
.composer-status.muted { background: #f8fafc; color: var(--muted); border: 1px solid var(--border); }
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

/* 工作台通用模态框（替代行内卡片，iPad/钉钉左栏窄屏更稳定） */
.wb-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  z-index: 1000;
  overflow-y: auto;
}
.wb-modal-overlay[data-open="true"] { display: flex; }
.wb-modal {
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
  width: min(560px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wb-modal__head {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.wb-modal__title { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; }
.wb-modal__close {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}
.wb-modal__close:hover { background: #f1f5f9; color: var(--text); }
.wb-modal__body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.wb-modal__foot {
  padding: 12px 20px 18px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  align-items: center;
  background: #fcfdff;
}
.wb-modal__foot .feedback { margin: 0; flex: 1 1 100%; min-height: 0; }
.wb-modal__radio-row {
  display: grid;
  gap: 10px;
  margin: 4px 0 12px;
}
.wb-modal__radio-row label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  cursor: pointer;
  background: #f8fafc;
}
.wb-modal__radio-row label:hover { border-color: #94a3b8; background: #fff; }
.wb-modal__radio-row label.is-checked {
  border-color: #93c5fd;
  background: #eff6ff;
}
.wb-modal__radio-row input[type="radio"] { margin-top: 3px; flex-shrink: 0; }
.wb-modal__radio-text strong { display: block; font-size: 14px; line-height: 1.3; }
.wb-modal__radio-text .muted { display: block; font-size: 12px; line-height: 1.5; margin-top: 4px; }

/* 员工待承接列表分段样式 */
.emp-section-h {
  margin: 18px 0 10px;
  font-size: 14px;
  font-weight: 650;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.emp-section-h .emp-section-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: #e2e8f0;
  border-radius: 999px;
  padding: 1px 8px;
}
.emp-section-hint { font-size: 12px; color: var(--muted); margin: -4px 0 8px; }
.task-card.is-waiting-mgr {
  background: #f8fafc;
  border-style: dashed;
}
.task-card.is-waiting-mgr .title { color: #475569; }
.emp-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.emp-list-toolbar input[type="search"] {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  min-width: 200px;
  flex: 1 1 200px;
  max-width: 360px;
}
.emp-task-group {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  margin-bottom: 14px;
  overflow: hidden;
}
.emp-task-group__head {
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: baseline;
  font-size: 13px;
}
.emp-task-group__title { font-weight: 650; color: var(--text); }
.emp-task-group__no { color: var(--muted); font-size: 12px; }
.emp-task-group__count {
  font-size: 11px;
  color: var(--muted);
  background: #e2e8f0;
  border-radius: 999px;
  padding: 1px 8px;
}
.emp-task-group__body { padding: 12px 14px; display: grid; gap: 10px; }

/* 员工详情筛选 chips */
.emp-sub-filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.emp-sub-filter button {
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
  font-family: inherit;
  font-weight: 500;
}
.emp-sub-filter button:hover { border-color: #94a3b8; background: #fff; }
.emp-sub-filter button[aria-pressed="true"] {
  background: #eff6ff;
  border-color: #93c5fd;
  color: var(--primary-hover);
  font-weight: 650;
}

/* 草案 Excel 弹窗（主管 chat） */
.draft-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 8000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.draft-modal {
  width: 92vw;
  height: 88vh;
  max-width: 1600px;
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.draft-modal--fullscreen {
  width: 100vw;
  height: 100vh;
  max-width: none;
  border-radius: 0;
}
.draft-modal-top {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
}
.draft-modal-top-left { flex: 1; min-width: 240px; }
.draft-modal-top-left h2 { margin: 0 0 8px; font-size: 17px; }
.draft-meta-row { display: flex; gap: 10px; flex-wrap: wrap; }
.draft-meta-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.draft-meta-input,
.draft-meta-textarea {
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  min-width: 200px;
}
.draft-meta-textarea { min-width: 320px; min-height: 40px; resize: vertical; }
.draft-modal-top-right { display: flex; gap: 6px; flex-wrap: wrap; }
.draft-modal-toolbar {
  flex-shrink: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: #fafbfc;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.draft-modal-grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 12px 8px;
}
.draft-excel-scroll {
  overflow: auto;
  height: 100%;
  border: 1px solid #d1d5db;
  margin-top: 8px;
}
.draft-excel-table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 12px;
}
.draft-excel-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
  font-weight: 600;
}
.draft-excel-table th .col-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
}
.draft-excel-table th .col-resize-handle:hover {
  background: rgba(37, 99, 235, 0.2);
}
.draft-excel-table th.col-frozen,
.draft-excel-table td.col-frozen {
  position: sticky;
  left: 0;
  z-index: 3;
  background: #e5e7eb;
}
.draft-excel-table th:nth-child(2),
.draft-excel-table td:nth-child(2) {
  position: sticky;
  left: 36px;
  z-index: 3;
  background: #e5e7eb;
}
.draft-excel-table td {
  border: 1px solid #d1d5db;
  padding: 0;
  min-width: 60px;
  vertical-align: top;
}
.draft-excel-table .cell-input--date {
  background: #fffbeb;
  min-height: 32px;
}
.cell-contact-combo { position: relative; }
.contact-combo-wrap { position: relative; }
.contact-combo-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 20;
  max-height: 160px;
  overflow: auto;
}
.draft-excel-table .cell-input {
  width: 100%;
  min-height: 36px;
  border: none;
  outline: none;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
  background: transparent;
  resize: vertical;
}
.draft-excel-table .cell-input:focus {
  background: #dbeafe;
  box-shadow: inset 0 0 0 2px var(--primary);
}
.draft-excel-table .cell-readonly {
  padding: 6px 8px;
  text-align: center;
  color: var(--muted);
  background: #f9fafb;
}
.draft-modal-footer {
  flex-shrink: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: #fafbfc;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.draft-modal-error {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  color: var(--danger);
}
.draft-excel-table tr.selected td { background: #eff6ff; }
.draft-modal-grid-wrap { position: relative; }
.draft-modal-submit-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 20px;
}
.draft-modal-submit-overlay[hidden] { display: none !important; }
.draft-modal-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: draft-spin 0.8s linear infinite;
}
@keyframes draft-spin { to { transform: rotate(360deg); } }
.draft-modal-submit-title { font-weight: 700; font-size: 14px; }
.draft-modal-submit-hint { font-size: 12px; color: var(--muted); }
.draft-modal--submitting .draft-excel-scroll,
.draft-modal--submitting .draft-modal-toolbar,
.draft-modal--submitting .draft-modal-top {
  pointer-events: none;
  opacity: 0.55;
}
.draft-modal-footer-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.chat-pane-head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

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
