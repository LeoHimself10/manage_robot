/** 交付绩效看板样式 — 与周度 Dashboard / 工作台 design tokens 对齐（DM Sans、card、dash-*）。 */
export const PERFORMANCE_PAGE_CSS = `
.app-shell--performance { max-width: 100%; overflow-x: clip; }
.perf-stack { display: grid; gap: 14px; max-width: 100%; min-width: 0; }
.perf-kpi-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 720px) {
  .perf-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.perf-kpi {
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  box-shadow: var(--shadow-sm);
}
.perf-kpi-lbl { font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.02em; }
.perf-kpi-val {
  margin-top: 6px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.perf-kpi-val.is-warn { color: var(--warn); }
.perf-kpi-val.is-danger { color: var(--danger); }
.perf-kpi-val.is-ok { color: var(--success); }
.perf-kpi-sub { margin-top: 4px; font-size: 11px; color: var(--muted); }
.perf-toolbar-card { padding: 16px; min-width: 0; }
.perf-filter-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
  align-items: end;
}
@media (min-width: 720px) {
  .perf-filter-grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 0.9fr) auto; }
}
.perf-filter-block { display: grid; gap: 6px; min-width: 0; }
.perf-filter-lbl { font-size: 12px; font-weight: 600; color: #475569; letter-spacing: 0.02em; }
.perf-meta {
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
  font-size: 12px;
  color: var(--muted);
}
.perf-table-wrap { overflow-x: auto; margin-top: 12px; }
table.perf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
table.perf-table th,
table.perf-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  text-align: right;
  white-space: nowrap;
}
table.perf-table th:first-child,
table.perf-table td:first-child {
  text-align: left;
  position: sticky;
  left: 0;
  background: var(--surface);
  z-index: 1;
}
table.perf-table th { font-weight: 600; color: #475569; font-size: 12px; }
table.perf-table tbody tr { cursor: pointer; transition: background 0.12s ease; }
table.perf-table tbody tr:hover { background: #f8fafc; }
table.perf-table tbody tr.is-active { background: var(--primary-soft); }
.perf-name-cell { display: flex; flex-direction: column; gap: 2px; }
.perf-name-main { font-weight: 600; color: var(--text); }
.perf-name-sub { font-size: 11px; color: var(--muted); }
.perf-rate { font-weight: 700; }
.perf-rate.is-high { color: var(--danger); }
.perf-rate.is-mid { color: var(--warn); }
.perf-rate.is-low { color: var(--success); }
.perf-rate.is-muted { color: var(--muted); font-weight: 500; }
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
.perf-empty { padding: 32px 16px; text-align: center; color: var(--muted); font-size: 14px; }
.perf-detail {
  display: none;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
  align-items: start;
}
.perf-detail.is-open { display: grid; }
@media (max-width: 960px) {
  .perf-detail.is-open { grid-template-columns: 1fr; }
}
.perf-detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.perf-detail-title { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
.perf-detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.perf-chart-row {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin-bottom: 14px;
}
.perf-chart-card {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
}
.perf-chart-card h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #475569; }
.perf-donut-wrap { display: flex; align-items: center; gap: 14px; }
.perf-donut {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.perf-donut-hole {
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: #fff;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
}
.perf-legend { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
.perf-legend-row { display: flex; align-items: center; gap: 8px; }
.perf-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.perf-bar-list { display: grid; gap: 8px; }
.perf-bar-row { display: grid; gap: 4px; }
.perf-bar-label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.perf-bar-track { height: 8px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
.perf-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #2563eb, #60a5fa); }
.perf-bar-fill.is-warn { background: linear-gradient(90deg, #d97706, #fbbf24); }
.perf-bar-fill.is-danger { background: linear-gradient(90deg, #dc2626, #f87171); }
.perf-task-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.perf-task-table th, .perf-task-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; text-align: left; }
.perf-task-table th { color: var(--muted); font-weight: 600; }
.perf-task-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.perf-tag-late { color: var(--danger); font-weight: 600; }
.perf-tag-ok { color: var(--success); font-weight: 600; }
.perf-tag-pending { color: var(--warn); font-weight: 600; }
.perf-chat-card { padding: 16px; }
.perf-chat-card h2 { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.perf-chat-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}
.perf-msg {
  padding: 10px 12px;
  border-radius: 12px;
  max-width: 92%;
  white-space: pre-wrap;
  font-size: var(--text-sm);
  line-height: 1.55;
}
.perf-msg.user { align-self: flex-end; background: var(--primary); color: #fff; }
.perf-msg.bot { align-self: flex-start; background: #f1f5f9; color: var(--text); }
.perf-chat-row { display: flex; gap: 8px; margin-top: 10px; }
.perf-chat-row textarea {
  flex: 1;
  resize: vertical;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
}
`;
