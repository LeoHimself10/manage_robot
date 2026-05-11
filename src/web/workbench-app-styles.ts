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
.brand { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); text-transform: uppercase; }
.page-title { margin: 4px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.page-desc { margin: 6px 0 0; font-size: 14px; color: var(--muted); max-width: 560px; }
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
.badge.blocked { background: #fef3c7; color: #92400e; }
.badge.assigned { background: #e0e7ff; color: #3730a3; }
.badge.pending { background: #fce7f3; color: #9d174d; }
.badge.progress { background: #dbeafe; color: #1e40af; }
.badge.done { background: #d1fae5; color: #065f46; }
.badge.rejected { background: #fee2e2; color: #991b1b; }
.empty-state {
  padding: 36px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: #fafbfc;
}
.split-chat {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 16px;
  min-height: 520px;
}
@media (max-width: 860px) {
  .split-chat { grid-template-columns: 1fr; min-height: auto; }
}
.thread-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 480px;
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
.msg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}
.msg-list li {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 13px;
  background: #fff;
}
.msg-list li strong { display: block; margin-bottom: 4px; font-size: 12px; color: var(--muted); text-transform: capitalize; }
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
