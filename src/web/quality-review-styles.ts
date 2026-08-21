export const QUALITY_REVIEW_STYLES = String.raw`
body { overflow-x: hidden; }
.qr-page { display: grid; gap: 14px; min-width: 0; }
.qr-topbar, .qr-scopebar, .qr-filterbar, .qr-actions, .qr-section-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.qr-topbar { justify-content: space-between; padding: 16px 18px; border: 1px solid #dbe4ef; border-radius: 16px; background: linear-gradient(135deg,#ffffff 0%,#f7faff 100%); }
.qr-topbar h2 { margin: 0 0 5px; color: #0f172a; font-size: 22px; }
.qr-muted { margin: 0; color: #64748b; font-size: 13px; line-height: 1.55; }
.qr-scopebar { padding: 5px; width: fit-content; border: 1px solid #dbe4ef; border-radius: 13px; background: #fff; }
.qr-scope { border: 0; border-radius: 9px; padding: 9px 13px; background: transparent; color: #475569; font: inherit; font-weight: 700; cursor: pointer; }
.qr-scope.is-on { color: #fff; background: #163b65; box-shadow: 0 4px 12px rgba(22,59,101,.18); }
.qr-count { margin-left: 5px; padding: 1px 6px; border-radius: 999px; background: rgba(148,163,184,.18); font-size: 11px; }
.qr-filterbar { display: grid; grid-template-columns: minmax(220px,1.6fr) repeat(3,minmax(130px,.7fr)) auto; padding: 14px; border: 1px solid #dbe4ef; border-radius: 14px; background: #fff; }
.qr-input, .qr-select, .qr-textarea { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 9px; padding: 9px 11px; color: #0f172a; background: #fff; font: inherit; }
.qr-input:focus, .qr-select:focus, .qr-textarea:focus { outline: 3px solid rgba(59,130,246,.16); border-color: #3b82f6; }
.qr-layout { display: grid; grid-template-columns: minmax(310px,.9fr) minmax(480px,1.6fr); gap: 14px; min-height: 610px; align-items: start; }
.qr-panel { min-width: 0; border: 1px solid #dbe4ef; border-radius: 16px; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.04); }
.qr-queue-panel { overflow: hidden; }
.qr-queue-head { padding: 13px 15px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 12px; }
.qr-queue { max-height: calc(100dvh - 310px); min-height: 500px; overflow: auto; }
.qr-item { width: 100%; display: grid; gap: 7px; padding: 14px 15px; border: 0; border-bottom: 1px solid #edf2f7; background: #fff; color: inherit; text-align: left; cursor: pointer; }
.qr-item:hover { background: #f8fbff; }
.qr-item.is-on { background: #eff6ff; box-shadow: inset 3px 0 #2563eb; }
.qr-item-title { color: #0f172a; font-weight: 760; line-height: 1.4; overflow-wrap: anywhere; }
.qr-item-meta { color: #64748b; font-size: 12px; line-height: 1.5; }
.qr-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.qr-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 750; }
.qr-badge.is-risk { background: #fff1f2; color: #be123c; }
.qr-badge.is-repeat { background: #fff7ed; color: #c2410c; }
.qr-badge.is-update { background: #ecfeff; color: #0e7490; }
.qr-detail { min-height: 610px; padding: 18px; }
.qr-detail-empty, .qr-empty { margin: 18px; padding: 42px 18px; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; text-align: center; }
.qr-detail-title { margin: 0; color: #0f172a; font-size: 21px; overflow-wrap: anywhere; }
.qr-detail-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px 14px; }
.qr-kv { min-width: 0; padding: 9px 0; border-bottom: 1px solid #edf2f7; }
.qr-kv span { display: block; margin-bottom: 3px; color: #94a3b8; font-size: 11px; }
.qr-kv strong { color: #334155; font-size: 13px; overflow-wrap: anywhere; }
.qr-section { margin-top: 16px; padding-top: 15px; border-top: 1px solid #e2e8f0; }
.qr-section h3 { margin: 0; color: #334155; font-size: 14px; }
.qr-text { margin: 10px 0 0; color: #334155; font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.qr-note { margin-top: 9px; padding: 10px 12px; border-radius: 9px; background: #f8fafc; color: #475569; font-size: 12px; }
.qr-writeback { margin-top: 12px; padding: 11px 12px; border-radius: 10px; background: #f8fafc; color: #475569; font-size: 12px; }
.qr-writeback.is-failed { background: #fff7ed; color: #9a3412; }
.qr-actionbar { position: sticky; bottom: 0; display: flex; gap: 9px; flex-wrap: wrap; margin: 18px -18px -18px; padding: 13px 18px; border-top: 1px solid #dbe4ef; background: rgba(255,255,255,.96); backdrop-filter: blur(8px); }
.qr-loading { padding: 44px 18px; color: #64748b; text-align: center; }
.qr-sync-status { color: #64748b; font-size: 12px; }
.qr-dialog { width: min(720px,calc(100vw - 28px)); max-height: calc(100dvh - 28px); padding: 0; border: 0; border-radius: 16px; box-shadow: 0 28px 70px rgba(15,23,42,.28); }
.qr-dialog::backdrop { background: rgba(15,23,42,.52); }
.qr-dialog-body { max-height: calc(100dvh - 28px); overflow: auto; padding: 20px; }
.qr-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.qr-dialog-head h2 { margin: 0 0 4px; }
.qr-close { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #f1f5f9; color: #475569; font-size: 20px; cursor: pointer; }
.qr-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.qr-field { min-width: 0; display: grid; gap: 5px; color: #475569; font-size: 12px; font-weight: 700; }
.qr-field.is-wide { grid-column: 1/-1; }
.qr-textarea { min-height: 100px; resize: vertical; }
.qr-dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 16px; }
.qr-feedback { min-height: 20px; margin-top: 10px; color: #b91c1c; font-size: 12px; }
@media (max-width: 980px) {
  .qr-filterbar { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .qr-filterbar > :first-child { grid-column: 1/-1; }
  .qr-layout { grid-template-columns: 1fr; }
  .qr-queue { max-height: 420px; min-height: 250px; }
}
@media (max-width: 560px) {
  .qr-topbar { display: grid; }
  .qr-topbar .btn { width: 100%; }
  .qr-scopebar { width: 100%; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); }
  .qr-scope { padding-inline: 5px; }
  .qr-filterbar, .qr-detail-grid, .qr-form { grid-template-columns: 1fr; }
  .qr-filterbar > :first-child, .qr-field.is-wide { grid-column: auto; }
  .qr-detail { padding: 14px; }
  .qr-actionbar { margin: 16px -14px -14px; padding: 12px 14px; }
  .qr-actionbar .btn { flex: 1 1 100%; }
  .qr-dialog { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .qr-dialog-body { max-height: 100dvh; }
}
`;
