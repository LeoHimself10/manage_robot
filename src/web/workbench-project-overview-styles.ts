/** Shared styles: project overview cards + unified task filter (portfolio). */

export const WORKBENCH_PROJECT_OVERVIEW_CSS = `
.proj-page-toolbar {
  display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: center;
  padding: 14px 16px; margin-bottom: 4px;
  background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
  border: 1px solid var(--border, #e2e8f0); border-radius: 12px;
}
.proj-page-toolbar .proj-search {
  flex: 1; min-width: 200px; max-width: 280px;
  padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; font: inherit;
}
.proj-filter-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.proj-filter-chip {
  padding: 7px 13px; border-radius: 999px; border: 1px solid var(--border);
  background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: background .12s, border-color .12s;
}
.proj-filter-chip:hover { background: #f8fafc; }
.proj-filter-chip[aria-pressed="true"] { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
.proj-load-meta { margin: 0 0 0 auto; font-size: 12px; color: var(--muted); }

.project-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px; margin-top: 16px;
}
.project-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--border, #e2e8f0); border-radius: 14px;
  padding: 18px 18px 16px; background: #fff; cursor: pointer;
  transition: box-shadow .18s, border-color .18s, transform .12s;
}
.project-card:hover {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); transform: translateY(-1px);
}
.project-card.attn-blocked { border-color: #fca5a5; box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.12); }
.project-card.attn-needs { border-color: #fdba74; }
.project-card__head { margin-bottom: 12px; }
.project-card h3 { margin: 0 0 4px; font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; }
.project-card .desc {
  color: var(--muted, #64748b); font-size: 12px; margin: 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.project-card__progress {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 108px;
  margin-bottom: 0;
}
.project-card__progress-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.project-card__progress-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.project-card__tags-slot {
  min-height: 28px;
  display: flex;
  align-items: flex-start;
}
.project-card__tags:empty { display: none; }
.project-card__pill {
  display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; white-space: nowrap;
}
.project-card__pill.tone-blocked { background: #fef2f2; color: #991b1b; }
.project-card__pill.tone-needs { background: #ffedd5; color: #9a3412; }
.project-card__pill.tone-waiting { background: #e0e7ff; color: #3730a3; }
.project-card__pill.tone-running { background: #eff6ff; color: #1d4ed8; }
.project-card__pill.tone-done { background: #ecfdf5; color: #047857; }
.project-card__pill.tone-stopped { background: #f1f5f9; color: #475569; }
.project-card__pill.tone-idle { background: #f8fafc; color: #64748b; border: 1px dashed #cbd5e1; }
.project-card__summary { font-size: 13px; color: #334155; line-height: 1.4; }
.project-card__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.project-card__tag {
  font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px;
  background: #f1f5f9; color: #475569;
}
.project-card__bar {
  flex-shrink: 0;
  height: 6px;
  margin-top: 12px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
  display: flex;
}
.project-card__bar .seg { height: 100%; min-width: 2px; }
.project-card__bar .seg-blocked { background: #ef4444; }
.project-card__bar .seg-needs { background: #f97316; }
.project-card__bar .seg-waiting { background: #818cf8; }
.project-card__bar .seg-running { background: #3b82f6; }
.project-card__bar .seg-done { background: #10b981; }
.project-card__bar .seg-stopped { background: #94a3b8; }
.project-card__bar:empty { background: #e2e8f0; opacity: 0.45; }
.project-card__actions {
  display: flex; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid #f1f5f9;
}
.project-card__actions .btn { position: relative; z-index: 2; }
`;

export const WORKBENCH_TASKS_FILTER_UNIFIED_CSS = `
.mgr-list-toolbar.mgr-list-toolbar--portfolio {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 14px;
  padding: 16px 18px;
  background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
@media (max-width: 900px) {
  .mgr-list-toolbar.mgr-list-toolbar--portfolio { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .mgr-list-toolbar.mgr-list-toolbar--portfolio {
    grid-template-columns: 1fr;
    padding: 12px;
  }
  .mgr-list-toolbar--portfolio .wb-filter-footer {
    flex-direction: column;
    align-items: stretch;
  }
  .mgr-list-toolbar--portfolio .wb-filter-hint {
    min-width: 0;
    flex: 1 1 auto;
  }
}
.mgr-list-toolbar--portfolio label {
  display: grid; gap: 5px; font-size: 12px; font-weight: 600; color: #475569; margin: 0;
}
.mgr-list-toolbar--portfolio label input,
.mgr-list-toolbar--portfolio label select {
  padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px;
  font: inherit; width: 100%; background: #fff;
}
.mgr-list-toolbar--portfolio .wb-filter-actions {
  display: flex; gap: 8px; align-items: flex-end; justify-content: flex-end;
}
.mgr-list-toolbar--portfolio .wb-filter-footer {
  grid-column: 1 / -1;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
  padding-top: 12px; margin-top: 2px; border-top: 1px solid #f1f5f9;
}
.mgr-list-toolbar--portfolio .wb-filter-footer-lbl {
  font-size: 12px; font-weight: 600; color: #64748b;
}
.mgr-list-toolbar--portfolio .wb-filter-hint {
  font-size: 11px; color: #94a3b8; flex: 1; min-width: 160px;
}
.mgr-list-toolbar--portfolio .wb-tasks-view-mode { margin-left: 0; }
`;
