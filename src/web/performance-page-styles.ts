/** 交付绩效看板样式 — 与工作台 design tokens 对齐（DM Sans、card、slate/blue），精炼数据分析风格。 */
export const PERFORMANCE_PAGE_CSS = `
.app-shell--performance { max-width: 100%; overflow-x: clip; }
.perf-stack {
  display: grid;
  gap: 16px;
  max-width: 100%;
  min-width: 0;
  --perf-accent: #4f46e5;
}

/* ---------- KPI ---------- */
.perf-kpi-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 760px) {
  .perf-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.perf-kpi {
  position: relative;
  padding: 16px 16px 15px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  isolation: isolate;
}
.perf-kpi::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--perf-accent);
  opacity: 0.9;
}
.perf-kpi::after {
  content: "";
  position: absolute;
  right: -28px;
  top: -28px;
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--perf-accent) 14%, transparent), transparent 70%);
  z-index: -1;
}
.perf-kpi.is-primary { --perf-accent: #2563eb; }
.perf-kpi.is-warn { --perf-accent: #d97706; }
.perf-kpi.is-danger { --perf-accent: #dc2626; }
.perf-kpi.is-accent { --perf-accent: #4f46e5; }
.perf-kpi-lbl { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.01em; }
.perf-kpi-val {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  color: var(--text);
}
.perf-kpi.is-warn .perf-kpi-val { color: var(--warn); }
.perf-kpi.is-danger .perf-kpi-val { color: var(--danger); }
.perf-kpi-sub { margin-top: 5px; font-size: 11px; color: var(--muted); }

/* ---------- toolbar ---------- */
.perf-toolbar-card { padding: 16px; min-width: 0; }
.perf-toolbar-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px 18px;
}
.perf-seg-block { display: grid; gap: 7px; }
.perf-filter-lbl { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; }
.perf-segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: #f1f5f9;
  border-radius: 999px;
  border: 1px solid var(--border);
}
.perf-segmented button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 13px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease;
}
.perf-segmented button:hover { color: var(--text); }
.perf-segmented button.is-on {
  background: var(--surface);
  color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}
.perf-filter-block { display: grid; gap: 7px; min-width: 0; }
.perf-filter-block.is-grow { flex: 1 1 200px; min-width: 160px; }
.perf-filter-block .dash-select { min-width: 150px; }
.perf-toolbar-spacer { flex: 1 1 auto; }
.perf-meta {
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  font-size: 12px;
  color: var(--muted);
}

/* ---------- table ---------- */
.perf-table-wrap { overflow-x: auto; margin-top: 14px; border-radius: var(--radius-sm); }
table.perf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
table.perf-table th,
table.perf-table td {
  padding: 11px 12px;
  border-bottom: 1px solid var(--border);
  text-align: right;
  white-space: nowrap;
}
table.perf-table thead th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 700;
  color: #475569;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  z-index: 2;
}
table.perf-table th:first-child,
table.perf-table td:first-child {
  text-align: left;
  position: sticky;
  left: 0;
  background: var(--surface);
  z-index: 1;
}
table.perf-table thead th:first-child { z-index: 3; background: #f8fafc; }
table.perf-table tbody tr { cursor: pointer; transition: background .12s ease; }
table.perf-table tbody tr:hover { background: #f8fafc; }
table.perf-table tbody tr:hover td:first-child { background: #f8fafc; }
table.perf-table tbody tr.is-active td { background: var(--primary-soft); }
table.perf-table tbody tr.is-active td:first-child { background: var(--primary-soft); box-shadow: inset 3px 0 0 var(--primary); }
.perf-name-cell { display: flex; flex-direction: column; gap: 3px; }
.perf-name-main { font-weight: 650; color: var(--text); display: flex; align-items: center; gap: 7px; }
.perf-name-sub { font-size: 11px; color: var(--muted); }
.perf-rate { font-weight: 700; font-size: 14px; }
.perf-rate.is-high { color: var(--danger); }
.perf-rate.is-mid { color: var(--warn); }
.perf-rate.is-low { color: var(--success); }
.perf-rate.is-muted { color: var(--muted); font-weight: 600; font-size: 13px; }
.perf-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #f1f5f9;
  color: #64748b;
}
.perf-badge.warn { background: #fef3c7; color: #92400e; }
.perf-badge.info { background: var(--primary-soft); color: var(--primary-hover); }
.perf-badge.muted { background: #f8fafc; color: #94a3b8; }
.perf-empty { padding: 40px 16px; text-align: center; color: var(--muted); font-size: 14px; }

/* ---------- detail panel ---------- */
.perf-detail {
  display: none;
  scroll-margin-top: 12px;
}
.perf-detail.is-open { display: block; }
.perf-detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.perf-detail-id { display: flex; align-items: center; gap: 12px; min-width: 0; }
.perf-detail-avatar {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 12px;
  display: grid; place-items: center;
  font-weight: 700; font-size: 16px; color: #fff;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
}
.perf-detail-title { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
.perf-detail-meta { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.perf-detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.perf-detail-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.perf-mini-kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
@media (min-width: 640px) { .perf-mini-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 960px) { .perf-mini-kpis { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.perf-mini {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fbfdff;
}
.perf-mini-lbl { font-size: 11px; color: var(--muted); font-weight: 600; }
.perf-mini-val { margin-top: 4px; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.perf-chart-row {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
  margin-bottom: 16px;
}
@media (min-width: 720px) { .perf-chart-row { grid-template-columns: minmax(0, 260px) minmax(0, 1fr); } }
.perf-chart-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.perf-chart-card h3 { margin: 0 0 12px; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
.perf-stack-summary { margin-bottom: 14px; }
.perf-stack-list { display: grid; gap: 12px; }
.perf-stack-row { display: grid; gap: 6px; }
.perf-stack-row.is-total .perf-stack-label span:first-child { font-weight: 700; color: var(--text); }
.perf-stack-label { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--text); }
.perf-stack-label .muted { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.perf-stack-track {
  display: flex;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: #eef2f7;
}
.perf-stack-track.is-empty { align-items: center; justify-content: center; min-height: 12px; }
.perf-stack-empty { font-size: 11px; color: var(--muted); padding: 0 8px; }
.perf-stack-seg { display: block; height: 100%; min-width: 0; }
.perf-stack-seg.is-on-time { background: #059669; }
.perf-stack-seg.is-late { background: #d97706; }
.perf-stack-seg.is-pending { background: #2563eb; }
.perf-stack-seg.is-overdue { background: #dc2626; }
.perf-stack-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted);
}
.perf-stack-legend-item { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.perf-stack-legend-item i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  font-style: normal;
}
.perf-stack-legend-item.is-on-time i { background: #059669; }
.perf-stack-legend-item.is-late i { background: #d97706; }
.perf-stack-legend-item.is-pending i { background: #2563eb; }
.perf-stack-legend-item.is-overdue i { background: #dc2626; }
.perf-accordion-card { padding: 0; overflow: hidden; }
.perf-accordion-toggle,
.perf-task-head {
  width: 100%;
  padding: 14px 16px;
  border: 0;
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--text);
}
.perf-accordion-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}
.perf-accordion-toggle:hover,
.perf-task-head:hover { background: #f8fafc; }
.perf-accordion-chevron {
  margin-left: auto;
  color: var(--muted);
  transition: transform .15s ease;
  flex-shrink: 0;
}
.perf-accordion-toggle[aria-expanded="true"] .perf-accordion-chevron,
.perf-task-head[aria-expanded="true"] .perf-accordion-chevron { transform: rotate(90deg); }
.perf-accordion-body { padding: 0 16px 16px; border-top: 1px solid var(--border); }
.perf-task-group { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.perf-task-group + .perf-task-group { margin-top: 10px; }
.perf-task-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "main chev" "sub sub";
  align-items: center;
  gap: 2px 10px;
  border-bottom: 1px solid transparent;
}
.perf-task-head[aria-expanded="true"] { border-bottom-color: var(--border); }
.perf-task-head-main { grid-area: main; font-size: 13px; font-weight: 600; }
.perf-task-head-sub { grid-area: sub; font-size: 11px; color: var(--muted); text-align: left; font-variant-numeric: tabular-nums; }
.perf-task-head .perf-accordion-chevron { grid-area: chev; margin-left: 0; }
.perf-task-body { padding: 0 12px 12px; background: #fbfdff; }
.perf-donut-wrap { display: flex; align-items: center; gap: 16px; }
.perf-donut {
  width: 96px; height: 96px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
  background: #f1f5f9;
}
.perf-donut-hole {
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background: var(--surface);
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--border);
}
.perf-legend { display: grid; gap: 8px; font-size: 12px; color: var(--text); }
.perf-legend-row { display: flex; align-items: center; gap: 8px; }
.perf-legend-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
.perf-bar-list { display: grid; gap: 11px; }
.perf-bar-row { display: grid; gap: 5px; }
.perf-bar-label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text); }
.perf-bar-label .muted { color: var(--muted); font-variant-numeric: tabular-nums; }
.perf-bar-track { height: 9px; background: #eef2f7; border-radius: 999px; overflow: hidden; }
.perf-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2563eb, #60a5fa); transition: width .4s ease; }
.perf-bar-fill.is-warn { background: linear-gradient(90deg, #d97706, #fbbf24); }
.perf-bar-fill.is-danger { background: linear-gradient(90deg, #dc2626, #f87171); }
.perf-bar-fill.is-ok { background: linear-gradient(90deg, #059669, #34d399); }
.perf-subtable-wrap { overflow-x: auto; }
.perf-subtable-wrap.is-scroll { max-height: 320px; overflow-y: auto; }
.perf-task-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.perf-task-table th, .perf-task-table td { padding: 9px 10px; border-bottom: 1px solid #f1f5f9; text-align: left; white-space: nowrap; }
.perf-task-table thead th { position: sticky; top: 0; background: #f8fafc; color: var(--muted); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.02em; }
.perf-task-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.perf-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.perf-pill.late { background: #fef2f2; color: var(--danger); }
.perf-pill.overdue { background: #fef2f2; color: #b91c1c; }
.perf-pill.ok { background: #ecfdf5; color: var(--success); }
.perf-pill.pending { background: #eff6ff; color: #1d4ed8; }
.perf-pill.stopped { background: #f1f5f9; color: var(--muted); }

/* ---------- chat (conversational best-practice) ---------- */
.perf-chat-card { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.perf-chat-head {
  display: flex; align-items: center; gap: 11px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, #fbfdff, var(--surface));
}
.perf-chat-head-avatar {
  width: 34px; height: 34px; border-radius: 10px;
  display: grid; place-items: center; flex-shrink: 0;
  color: #fff; font-size: 13px; font-weight: 700;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
  box-shadow: 0 4px 10px rgba(37,99,235,.28);
}
.perf-chat-head h2 { margin: 0; font-size: 15px; font-weight: 700; }
.perf-chat-head p { margin: 2px 0 0; font-size: 11px; color: var(--muted); }
.perf-chat-status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--success); font-weight: 600; }
.perf-chat-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px rgba(5,150,105,.16); }
.perf-chat-log {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  min-height: 140px;
  max-height: 440px;
  overflow-y: auto;
  scroll-behavior: smooth;
}
.perf-chat-empty { margin: auto; text-align: center; color: var(--muted); padding: 8px; }
.perf-chat-empty p { margin: 0 0 12px; font-size: 13px; }
.perf-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.perf-chip {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit; font-size: 12px;
  padding: 7px 13px;
  border-radius: 999px;
  cursor: pointer;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.perf-chip:hover { border-color: var(--primary); color: var(--primary-hover); background: var(--primary-soft); }
.perf-msg-row { display: flex; gap: 10px; align-items: flex-end; max-width: 100%; }
.perf-msg-row.is-user { flex-direction: row-reverse; }
.perf-avatar {
  width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
  display: grid; place-items: center; font-size: 11px; font-weight: 700;
}
.perf-avatar.is-bot { color: #fff; background: linear-gradient(135deg, #4f46e5, #2563eb); }
.perf-avatar.is-user { color: var(--muted); background: #e2e8f0; }
.perf-bubble {
  position: relative;
  padding: 11px 14px;
  border-radius: 16px;
  max-width: min(76%, 560px);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: var(--shadow-sm);
}
.perf-msg-row.is-bot .perf-bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-bottom-left-radius: 5px;
}
.perf-msg-row.is-user .perf-bubble {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #fff;
  border-bottom-right-radius: 5px;
}
.perf-bubble strong { font-weight: 700; }
.perf-bubble .msg-md-table-wrap {
  margin: 8px 0;
  overflow-x: auto;
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.perf-bubble .msg-md-table {
  width: max-content;
  min-width: min(100%, 480px);
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}
.perf-bubble .msg-md-table th,
.perf-bubble .msg-md-table td {
  padding: 7px 9px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
  min-width: 64px;
  white-space: normal;
  word-break: break-word;
}
.perf-bubble .msg-md-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  font-size: 11px;
}
.perf-bubble .msg-md-table tr:last-child td { border-bottom: none; }
.perf-bubble .msg-md-p { margin: 0 0 8px; }
.perf-bubble .msg-md-p:last-child { margin-bottom: 0; }
.perf-bubble .msg-md-ul, .perf-bubble .msg-md-ol { margin: 6px 0; padding-left: 1.25rem; }
.perf-bubble .msg-md-li { margin: 3px 0; }
.perf-bubble .msg-md-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 4px;
}
.perf-bubble .msg-md-pre {
  margin: 8px 0;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 12px;
}
.perf-bubble .msg-md-h { margin: 10px 0 6px; font-size: 13px; font-weight: 700; }
.perf-bubble .msg-md-h:first-child { margin-top: 0; }
.perf-bubble .perf-stream-cursor { display:inline-block; width:7px; height:14px; margin-left:1px; vertical-align:-2px; background: var(--primary); border-radius:1px; animation: perfBlink 1s steps(2) infinite; }
@keyframes perfBlink { 0%,50%{opacity:1;} 50.01%,100%{opacity:0;} }
.perf-dots { display: inline-flex; gap: 4px; padding: 2px 0; }
.perf-dots i { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; animation: perfBounce 1.2s infinite ease-in-out; }
.perf-dots i:nth-child(2) { animation-delay: .15s; }
.perf-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes perfBounce { 0%,80%,100%{ transform: translateY(0); opacity:.5; } 40%{ transform: translateY(-5px); opacity:1; } }
.perf-composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  background: #fbfdff;
}
.perf-composer textarea {
  flex: 1;
  resize: none;
  min-height: 24px;
  max-height: 140px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.5;
  background: var(--surface);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.perf-composer textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,.14); }
.perf-send {
  appearance: none; border: 0;
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  display: grid; place-items: center;
  transition: background .15s ease, transform .12s ease;
}
.perf-send:hover:not(:disabled) { background: var(--primary-hover); }
.perf-send:active:not(:disabled) { transform: scale(.94); }
.perf-send:disabled { opacity: .5; cursor: not-allowed; }
.perf-send svg { width: 18px; height: 18px; }

/* ---------- mobile ---------- */
@media (max-width: 600px) {
  .perf-stack { gap: 12px; }
  .perf-kpi-val { font-size: 24px; }
  .perf-toolbar-top { gap: 12px; }
  .perf-filter-block.is-grow, .perf-filter-block { flex: 1 1 100%; width: 100%; }
  .perf-filter-block .dash-select { width: 100%; }
  .perf-segmented { width: 100%; justify-content: space-between; }
  .perf-segmented button { flex: 1; padding: 7px 4px; }
  .perf-chat-log { max-height: 60vh; padding: 14px; }
  .perf-bubble { max-width: 82%; }
  .perf-detail-actions { width: 100%; }
  .perf-detail-actions .btn { flex: 1; }
}
`;
