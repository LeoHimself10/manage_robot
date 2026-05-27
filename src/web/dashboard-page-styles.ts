export const DASHBOARD_PAGE_CSS = `
.app-shell--dashboard { max-width: 1320px; }
.dashboard-stack { display: grid; gap: 14px; }
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
.dash-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; justify-content: space-between; }
.dash-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.dash-controls label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
.dash-controls input, .dash-controls select { min-width: 120px; }
.week-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
.week-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.dash-project-filter select { min-width: 160px; }
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
.gantt-head, .gantt-row { display: grid; grid-template-columns: 280px minmax(520px, 1fr); }
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
.gantt-group-badges { display: flex; flex-wrap: wrap; gap: 4px; flex-shrink: 0; }
.gantt-group-summary {
  display: flex; align-items: center; padding: 0 8px; color: var(--muted); font-size: 11px;
}
.gantt-sub-row .gantt-label {
  padding-left: 36px; flex-direction: row; align-items: center; gap: 8px; justify-content: flex-start;
}
.gantt-sub-title { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.gantt-label {
  padding: 10px 12px; border-right: 1px solid var(--border); font-size: 12px; font-weight: 650;
  display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;
}
.gantt-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-label small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-track-wrap { position: relative; padding: 22px 4px 6px; }
.gantt-track {
  position: relative; height: 24px;
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
}
.gantt-bar.status-IN_PROGRESS { background: #2563eb; }
.gantt-bar.status-BLOCKED { background: #dc2626; }
.gantt-bar.status-DONE { background: #16a34a; }
.gantt-bar.status-ASSIGNED, .gantt-bar.status-CHANGES_REQUESTED { background: #d97706; }
.gantt-bar.status-REJECTED { background: #7c3aed; }
.gantt-due-marker {
  position: absolute; top: 4px; bottom: 4px; width: 0; z-index: 3; pointer-events: none;
  border-left: 2px solid #7c3aed;
}
.gantt-due-marker::before {
  content: ""; position: absolute; top: 0; left: -5px;
  border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-top: 6px solid #7c3aed;
}
.gantt-due-marker::after {
  content: attr(data-label); position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
  padding: 2px 7px; border-radius: 6px; font-size: 10px; font-weight: 700; line-height: 1.2;
  color: #5b21b6; background: #ede9fe; border: 1px solid #c4b5fd; white-space: nowrap;
}
.gantt-due-marker.is-overdue { border-left-color: #dc2626; }
.gantt-due-marker.is-overdue::before { border-top-color: #dc2626; }
.gantt-due-marker.is-overdue::after { color: #991b1b; background: #fee2e2; border-color: #fca5a5; }
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
.gantt-legend i.bar-due { width: 3px; height: 10px; border-radius: 1px; background: #7c3aed; }
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
