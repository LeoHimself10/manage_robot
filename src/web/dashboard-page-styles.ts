export const DASHBOARD_PAGE_CSS = `
.app-shell--dashboard { max-width: 100%; overflow-x: clip; }
.dashboard-stack { display: grid; gap: 14px; max-width: 100%; min-width: 0; }
.dashboard-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.dashboard-main { display: grid; gap: 14px; min-width: 0; }
.dashboard-side {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}
.dash-filter-card { padding: 16px; min-width: 0; overflow: hidden; }
.dash-filter-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
  align-items: end;
}
.dash-filter-block { display: grid; gap: 6px; min-width: 0; }
.dash-filter-lbl {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  letter-spacing: 0.02em;
}
.dash-week-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 36px;
  gap: 6px;
  align-items: center;
}
.dash-week-arrow {
  min-width: 36px;
  width: 36px;
  height: 36px;
  padding: 0 !important;
  display: grid;
  place-items: center;
  font-size: 18px;
}
.dash-date-input,
.dash-select {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  line-height: 1.3;
  -webkit-appearance: none;
  appearance: none;
}
.dash-date-input { min-height: 42px; }
.dash-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 34px;
}
.dash-week-chips {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 4px;
}
.dash-week-chip {
  border: 1px solid var(--border);
  background: #f8fafc;
  border-radius: 999px;
  padding: 8px 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  min-height: 36px;
}
.dash-week-chip.is-on,
.week-chip.is-on {
  background: var(--primary-soft);
  border-color: #93c5fd;
  color: var(--primary-hover);
}
.dash-filter-block--action { display: flex; align-items: end; }
.dash-refresh-btn { width: 100%; min-height: 42px; }
.dash-range-meta { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid #f1f5f9; }
@media (min-width: 720px) {
  .dash-filter-grid { grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr) minmax(0, 0.9fr) auto; }
  .dash-filter-block--week { grid-column: 1 / -1; }
  .dash-refresh-btn { width: auto; min-width: 96px; }
}
@media (max-width: 719px) {
  .dash-filter-block--week { grid-column: 1 / -1; }
}
.dash-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; justify-content: space-between; }
.dash-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.dash-controls label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
.dash-controls input, .dash-controls select { min-width: 0; max-width: 100%; }
.week-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
.week-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.dash-project-filter select { min-width: 0; }
.section-head {
  display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; justify-content: space-between;
  margin-bottom: 10px;
}
.section-head h2 { margin: 0; font-size: 17px; }
.section-sub { margin: 0; color: var(--muted); font-size: 12px; }
.kpis.kpis--6 { grid-template-columns: repeat(6, minmax(0, 1fr)); margin-bottom: 0; }
@media (max-width: 1180px) { .kpis.kpis--6 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .kpis.kpis--6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.kpi.danger .val { color: var(--danger); }
.kpi.warn .val { color: #d97706; }
.kpi.ok .val { color: #16a34a; }
.timeline-wrap {
  overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: #fff;
}
.gantt-table { min-width: 860px; }
.gantt-head, .gantt-row { display: grid; grid-template-columns: minmax(148px, 196px) minmax(560px, 1fr); }
.gantt-head { position: sticky; top: 0; z-index: 2; background: #f8fafc; border-bottom: 1px solid var(--border); }
.gantt-head .gantt-label { padding: 10px 12px; font-size: 12px; font-weight: 700; border-right: 1px solid var(--border); }
.gantt-days { display: grid; grid-template-columns: repeat(var(--day-count), minmax(28px, 1fr)); }
.gantt-day-h {
  padding: 6px 2px; text-align: center; font-size: 11px; border-right: 1px solid #eef2f7;
}
.gantt-day-h.is-center-week { background: #eff6ff; color: #1d4ed8; font-weight: 700; }
.gantt-day-h.is-weekend { opacity: 0.65; }
.gantt-row { border-bottom: 1px solid #eef2f7; min-height: 40px; align-items: stretch; }
.gantt-row:last-child { border-bottom: 0; }
.gantt-group-head {
  background: linear-gradient(180deg, #fafbfc, #f8fafc); cursor: pointer; user-select: none;
}
.gantt-group-head:hover { background: #f1f5f9; }
.gantt-group-head .gantt-label {
  flex-direction: row; align-items: center; gap: 8px; justify-content: flex-start;
}
.gantt-group-head.is-collapsed .gantt-chev { transform: rotate(-90deg); }
.gantt-chev {
  width: 18px; height: 18px; display: grid; place-items: center; font-size: 11px; color: var(--muted);
  flex-shrink: 0; transition: transform .15s;
}
.gantt-group-title { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.gantt-group-title strong { font-size: 13px; font-weight: 700; }
.gantt-group-summary {
  display: flex; align-items: center; padding: 0 8px; color: var(--muted); font-size: 11px;
}
.gantt-sub-row .gantt-label {
  padding-left: 28px; flex-direction: column; align-items: stretch; gap: 2px; justify-content: center;
}
.gantt-sub-title { min-width: 0; width: 100%; display: flex; flex-direction: column; gap: 2px; }
.gantt-sub-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.gantt-sub-title strong::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  margin-right: 6px;
  vertical-align: middle;
  background: #2563eb;
}
.gantt-sub-row .gantt-label[data-status="BLOCKED"] .gantt-sub-title strong::before { background: #dc2626; }
.gantt-sub-row .gantt-label[data-status="DONE"] .gantt-sub-title strong::before { background: #16a34a; }
.gantt-sub-row .gantt-label[data-status="ASSIGNED"] .gantt-sub-title strong::before,
.gantt-sub-row .gantt-label[data-status="CHANGES_REQUESTED"] .gantt-sub-title strong::before { background: #d97706; }
.gantt-sub-row .gantt-label[data-status="REJECTED"] .gantt-sub-title strong::before { background: #7c3aed; }
.gantt-sub-row .gantt-label[data-status="IN_PROGRESS"] .gantt-sub-title strong::before { background: #2563eb; }
.gantt-label {
  padding: 10px 12px; border-right: 1px solid var(--border); font-size: 12px; font-weight: 650;
  display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;
}
.gantt-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-label small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-track-wrap { position: relative; padding: 26px 4px 6px; overflow: visible; }
.gantt-track {
  position: relative; height: 24px; overflow: visible;
  display: grid; grid-template-columns: repeat(var(--day-count), minmax(28px, 1fr)); gap: 2px;
}
.gantt-cell { background: #f8fafc; border-radius: 3px; min-height: 24px; }
.gantt-cell.is-center-week { background: #eff6ff; }
.gantt-cell.is-weekend { opacity: 0.72; }
.gantt-bar {
  position: absolute; top: 3px; height: 18px; border-radius: 4px;
  font-size: 10px; font-weight: 700; color: #fff; padding: 0 6px;
  display: flex; align-items: center; overflow: hidden; white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15,23,42,.12);
  min-width: 6px;
}
.gantt-bar--compact {
  padding: 0;
  color: transparent;
  min-width: 4px;
}
.gantt-bar--compact::after {
  content: "";
  position: absolute;
  inset: 3px 2px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.35);
}
.gantt-bar.status-IN_PROGRESS { background: #2563eb; }
.gantt-bar.status-BLOCKED { background: #dc2626; }
.gantt-bar.status-DONE { background: #16a34a; }
.gantt-bar.status-ASSIGNED, .gantt-bar.status-CHANGES_REQUESTED { background: #d97706; }
.gantt-bar.status-REJECTED { background: #7c3aed; }
.gantt-due-marker {
  position: absolute; top: 0; bottom: 0; width: 0; z-index: 5; pointer-events: none;
  border-left: 3px solid #6d28d9;
  filter: drop-shadow(0 0 2px rgba(109, 40, 217, 0.55));
}
.gantt-due-marker::before {
  content: ""; position: absolute; top: 0; left: -6px;
  border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-top: 7px solid #6d28d9;
}
.gantt-due-marker::after {
  content: attr(data-label); position: absolute; top: -24px; left: 50%; transform: translateX(-50%);
  padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; line-height: 1.2;
  color: #fff; background: #6d28d9; border: 1px solid #5b21b6; white-space: nowrap;
  box-shadow: 0 2px 6px rgba(109, 40, 217, 0.38);
}
.gantt-density {
  display: inline-flex; padding: 3px; background: #f1f5f9; border: 1px solid var(--border); border-radius: 8px;
}
.gantt-density button {
  border: 0; background: transparent; padding: 6px 10px; border-radius: 6px; font-size: 12px;
  font-weight: 600; cursor: pointer; color: var(--muted); font-family: inherit;
}
.gantt-density button.is-on { background: #fff; color: var(--primary); box-shadow: 0 1px 2px rgba(15,23,42,.08); }
.gantt-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; font-size: 12px; color: var(--muted); }
.gantt-legend i {
  display: inline-block; width: 18px; height: 8px; border-radius: 3px; margin-right: 4px; vertical-align: middle;
}
.gantt-legend i.bar-inprogress { background: #2563eb; }
.gantt-legend i.bar-blocked { background: #dc2626; }
.gantt-legend i.bar-done { background: #16a34a; }
.gantt-legend i.bar-waiting { background: #d97706; }
.gantt-legend i.bar-due { width: 3px; height: 12px; border-radius: 1px; background: #6d28d9; }
.detail-panel[hidden] { display: none; }
.person-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.person-card { border: 1px solid var(--border); border-radius: 10px; padding: 14px; background: #fff; }
.person-card__head h3 { margin: 0 0 8px; font-size: 15px; }
.person-card__stats { display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.person-card__stats strong { color: var(--text); }
.person-card__due { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.due-chip {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  background: #dbeafe; color: #1d4ed8; font-size: 11px; font-weight: 600;
}
.person-card__subs { margin: 0; padding-left: 18px; font-size: 12px; display: grid; gap: 4px; }
.feed-list { display: grid; gap: 8px; }
.feed-item { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: #fff; }
.feed-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; align-items: center; }
.advisor-card { padding: 0; overflow: hidden; }
.advisor-card__head {
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, #fff, #f8fafc);
}
.advisor-card__head h2 { margin: 0 0 4px; font-size: 16px; }
.advisor-card__body { padding: 14px 16px 16px; display: grid; gap: 12px; }
.advisor-empty {
  border: 1px dashed #cbd5e1; border-radius: 10px; padding: 18px 14px; color: var(--muted);
  font-size: 13px; text-align: center; background: #fafbfc;
}
.advisor-sections { display: grid; gap: 10px; }
.advisor-section {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 12px 12px 14px;
  background: #fff; border-left-width: 4px;
}
.advisor-section--high { border-left-color: #dc2626; }
.advisor-section--mid { border-left-color: #2563eb; }
.advisor-section--low { border-left-color: #94a3b8; }
.advisor-section h3 { margin: 0 0 8px; font-size: 14px; }
.advisor-section ul { margin: 0; padding-left: 18px; font-size: 13px; }
.advisor-meta { font-size: 12px; color: var(--muted); min-height: 1.2em; }
.advisor-meta--warn { color: #d97706; font-weight: 600; }
.dashboard-note { color: var(--muted); font-size: 12px; margin: 0; }
.gantt-section-tools {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end;
}
.advisor-trigger-btn {
  display: none; align-items: center; gap: 6px; padding: 7px 12px;
  border: 1px solid #93c5fd; border-radius: 8px; background: #eff6ff;
  color: #1d4ed8; font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.advisor-trigger-btn:hover { border-color: #60a5fa; background: #dbeafe; }
.advisor-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 200;
  opacity: 0; pointer-events: none; transition: opacity 0.2s;
}
.advisor-drawer-backdrop.is-open { opacity: 1; pointer-events: auto; }
.advisor-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 92vw);
  background: #fff; z-index: 201; box-shadow: -8px 0 32px rgba(15, 23, 42, 0.15);
  transform: translateX(100%); transition: transform 0.25s ease;
  display: flex; flex-direction: column; overflow: hidden;
}
.advisor-drawer.is-open { transform: translateX(0); }
.advisor-drawer__head {
  padding: 16px 18px; border-bottom: 1px solid var(--border);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  flex-shrink: 0;
}
.advisor-drawer__head h2 { margin: 0; font-size: 16px; }
.advisor-drawer__close {
  border: 0; background: #f1f5f9; width: 32px; height: 32px; border-radius: 8px;
  font-size: 18px; line-height: 1; cursor: pointer; color: var(--muted); flex-shrink: 0;
}
.advisor-drawer__body { padding: 14px 16px 16px; overflow-y: auto; flex: 1; min-height: 0; }
.advisor-drawer__body .advisor-card { border: 0; box-shadow: none; padding: 0; }
@media (max-width: 1279px) {
  .dashboard-body { grid-template-columns: 1fr; }
  .dashboard-side { display: none; }
  .advisor-trigger-btn { display: inline-flex; }
}
@media (max-width: 640px) {
  .advisor-drawer {
    top: auto; left: 0; right: 0; bottom: 0; width: 100%; max-height: 88vh;
    border-radius: 16px 16px 0 0; transform: translateY(100%);
  }
  .advisor-drawer.is-open { transform: translateY(0); }
}
`;
