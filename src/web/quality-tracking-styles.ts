export const QUALITY_TRACKING_STYLES = String.raw`
body { overflow-x: hidden; }
.wb-main, .wb-main-body, .qt-grid, .qt-card { min-width: 0; max-width: 100%; }
.qt-grid { display: grid; gap: 16px; }
.qt-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
.qt-hero, .qt-source-head, .qt-toolbar, .qt-card-head, .qt-dialog-actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.qt-hero h2, .qt-card h3 { margin: 0 0 6px; }
.qt-muted { margin: 0; color: #64748b; font-size: 13px; }
.qt-pill, .qt-status { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; }
.qt-pill { margin-bottom: 8px; background: #eef2ff; color: #3730a3; }
.qt-status { background: #f1f5f9; color: #475569; }
.qt-status.is-warn { background: #fff7ed; color: #c2410c; }
.qt-status.is-ok { background: #ecfdf5; color: #047857; }
.qt-actions, .qt-tabs, .qt-pagination { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qt-tabs > [data-quality-mode-only] { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qt-tabs > [data-quality-mode-only][hidden] { display: none; }
.qt-mode-switch { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: #f1f5f9; border: 1px solid #e2e8f0; }
.qt-mode-switch .qt-tab { border-color: transparent; padding: 7px 11px; }
.qt-mode-switch .qt-tab.is-on { background: #fff; color: #0f172a; border-color: #cbd5e1; box-shadow: 0 1px 2px rgba(15, 23, 42, .08); }
.qt-source-meta { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #f8fafc; color: #475569; font-size: 13px; }
.qt-source-meta.is-failed { background: #fff7ed; color: #9a3412; }
.qt-toolbar { margin: 16px 0 12px; align-items: center; }
.qt-search { display: flex; gap: 8px; flex: 1; max-width: 620px; min-width: 0; }
.qt-input, .qt-select, .qt-textarea { width: 100%; min-width: 0; border: 1px solid #cbd5e1; border-radius: 9px; padding: 9px 11px; font: inherit; color: #0f172a; background: #fff; }
.qt-textarea { min-height: 96px; resize: vertical; }
.qt-tab { border: 1px solid #dbe3ee; border-radius: 999px; padding: 8px 13px; background: #fff; color: #334155; cursor: pointer; font: inherit; font-weight: 650; }
.qt-tab.is-on { background: #0f172a; color: #fff; border-color: #0f172a; }
.qt-list { display: grid; gap: 10px; margin-top: 14px; }
.qt-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: start; border: 1px solid #e2e8f0; border-radius: 12px; padding: 13px; }
.qt-row-main { min-width: 0; display: grid; gap: 5px; }
.qt-row-title { color: #0f172a; font-weight: 700; overflow-wrap: anywhere; }
.qt-row-meta { color: #64748b; font-size: 12px; overflow-wrap: anywhere; }
.qt-row-desc { color: #334155; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.qt-candidate-facts { color: #1e3a8a; }
.qt-checkbox { width: 18px; height: 18px; margin-top: 3px; }
.qt-empty { border: 1px dashed #cbd5e1; border-radius: 12px; padding: 28px 14px; text-align: center; color: #64748b; }
.qt-error { border-color: #fecaca; color: #b91c1c; background: #fef2f2; }
.qt-dialog { width: min(820px, calc(100vw - 28px)); max-height: calc(100dvh - 28px); border: 0; border-radius: 16px; padding: 0; box-shadow: 0 24px 60px rgba(15,23,42,.24); }
.qt-dialog::backdrop { background: rgba(15,23,42,.48); }
.qt-dialog-body { padding: 20px; overflow: auto; max-height: calc(100dvh - 28px); }
.qt-candidate-dialog { width: min(700px, calc(100vw - 28px)); }
.qt-candidate-detail { display: grid; gap: 14px; }
.qt-candidate-detail #qualityCandidateFacts, .qt-candidate-detail #qualityCandidateSources { display: grid; gap: 8px; }
.qt-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
.qt-dialog-head h2 { margin: 0 0 4px; }
.qt-close { border: 0; background: #f1f5f9; color: #475569; border-radius: 999px; width: 34px; height: 34px; cursor: pointer; font-size: 20px; }
.qt-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.qt-field { min-width: 0; display: grid; gap: 6px; font-size: 13px; font-weight: 650; color: #334155; }
.qt-field.is-wide { grid-column: 1 / -1; }
.qt-snapshots { display: grid; gap: 10px; margin: 8px 0 16px; }
.qt-snapshot { border: 1px solid #dbeafe; background: #f8fbff; border-radius: 10px; padding: 11px; }
.qt-snapshot-title { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 7px; }
.qt-snapshot-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 12px; color: #475569; font-size: 12px; }
.qt-snapshot-grid div { min-width: 0; overflow-wrap: anywhere; }
.qt-form-feedback { min-height: 22px; margin: 10px 0; font-size: 13px; color: #b91c1c; }
.qt-page-label { color: #64748b; font-size: 12px; }
.qt-state-groups { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.qt-state-groups span { padding: 9px 8px; border-radius: 9px; background: #f8fafc; color: #475569; font-size: 12px; font-weight: 700; text-align: center; }
.qt-event-group { display: grid; gap: 10px; padding-top: 4px; }
.qt-group-title { padding-bottom: 7px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
.qt-detail { display: grid; gap: 14px; margin-top: 18px; padding-top: 18px; border-top: 1px solid #e2e8f0; }
.qt-detail-actions { display: flex; gap: 8px; flex-wrap: wrap; position: sticky; top: -20px; z-index: 2; padding: 10px 0; background: #fff; }
.qt-detail-section { min-width: 0; border: 1px solid #e2e8f0; border-radius: 12px; padding: 13px; }
.qt-detail-section h3 { margin-bottom: 10px; }
.qt-detail-text { white-space: pre-wrap; overflow-wrap: anywhere; color: #334155; font-size: 13px; line-height: 1.65; }
.qt-tree, #qualityDetailSources, #qualityRelatedEvents, #qualityEvidenceReviews, #qualityNotifications, #qualityPublicAudit { display: grid; gap: 8px; }
.qt-tree-node, .qt-mini-card, .qt-audit-row { min-width: 0; padding: 10px; border: 1px solid #e2e8f0; border-radius: 9px; background: #f8fafc; overflow-wrap: anywhere; }
.qt-audit-row { color: #475569; font-size: 12px; }
.qt-file-link { display: block; padding: 9px 10px; border-radius: 9px; background: #eff6ff; color: #1d4ed8; text-decoration: none; overflow-wrap: anywhere; }
.qt-opinion-layout { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(360px, 1.4fr); gap: 16px; align-items: start; }
.qt-opinion-layout .qt-card { display: grid; gap: 12px; }
.qt-thread-card { width: 100%; display: grid; gap: 5px; padding: 11px; text-align: left; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; cursor: pointer; }
.qt-thread-card:hover { border-color: #93c5fd; background: #f8fbff; }
.qt-opinion-group { display: grid; gap: 7px; }
.qt-opinion-group h4 { margin: 0; }
.qt-messages { min-height: 260px; max-height: 55vh; overflow: auto; display: grid; align-content: start; gap: 9px; padding: 12px; border-radius: 12px; background: #f8fafc; }
.qt-message { max-width: 82%; justify-self: start; padding: 10px 12px; border-radius: 12px 12px 12px 3px; background: #fff; border: 1px solid #e2e8f0; white-space: pre-wrap; overflow-wrap: anywhere; }
.qt-message.is-mine { justify-self: end; border-radius: 12px 12px 3px 12px; background: #eff6ff; border-color: #bfdbfe; }
.qt-message .qt-row-meta { display: block; margin-top: 5px; }
@media (max-width: 640px) {
  .qt-hero, .qt-source-head, .qt-toolbar, .qt-card-head, .qt-dialog-actions { display: grid; }
  .qt-card { padding: 14px; }
  .qt-actions .btn, .qt-dialog-actions .btn { width: 100%; }
  .qt-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qt-tab { min-width: 0; padding-inline: 7px; }
  .qt-search { max-width: none; width: 100%; }
  .qt-row { grid-template-columns: auto minmax(0, 1fr); }
  .qt-row > .qt-actions { grid-column: 1 / -1; }
  .qt-form-grid, .qt-snapshot-grid { grid-template-columns: 1fr; }
  .qt-state-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qt-opinion-layout { grid-template-columns: 1fr; }
  .qt-dialog { width: 100vw; max-height: 100dvh; height: 100dvh; border-radius: 0; }
  .qt-dialog-body { max-height: 100dvh; }
}
`;
