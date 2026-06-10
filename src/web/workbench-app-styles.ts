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
  --primary-soft: #eff6ff;
  --danger: #dc2626;
  --success: #059669;
  --warn: #d97706;
  --status-blocked: #dc2626;
  --status-warn: #d97706;
  --status-success: #059669;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-lg: 0 12px 32px rgba(15, 23, 42, 0.12);
  --font: "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 15px;
  --text-lg: 20px;
  --text-xl: 24px;
  --admin: #6366f1;
  --admin-soft: #eef2ff;
  --rail-w: 248px;
  --appbar-h: 52px;
  --touch-min: 44px;
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 16px;
  align-items: start;
  margin-bottom: 20px;
}
.topbar > div:first-child {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
.topbar.topbar--compact { margin-bottom: 14px; }
.brand { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); }
.page-title { margin: 4px 0 0; font-size: var(--text-lg, 20px); font-weight: 700; letter-spacing: -0.02em; }
.page-desc { margin: 6px 0 0; font-size: 14px; color: var(--muted); max-width: 560px; }
.topbar.topbar--compact .page-title { font-size: var(--text-lg, 20px); }
.topbar.topbar--compact .page-desc { max-width: 480px; }
.top-actions {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  align-self: start;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
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
.form-stack .combo { position: relative; }
.form-stack input, .form-stack select, .form-stack textarea {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  width: 100%;
}
.form-stack textarea { min-height: 88px; resize: vertical; }
.add-subtask-depends-field { display: grid; gap: 6px; }
.add-subtask-depends-label { font-size: 13px; font-weight: 500; color: #334155; }
.add-subtask-depends-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #f8fafc;
}
.add-subtask-depends-empty { margin: 0; font-size: 13px; padding: 6px 4px; }
.add-subtask-depends-hint { margin: 0; font-size: 12px; line-height: 1.45; }
/* 覆盖 .form-stack label{display:grid}，避免 checkbox 被挤到卡片顶部 */
.add-subtask-depends-list label.add-subtask-depends-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  font-weight: 400;
  margin: 0;
  min-height: 44px;
  box-sizing: border-box;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}
