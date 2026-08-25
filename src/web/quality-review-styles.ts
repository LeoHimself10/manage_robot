export const QUALITY_REVIEW_STYLES = String.raw`
body { overflow-x: hidden; }
.qr-page {
  --qr-ink: #102a43;
  --qr-navy: #163b65;
  --qr-blue: #2563eb;
  --qr-line: #dbe4ef;
  --qr-soft: #f5f8fc;
  display: grid;
  gap: 14px;
  min-width: 0;
}
.qr-page [hidden] { display: none !important; }
.qr-actions, .qr-section-head, .qr-command-actions, .qr-control-deck,
.qr-viewbar, .qr-scopebar, .qr-cluster-head, .qr-cluster-legend {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.qr-command {
  position: relative;
  isolation: isolate;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  overflow: hidden;
  padding: 22px 24px;
  border: 1px solid #254f7d;
  border-radius: 18px;
  color: #fff;
  background:
    radial-gradient(circle at 76% -20%, rgba(96,165,250,.28), transparent 38%),
    linear-gradient(125deg, #102f52 0%, #163b65 58%, #1f537d 100%);
  box-shadow: 0 12px 32px rgba(15,42,71,.15);
}
.qr-command::after {
  content: "";
  position: absolute;
  z-index: -1;
  right: -56px;
  bottom: -98px;
  width: 260px;
  height: 260px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 50%;
  box-shadow: 0 0 0 34px rgba(255,255,255,.035), 0 0 0 72px rgba(255,255,255,.025);
}
.qr-command-copy { max-width: 720px; }
.qr-command h2 { margin: 4px 0 7px; font-size: clamp(23px,2.4vw,31px); line-height: 1.2; letter-spacing: -.02em; }
.qr-command p { max-width: 680px; margin: 0; color: #c9dcf0; font-size: 13px; line-height: 1.7; }
.qr-eyebrow { display: block; color: #8fc8ff; font-size: 9px; font-weight: 800; letter-spacing: .18em; }
.qr-eyebrow.is-dark { color: #5b7692; }
.qr-command-actions { align-content: space-between; justify-content: flex-end; }
.qr-command-actions .btn { border-color: rgba(255,255,255,.24); color: #eaf4ff; background: rgba(255,255,255,.08); }
.qr-command-actions .btn:hover { border-color: rgba(255,255,255,.4); background: rgba(255,255,255,.15); }
.qr-sync-block { display: flex; align-items: center; gap: 8px; width: 100%; justify-content: flex-end; }
.qr-sync-dot { width: 7px; height: 7px; border-radius: 50%; background: #5eead4; box-shadow: 0 0 0 4px rgba(94,234,212,.12); }
.qr-sync-status { color: #c9dcf0; font-size: 11px; }

.qr-metrics { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 10px; }
.qr-metric {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 14px 15px 13px;
  border: 1px solid var(--qr-line);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15,23,42,.035);
}
.qr-metric::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: #a8b8c8; }
.qr-metric.is-primary::before { background: #2563eb; }
.qr-metric.is-danger::before { background: #e11d48; }
.qr-metric.is-warning::before { background: #ea580c; }
.qr-metric.is-info::before { background: #0891b2; }
.qr-metric span, .qr-metric small { display: block; overflow: hidden; color: #64748b; text-overflow: ellipsis; white-space: nowrap; }
.qr-metric span { font-size: 11px; font-weight: 750; }
.qr-metric strong { display: block; margin: 3px 0 1px; color: var(--qr-ink); font-size: 25px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.qr-metric small { font-size: 10px; }

.qr-control-deck { justify-content: space-between; }
.qr-viewbar, .qr-scopebar { padding: 4px; border: 1px solid var(--qr-line); border-radius: 12px; background: #fff; }
.qr-view, .qr-scope { border: 0; border-radius: 8px; padding: 8px 12px; background: transparent; color: #52677d; font: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
.qr-view { display: inline-flex; align-items: center; gap: 7px; }
.qr-view-icon { color: #7890a7; font-size: 14px; }
.qr-view.is-on { color: var(--qr-navy); background: #eaf2fb; box-shadow: inset 0 0 0 1px #d5e5f5; }
.qr-view.is-on .qr-view-icon { color: #2563eb; }
.qr-scope.is-on { color: #fff; background: var(--qr-navy); box-shadow: 0 4px 12px rgba(22,59,101,.16); }
.qr-count { margin-left: 5px; padding: 1px 6px; border-radius: 999px; background: rgba(148,163,184,.18); font-size: 10px; }

.qr-filterbar {
  display: grid;
  grid-template-columns: minmax(250px,1.7fr) repeat(3,minmax(125px,.72fr)) auto;
  gap: 10px;
  align-items: center;
  padding: 11px;
  border: 1px solid var(--qr-line);
  border-radius: 14px;
  background: #fff;
}
.qr-search { position: relative; min-width: 0; }
.qr-search > span { position: absolute; z-index: 1; left: 12px; top: 50%; color: #7c91a6; font-size: 19px; transform: translateY(-52%); pointer-events: none; }
.qr-search .qr-input { padding-left: 36px; }
.qr-input, .qr-select, .qr-textarea {
  width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid #cbd8e6; border-radius: 9px;
  padding: 9px 11px; color: #132f4c; background: #fbfdff; font: inherit; font-size: 12px;
}
.qr-input:focus, .qr-select:focus, .qr-textarea:focus { outline: 3px solid rgba(37,99,235,.12); border-color: #3b82f6; background: #fff; }

.qr-layout { display: grid; grid-template-columns: minmax(280px,.78fr) minmax(430px,1.35fr) minmax(280px,.78fr); gap: 12px; min-height: 620px; align-items: start; }
.qr-panel { min-width: 0; border: 1px solid var(--qr-line); border-radius: 16px; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.04); }
.qr-queue-panel { overflow: hidden; }
.qr-queue-head { padding: 12px 14px; border-bottom: 1px solid #e4ebf3; color: #5c7186; background: #f8fafc; font-size: 11px; font-weight: 650; }
.qr-queue { max-height: calc(100dvh - 330px); min-height: 555px; overflow: auto; scrollbar-color: #cbd8e6 transparent; }
.qr-item { width: 100%; display: grid; gap: 7px; padding: 13px 14px; border: 0; border-bottom: 1px solid #edf2f7; background: #fff; color: inherit; text-align: left; cursor: pointer; transition: background .16s ease, box-shadow .16s ease; }
.qr-item:hover { background: #f8fbff; }
.qr-item.is-on { background: #edf5ff; box-shadow: inset 3px 0 #2563eb; }
.qr-item-title { color: #142f4b; font-size: 13px; font-weight: 780; line-height: 1.4; overflow-wrap: anywhere; }
.qr-item-meta { color: #64798e; font-size: 11px; line-height: 1.55; white-space: pre-line; }
.qr-badges { display: flex; gap: 5px; flex-wrap: wrap; }
.qr-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 7px; background: #f0f4f8; color: #53687e; font-size: 9px; font-weight: 800; letter-spacing: .02em; }
.qr-badge.is-risk { background: #fff0f3; color: #be123c; }
.qr-badge.is-repeat { background: #fff4e8; color: #c2410c; }
.qr-badge.is-update { background: #e9fbff; color: #0e7490; }

.qr-detail { min-height: 620px; padding: 18px; }
.qr-detail-head { align-items: flex-start; justify-content: space-between; }
.qr-detail-empty, .qr-empty { margin: 16px; padding: 42px 18px; border: 1px dashed #cbd8e6; border-radius: 12px; color: #64798e; text-align: center; }
.qr-detail-title { margin: 3px 0 2px; color: var(--qr-ink); font-size: 20px; overflow-wrap: anywhere; }
.qr-muted { margin: 0; color: #64798e; font-size: 12px; line-height: 1.6; }
.qr-detail-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 0 14px; margin-top: 13px; padding: 4px 13px; border: 1px solid #e3eaf2; border-radius: 12px; background: #f8fafc; }
.qr-kv { min-width: 0; padding: 9px 0; border-bottom: 1px solid #e8eef5; }
.qr-kv:nth-last-child(-n+3) { border-bottom: 0; }
.qr-kv span { display: block; margin-bottom: 3px; color: #8194a8; font-size: 9px; font-weight: 700; }
.qr-kv strong { color: #304a63; font-size: 11px; overflow-wrap: anywhere; }
.qr-section { margin-top: 15px; padding-top: 14px; border-top: 1px solid #e4ebf3; }
.qr-section h3 { margin: 0; color: #314b64; font-size: 12px; }
.qr-text { margin: 8px 0 0; color: #334e68; font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.qr-note, .qr-writeback { margin-top: 10px; padding: 10px 11px; border-radius: 9px; background: #f6f9fc; color: #52677c; font-size: 11px; }
.qr-writeback { border-left: 3px solid #94a3b8; }
.qr-writeback.is-failed { border-left-color: #ea580c; background: #fff7ed; color: #9a3412; }
.qr-actionbar { position: sticky; bottom: 0; display: flex; gap: 8px; flex-wrap: wrap; margin: 17px -18px -18px; padding: 12px 18px; border-top: 1px solid var(--qr-line); border-radius: 0 0 16px 16px; background: rgba(255,255,255,.96); backdrop-filter: blur(8px); }
.qr-loading { padding: 44px 18px; color: #64798e; text-align: center; }

.qr-insight { position: sticky; top: 14px; min-height: 420px; overflow: hidden; padding: 17px; background: linear-gradient(180deg,#fafdff 0%,#f4f8fc 100%); }
.qr-insight::before { content: ""; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg,#2563eb,#06b6d4); }
.qr-insight-empty { display: grid; justify-items: center; gap: 8px; padding: 64px 14px; color: #6a7f94; text-align: center; }
.qr-insight-empty strong { color: #2c4965; }
.qr-insight-empty p { max-width: 230px; margin: 0; font-size: 11px; line-height: 1.6; }
.qr-orbit { position: relative; width: 34px; height: 34px; border: 1px solid #94bcea; border-radius: 50%; box-shadow: 0 0 0 7px #e8f2ff; }
.qr-orbit::after { content: ""; position: absolute; top: 5px; right: -3px; width: 7px; height: 7px; border: 2px solid #fff; border-radius: 50%; background: #2563eb; }
.qr-insight-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.qr-insight-head h3 { margin: 3px 0 0; color: var(--qr-ink); font-size: 16px; }
.qr-ai-state { padding: 4px 8px; border: 1px solid #d8e3ee; border-radius: 999px; color: #64798e; background: #fff; font-size: 9px; font-weight: 800; }
.qr-ai-state.is-live { border-color: #bfdbfe; color: #1d4ed8; background: #eff6ff; }
.qr-verdict { margin-top: 15px; padding: 14px; border: 1px solid #d8e6f4; border-radius: 12px; background: #fff; box-shadow: 0 5px 18px rgba(30,64,100,.05); }
.qr-verdict-label { display: block; color: #8396a9; font-size: 9px; font-weight: 750; }
.qr-verdict strong { display: block; margin: 3px 0 5px; color: #173e66; font-size: 15px; }
.qr-verdict p { margin: 0; color: #536b82; font-size: 11px; line-height: 1.65; }
.qr-confidence { margin-top: 12px; }
.qr-confidence-head { display: flex; justify-content: space-between; color: #60758a; font-size: 10px; }
.qr-confidence-track { height: 5px; margin-top: 6px; overflow: hidden; border-radius: 999px; background: #dbe7f3; }
.qr-confidence-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#2563eb,#06b6d4); }
.qr-insight-section { margin-top: 15px; }
.qr-insight-section h4 { margin: 0 0 7px; color: #38526b; font-size: 11px; }
.qr-reason-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.qr-reason-list li { position: relative; padding-left: 13px; color: #536b82; font-size: 10px; line-height: 1.5; }
.qr-reason-list li::before { content: ""; position: absolute; left: 0; top: .55em; width: 5px; height: 5px; border-radius: 50%; background: #3b82f6; }
.qr-gap-list { display: flex; flex-wrap: wrap; gap: 6px; }
.qr-gap-list span { padding: 4px 7px; border: 1px solid #d7e2ed; border-radius: 7px; color: #556c82; background: #fff; font-size: 9px; }
.qr-ai-guard { margin-top: 15px; padding: 9px 10px; border-radius: 8px; color: #6b7f92; background: #eaf0f6; font-size: 9px; line-height: 1.5; }
.qr-adopt { width: 100%; margin-top: 10px; }

.qr-cluster-view { min-height: 560px; padding: 20px; border: 1px solid var(--qr-line); border-radius: 16px; background: #fff; }
.qr-cluster-head { justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #e4ebf3; }
.qr-cluster-head h2 { margin: 3px 0 2px; color: var(--qr-ink); font-size: 20px; }
.qr-cluster-legend { color: #64798e; font-size: 10px; }
.qr-cluster-legend span { display: inline-flex; align-items: center; gap: 6px; }
.qr-cluster-legend i { width: 7px; height: 7px; border-radius: 50%; background: #ea580c; }
.qr-cluster-legend i.is-danger { background: #e11d48; }
.qr-cluster-grid { display: grid; gap: 10px; margin-top: 15px; }
.qr-cluster-card { display: grid; grid-template-columns: 46px minmax(0,1fr) auto auto; gap: 15px; align-items: center; padding: 15px; border: 1px solid #dfe8f1; border-radius: 13px; background: linear-gradient(90deg,#fff,#fbfdff); transition: transform .16s ease, box-shadow .16s ease; }
.qr-cluster-card:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(15,42,71,.08); }
.qr-cluster-card.is-high { border-left: 3px solid #e11d48; }
.qr-cluster-rank { color: #9cb0c3; font-size: 25px; font-weight: 850; font-variant-numeric: tabular-nums; }
.qr-cluster-body h3 { margin: 5px 0 3px; color: #1b3854; font-size: 14px; }
.qr-cluster-models { margin: 0; color: #70859a; font-size: 10px; }
.qr-cluster-samples { display: flex; gap: 10px; margin-top: 9px; overflow: hidden; }
.qr-cluster-samples p { min-width: 0; flex: 1; margin: 0; padding: 7px 8px; border-radius: 7px; color: #5b7187; background: #f3f7fb; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qr-cluster-numbers { display: flex; gap: 16px; padding: 0 16px; border-left: 1px solid #e1e9f1; }
.qr-cluster-numbers div { min-width: 56px; text-align: center; }
.qr-cluster-numbers strong, .qr-cluster-numbers span { display: block; }
.qr-cluster-numbers strong { color: #173e66; font-size: 18px; }
.qr-cluster-numbers span { color: #7b8fa3; font-size: 9px; }

.qr-dialog { width: min(720px,calc(100vw - 28px)); max-height: calc(100dvh - 28px); padding: 0; border: 0; border-radius: 16px; box-shadow: 0 28px 70px rgba(15,23,42,.28); }
.qr-dialog::backdrop { background: rgba(15,23,42,.52); }
.qr-dialog-body { max-height: calc(100dvh - 28px); overflow: auto; padding: 20px; }
.qr-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.qr-dialog-head h2 { margin: 0 0 4px; color: #102a43; }
.qr-close { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #f1f5f9; color: #475569; font-size: 20px; cursor: pointer; }
.qr-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.qr-field { min-width: 0; display: grid; gap: 5px; color: #475569; font-size: 11px; font-weight: 700; }
.qr-field.is-wide { grid-column: 1/-1; }
.qr-textarea { min-height: 100px; resize: vertical; }
.qr-dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 16px; }
.qr-feedback { min-height: 20px; margin-top: 10px; color: #b91c1c; font-size: 11px; }

@media (max-width: 1280px) {
  .qr-layout { grid-template-columns: minmax(280px,.8fr) minmax(430px,1.4fr); }
  .qr-insight { position: static; grid-column: 1/-1; min-height: 0; }
  .qr-metrics { grid-template-columns: repeat(3,minmax(0,1fr)); }
}
@media (max-width: 980px) {
  .qr-command { display: grid; }
  .qr-command-actions, .qr-sync-block { justify-content: flex-start; }
  .qr-filterbar { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .qr-filterbar > :first-child { grid-column: 1/-1; }
  .qr-layout { grid-template-columns: 1fr; }
  .qr-insight { grid-column: auto; }
  .qr-queue { max-height: 390px; min-height: 250px; }
  .qr-cluster-card { grid-template-columns: 38px minmax(0,1fr) auto; }
  .qr-cluster-card > .btn { grid-column: 2/-1; justify-self: start; }
}
@media (max-width: 640px) {
  .qr-command { padding: 18px; }
  .qr-command-actions .btn { flex: 1; }
  .qr-metrics { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; }
  .qr-metric { min-width: 150px; scroll-snap-align: start; }
  .qr-control-deck { display: grid; }
  .qr-viewbar, .qr-scopebar { display: grid; width: 100%; }
  .qr-viewbar { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .qr-scopebar { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .qr-view, .qr-scope { justify-content: center; padding-inline: 5px; }
  .qr-filterbar, .qr-detail-grid, .qr-form { grid-template-columns: 1fr; }
  .qr-filterbar > :first-child, .qr-field.is-wide { grid-column: auto; }
  .qr-kv:nth-last-child(-n+3) { border-bottom: 1px solid #e8eef5; }
  .qr-kv:last-child { border-bottom: 0; }
  .qr-detail { padding: 14px; }
  .qr-actionbar { margin: 16px -14px -14px; padding: 12px 14px; }
  .qr-actionbar .btn { flex: 1 1 100%; }
  .qr-cluster-view { padding: 14px; }
  .qr-cluster-card { grid-template-columns: 34px minmax(0,1fr); gap: 10px; }
  .qr-cluster-numbers, .qr-cluster-card > .btn { grid-column: 2; }
  .qr-cluster-numbers { padding: 8px 0 0; border-top: 1px solid #e1e9f1; border-left: 0; }
  .qr-cluster-samples { display: grid; }
  .qr-dialog { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
  .qr-dialog-body { max-height: 100dvh; }
}
`;
