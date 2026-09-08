export const QUALITY_TRACKING_STYLES = String.raw`
:root {
  --qpc-navy: #10243d;
  --qpc-navy-2: #183553;
  --qpc-blue: #9a672c;
  --qpc-ink: #18283b;
  --qpc-muted: #66768a;
  --qpc-line: #d8e1ea;
  --qpc-bg: #f1f0ed;
  --qpc-paper: #ffffff;
  --qpc-orange: #b96718;
  --qpc-green: #177057;
  --qpc-red: #b43e45;
}
body { overflow-x: hidden; }
.qpc-perspective-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border:1px solid #d9e2ec;border-radius:12px;background:#fff}
.qpc-perspective-tabs a{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 16px;border-radius:9px;color:#40546b;font-size:14px;font-weight:700;text-decoration:none;border:1px solid transparent}
.qpc-perspective-tabs a:hover{background:#f7f4ef;color:#58432d}
.qpc-perspective-tabs a.is-active{border-color:#d6b98f;background:#f7f0e6;color:#6e471e;box-shadow:0 1px 2px rgba(91,62,30,.08)}
.qpc-business-list{margin:8px 0 16px;padding-left:22px;color:#31485f}
.qpc-business-list li{margin:5px 0}
.qpc-supervisor-picker,.qpc-test-actions,.qpc-closure-actions,.qpc-test-analysis-form{margin-top:16px;padding:16px;border:1px solid var(--qpc-line);border-radius:12px;background:#faf9f7}
.qpc-picker-search{display:flex;gap:8px;margin:10px 0}
.qpc-picker-search input,.qpc-supervisor-picker input,.qpc-supervisor-picker textarea,.qpc-test-actions input,.qpc-test-actions select,.qpc-test-actions textarea,.qpc-closure-actions select,.qpc-closure-actions textarea,.qpc-test-analysis-form input,.qpc-test-analysis-form select,.qpc-test-analysis-form textarea{width:100%;min-height:42px;padding:9px 11px;border:1px solid #cbd6e1;border-radius:8px;background:#fff;font:inherit;color:var(--qpc-ink)}
.qpc-supervisor-group{margin:8px 0;border:1px solid #dbe4ec;border-radius:9px;background:#fff;overflow:hidden}
.qpc-supervisor-group summary{cursor:pointer;padding:11px 13px;font-weight:700;color:#29445f}
.qpc-supervisor-options{display:grid;gap:7px;padding:0 12px 12px}
.qpc-supervisor-option{min-height:40px;padding:8px 12px;border:1px solid #d7e1ea;border-radius:8px;background:#fff;text-align:left;color:#334b63;cursor:pointer}
.qpc-supervisor-option:hover,.qpc-supervisor-option.is-selected{border-color:#c39a68;background:#f8f2e9;color:#67451f}
.qpc-test-action-box{display:grid;gap:10px;margin-top:12px;padding:13px;border:1px solid #e1e8ef;border-radius:10px;background:#fff}
.qpc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
@media(max-width:900px){.qpc-perspective-tabs{overflow-x:auto;flex-wrap:nowrap}.qpc-perspective-tabs a{white-space:nowrap}}
.wb-main-body--quality-center { width: 100%; max-width: none; padding: 20px 24px 56px; background: var(--qpc-bg); }
.qpc-page { width: min(1660px, 100%); margin: 0 auto; color: var(--qpc-ink); font-family: "Microsoft YaHei", "PingFang SC", "DengXian", sans-serif; line-height: 1.65; }
.qpc-readonly-banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 14px; border: 1px solid #e9cf89; border-left: 4px solid #b77910; border-radius: 12px; color: #6b420c; background: linear-gradient(100deg, #fff8e3 0%, #fffdf6 78%); }
.qpc-readonly-banner strong { flex: 0 0 auto; font-size: 14px; }
.qpc-readonly-banner span { font-size: 12px; line-height: 1.55; color: #8b5b16; }
.qpc-page *, .qpc-page *::before, .qpc-page *::after { box-sizing: border-box; }
.qpc-page [hidden] { display: none !important; }
.qpc-page button, .qpc-page input, .qpc-page select, .qpc-page textarea { font: inherit; color: inherit; }
.qpc-page button:disabled { cursor: not-allowed; opacity: .52; }
.qpc-page .btn-primary { border-color: #2d3338; background: #2d3338; color: #fff; box-shadow: 0 1px 2px rgba(22,25,28,.14); }
.qpc-page .btn-primary:hover:not(:disabled) { border-color: #1f2428; background: #1f2428; }
@media (max-width: 720px) { .qpc-readonly-banner { align-items: flex-start; flex-direction: column; gap: 4px; } }
.qpc-hero { display: flex; align-items: flex-start; gap: 22px; padding: 20px 22px; margin-bottom: 15px; border: 1px solid #d0dae4; border-left: 5px solid var(--qpc-blue); border-radius: 12px; background: var(--qpc-paper); box-shadow: 0 8px 26px rgba(16,36,61,.06); }
.qpc-hero h1 { margin: 1px 0 0; font-size: 25px; line-height: 1.35; letter-spacing: -.02em; }
.qpc-hero p, .qpc-heading p, .qpc-panel-head p, .qpc-card-head p, .qpc-decision-head p { margin: 4px 0 0; color: var(--qpc-muted); font-size: 13px; }
.qpc-eyebrow { color: var(--qpc-blue); font-size: 11px; font-weight: 900; letter-spacing: .14em; }
.qpc-caps { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-left: auto; }
.qpc-caps span, .qpc-tag { display: inline-flex; align-items: center; padding: 4px 9px; border: 1px solid #cbd6e2; border-radius: 999px; background: #f6f8fa; color: #4b5e74; font-size: 12px; font-weight: 800; white-space: nowrap; }
.qpc-center { padding: 19px; border: 1px solid #d4d0ca; border-radius: 15px; background: #eceae6; }
.qpc-heading { display: flex; align-items: flex-end; gap: 18px; margin-bottom: 13px; }
.qpc-heading h2 { margin: 0; font-size: 19px; }
.qpc-heading > .btn { margin-left: auto; }
.qpc-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.qpc-metric-group { min-width: 0; padding: 12px; border: 1px solid var(--qpc-line); border-radius: 11px; background: #f7f9fb; }
.qpc-metric-group > header { display: flex; align-items: baseline; gap: 9px; margin-bottom: 9px; }
.qpc-metric-group > header strong { color: var(--qpc-ink); font-size: 14px; }
.qpc-metric-group > header span { color: var(--qpc-muted); font-size: 12px; }
.qpc-metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; }
.qpc-metric-group:only-child { grid-column: 1 / -1; }
.qpc-metric-group:only-child .qpc-metric-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.qpc-metric { position: relative; min-width: 0; min-height: 107px; padding: 13px; border: 1px solid var(--qpc-line); border-top: 3px solid var(--tone); border-radius: 10px; background: var(--qpc-paper); text-align: left; appearance: none; cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
.qpc-metric:hover, .qpc-metric:focus-visible { transform: translateY(-2px); border-color: var(--tone); box-shadow: 0 9px 20px rgba(20,38,60,.1); outline: none; }
.qpc-metric.is-active { border-color: var(--tone); background: #faf8f4; box-shadow: 0 0 0 2px rgba(154,103,44,.12); }
.qpc-metric span, .qpc-metric small { display: block; color: var(--qpc-muted); font-size: 12px; overflow-wrap: anywhere; }
.qpc-metric strong { display: block; margin: 2px 0 3px; color: var(--qpc-ink); font-size: 25px; line-height: 1.2; }
.qpc-metric em { display: block; margin: -1px 0 4px; color: var(--tone); font-size: 11px; font-style: normal; font-weight: 800; }
.qpc-panel { overflow: hidden; border: 1px solid var(--qpc-line); border-radius: 12px; background: var(--qpc-paper); box-shadow: 0 10px 28px rgba(20,38,60,.07); }
.qpc-panel-head { display: flex; align-items: center; gap: 12px; min-height: 59px; padding: 12px 16px; border-bottom: 1px solid var(--qpc-line); }
.qpc-panel-head h3, .qpc-card h4, .qpc-decision-head h4 { margin: 0; font-size: 16px; }
.qpc-panel-body { padding: 16px; }
.qpc-tabs { display: flex; gap: 4px; padding: 5px; margin-left: auto; border: 1px solid var(--qpc-line); border-radius: 9px; background: #f4f6f8; }
.qpc-tabs button { min-height: 38px; padding: 0 14px; border: 0; border-radius: 7px; background: transparent; font-weight: 900; cursor: pointer; }
.qpc-tabs button.is-active { background: #30363b; color: #fff; }
.qpc-toolbar { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 12px; }
.qpc-toolbar input, .qpc-toolbar select, .qpc-field input, .qpc-field select, .qpc-field textarea { min-height: 42px; padding: 9px 11px; border: 1px solid #c8d3df; border-radius: 8px; background: #fff; }
.qpc-toolbar input { min-width: 230px; flex: 1; }
.qpc-toolbar select { min-width: 145px; }
.qpc-table-wrap { max-width: 100%; overflow: auto; border: 1px solid var(--qpc-line); border-radius: 9px; background: #fff; }
.qpc-table { width: 100%; min-width: 980px; border-collapse: collapse; }
.qpc-table th, .qpc-table td { padding: 11px 13px; border-bottom: 1px solid #e9eef3; text-align: left; vertical-align: middle; }
.qpc-table th { background: #f6f4f1; color: #52606e; font-size: 13px; white-space: nowrap; }
.qpc-table tbody tr { cursor: pointer; transition: background .14s ease; }
.qpc-table tbody tr:hover, .qpc-table tbody tr.is-active { background: #f8f4ee; }
.qpc-table tbody tr:focus-visible { outline: 2px solid var(--qpc-blue); outline-offset: -2px; }
.qpc-summary { display: block; max-width: 470px; color: var(--qpc-ink); font-weight: 750; overflow-wrap: anywhere; }
.qpc-meta { display: block; margin-top: 3px; color: var(--qpc-muted); font-size: 12px; }
.qpc-link { padding: 0; border: 0; background: transparent; color: var(--qpc-blue); font-weight: 850; text-align: left; cursor: pointer; }
.qpc-ai-state { color: #405875; font-size: 12px; font-weight: 750; }
.qpc-tag.is-green { border-color: #b6dccb; background: #eaf7f1; color: var(--qpc-green); }
.qpc-tag.is-blue { border-color: #dcc6a9; background: #f7f1e8; color: #72502b; }
.qpc-tag.is-orange { border-color: #eac9a4; background: #fff4e7; color: #92520e; }
.qpc-tag.is-high, .qpc-tag.is-critical { border-color: #edbec2; background: #fff0f1; color: var(--qpc-red); }
.qpc-tag.is-medium { border-color: #eac9a4; background: #fff4e7; color: #92520e; }
.qpc-tag.is-low, .qpc-tag.is-muted { border-color: #d6dde5; background: #f4f6f8; color: #657487; }
.qpc-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-height: 42px; padding-top: 10px; color: var(--qpc-muted); font-size: 12px; }
.qpc-empty { display: grid; place-items: center; min-height: 130px; padding: 24px; color: var(--qpc-muted); text-align: center; }
.qpc-empty.is-error { color: var(--qpc-red); }
.qpc-workspace { margin-top: 18px; overflow: clip; border: 1px solid #b8c8d8; border-radius: 18px; background: #fff; box-shadow: 0 20px 48px rgba(17,41,68,.13); scroll-margin-top: 78px; }
.qpc-workbar { position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: flex-start; gap: 18px; min-height: 132px; padding: 26px 28px; background: radial-gradient(circle at 80% -80%, rgba(190,137,77,.24), transparent 48%), linear-gradient(118deg, #262a2e, #34383b 72%, #403d38); color: #fff; }
.qpc-workbar::after { content: ""; position: absolute; z-index: -1; right: -55px; bottom: -135px; width: 300px; height: 300px; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; box-shadow: 0 0 0 34px rgba(255,255,255,.035), 0 0 0 72px rgba(255,255,255,.02); }
.qpc-workbar h3 { margin: 0; font-family: "Aptos Display", "Microsoft YaHei UI", "PingFang SC", sans-serif; font-size: 25px; line-height: 1.28; letter-spacing: -.025em; }
.qpc-workbar p { max-width: 900px; margin: 7px 0 0; color: #d6d2cc; font-size: 14px; }
.qpc-work-badges { display: flex; align-items: center; gap: 7px; margin-left: auto; }
.qpc-work-badges > span { padding: 4px 9px; border: 1px solid #56708a; border-radius: 99px; background: rgba(255,255,255,.08); color: #fff; font-size: 12px; font-weight: 800; }
.qpc-work-badges .btn { min-height: 34px; border-color: #8095aa; background: rgba(255,255,255,.1); color: #fff; }
.qpc-stages { position: sticky; top: 0; z-index: 8; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 0; border-bottom: 1px solid var(--qpc-line); background: rgba(255,255,255,.96); box-shadow: 0 8px 20px rgba(23,38,58,.055); backdrop-filter: blur(12px); }
.qpc-stages.is-four-stage { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.qpc-stage { position: relative; display: flex; align-items: center; gap: 10px; min-height: 68px; padding: 10px 18px; border: 0; border-right: 1px solid var(--qpc-line); border-bottom: 0; background: transparent; text-align: left; cursor: pointer; }
.qpc-stage:last-child { border-right: 0; }
.qpc-stage:hover { background: #f7fafc; }
.qpc-stage.is-active { color: #66471f; background: #f6f0e7; }
.qpc-stage.is-active::after { content: ""; position: absolute; right: 16px; bottom: 0; left: 16px; height: 3px; border-radius: 3px 3px 0 0; background: var(--qpc-blue); }
.qpc-stage-number { display: grid; place-items: center; flex: 0 0 29px; width: 29px; height: 29px; border-radius: 50%; background: #ece9e4; color: #5f6770; font-weight: 900; }
.qpc-stage.is-active .qpc-stage-number { background: var(--qpc-blue); color: #fff; }
.qpc-stage b, .qpc-stage small { display: block; }
.qpc-stage small { color: var(--qpc-muted); font-size: 12px; }
.qpc-work-content { min-height: 320px; padding: 26px; background: linear-gradient(180deg, #fff, #fbfcfd); }
.qpc-stage-panel { animation: qpc-stage-in .24s ease both; }
@keyframes qpc-stage-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
.qpc-block-title { margin: 0 0 14px; font-family: "Aptos Display", "Microsoft YaHei UI", "PingFang SC", sans-serif; font-size: 20px; letter-spacing: -.02em; }
.qpc-fact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; overflow: hidden; border: 1px solid var(--qpc-line); border-radius: 12px; background: #fff; }
.qpc-fact { min-width: 0; min-height: 78px; padding: 13px 14px; border-right: 1px solid var(--qpc-line); border-bottom: 1px solid var(--qpc-line); background: #fff; overflow-wrap: anywhere; }
.qpc-fact:nth-child(4n) { border-right: 0; }
.qpc-fact label { display: block; color: var(--qpc-muted); font-size: 12px; }
.qpc-fact strong { display: block; margin-top: 3px; }
.qpc-quote { padding: 13px 15px; margin: 12px 0 0; border: 0; border-left: 4px solid #8195aa; background: #f5f7f9; white-space: pre-wrap; overflow-wrap: anywhere; }
.qpc-two-column { display: grid; grid-template-columns: minmax(0,.94fr) minmax(0,1.06fr); gap: 16px; margin-top: 20px; align-items: start; }
.qpc-card { min-width: 0; padding: 19px 20px; border: 1px solid var(--qpc-line); border-radius: 14px; background: #fff; }
.qpc-card-head { display: flex; align-items: flex-start; gap: 10px; }
.qpc-card-head .btn { margin-left: auto; }
.qpc-ai-progress { min-height: 25px; margin-top: 10px; color: #6f5130; font-size: 13px; font-weight: 800; }
.qpc-ai-progress.is-error { color: var(--qpc-red); }
.qpc-ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-top: 8px; border: 1px solid #d5cec5; border-radius: 8px; background: #d5cec5; }
.qpc-ai-grid .qpc-fact { min-height: 64px; }
.qpc-card h5, .qpc-subtitle { margin: 13px 0 7px; font-size: 13px; }
.qpc-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin: 24px 0 10px; }
.qpc-section-head .qpc-subtitle { margin: 3px 0 0; color: var(--qpc-ink); font-size: 17px; }
.qpc-readonly-pill, .qpc-human-pill { display: inline-flex; align-items: center; width: fit-content; min-height: 27px; padding: 0 9px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.qpc-readonly-pill { color: #f0dfc8; background: rgba(214,180,133,.14); }
.qpc-section-head .qpc-readonly-pill { color: #72502b; background: #f6efe5; }
.qpc-human-pill { color: #176047; background: #eaf7f1; }
.qpc-event-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); box-shadow: 0 8px 24px rgba(18,54,91,.045); }
.qpc-event-summary-grid .qpc-fact:nth-child(4n) { border-right: 1px solid var(--qpc-line); }
.qpc-event-summary-grid .qpc-fact:nth-child(3n) { border-right: 0; }
.qpc-source-grid { border-left: 5px solid #9a672c; }
.qpc-judgment-layout { align-items: stretch; }
.qpc-ai-card { color: #f3f1ed; border-color: #3d4144; background: linear-gradient(155deg,#292d30,#383b3d); }
.qpc-ai-card > h4, .qpc-human-card > h4 { margin: 9px 0 10px; font-size: 17px; }
.qpc-ai-card .qpc-summary { color: #fff; }
.qpc-ai-card .qpc-fact-grid { border-color: rgba(255,255,255,.16); background: transparent; }
.qpc-ai-card .qpc-fact { min-height: 66px; border-color: rgba(255,255,255,.12); background: rgba(255,255,255,.045); }
.qpc-ai-card .qpc-fact label, .qpc-ai-card .qpc-subtitle, .qpc-ai-card .qpc-action-help { color: #c9c3bb; }
.qpc-ai-card .qpc-plain-list { color: #f3f1ed; }
.qpc-ai-card .qpc-notice.is-muted { border-color: rgba(255,255,255,.12); color: #d5d0c8; background: rgba(255,255,255,.05); }
.qpc-human-card { border-top: 3px solid var(--qpc-green); }
.qpc-stage-review > .qpc-test-actions { margin-top: 20px; border: 1px solid #d5cec5; border-radius: 14px; background: #faf9f7; }
.qpc-stage-review > .qpc-test-actions > .qpc-subtitle { margin-top: 0; color: var(--qpc-ink); font-size: 17px; }
.qpc-stage-review > .qpc-test-actions .qpc-actions, .qpc-test-analysis-form > .qpc-actions { position: sticky; bottom: 12px; z-index: 4; margin: 16px -4px -4px; padding: 12px; border: 1px solid rgba(154,172,190,.72); border-radius: 12px; background: rgba(255,255,255,.94); box-shadow: 0 12px 28px rgba(17,41,68,.12); backdrop-filter: blur(12px); }
.qpc-plain-list { margin: 0; padding-left: 20px; color: #334b66; }
.qpc-plain-list li + li { margin-top: 5px; }
.qpc-case { display: grid; gap: 4px; padding: 10px 11px; margin-top: 8px; border: 1px solid #cbd8e6; border-radius: 8px; background: #fff; }
.qpc-case p { margin: 0; color: #3d5168; }
.qpc-case small { color: var(--qpc-muted); }
.qpc-notice { padding: 10px 12px; margin: 7px 0 0; border: 1px solid #ddd2c3; border-radius: 8px; background: #f8f5f0; color: #5f5142; }
.qpc-notice.is-muted { border-color: #d7dfe7; background: #f6f7f9; color: #59697b; }
.qpc-notice.is-green { border-color: #b9dccb; background: #eaf7f1; color: #176047; }
.qpc-notice.is-warning { border-color: #e6bf91; background: #fff6e9; color: #8b4d10; }
.qpc-decision { margin-top: 14px; overflow: hidden; border: 1px solid #e1c49d; border-top: 3px solid var(--qpc-orange); border-radius: 10px; }
.qpc-decision-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #eee2d4; }
.qpc-decision-head .qpc-tag { margin-left: auto; }
.qpc-decision-body { padding: 16px; }
.qpc-adoption { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 13px; }
.qpc-adoption label { display: flex; align-items: center; gap: 7px; min-height: 42px; padding: 0 11px; border: 1px solid #ccd7e2; border-radius: 8px; background: #fff; }
.qpc-adoption label:has(input:checked) { border-color: #d2873d; background: #fff7ed; }
.qpc-projected-assessment { margin-top: 0; border-color: #d7d0c7; border-top-color: var(--qpc-blue); background: #fff; box-shadow: 0 12px 30px rgba(35,31,26,.07); }
.qpc-projected-assessment .qpc-decision-head { justify-content: space-between; border-bottom-color: #e3ddd5; background: #faf9f7; }
.qpc-decision-tools { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-left: auto; }
.qpc-decision-tools .qpc-tag { margin-left: 0; }
.qpc-ai-trigger { position: relative; min-width: 104px; color: #183b5b; border-color: #aebfce; background: #fff; box-shadow: 0 1px 2px rgba(15,39,64,.06); transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease; }
.qpc-ai-trigger::before { content: ""; width: 7px; height: 7px; border: 1.5px solid #b87532; transform: rotate(45deg); }
.qpc-ai-trigger:hover:not(:disabled) { color: #102f4b; border-color: #718da6; background: #f5f8fa; box-shadow: 0 4px 12px rgba(20,52,80,.10); transform: translateY(-1px); }
.qpc-ai-trigger:active:not(:disabled) { box-shadow: 0 1px 3px rgba(20,52,80,.08); transform: translateY(0); }
.qpc-projected-assessment .qpc-ai-progress { margin-bottom: 13px; }
.qpc-projected-assessment .qpc-actions { margin-top: 16px; }
.qpc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
.qpc-field { display: grid; gap: 5px; min-width: 0; }
.qpc-field > span { color: #40536a; font-size: 13px; font-weight: 800; }
.qpc-field textarea { min-height: 92px; resize: vertical; line-height: 1.7; }
.qpc-field input, .qpc-field select, .qpc-field textarea { width: 100%; }
.qpc-field input:focus, .qpc-field select:focus, .qpc-field textarea:focus, .qpc-toolbar input:focus, .qpc-toolbar select:focus { border-color: var(--qpc-blue); outline: 2px solid rgba(40,99,159,.12); }
.qpc-disposition-gate { grid-column: 1 / -1; min-width: 0; margin: 0; padding: 14px; border: 1px solid #c5d2df; border-left: 4px solid var(--qpc-blue); border-radius: 10px; background: #f7fafc; }
.qpc-disposition-gate legend { padding: 0 6px; color: #263f59; font-size: 15px; font-weight: 900; }
.qpc-disposition-gate > p { margin: 0 0 11px; color: var(--qpc-muted); font-size: 13px; }
.qpc-disposition-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.qpc-disposition-option { display: flex; align-items: flex-start; gap: 10px; min-height: 72px; padding: 12px; border: 1px solid #cbd6e1; border-radius: 9px; background: #fff; cursor: pointer; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.qpc-disposition-option:hover { border-color: #8ca9c3; box-shadow: 0 3px 10px rgba(39,67,94,.08); }
.qpc-disposition-option:has(input:checked) { border-color: var(--qpc-blue); background: #edf5fb; box-shadow: inset 0 0 0 1px rgba(40,99,159,.12); }
.qpc-disposition-option input { width: 17px; height: 17px; margin: 2px 0 0; accent-color: var(--qpc-blue); }
.qpc-disposition-option span { display: grid; gap: 4px; }
.qpc-disposition-option strong { color: #1d354d; font-size: 14px; }
.qpc-disposition-option small { color: #607286; font-size: 12px; line-height: 1.5; }
.qpc-wide { grid-column: 1 / -1; }
#qualityChangeReasonField.is-required > span::after { content: " *"; color: var(--qpc-red); }
.qpc-form-feedback { min-height: 23px; margin-top: 9px; color: var(--qpc-red); font-size: 12px; font-weight: 800; }
.qpc-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.qpc-disposition { margin-top: 16px; overflow: hidden; border: 1px solid #d4ccc1; border-top: 3px solid var(--qpc-blue); border-radius: 10px; background: #fff; }
.qpc-disposition-head { display: flex; gap: 12px; padding: 13px 15px; border-bottom: 1px solid #e4ddd4; background: #faf8f4; }
.qpc-disposition-head h4 { margin: 1px 0 0; font-size: 16px; }
.qpc-disposition-head p { margin: 3px 0 0; color: var(--qpc-muted); font-size: 13px; }
.qpc-disposition-body { padding: 16px; }
.qpc-disposition-body > .qpc-field { margin-top: 13px; }
.qpc-disposition-action, .qpc-disposition-result { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border: 1px solid #cddce9; border-radius: 9px; background: #fff; }
.qpc-disposition-action { margin-top: 13px; }
.qpc-disposition-action p, .qpc-disposition-result p { flex: 1; margin: 0; color: #53667a; }
.qpc-disposition-result { flex-wrap: wrap; border-color: #b9dccb; background: #eef8f3; }
.qpc-disposition-result strong { color: #176047; }
.qpc-disposition-result .qpc-quote { flex-basis: 100%; margin-top: 0; }
.qpc-report-dialog { width: min(920px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 0; overflow: hidden; border: 1px solid #9eb3c7; border-radius: 14px; background: #fff; color: var(--qpc-ink); box-shadow: 0 28px 80px rgba(7,24,43,.35); font-family: "Microsoft YaHei", "PingFang SC", "DengXian", sans-serif; }
.qpc-report-dialog *, .qpc-report-dialog *::before, .qpc-report-dialog *::after { box-sizing: border-box; }
.qpc-report-dialog::backdrop { background: rgba(9,25,42,.58); backdrop-filter: blur(2px); }
.qpc-report-shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: calc(100vh - 34px); margin: 0; }
.qpc-report-head { display: flex; align-items: flex-start; gap: 14px; padding: 18px 20px; border-bottom: 1px solid #cdd9e5; background: var(--qpc-navy-2); color: #fff; }
.qpc-report-head h2 { margin: 1px 0 0; font-size: 20px; }
.qpc-report-head p { margin: 4px 0 0; color: #c5d3df; font-size: 13px; }
.qpc-report-head .qpc-eyebrow { color: #8fc0ed; }
.qpc-dialog-close { width: 36px; height: 36px; padding: 0; margin-left: auto; border: 1px solid #71869b; border-radius: 8px; background: rgba(255,255,255,.08); color: #fff; font-size: 24px; line-height: 1; cursor: pointer; }
.qpc-report-body { min-height: 0; padding: 16px 20px 20px; overflow: auto; }
.qpc-report-grid { margin-top: 14px; }
.qpc-report-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 13px 20px; border-top: 1px solid #d4dee8; background: #f5f8fa; }
.qpc-readonly-banner { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.qpc-readonly-banner > div:first-child { display: grid; gap: 3px; }
.qpc-perspective { display: grid; grid-template-columns: auto minmax(230px, 360px); align-items: center; gap: 4px 10px; min-width: min(100%, 430px); }
.qpc-perspective > span { font-size: 12px; font-weight: 850; }
.qpc-perspective select { min-height: 42px; border-color: rgba(255,255,255,.42); background: #fff; color: #16324d; }
.qpc-perspective small { grid-column: 2; color: #7c5317; font-size: 12px; }
.qpc-confirm-dialog { width: min(480px, calc(100vw - 32px)); padding: 0; overflow: hidden; border: 1px solid #9eb3c7; border-radius: 14px; background: #fff; color: var(--qpc-ink); box-shadow: 0 28px 80px rgba(7,24,43,.38); font-family: "Microsoft YaHei", "PingFang SC", "DengXian", sans-serif; }
.qpc-confirm-dialog::backdrop { background: rgba(9,25,42,.6); backdrop-filter: blur(2px); }
.qpc-confirm-shell { display: grid; justify-items: center; padding: 30px 30px 24px; text-align: center; }
.qpc-confirm-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 50%; background: #e7f5ef; color: #177057; font-size: 25px; font-weight: 900; }
.qpc-confirm-icon.is-handoff { background: #f5ede2; color: #8b5d29; }
.qpc-confirm-shell h2 { margin: 15px 0 5px; font-size: 21px; }
.qpc-confirm-shell p { margin: 0; color: #304960; font-size: 15px; line-height: 1.7; }
.qpc-confirm-shell small { max-width: 390px; margin-top: 8px; color: var(--qpc-muted); font-size: 12px; line-height: 1.6; }
.qpc-confirm-actions { display: flex; justify-content: center; gap: 10px; width: 100%; margin-top: 22px; }
.qpc-confirm-actions .btn { min-width: 136px; }
.qpc-action-help { max-width: 720px; margin: 8px 0 0; color: var(--qpc-muted); font-size: 13px; line-height: 1.7; }
.qpc-row-assign { min-height: 36px; padding-inline: 14px; text-decoration: none; }
.qpc-stage-empty.is-ready > span { background: #e7f5ef; color: #177057; }
.qpc-stage-empty { display: grid; justify-items: center; min-height: 270px; align-content: center; color: var(--qpc-muted); text-align: center; }
.qpc-stage-empty > span { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #ece9e4; color: #646a70; font-size: 18px; font-weight: 900; }
.qpc-stage-empty h3 { margin: 11px 0 2px; color: var(--qpc-ink); }
.qpc-stage-empty p { max-width: 520px; margin: 0 0 14px; }
.qpc-record-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.qpc-record-card { min-width: 0; padding: 12px; border: 1px solid var(--qpc-line); border-radius: 9px; background: #fff; overflow-wrap: anywhere; }
.qpc-record-card p { margin: 6px 0; color: #3d5168; }
.qpc-record-card small { color: var(--qpc-muted); }
.qpc-formal-task-link { display: inline-flex; margin-top: 10px; }
.qpc-assignment-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 14px; margin-top: 14px; }
.qpc-assignment-groups.is-single-group { grid-template-columns: 1fr; }
.qpc-assignment-groups.is-single-group .qpc-assignment-person.has-multiple-items .qpc-record-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.qpc-assignment-person { padding: 15px; }
.qpc-assignment-person .qpc-section-head { align-items: center; margin: 0 0 10px; }
.qpc-assignment-person .qpc-section-head .qpc-subtitle { margin: 0; }
.qpc-assignment-person .qpc-action-help { margin-top: 2px; }
.qpc-assignment-person .qpc-record-grid { grid-template-columns: 1fr; gap: 10px; margin-top: 0; }
.qpc-assignment-person .qpc-record-card { padding: 0; overflow: hidden; }
.qpc-assignment-person .qpc-record-card > strong { display: block; padding: 11px 13px; border-bottom: 1px solid var(--qpc-line); background: #f8fafb; font-size: 15px; }
.qpc-assignment-person .qpc-fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); border: 0; border-radius: 0; }
.qpc-assignment-person .qpc-fact { min-height: 66px; padding: 10px 12px; }
.qpc-assignment-person .qpc-fact:nth-child(4n) { border-right: 1px solid var(--qpc-line); }
.qpc-assignment-person .qpc-fact:nth-child(2n) { border-right: 0; }
.qpc-assignment-person .qpc-formal-task-link { margin: 10px 12px 12px; }
.qpc-assignment-reason { color: #9a4f18 !important; font-weight: 700; }
.qpc-assignment-all { margin-top: 14px; border: 1px solid var(--qpc-line); border-radius: 10px; background: #f8fafb; }
.qpc-assignment-all > summary { padding: 12px 14px; color: #334b63; font-weight: 800; cursor: pointer; }
.qpc-assignment-all[open] > summary { border-bottom: 1px solid var(--qpc-line); }
.qpc-assignment-all-body { padding: 14px; }
.qpc-assignment-all-body .qpc-assignment-groups { margin-top: 0; }
.qpc-submission-list { display: grid; gap: 10px; }
.qpc-submission-card { overflow: hidden; border: 1px solid #d5dee7; border-left: 4px solid #aebbc7; border-radius: 12px; background: #fff; box-shadow: 0 5px 14px rgba(25,45,67,.045); }
.qpc-submission-card.is-review { border-left-color: #b77725; }
.qpc-submission-card.is-approved { border-left-color: #238064; }
.qpc-submission-card.is-returned { border-left-color: #bd4e45; }
.qpc-submission-summary { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 74px; padding: 12px 44px 12px 14px; list-style: none; cursor: pointer; }
.qpc-submission-summary::-webkit-details-marker { display: none; }
.qpc-submission-summary::after { content: "⌄"; position: absolute; right: 16px; top: 50%; color: #687b8d; font-size: 20px; transform: translateY(-50%); transition: transform .18s ease; }
.qpc-submission-card[open] .qpc-submission-summary::after { transform: translateY(-50%) rotate(180deg); }
.qpc-submission-summary:hover { background: #f7fafc; }
.qpc-submission-identity { display: flex; align-items: center; min-width: 0; gap: 11px; }
.qpc-submission-identity > div { min-width: 0; }
.qpc-submission-identity strong, .qpc-submission-identity small { display: block; }
.qpc-submission-identity strong { overflow: hidden; color: #182b3f; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.qpc-submission-identity small { margin-top: 3px; color: var(--qpc-muted); }
.qpc-submission-avatar { display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 36px; border-radius: 10px; background: #e7edf3; color: #405b73; font-weight: 900; }
.qpc-review-badge { flex: 0 0 auto; padding: 5px 9px; border: 1px solid #cdd7e1; border-radius: 999px; background: #f4f7f9; color: #526679; font-size: 12px; font-weight: 850; }
.qpc-review-badge.is-review { border-color: #e5c18e; background: #fff6e8; color: #8a5414; }
.qpc-review-badge.is-approved { border-color: #a9d5c6; background: #edf8f3; color: #176b53; }
.qpc-review-badge.is-returned { border-color: #e5b4af; background: #fff2f0; color: #9c3931; }
.qpc-submission-body { padding: 14px; border-top: 1px solid #dde5ec; background: #fbfcfd; }
.qpc-submission-body .qpc-fact-grid { margin-bottom: 14px; }
.qpc-submission-evidence { padding-top: 2px; }
.qpc-submission-evidence h5 { margin: 0 0 8px; color: #20364c; font-size: 14px; }
.qpc-evidence-list { display: grid; gap: 8px; }
.qpc-evidence-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 12px; border: 1px solid #dbe4ec; border-radius: 9px; background: #fff; }
.qpc-evidence-item p { margin: 3px 0; color: #40556a; font-size: 13px; }
.qpc-evidence-item small { color: var(--qpc-muted); }
.qpc-review-result { display: grid; gap: 3px; margin-top: 12px; padding: 11px 13px; border: 1px solid #d8e1e9; border-radius: 9px; background: #f4f7f9; }
.qpc-review-result.is-approved { border-color: #b8dece; background: #edf8f3; }
.qpc-review-result.is-review { border-color: #ead0a8; background: #fff8ed; }
.qpc-review-result.is-returned { border-color: #e7c0bc; background: #fff3f1; }
.qpc-review-result span, .qpc-review-result small { color: #53677a; font-size: 12px; }
.qpc-review-gate { display: grid; grid-template-columns: minmax(0, 1fr) minmax(180px, 280px) auto; align-items: center; gap: 18px; margin-bottom: 16px; padding: 16px 18px; border: 1px solid #d8e1e9; border-radius: 12px; background: #f7f9fb; }
.qpc-review-gate.is-complete { border-color: #afd9c9; background: #eef8f4; }
.qpc-review-gate h4 { margin: 2px 0 0; }
.qpc-review-meter { overflow: hidden; height: 8px; border-radius: 999px; background: #dfe6ec; }
.qpc-review-meter span { display: block; height: 100%; border-radius: inherit; background: #a66d29; transition: width .25s ease; }
.qpc-review-gate.is-complete .qpc-review-meter span { background: #248266; }
.qpc-review-count { color: #294158; font-size: 18px; font-variant-numeric: tabular-nums; }
.qpc-responsibility-structure { width: 100%; margin-top: 12px; }
.qpc-responsibility-root { display: grid; grid-template-columns: minmax(240px, .85fr) minmax(560px, 1.7fr); align-items: stretch; overflow: hidden; border: 1px solid #bac8d5; border-left: 5px solid #253e57; border-radius: 12px; background: #fff; box-shadow: 0 7px 20px rgba(22,43,65,.06); }
.qpc-responsibility-root-identity { display: flex; align-items: center; gap: 13px; padding: 17px 18px; background: #f5f7f8; }
.qpc-responsibility-root-mark { display: grid; place-items: center; flex: 0 0 42px; width: 42px; height: 42px; border-radius: 8px; background: #253e57; color: #fff; font-size: 17px; font-weight: 900; }
.qpc-responsibility-root h4 { margin: 1px 0 2px; color: #172d43; font-size: 17px; }
.qpc-responsibility-root p { margin: 0; color: #607184; font-size: 12px; }
.qpc-manager-responsibility .qpc-responsibility-root { border-left-color: #a66d29; }
.qpc-manager-responsibility .qpc-responsibility-root-identity { background: #f8f5f0; }
.qpc-manager-responsibility .qpc-responsibility-root-mark { background: #9a6424; }
.qpc-responsibility-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-left: 1px solid #d5dfe8; }
.qpc-responsibility-metrics > div { display: grid; align-content: center; gap: 3px; min-width: 0; min-height: 78px; padding: 12px 14px; border-right: 1px solid #e0e6ec; }
.qpc-responsibility-metrics > div:last-child { border-right: 0; }
.qpc-responsibility-metrics small { color: var(--qpc-muted); font-size: 11px; }
.qpc-responsibility-metrics strong { color: #243b52; font-size: 13px; overflow-wrap: anywhere; }
.qpc-parallel-head { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding: 24px 4px 11px 20px; }
.qpc-parallel-head::before { content: ""; position: absolute; top: 0; left: 24px; width: 2px; height: 17px; background: #9babba; }
.qpc-parallel-head h4 { margin: 1px 0 0; font-size: 16px; }
.qpc-parallel-head p { margin: 2px 0 0; color: var(--qpc-muted); font-size: 12px; }
.qpc-parallel-count { padding: 4px 9px; border: 1px solid #bdcbd7; border-radius: 999px; background: #f6f8fa; color: #455d73; font-size: 12px; font-weight: 850; }
.qpc-quality-task-list { display: grid; gap: 10px; }
.qpc-quality-task { overflow: hidden; border: 1px solid #d3dde6; border-left: 4px solid #8fa0af; border-radius: 11px; background: #fff; box-shadow: 0 4px 13px rgba(24,44,64,.04); }
.qpc-quality-task.is-approved { border-left-color: #238064; }
.qpc-quality-task.is-review { border-left-color: #b77725; }
.qpc-quality-task.is-returned { border-left-color: #bd4e45; }
.qpc-quality-task-summary { position: relative; display: grid; grid-template-columns: 46px minmax(260px, 1fr) minmax(460px, auto); align-items: center; gap: 12px; min-height: 76px; padding: 12px 46px 12px 14px; list-style: none; cursor: pointer; transition: background .16s ease; }
.qpc-quality-task-summary::-webkit-details-marker { display: none; }
.qpc-quality-task-summary::after { content: "⌄"; position: absolute; right: 17px; top: 50%; color: #687b8d; font-size: 21px; transform: translateY(-50%); transition: transform .18s ease; }
.qpc-quality-task[open] .qpc-quality-task-summary::after { transform: translateY(-50%) rotate(180deg); }
.qpc-quality-task-summary:hover, .qpc-quality-task-summary:focus-visible { background: #f7f9fb; outline: none; }
.qpc-quality-task-ordinal { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #cad5df; border-radius: 7px; background: #f4f6f8; color: #40566c; font-size: 12px; font-weight: 900; font-variant-numeric: tabular-nums; }
.qpc-quality-task-identity { min-width: 0; }
.qpc-quality-task-identity strong, .qpc-quality-task-identity small { display: block; }
.qpc-quality-task-identity strong { overflow: hidden; color: #172c41; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.qpc-quality-task-identity small { margin-top: 3px; color: var(--qpc-muted); font-size: 12px; }
.qpc-quality-task-signals { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.qpc-task-state, .qpc-task-due, .qpc-task-evidence { display: inline-flex; align-items: center; min-height: 27px; padding: 3px 8px; border: 1px solid #d3dce4; border-radius: 6px; background: #f7f9fa; color: #52677b; font-size: 11px; font-weight: 800; white-space: nowrap; }
.qpc-task-evidence { border-color: #d9c6aa; background: #fbf7f0; color: #775126; }
.qpc-quality-task-body { padding: 15px 16px 17px; border-top: 1px solid #dce4eb; background: #fafbfc; }
.qpc-quality-task-body > .qpc-fact-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 12px; }
.qpc-quality-task.is-manager-task .qpc-quality-task-ordinal { border-color: #d4c1a7; background: #faf7f2; color: #765027; }
.qpc-quality-task-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.qpc-quality-task-detail-grid section { min-width: 0; padding: 11px 12px; border: 1px solid #dce4eb; border-radius: 8px; background: #fff; }
.qpc-quality-task-detail-grid h5 { margin: 0 0 3px; color: #52677b; font-size: 11px; }
.qpc-quality-task-detail-grid p { margin: 0; color: #243b52; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.qpc-quality-task-evidence { margin-top: 13px; padding: 13px; border: 1px solid #d8e1e9; border-radius: 9px; background: #fff; }
.qpc-quality-task-evidence-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 9px; }
.qpc-quality-task-evidence-head h5 { margin: 0; color: #243b52; font-size: 14px; }
.qpc-quality-task-evidence-head p { margin: 2px 0 0; color: var(--qpc-muted); font-size: 12px; }
.qpc-quality-evidence-list { display: grid; gap: 7px; }
.qpc-quality-evidence-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 10px 11px; border: 1px solid #dae2e9; border-radius: 8px; background: #fbfcfd; }
.qpc-quality-evidence-row.is-latest { border-color: #c6ab84; background: #fdfaf5; }
.qpc-quality-evidence-row > div { min-width: 0; }
.qpc-quality-evidence-name { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.qpc-quality-evidence-name strong { color: #20374e; font-size: 13px; overflow-wrap: anywhere; }
.qpc-quality-evidence-name span { padding: 2px 6px; border-radius: 5px; background: #ede7dc; color: #765027; font-size: 10px; font-weight: 900; }
.qpc-quality-evidence-row p { margin: 3px 0; color: #40566b; font-size: 12px; }
.qpc-quality-evidence-row small { color: var(--qpc-muted); font-size: 11px; }
.qpc-quality-evidence-row .btn { flex: 0 0 auto; }
.qpc-manager-task-action { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 12px; padding: 11px 13px; border: 1px solid #d5dee6; border-left: 3px solid #a66d29; border-radius: 8px; background: #fff; }
.qpc-manager-task-action p { margin: 0; color: #566b7e; font-size: 12px; line-height: 1.6; }
.qpc-manager-task-action .btn { flex: 0 0 auto; margin: 0; text-decoration: none; }
.qpc-manager-all-tasks { margin-top: 14px; }
.qpc-manager-all-tasks .qpc-quality-task-list { margin: 0; }
.qpc-manager-responsibility > .qpc-review-gate { margin: 14px 0 0; }
.qpc-quality-final-gate { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 18px; margin-top: 13px; border: 1px solid #dbc7a8; border-left: 4px solid #a66d29; border-radius: 10px; background: #fcf8f1; }
.qpc-quality-final-gate.is-complete { border-color: #acd4c5; border-left-color: #238064; background: #eef8f4; }
.qpc-quality-final-gate h4 { margin: 1px 0 0; color: #263e55; font-size: 15px; }
.qpc-quality-final-gate p { margin: 3px 0 0; color: #596d80; font-size: 12px; }
.qpc-quality-final-count { color: #63451f; font-size: 20px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.qpc-quality-final-gate.is-complete .qpc-quality-final-count { color: #176b53; }
.qpc-chain { display: flex; align-items: stretch; overflow: auto; padding: 7px 2px 14px; }
.qpc-chain-node { position: relative; flex: 1; min-width: 145px; padding: 11px; border: 1px solid #cad6e1; border-radius: 9px; background: #fff; }
.qpc-chain-node + .qpc-chain-node { margin-left: 24px; }
.qpc-chain-node + .qpc-chain-node::before { content: "→"; position: absolute; left: -19px; top: 31px; color: #8291a3; font-weight: 900; }
.qpc-chain-node strong, .qpc-chain-node span, .qpc-chain-node small { display: block; }
.qpc-chain-node span, .qpc-chain-node small { color: var(--qpc-muted); font-size: 12px; }
.qpc-evidence-dialog { width: min(1180px, calc(100vw - 40px)); height: min(820px, calc(100vh - 40px)); max-width: none; max-height: none; padding: 0; overflow: hidden; border: 1px solid #8ea1b3; border-radius: 14px; background: #fff; color: var(--qpc-ink); box-shadow: 0 30px 90px rgba(7,24,43,.4); font-family: "Microsoft YaHei", "PingFang SC", "DengXian", sans-serif; }
.qpc-evidence-dialog *, .qpc-evidence-dialog *::before, .qpc-evidence-dialog *::after { box-sizing: border-box; }
.qpc-evidence-dialog::backdrop { background: rgba(9,25,42,.64); backdrop-filter: blur(2px); }
.qpc-evidence-dialog-shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
.qpc-evidence-dialog-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 19px; border-bottom: 1px solid #526a80; background: #1d344b; color: #fff; }
.qpc-evidence-dialog-head h2 { margin: 1px 0 0; font-size: 20px; overflow-wrap: anywhere; }
.qpc-evidence-dialog-head p { margin: 3px 0 0; color: #bfccd8; font-size: 12px; }
.qpc-evidence-dialog-head .qpc-eyebrow { color: #d4af7c; }
.qpc-evidence-dialog-body { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
.qpc-evidence-meta { min-width: 0; padding: 18px; overflow: auto; border-right: 1px solid #d4dde5; background: #f5f6f6; }
.qpc-evidence-meta h3 { margin: 2px 0 13px; font-size: 17px; }
.qpc-evidence-meta .qpc-fact-grid { grid-template-columns: 1fr; }
.qpc-evidence-meta .qpc-fact { min-height: 58px; border-right: 0; }
.qpc-evidence-meta h4 { margin: 16px 0 5px; color: #30485f; font-size: 13px; }
.qpc-evidence-summary { padding: 10px 11px; margin: 0; border: 1px solid #d6dfe7; border-radius: 7px; background: #fff; color: #40566c; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.qpc-evidence-preview { display: grid; min-width: 0; min-height: 0; overflow: auto; place-items: center; padding: 18px; background: #e8ecef; }
.qpc-evidence-preview-state { display: grid; justify-items: center; max-width: 480px; gap: 8px; color: #5b6d7f; text-align: center; }
.qpc-evidence-preview-state p { margin: 0; color: #657789; font-size: 13px; }
.qpc-evidence-preview-state.is-error strong { color: var(--qpc-red); }
.qpc-file-mark { display: grid; place-items: center; width: 68px; height: 82px; border: 2px solid #8ea0b1; border-radius: 8px; background: #fff; color: #425a70; font-size: 12px; font-weight: 900; letter-spacing: .08em; }
.qpc-evidence-image { display: block; max-width: 100%; max-height: 100%; border: 1px solid #c5ced6; background: #fff; box-shadow: 0 8px 24px rgba(20,39,59,.14); object-fit: contain; }
.qpc-evidence-frame { width: 100%; height: 100%; min-height: 520px; border: 1px solid #bdc8d2; background: #fff; }
.qpc-evidence-text { width: 100%; min-height: 100%; padding: 20px; margin: 0; align-self: stretch; overflow: auto; border: 1px solid #c5d0d9; background: #fff; color: #253b50; font: 13px/1.75 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.qpc-evidence-truncated { width: 100%; padding: 8px 11px; border: 1px solid #dfcba9; background: #fff8eb; color: #76552b; font-size: 11px; }
.qpc-evidence-dialog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 9px; min-height: 63px; padding: 10px 17px; border-top: 1px solid #cbd6df; background: #f7f9fa; }
.qpc-evidence-dialog-actions span { margin-right: auto; color: #667789; font-size: 11px; }
.qpc-evidence-dialog-actions a { text-decoration: none; }
.qpc-audit { display: grid; gap: 9px; }
.qpc-audit article { padding-left: 20px; border-left: 2px solid #cdd7e1; }
.qpc-audit strong, .qpc-audit span, .qpc-audit small { display: block; }
.qpc-audit span, .qpc-audit small { color: var(--qpc-muted); font-size: 12px; }
.qa-hero { display: flex; align-items: flex-start; gap: 18px; padding: 16px 18px; border: 1px solid #d7cbbb; border-left: 5px solid var(--qpc-blue); border-radius: 10px; background: linear-gradient(105deg, #faf7f2, #fff); }
.qa-hero h3 { margin: 2px 0 0; font-size: 19px; }
.qa-hero p, .qa-section > header p { margin: 4px 0 0; color: var(--qpc-muted); font-size: 13px; }
.qa-hero-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-left: auto; }
.qa-section { margin-top: 14px; padding: 15px; border: 1px solid var(--qpc-line); border-radius: 10px; background: #faf9f7; }
.qa-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid #e1e8ef; }
.qa-section > header h4 { margin: 0; font-size: 15px; }
.qa-trace { display: grid; gap: 3px; padding: 10px 12px; border-left: 3px solid #91a8bd; background: #fff; }
.qa-trace + .qa-trace { margin-top: 7px; }
.qa-trace-head { display: flex; align-items: center; gap: 8px; }
.qa-trace-head .qpc-tag { margin-left: auto; }
.qa-trace p, .qa-trace small { margin: 0; color: var(--qpc-muted); font-size: 12px; overflow-wrap: anywhere; }
.qa-original-details { margin-top: 10px; border: 1px solid #cfdae5; border-radius: 8px; background: #fff; }
.qa-original-details summary { padding: 9px 11px; color: #365777; font-size: 13px; font-weight: 800; cursor: pointer; }
.qa-json { max-height: 340px; padding: 11px; margin: 0; overflow: auto; border-top: 1px solid #ded8d0; background: #f6f4f1; color: #47423d; font: 12px/1.6 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.qa-department-form { margin-top: 12px; }
.qa-department-search { max-width: 560px; margin-bottom: 12px; }
.qa-department-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.qa-department-card { padding: 11px; border: 1px solid #cbd8e4; border-radius: 8px; background: #fff; cursor: pointer; }
.qa-department-card:hover, .qa-department-card:focus-visible { border-color: var(--qpc-blue); outline: 2px solid rgba(40,99,159,.12); }
.qa-department-card p { margin: 5px 0; color: #425970; font-size: 13px; }
.qa-department-card small { color: var(--qpc-muted); }
.qa-check-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.qa-check { display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 7px 9px; border: 1px solid #d2dce6; border-radius: 7px; background: #fff; font-size: 13px; }
.qa-check:has(input:checked) { border-color: #c59a68; background: #f8f1e8; }
.qa-deliverables { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
.qa-deliverable { display: grid; gap: 9px; min-width: 0; padding: 12px; border: 1px solid #cbd8e4; border-top: 3px solid #7598b9; border-radius: 9px; background: #fff; }
.qa-deliverable-head { display: flex; align-items: center; gap: 8px; }
.qa-deliverable-head > .qpc-link { margin-left: auto; }
.qa-select { display: flex; align-items: center; gap: 7px; font-weight: 850; }
.qa-file, .qa-version { display: grid; gap: 4px; padding: 11px 12px; border: 1px solid #d3dde6; border-radius: 8px; background: #fff; overflow-wrap: anywhere; }
.qa-file + .qa-file, .qa-version + .qa-version { margin-top: 8px; }
.qa-file span, .qa-version span { color: var(--qpc-muted); font-size: 12px; }
.qa-file p, .qa-version p { margin: 0; color: #41566d; font-size: 13px; }
.qa-version-list { margin-top: 12px; }
.qa-planning-link { display: inline-flex; align-items: center; min-height: 42px; margin-top: 10px; text-decoration: none; }
@media (max-width: 1320px) {
  .qpc-metrics { grid-template-columns: 1fr; }
  .qpc-metric-grid, .qpc-metric-group:only-child .qpc-metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .qpc-stages { overflow: auto; grid-template-columns: repeat(5, minmax(178px, 1fr)); }
  .qpc-stages.is-four-stage { grid-template-columns: repeat(4, minmax(178px, 1fr)); }
  .qpc-fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-event-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-event-summary-grid .qpc-fact:nth-child(3n) { border-right: 1px solid var(--qpc-line); }
  .qpc-event-summary-grid .qpc-fact:nth-child(2n) { border-right: 0; }
  .qpc-record-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-responsibility-root { grid-template-columns: minmax(235px, .7fr) minmax(0, 1.6fr); }
  .qpc-quality-task-summary { grid-template-columns: 46px minmax(220px, 1fr) minmax(390px, auto); }
  .qa-department-grid, .qa-check-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .wb-main-body--quality-center { padding: 14px; }
  .qpc-hero, .qpc-heading, .qpc-panel-head, .qpc-workbar { align-items: flex-start; flex-wrap: wrap; }
  .qpc-caps, .qpc-heading > .btn, .qpc-tabs, .qpc-work-badges { margin-left: 0; }
  .qpc-caps { justify-content: flex-start; }
  .qpc-center { padding: 11px; }
  .qpc-two-column, .qpc-form-grid { grid-template-columns: 1fr; }
  .qpc-disposition-options { grid-template-columns: 1fr; }
  .qpc-wide { grid-column: auto; }
  .qpc-record-grid { grid-template-columns: 1fr; }
  .qpc-assignment-groups { grid-template-columns: 1fr; }
  .qpc-assignment-groups.is-single-group .qpc-assignment-person.has-multiple-items .qpc-record-grid { grid-template-columns: 1fr; }
  .qpc-review-gate { grid-template-columns: 1fr; }
  .qpc-evidence-item { align-items: flex-start; flex-direction: column; }
  .qpc-responsibility-root { grid-template-columns: 1fr; }
  .qpc-responsibility-metrics { border-top: 1px solid #d5dfe8; border-left: 0; }
  .qpc-quality-task-summary { grid-template-columns: 42px minmax(0, 1fr); }
  .qpc-quality-task-signals { grid-column: 2; justify-content: flex-start; }
  .qpc-quality-task-body > .qpc-fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-manager-task-action { align-items: flex-start; flex-direction: column; }
  .qpc-evidence-dialog { width: calc(100vw - 24px); height: calc(100vh - 24px); }
  .qpc-evidence-dialog-body { grid-template-columns: 260px minmax(0, 1fr); }
  .qpc-disposition-action { align-items: stretch; flex-direction: column; }
  .qpc-report-actions { flex-wrap: wrap; }
  .qa-hero, .qa-section > header { flex-wrap: wrap; }
  .qa-hero-actions { margin-left: 0; justify-content: flex-start; }
  .qa-department-grid, .qa-check-grid, .qa-deliverables { grid-template-columns: 1fr; }
  .qpc-readonly-banner { align-items: stretch; flex-direction: column; }
  .qpc-perspective { grid-template-columns: 1fr; }
  .qpc-perspective small { grid-column: 1; }
}
@media (max-width: 620px) {
  .qpc-metrics, .qpc-metric-grid, .qpc-metric-group:only-child .qpc-metric-grid, .qpc-fact-grid, .qpc-ai-grid { grid-template-columns: 1fr; }
  .qpc-toolbar > * { width: 100%; }
  .qpc-toolbar input { min-width: 0; }
  .qpc-work-badges { flex-wrap: wrap; }
  .qpc-pagination { justify-content: space-between; }
  .qpc-hero h1 { font-size: 22px; }
  .qpc-event-summary-grid .qpc-fact { border-right: 0; }
  .qpc-responsibility-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-quality-task-summary { padding-right: 38px; }
  .qpc-quality-task-signals { grid-column: 1 / -1; }
  .qpc-quality-task-body > .qpc-fact-grid, .qpc-quality-task-detail-grid { grid-template-columns: 1fr; }
  .qpc-quality-evidence-row { align-items: flex-start; flex-direction: column; }
  .qpc-quality-final-gate { align-items: flex-start; flex-direction: column; }
  .qpc-evidence-dialog-body { grid-template-columns: 1fr; grid-template-rows: minmax(180px, auto) minmax(320px, 1fr); overflow: auto; }
  .qpc-evidence-meta { max-height: 260px; border-right: 0; border-bottom: 1px solid #d4dde5; }
  .qpc-evidence-dialog-actions { align-items: stretch; flex-wrap: wrap; }
  .qpc-evidence-dialog-actions span { flex-basis: 100%; margin-right: 0; }
  .qpc-decision-head, .qpc-decision-tools { align-items: stretch; flex-direction: column; }
  .qpc-decision-tools { width: 100%; margin-left: 0; }
}
`;