.add-subtask-depends-list label.add-subtask-depends-item:hover {
  border-color: #bfdbfe;
  background: #f8fafc;
}
.add-subtask-depends-list label.add-subtask-depends-item.is-selected {
  border-color: #60a5fa;
  background: #eff6ff;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
}
.add-subtask-depends-list label.add-subtask-depends-item input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin: 0;
  flex-shrink: 0;
  border: 2px solid #cbd5e1;
  border-radius: 5px;
  background: #fff;
  cursor: pointer;
  position: relative;
  vertical-align: middle;
}
.add-subtask-depends-list label.add-subtask-depends-item input[type="checkbox"]:checked {
  border-color: #2563eb;
  background: #2563eb;
}
.add-subtask-depends-list label.add-subtask-depends-item input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 1px;
  width: 5px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.add-subtask-depends-item-body {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  font-size: 14px;
  color: var(--text);
  line-height: 1.4;
}
.add-subtask-depends-ord {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 2px 8px;
  line-height: 1.3;
}
.add-subtask-depends-list label.add-subtask-depends-item.is-selected .add-subtask-depends-ord {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #93c5fd;
}
.add-subtask-depends-title { flex: 1; min-width: 0; word-break: break-word; }
.mgr-opt { font-weight: 400; color: var(--muted); font-size: 12px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.kpis.kpis--5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.kpis.kpis--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 480px; }
.kpis.kpis--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 100%; }
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
.combo-options.combo-options--fixed {
  position:fixed;
  right:auto;
  z-index:10050;
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
  font-size: var(--text-base, 14px);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
}
.empty-state__icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: var(--primary-soft);
  border: 1px solid #bfdbfe;
  display: grid;
  place-items: center;
  font-size: 22px;
  line-height: 1;
}
.skeleton {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: wb-skeleton-shimmer 1.2s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
@keyframes wb-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
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
  grid-template-columns: 260px minmax(0, 1fr) 260px;
  flex: 1;
  min-height: 0;
  gap: 12px;
  position: relative;
}
.chat-overlay-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 180;
  background: rgba(15, 23, 42, 0.35);
}
.chat-main.is-overlay-open .chat-overlay-backdrop { display: block; }
body.chat-overlay-lock { overflow: hidden; }
.chat-mobile-top {
  display: none;
  grid-template-columns: 40px minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.96);
  flex-shrink: 0;
}
.chat-icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  display: grid;
  place-items: center;
  cursor: pointer;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  padding: 0;
}
.chat-icon-btn:active { background: #f4f4f5; }
.chat-mobile-top__title { text-align: center; min-width: 0; }
.chat-mobile-top__title strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-mobile-top__title em {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: var(--muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-pane-head--desktop {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.draft-mobile-bar {
  flex-shrink: 0;
  padding: 0 12px 6px;
  display: none;
}
.draft-mobile-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: linear-gradient(90deg, #eff6ff, #f0f9ff);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: var(--text);
}
.draft-mobile-chip__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}
.draft-mobile-chip__main { flex: 1; min-width: 0; }
.draft-mobile-chip__title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.draft-mobile-chip__meta {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
.draft-mobile-chip__chev { color: var(--muted); font-size: 12px; flex-shrink: 0; }
.draft-sheet-grab {
  display: none;
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: #d4d4d8;
  margin: 10px auto 0;
  flex-shrink: 0;
}
.draft-sheet-close {
  display: none;
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}
.chat-starter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 16px 0 12px;
}
.chat-starter-chip {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  padding: 10px 14px;
  font: inherit;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
}
.chat-starter-chip:active { background: #f4f4f5; }
.chat-composer-pill {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: end;
  padding: 8px 8px 8px 14px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: #fafafa;
}
.chat-composer-pill textarea {
  border: none;
  background: transparent;
  resize: none;
  font: inherit;
  font-size: 15px;
  line-height: 1.45;
  min-height: 24px;
  max-height: 120px;
  padding: 6px 0;
  outline: none;
  width: 100%;
  color: var(--text);
}
.chat-composer-pill textarea::placeholder { color: #a1a1aa; }
.chat-send-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: var(--text);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.chat-send-btn:disabled { opacity: 0.35; cursor: default; }
.chat-composer-extra {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 8px;
  font-size: 12px;
}
.chat-roster-status { font-size: 12px; }
.chat-composer-hint {
  text-align: center;
  font-size: 11px;
  color: #a1a1aa;
  margin: 6px 0 0;
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
  position: relative;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 8px 28px 8px 10px;
  cursor: pointer;
  background: #fff;
}
.chat-thread-menu-btn {
  position: absolute;
  top: 6px;
  right: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.chat-thread-item:hover .chat-thread-menu-btn,
.chat-thread-item.menu-open .chat-thread-menu-btn {
  opacity: 1;
}
.chat-thread-menu-btn:hover {
  background: #e2e8f0;
  color: var(--text);
}
.chat-thread-dropdown {
  position: absolute;
  top: 28px;
  right: 4px;
  z-index: 30;
  min-width: 108px;
  padding: 4px 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.chat-thread-dropdown[hidden] {
  display: none;
}
.chat-thread-dropdown-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
}
.chat-thread-dropdown-item:hover {
  background: #f1f5f9;
}
.chat-thread-dropdown-item--danger {
  color: var(--danger);
}
.chat-thread-dropdown-item--danger:hover {
  background: #fef2f2;
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
  display: none;
}
.chat-pane-sub {
  font-size: 11px;
  color: var(--muted);
  margin-top: 1px;
}
.chat-pane-sub--hidden {
  display: none;
}
.draft-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: #f0fdf4;
  font-size: 11px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.draft-context-bar.is-muted {
  background: #f8fafc;
  color: var(--muted);
}
.wb-confirm-bar {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  text-align: left;
}
.wb-confirm-bar__row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}
.wb-confirm-bar__row input[type="checkbox"] {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #2563eb;
}
.form-stack .wb-confirm-bar__row label {
  display: inline;
  margin: 0;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.draft-context-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.draft-context-panel::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--draft-accent, var(--primary));
}
.draft-context-panel[data-state="ready"] { --draft-accent: #059669; }
.draft-context-panel[data-state="warn"] { --draft-accent: var(--warn); }
.draft-context-panel[data-state="empty"]::before,
.draft-context-panel--empty::before { background: var(--border); }
.draft-context-panel--empty .draft-panel-body { display: none; }
.draft-panel-empty-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 28px 16px;
  flex: 1;
  min-height: 200px;
}
.draft-panel-empty-wrap[hidden] { display: none; }
.draft-panel-empty-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}
.draft-panel-empty-icon svg { width: 22px; height: 22px; }
.draft-panel-empty-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 650;
}
.draft-panel-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--muted);
  max-width: 22ch;
}
.draft-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.draft-panel-body[hidden] { display: none; }
.draft-panel__head {
  padding: 14px 14px 10px;
  flex-shrink: 0;
}
.draft-panel__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.draft-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 8px;
}
.draft-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  background: #f3f4f6;
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
}
.draft-panel__meta {
  display: grid;
  gap: 8px;
}
.draft-assign-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.draft-assign-progress__bar {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: #f3f4f6;
  overflow: hidden;
}
.draft-assign-progress__fill {
  height: 100%;
  border-radius: 999px;
  background: #059669;
  transition: width 0.2s ease;
}
.draft-context-panel[data-state="warn"] .draft-assign-progress__fill {
  background: linear-gradient(90deg, #059669 0%, #059669 var(--draft-pct, 60%), #e5e7eb var(--draft-pct, 60%));
}
.draft-assign-progress__label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
}
.draft-assign-progress__label em {
  font-style: normal;
  color: var(--text);
}
.draft-due-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.draft-due-row svg { width: 14px; height: 14px; opacity: 0.75; flex-shrink: 0; }
.draft-due-row strong { color: #64748b; font-weight: 600; }
.draft-due-row[hidden] { display: none; }
.btn-draft-edit-table {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 2px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fafbfc;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s, box-shadow 0.12s;
}
.btn-draft-edit-table:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #eff6ff;
  color: var(--primary);
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.08);
}
.btn-draft-edit-table:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.btn-draft-edit-table:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-draft-edit-table[hidden] { display: none; }
.btn-draft-edit-table svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.85; }
.draft-panel__list {
  flex: 1;
  overflow: auto;
  padding: 2px 8px 8px;
  min-height: 0;
}
.draft-task-row {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 9px 8px;
  border-radius: var(--radius-sm);
}
.draft-task-row + .draft-task-row { border-top: 1px solid #f0f1f3; }
.draft-task-row:hover { background: #fafafa; }
.draft-task-row__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  background: #059669;
}
.draft-task-row--pending .draft-task-row__dot {
  background: #fbbf24;
  box-shadow: 0 0 0 3px #fffbeb;
}
.draft-task-row__body { min-width: 0; }
.draft-task-row__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.draft-task-row--pending .draft-task-row__title { color: #64748b; }
.draft-task-row__sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted);
}
.draft-assignee {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 36px;
}
.draft-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
}
.draft-avatar--tone-0 { background: #6366f1; }
.draft-avatar--tone-1 { background: #0ea5e9; }
.draft-avatar--tone-2 { background: #10b981; }
.draft-avatar--tone-3 { background: #8b5cf6; }
.draft-avatar--pending {
  background: #f3f4f6;
  color: var(--muted);
  border: 1px dashed #d1d5db;
  font-size: 14px;
  font-weight: 400;
}
.draft-assignee__name {
  font-size: 10px;
  color: var(--muted);
  max-width: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-panel__foot {
  padding: 10px 14px 14px;
  border-top: 1px solid #f0f1f3;
  background: linear-gradient(to top, #fafbfc 0%, var(--surface) 100%);
  flex-shrink: 0;
}
.btn-draft-publish {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.12s, transform 0.08s;
}
.btn-draft-publish:hover:not(:disabled) { background: var(--primary-hover); }
.btn-draft-publish:active:not(:disabled) { transform: translateY(1px); }
.btn-draft-publish:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.btn-draft-publish:disabled {
  background: #e5e7eb;
  color: #9ca3af;
  cursor: not-allowed;
}
.btn-draft-publish[hidden] { display: none; }
.btn-draft-publish svg { width: 16px; height: 16px; flex-shrink: 0; }
.draft-foot-caption {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
  text-align: center;
}
.chat-pane-title {
  margin: 0;
  font-size: 15px;
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
    gap: 0;
    flex: 1;
    min-height: 0;
    height: 100%;
  }
  .chat-mobile-top { display: grid; }
  .chat-pane-head--desktop { display: none; }
  .chat-sidebar {
    position: fixed;
    top: var(--appbar-h);
    left: 0;
    bottom: 0;
    width: min(82%, 300px);
    z-index: 190;
    max-height: none;
    transform: translateX(-100%);
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    border-radius: 0;
    box-shadow: 8px 0 32px rgba(15, 23, 42, 0.12);
  }
  .chat-main.is-thread-drawer-open .chat-sidebar {
    transform: translateX(0);
  }
  .chat-sidebar-tip { display: block; font-size: 11px; }
  .chat-pane {
    min-height: 0;
    max-height: none;
    flex: 1;
    height: 100%;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }
  .draft-context-bar {
    display: none !important;
  }
  .draft-mobile-bar {
    display: block;
  }
  .draft-context-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    width: 100% !important;
    max-height: min(72vh, 560px) !important;
    border-radius: 20px 20px 0 0 !important;
    transform: translateY(calc(100% + 8px));
    transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.14);
    flex: none !important;
    overflow: hidden;
    padding-top: 4px;
  }
  .chat-main.is-draft-sheet-open .draft-context-panel {
    transform: translateY(0);
  }
  .draft-sheet-grab { display: block; }
  .draft-sheet-close { display: grid; }
  .draft-panel__list {
    max-height: min(36vh, 280px);
    overflow-y: auto;
  }
  .draft-panel-collapse-btn { display: none !important; }
  .btn-draft-edit-table,
  .btn-draft-publish {
    width: 100%;
    justify-content: center;
  }
  .chat-thread-menu-btn {
    opacity: 1;
  }
  .chat-composer-wrap {
    padding: 8px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    background: #fff;
    box-shadow: 0 -8px 32px rgba(24, 24, 27, 0.08);
    border-top: none;
  }
  .msg-bubble--assistant {
    border: none;
    background: transparent;
    padding: 0 2px;
    max-width: 100%;
  }
  .msg-bubble--user {
    border: none;
    background: #f4f4f5;
    border-radius: 18px 18px 4px 18px;
    padding: 10px 14px;
  }
  .msg-row--user .msg-bubble { max-width: 88%; }
  .chat-stream { padding: 16px 14px 8px; }
  .msg-list { gap: 20px; }
}
@media (min-width: 960px) {
  .draft-mobile-bar,
  .chat-mobile-top,
  .chat-overlay-backdrop,
  .draft-sheet-grab,
  .draft-sheet-close {
    display: none !important;
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
  padding: 4px 0 8px;
}
.chat-welcome {
  max-width: 420px;
  width: 100%;
  text-align: center;
  padding: 4px 12px 0;
}
.chat-welcome__icon {
  width: 40px;
  height: 40px;
  margin: 0 auto 10px;
  border-radius: 12px;
  background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 50%, #f0fdf4 100%);
  border: 1px solid #bfdbfe;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
}
.chat-welcome__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.chat-welcome__lead {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.55;
}
.chat-welcome__steps {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin: 0 auto 12px;
  max-width: 360px;
  text-align: left;
}
@media (min-width: 520px) {
  .chat-welcome { max-width: 520px; }
  .chat-welcome__steps {
    grid-template-columns: repeat(3, 1fr);
    max-width: none;
    gap: 10px;
  }
}
.chat-welcome__step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 10px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: #334155;
  line-height: 1.45;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}
@media (min-width: 520px) {
  .chat-welcome__step {
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 12px 8px;
  }
}
.chat-welcome__step-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: linear-gradient(135deg, #dbeafe, #eff6ff);
  color: var(--primary);
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #bfdbfe;
}
.chat-welcome__step-text {
  flex: 1;
  min-width: 0;
}
.chat-welcome__hint {
  margin: 0;
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
  padding: 8px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border);
  background: #fff;
  flex-shrink: 0;
}
.chat-composer-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  box-shadow: var(--shadow);
}
.chat-composer-card textarea {
  width: 100%;
  min-height: 54px;
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
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.msg-body--assistant .msg-md-table {
  width: max-content;
  min-width: min(100%, 520px);
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
  min-width: 72px;
  white-space: normal;
  word-break: break-word;
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
.msg-bubble--user {
  background: #f4f4f5;
  border-color: transparent;
  border-radius: 18px 18px 4px 18px;
}
.msg-bubble--assistant { background: #fff; }
.msg-bubble--system { background: #f8fafc; }
@media (min-width: 960px) {
  .msg-bubble--user {
    background: #eff6ff;
    border-color: var(--border);
    border-radius: var(--radius-sm);
  }
}
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
  padding: 16px 18px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--primary);
}
.task-card.is-waiting-mgr { border-left-color: var(--warn); }
.task-card.is-blocked { border-left-color: var(--status-blocked); }
.task-card.is-done { border-left-color: var(--status-success); opacity: 0.92; }
.task-card-summary { display: grid; gap: 6px; }
.task-card-planning {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.task-card-planning summary {
  cursor: pointer;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: var(--primary-hover);
  list-style: none;
  min-height: var(--touch-min, 44px);
  display: flex;
  align-items: center;
}
.task-card-planning summary::-webkit-details-marker { display: none; }
.task-card-planning summary::before {
  content: "▸ ";
  display: inline-block;
  transition: transform 0.15s ease;
}
.task-card-planning[open] summary::before { transform: rotate(90deg); }
.task-card-planning .subtask-planning-block { margin-top: 8px; }
.task-card .head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
.task-card .title { font-weight: 650; font-size: var(--text-md, 15px); margin: 0 0 6px; word-break: break-word; }
.task-card .meta { font-size: var(--text-sm, 12px); color: var(--muted); }
.task-card .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.task-card .actions .btn-primary { flex: 1 1 auto; min-width: 120px; min-height: var(--touch-min, 44px); }
.task-card .actions .btn-secondary,
.task-card .actions .btn-danger { flex: 0 1 auto; min-height: var(--touch-min, 44px); }
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
.wb-project-dialog .wb-modal {
  width: min(420px, calc(100vw - 32px));
}
.wb-project-dialog .form-stack label {
  display: grid;
  gap: 6px;
}
.wb-project-dialog .wb-modal__foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
dialog:not([open]) { display: none; }
dialog {
  border: none;
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 0;
  max-width: min(420px, calc(100vw - 32px));
}
dialog::backdrop {
  background: rgba(15, 23, 42, 0.45);
}
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
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 10px;
  }
  .top-actions {
    justify-self: end;
    justify-content: flex-end;
    max-width: 100%;
  }
  .nav-pills {
    flex: 0 1 auto;
    justify-content: flex-end;
    max-width: 100%;
  }
  .nav-pills a {
    flex: 0 1 auto;
    text-align: center;
    font-size: 13px;
    padding: 8px 10px;
  }
  .page-title { font-size: var(--text-lg, 20px); }
  .page-desc { font-size: 13px; max-width: none; }
  .wb-page-head { padding: 12px 14px 0; }
  .wb-main-body { padding: 12px 14px 24px; }
  .wb-rail-toggle-lbl { display: none; }
  .wb-appbar-brand-txt { display: none; }
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

/* ── v4 left rail shell (manager / employee / admin) ── */
body.wb-has-rail { background: var(--bg); }
body.wb-rail-open-lock { overflow: hidden; }
.wb-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.wb-appbar {
  position: sticky;
  top: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--appbar-h);
  padding: 0 12px 0 10px;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}
.wb-appbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.wb-appbar-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
}
.wb-appbar-mark.is-emp { background: linear-gradient(135deg, #059669, #34d399); }
.wb-appbar-mark.is-adm { background: linear-gradient(135deg, #6366f1, #818cf8); }
.wb-appbar-brand-txt { white-space: nowrap; }
.wb-appbar-spacer { flex: 1; min-width: 8px; }
.wb-appbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.wb-appbar-logout { color: var(--muted) !important; }

.wb-rail-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  top: var(--appbar-h);
  z-index: 180;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}
.wb-rail-backdrop[hidden] { display: none !important; }
.wb-rail {
  position: fixed;
  left: 0;
  top: var(--appbar-h);
  bottom: 0;
  z-index: 190;
  width: min(var(--rail-w), 88vw);
  background: #0f172a;
  color: #94a3b8;
  padding: 12px 10px 16px;
  display: flex;
  flex-direction: column;
  transform: translateX(-105%);
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: none;
  overflow: hidden;
}
body.wb-rail-is-open .wb-rail {
  transform: translateX(0);
  box-shadow: 8px 0 32px rgba(15, 23, 42, 0.28);
}
.wb-rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 10px;
  flex-shrink: 0;
}
.wb-rail-head-lbl { padding: 0 8px; margin: 0; }
.wb-rail-close {
  color: #94a3b8 !important;
  font-size: 20px !important;
  line-height: 1;
  padding: 4px 8px !important;
  flex-shrink: 0;
}
.wb-rail-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.wb-rail-grp { margin-bottom: 14px; }
.wb-rail-grp-lbl {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #475569;
  padding: 0 10px 6px;
}
.wb-rail-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: #94a3b8;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.wb-rail-link:hover { background: rgba(255, 255, 255, 0.05); color: #e2e8f0; text-decoration: none; }
.wb-rail-link.is-on { background: rgba(37, 99, 235, 0.14); color: #93c5fd; font-weight: 600; }
.wb-rail-link.is-on-emp { background: rgba(5, 150, 105, 0.12); color: #6ee7b7; font-weight: 600; }
.wb-rail-link.is-on-adm { background: rgba(99, 102, 241, 0.14); color: #a5b4fc; font-weight: 600; }
.wb-rail-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
}
.wb-rail-badge.is-green { background: var(--success); }
.wb-rail-badge.is-amber { background: var(--warn); }

.wb-rail-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.wb-rail-toggle-lbl { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

.wb-role-switch {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  font-weight: 600 !important;
  text-decoration: none !important;
  white-space: nowrap;
  max-width: min(46vw, 220px);
  overflow: hidden;
  text-overflow: ellipsis;
}
.wb-role-switch-ico {
  font-size: 12px;
  line-height: 1;
  opacity: 0.85;
  flex-shrink: 0;
}
.wb-role-switch--to-emp {
  background: #ecfdf5 !important;
  border: 1px solid #6ee7b7 !important;
  color: #047857 !important;
}
.wb-role-switch--to-emp:hover {
  background: #d1fae5 !important;
  color: #065f46 !important;
}
.wb-role-switch--to-mgr {
  background: #eff6ff !important;
  border: 1px solid #93c5fd !important;
  color: #1d4ed8 !important;
}
.wb-role-switch--to-mgr:hover {
  background: #dbeafe !important;
  color: #1e40af !important;
}
.wb-role-switch--to-adm {
  background: #faf5ff !important;
  border: 1px solid #c4b5fd !important;
  color: #6d28d9 !important;
}
.wb-role-switch--to-adm:hover {
  background: #f3e8ff !important;
  color: #5b21b6 !important;
}
.wb-role-switch[hidden] {
  display: none !important;
}

.wb-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}
.wb-page-head {
  padding: 16px 24px 0;
  flex-shrink: 0;
}
.wb-page-head-inner { min-width: 0; }
.wb-crumb { font-size: 12px; font-weight: 500; color: var(--muted); margin-bottom: 4px; }
.wb-crumb a { color: var(--primary); text-decoration: none; }
.wb-crumb a:hover { text-decoration: underline; }
.wb-main-title { margin: 0; font-size: var(--text-lg, 20px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.wb-main-desc { margin: 4px 0 0; font-size: 13px; color: var(--muted); max-width: 56ch; }
.wb-main-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding-top: 10px;
  margin-top: 12px;
  border-top: 1px solid var(--border);
}
details.mgr-filter-advanced:not([open]) .mgr-list-toolbar,
details.mgr-filter-advanced:not([open]) .wb-filter-footer {
  display: none !important;
}
.mgr-filter-advanced[open] .mgr-list-toolbar {
  margin-top: 10px;
}
html, body.wb-has-rail {
  overflow-x: hidden;
  max-width: 100%;
}
.wb-app, .wb-main {
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
}
.wb-main-body { padding: 16px 24px 32px; flex: 1; min-width: 0; max-width: 100%; overflow-x: hidden; box-sizing: border-box; }
.wb-main-body--detail { max-width: 980px; }
.wb-main-body--detail-emp { padding-bottom: 0; }

.wb-info-bar {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
}
.wb-info-bar--emp {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
}
.wb-info-bar--adm {
  background: var(--admin-soft);
  border: 1px solid #c7d2fe;
  color: #4338ca;
}

body.wb-has-rail.page-shell--chat {
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
body.wb-has-rail.page-shell--chat .wb-app {
  height: 100%;
  min-height: 0;
}
body.wb-has-rail.page-shell--chat .wb-main {
  overflow: hidden;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
body.wb-has-rail.page-shell--chat .wb-main-body {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
body.wb-has-rail.page-shell--chat .chat-main { flex: 1; min-height: 0; }

@media (max-width: 480px) {
  :root { --appbar-h: 48px; }
  .wb-appbar { gap: 6px; padding: 0 8px 0 6px; }
  .wb-role-switch { font-size: 12px !important; padding: 6px 8px !important; }
  .wb-appbar-logout { padding: 6px 8px !important; font-size: 12px !important; }
}

body.wb-has-rail .app-shell--dashboard { max-width: none; margin: 0; padding: 0; }
body.wb-has-rail .wb-main-body.app-shell--dashboard {
  overflow-x: clip;
  max-width: 100%;
  box-sizing: border-box;
}

.emp-detail-action-bar.wb-sticky-foot {
  position: sticky;
  bottom: 0;
  margin: 16px -24px -32px;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  z-index: 2;
}

.admin-perm-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: start;
}
@media (max-width: 900px) {
  .admin-perm-split { grid-template-columns: 1fr; }
}
.admin-perm-list .perm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.admin-perm-list .perm-row:last-child { border-bottom: none; }
.admin-perm-av {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--admin-soft);
  color: var(--admin);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

/* ── Mobile draft card editor ── */
.draft-card-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 8500;
  background: var(--surface);
}
.draft-card-editor {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-height: 100dvh;
  background: var(--bg);
  position: relative;
}
.draft-card-editor__head {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: var(--touch-min, 44px) 1fr var(--touch-min, 44px);
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  padding-top: max(8px, env(safe-area-inset-top));
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 2;
}
.draft-card-editor__title {
  margin: 0;
  font-size: var(--text-md, 15px);
  font-weight: 700;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  grid-column: 1 / -1;
  grid-row: 1;
  pointer-events: none;
  padding: 0 48px;
}
.draft-card-editor__back,
.draft-card-editor__close {
  min-width: var(--touch-min, 44px);
  min-height: var(--touch-min, 44px);
  position: relative;
  z-index: 3;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 20px;
  line-height: 1;
}
.draft-card-editor__back {
  grid-column: 1;
  grid-row: 1;
  justify-self: start;
}
.draft-card-editor__close {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
  font-size: var(--text-sm, 13px);
}
.draft-card-editor__back[hidden],
.draft-card-editor__close[hidden] {
  visibility: hidden;
  pointer-events: none;
}
.draft-card-editor__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 14px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
.draft-card-editor__error {
  font-size: var(--text-sm, 13px);
  color: var(--danger);
  margin-bottom: 8px;
}
.draft-card-editor__foot {
  flex-shrink: 0;
  padding: 10px 14px;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.draft-card-submit-btn {
  width: 100%;
  min-height: var(--touch-min, 44px);
}
.draft-card-meta {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 12px;
}
.draft-card-meta summary {
  font-weight: 600;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
  min-height: var(--touch-min, 44px);
  display: flex;
  align-items: center;
}
.draft-card-meta-form label {
  display: grid;
  gap: 6px;
  font-size: var(--text-sm, 13px);
  font-weight: 500;
  margin-top: 8px;
}
.draft-card-list-hint { margin: 0 0 10px; font-size: var(--text-sm, 13px); }
.draft-card-list { display: grid; gap: 10px; }
.draft-card-item {
  display: grid;
  gap: 4px;
  text-align: left;
  width: 100%;
  padding: 14px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--primary);
  cursor: pointer;
  font: inherit;
  color: inherit;
  min-height: var(--touch-min, 44px);
}
.draft-card-item.is-unassigned { border-left-color: var(--warn); }
.draft-card-item:not(.is-unassigned) { border-left-color: var(--primary); }
.draft-card-item__title { font-weight: 650; font-size: var(--text-base, 14px); }
.draft-card-item__meta { font-size: var(--text-sm, 12px); color: var(--muted); }
.draft-card-item__badge {
  justify-self: start;
  font-size: var(--text-xs, 11px);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}
.draft-card-item__badge.is-warn {
  background: #fffbeb;
  color: #b45309;
  border-color: #fde68a;
}
.draft-card-add-btn {
  width: 100%;
  margin-top: 10px;
  min-height: var(--touch-min, 44px);
}
.draft-card-form-view {
  display: flex;
  flex-direction: column;
  min-height: min(70vh, 100%);
}
.draft-card-form-scroll {
  flex: 1;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.draft-card-form label {
  display: grid;
  gap: 6px;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: #334155;
}
.draft-card-input {
  width: 100%;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 16px;
  background: var(--surface);
}
.draft-card-input--date { background: #fffbeb; }
.draft-card-form-foot {
  flex-shrink: 0;
  padding-top: 12px;
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--border);
  margin-top: 12px;
  background: var(--bg);
  position: sticky;
  bottom: 0;
}
.draft-card-form-nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: center;
}
.draft-card-form-nav-label {
  text-align: center;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: var(--muted);
}
.draft-card-form-nav .btn { min-height: var(--touch-min, 44px); }
.draft-card-save-back { width: 100%; min-height: var(--touch-min, 44px); }
.draft-card-delete-row { justify-self: center; }
.draft-card-editor--submitting .draft-card-editor__main,
.draft-card-editor--submitting .draft-card-editor__foot {
  pointer-events: none;
  opacity: 0.55;
}
.draft-card-editor .draft-modal-submit-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
}

/* ── Manager list SegNav filter ── */
.mgr-tasks-card {
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}
.mgr-tasks-card .tab-panel,
.mgr-tasks-card .panel-stack,
.mgr-tasks-card #taskTableMount {
  min-width: 0;
  max-width: 100%;
}
.mgr-filter-seg-wrap {
  min-width: 0;
  max-width: 100%;
}
.mgr-filter-seg {
  display: flex;
  flex-wrap: nowrap;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 3px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 2px;
  margin-bottom: 12px;
}
.mgr-filter-seg button {
  font: inherit;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  padding: 8px 6px;
  min-height: 36px;
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.mgr-filter-seg button.is-on {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.mgr-filter-advanced {
  margin-bottom: 12px;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fafbfc;
  padding: 0 12px;
}
.mgr-filter-advanced .mgr-list-toolbar {
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.tab-panel.panel-stack {
  min-width: 0;
  max-width: 100%;
}
.tab-panel.panel-stack > * {
  min-width: 0;
  max-width: 100%;
}
.reassign-plan-select {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
.reassign-task-picker {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.reassign-task-picker__btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--touch-min, 44px);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  font: inherit;
  font-size: 14px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.reassign-task-picker__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.reassign-task-picker__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reassign-task-picker__chev { flex-shrink: 0; color: var(--muted); font-size: 12px; }
.reassign-task-picker__list {
  position: absolute;
  z-index: 120;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 6px;
  list-style: none;
  max-height: min(52vh, 280px);
  overflow-y: auto;
  overflow-x: hidden;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
}
.reassign-task-picker__list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  align-items: start;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.reassign-task-picker__list li[data-plan-id] {
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 4px 8px;
}
.reassign-task-picker__list li:hover,
.reassign-task-picker__list li:focus {
  background: var(--primary-soft);
  outline: none;
}
.reassign-task-picker__opt-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.reassign-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(15, 23, 42, 0.35);
}
@media (max-width: 720px) {
  .reassign-task-picker__list {
    position: fixed;
    z-index: 120;
    left: 12px;
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    top: auto;
    max-height: min(62vh, 420px);
    border-radius: 14px;
  }
}
#mgrPanelReassign label > .reassign-task-picker,
#mgrPanelReassign label > .combo {
  min-width: 0;
  max-width: 100%;
}
.reassign-task-picker__opt-no {
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 11px;
  color: var(--muted);
  white-space: normal;
  word-break: break-all;
}
.reassign-task-picker__opt-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
  word-break: break-word;
  font-weight: 600;
}
.reassign-task-picker__opt-st {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.35;
  word-break: break-word;
}
@media (max-width: 720px) {
  .kpis.kpis--3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    max-width: 100%;
    width: 100%;
    gap: 8px;
    margin-bottom: 12px;
  }
  .kpis.kpis--3 .kpi { min-width: 0; padding: 10px 8px; }
  .kpis.kpis--3 .lbl { font-size: 11px; line-height: 1.25; }
  .kpis.kpis--3 .val { font-size: 22px; }
}
@media (max-width: 640px) {
  .mgr-tasks-card { padding: 12px; }
  .mgr-filter-seg button { font-size: 11px; padding: 8px 2px; }
  .mgr-list-toolbar.mgr-list-toolbar--portfolio {
    grid-template-columns: 1fr !important;
    padding: 12px !important;
  }
  .wb-main-body { padding: 12px 10px 24px; }
  .wb-main-body .card {
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    overflow-x: hidden;
  }
  #taskTableMount .wb-project-groups,
  #taskTableMount .wb-project-group,
  #taskTableMount .wb-proj-header {
    min-width: 0;
    max-width: 100%;
  }
  .wb-proj-header {
    grid-template-columns: 22px minmax(0, 1fr) minmax(0, auto);
    gap: 8px;
    padding: 10px;
  }
  .wb-proj-header > div:last-child {
    max-width: 4.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.mgr-filter-advanced summary {
  cursor: pointer;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: var(--primary-hover);
  min-height: var(--touch-min, 44px);
  display: flex;
  align-items: center;
}
.kpis--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 100%; }

/* ── Chat narrow: collapsible draft panel ── */
.draft-panel-collapse-btn {
  display: none;
  width: 100%;
  margin-top: 8px;
  min-height: var(--touch-min, 44px);
}
#mgrPanelReassign .form-stack {
  max-width: 100%;
  min-width: 0;
}
#mgrPanelReassign label,
#mgrPanelReassign select,
#mgrPanelReassign input,
#mgrPanelReassign textarea {
  max-width: 100%;
  box-sizing: border-box;
}
@media (max-width: 400px) {
  .mgr-filter-seg button { font-size: 10px; padding: 8px 1px; }
}

@media (max-width: 959px) {
  .wb-appbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
  }
  .wb-main {
    padding-top: var(--appbar-h);
  }
  .chat-mobile-top {
    position: sticky;
    top: 0;
    z-index: 40;
  }
  body.wb-has-rail.page-shell--chat {
    height: 100dvh;
    overflow: hidden;
  }
  body.wb-has-rail.page-shell--chat .wb-app {
    height: 100%;
    min-height: 0;
  }
  body.wb-has-rail.page-shell--chat .wb-main {
    overflow: hidden;
    height: 100%;
    flex: 1;
    min-height: 0;
  }
  body.wb-has-rail.page-shell--chat .wb-main-body {
    overflow: hidden;
    flex: 1;
    height: 100%;
    min-height: 0;
  }
  body.wb-has-rail.page-shell--chat .chat-main {
    height: 100%;
    min-height: 0;
  }
  .draft-context-panel.is-collapsed .draft-panel-body,
  .draft-context-panel.is-collapsed .draft-panel-empty-wrap {
    display: none !important;
  }
  .draft-context-panel.is-collapsed {
    max-height: none !important;
    flex: 0 0 auto !important;
  }
  .draft-panel-collapse-btn { display: none !important; }
  .btn-draft-edit-table .draft-edit-label-long { display: none; }
  .btn-draft-edit-table .draft-edit-label-short { display: inline; }
}
@media (min-width: 960px) {
  .btn-draft-edit-table .draft-edit-label-short { display: none; }
}
@media (max-width: 767px) {
  .draft-modal-overlay { padding: 0; align-items: stretch; }
  .draft-modal {
    width: 100vw;
    height: 100dvh;
    max-width: none;
    border-radius: 0;
  }
}

/* ── Unified login / landing shell ── */
.wb-login-page {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  font-family: var(--font);
  background: linear-gradient(160deg, #eef2f6 0%, #f8fafc 45%, #eff6ff 100%);
  color: var(--text);
  line-height: 1.55;
}
.wb-login-wrap {
  max-width: 440px;
  margin: 0 auto;
  padding: 32px 18px 48px;
  padding-top: max(32px, env(safe-area-inset-top));
}
.wb-login-hero {
  text-align: center;
  margin-bottom: 20px;
}
.wb-login-mark {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 800;
  box-shadow: var(--shadow-md);
}
.wb-login-hero h1 {
  margin: 0 0 6px;
  font-size: var(--text-xl, 24px);
  letter-spacing: -0.02em;
}
.wb-login-hero p {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-base, 14px);
}
.wb-login-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 20px;
}
.wb-login-card label {
  display: grid;
  gap: 6px;
  margin: 10px 0;
  font-size: var(--text-sm, 13px);
  font-weight: 500;
}
.wb-login-card input,
.wb-login-card select {
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 16px;
}
.wb-login-card .btn-primary {
  width: 100%;
  margin-top: 12px;
  min-height: var(--touch-min, 44px);
}
.wb-login-links {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.wb-login-link-card {
  display: block;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  text-decoration: none;
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.wb-login-link-card:hover {
  border-color: #93c5fd;
  background: var(--primary-soft);
  text-decoration: none;
}
.wb-login-link-card strong { display: block; margin-bottom: 2px; }
.wb-login-link-card span { font-size: var(--text-sm, 13px); color: var(--muted); }
.wb-login-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: draft-spin 0.8s linear infinite;
  margin: 12px auto;
}
`;
