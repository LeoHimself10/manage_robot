export const QUALITY_TRACKING_STYLES = String.raw`
:root {
  --qpc-navy: #10243d;
  --qpc-navy-2: #183553;
  --qpc-blue: #28639f;
  --qpc-ink: #18283b;
  --qpc-muted: #66768a;
  --qpc-line: #d8e1ea;
  --qpc-bg: #eef2f5;
  --qpc-paper: #ffffff;
  --qpc-orange: #b96718;
  --qpc-green: #177057;
  --qpc-red: #b43e45;
}
body { overflow-x: hidden; }
.qpc-perspective-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border:1px solid #d9e2ec;border-radius:12px;background:#fff}
.qpc-perspective-tabs a{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 16px;border-radius:9px;color:#40546b;font-size:14px;font-weight:700;text-decoration:none;border:1px solid transparent}
.qpc-perspective-tabs a:hover{background:#f3f7fb;color:#1d4f82}
.qpc-perspective-tabs a.is-active{border-color:#9fc1e3;background:#eaf3fb;color:#174f82;box-shadow:0 1px 2px rgba(26,74,117,.08)}
.qpc-business-list{margin:8px 0 16px;padding-left:22px;color:#31485f}
.qpc-business-list li{margin:5px 0}
.qpc-supervisor-picker,.qpc-test-actions,.qpc-closure-actions,.qpc-test-analysis-form{margin-top:16px;padding:16px;border:1px solid var(--qpc-line);border-radius:12px;background:#f8fafc}
.qpc-picker-search{display:flex;gap:8px;margin:10px 0}
.qpc-picker-search input,.qpc-supervisor-picker input,.qpc-supervisor-picker textarea,.qpc-test-actions input,.qpc-test-actions select,.qpc-test-actions textarea,.qpc-closure-actions select,.qpc-closure-actions textarea,.qpc-test-analysis-form input,.qpc-test-analysis-form select,.qpc-test-analysis-form textarea{width:100%;min-height:42px;padding:9px 11px;border:1px solid #cbd6e1;border-radius:8px;background:#fff;font:inherit;color:var(--qpc-ink)}
.qpc-supervisor-group{margin:8px 0;border:1px solid #dbe4ec;border-radius:9px;background:#fff;overflow:hidden}
.qpc-supervisor-group summary{cursor:pointer;padding:11px 13px;font-weight:700;color:#29445f}
.qpc-supervisor-options{display:grid;gap:7px;padding:0 12px 12px}
.qpc-supervisor-option{min-height:40px;padding:8px 12px;border:1px solid #d7e1ea;border-radius:8px;background:#fff;text-align:left;color:#334b63;cursor:pointer}
.qpc-supervisor-option:hover,.qpc-supervisor-option.is-selected{border-color:#5f95c7;background:#edf5fc;color:#174f82}
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
@media (max-width: 720px) { .qpc-readonly-banner { align-items: flex-start; flex-direction: column; gap: 4px; } }
.qpc-hero { display: flex; align-items: flex-start; gap: 22px; padding: 20px 22px; margin-bottom: 15px; border: 1px solid #d0dae4; border-left: 5px solid var(--qpc-blue); border-radius: 12px; background: var(--qpc-paper); box-shadow: 0 8px 26px rgba(16,36,61,.06); }
.qpc-hero h1 { margin: 1px 0 0; font-size: 25px; line-height: 1.35; letter-spacing: -.02em; }
.qpc-hero p, .qpc-heading p, .qpc-panel-head p, .qpc-card-head p, .qpc-decision-head p { margin: 4px 0 0; color: var(--qpc-muted); font-size: 13px; }
.qpc-eyebrow { color: var(--qpc-blue); font-size: 11px; font-weight: 900; letter-spacing: .14em; }
.qpc-caps { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-left: auto; }
.qpc-caps span, .qpc-tag { display: inline-flex; align-items: center; padding: 4px 9px; border: 1px solid #cbd6e2; border-radius: 999px; background: #f6f8fa; color: #4b5e74; font-size: 12px; font-weight: 800; white-space: nowrap; }
.qpc-center { padding: 19px; border: 1px solid #c9d4df; border-radius: 15px; background: #e8edf2; }
.qpc-heading { display: flex; align-items: flex-end; gap: 18px; margin-bottom: 13px; }
.qpc-heading h2 { margin: 0; font-size: 19px; }
.qpc-heading > .btn { margin-left: auto; }
.qpc-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.qpc-metrics.is-test { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.qpc-metric { position: relative; min-width: 0; min-height: 107px; padding: 13px; border: 1px solid var(--qpc-line); border-top: 3px solid var(--tone); border-radius: 10px; background: var(--qpc-paper); text-align: left; appearance: none; cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
.qpc-metric:hover, .qpc-metric:focus-visible { transform: translateY(-2px); border-color: var(--tone); box-shadow: 0 9px 20px rgba(20,38,60,.1); outline: none; }
.qpc-metric.is-active { border-color: var(--tone); background: #f7fafc; box-shadow: 0 0 0 2px rgba(40,99,159,.12); }
.qpc-metric span, .qpc-metric small { display: block; color: var(--qpc-muted); font-size: 12px; overflow-wrap: anywhere; }
.qpc-metric strong { display: block; margin: 2px 0 3px; color: var(--qpc-ink); font-size: 25px; line-height: 1.2; }
.qpc-panel { overflow: hidden; border: 1px solid var(--qpc-line); border-radius: 12px; background: var(--qpc-paper); box-shadow: 0 10px 28px rgba(20,38,60,.07); }
.qpc-panel-head { display: flex; align-items: center; gap: 12px; min-height: 59px; padding: 12px 16px; border-bottom: 1px solid var(--qpc-line); }
.qpc-panel-head h3, .qpc-card h4, .qpc-decision-head h4 { margin: 0; font-size: 16px; }
.qpc-panel-body { padding: 16px; }
.qpc-tabs { display: flex; gap: 4px; padding: 5px; margin-left: auto; border: 1px solid var(--qpc-line); border-radius: 9px; background: #f4f6f8; }
.qpc-tabs button { min-height: 38px; padding: 0 14px; border: 0; border-radius: 7px; background: transparent; font-weight: 900; cursor: pointer; }
.qpc-tabs button.is-active { background: var(--qpc-navy-2); color: #fff; }
.qpc-toolbar { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 12px; }
.qpc-toolbar input, .qpc-toolbar select, .qpc-field input, .qpc-field select, .qpc-field textarea { min-height: 42px; padding: 9px 11px; border: 1px solid #c8d3df; border-radius: 8px; background: #fff; }
.qpc-toolbar input { min-width: 230px; flex: 1; }
.qpc-toolbar select { min-width: 145px; }
.qpc-table-wrap { max-width: 100%; overflow: auto; border: 1px solid var(--qpc-line); border-radius: 9px; background: #fff; }
.qpc-table { width: 100%; min-width: 980px; border-collapse: collapse; }
.qpc-table th, .qpc-table td { padding: 11px 13px; border-bottom: 1px solid #e9eef3; text-align: left; vertical-align: middle; }
.qpc-table th { background: #f4f7f9; color: #526479; font-size: 13px; white-space: nowrap; }
.qpc-table tbody tr { cursor: pointer; transition: background .14s ease; }
.qpc-table tbody tr:hover, .qpc-table tbody tr.is-active { background: #eef5fc; }
.qpc-table tbody tr:focus-visible { outline: 2px solid var(--qpc-blue); outline-offset: -2px; }
.qpc-summary { display: block; max-width: 470px; color: var(--qpc-ink); font-weight: 750; overflow-wrap: anywhere; }
.qpc-meta { display: block; margin-top: 3px; color: var(--qpc-muted); font-size: 12px; }
.qpc-link { padding: 0; border: 0; background: transparent; color: var(--qpc-blue); font-weight: 850; text-align: left; cursor: pointer; }
.qpc-ai-state { color: #405875; font-size: 12px; font-weight: 750; }
.qpc-tag.is-green { border-color: #b6dccb; background: #eaf7f1; color: var(--qpc-green); }
.qpc-tag.is-blue { border-color: #bed3ea; background: #edf4fb; color: #275a8e; }
.qpc-tag.is-orange { border-color: #eac9a4; background: #fff4e7; color: #92520e; }
.qpc-tag.is-high, .qpc-tag.is-critical { border-color: #edbec2; background: #fff0f1; color: var(--qpc-red); }
.qpc-tag.is-medium { border-color: #eac9a4; background: #fff4e7; color: #92520e; }
.qpc-tag.is-low, .qpc-tag.is-muted { border-color: #d6dde5; background: #f4f6f8; color: #657487; }
.qpc-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-height: 42px; padding-top: 10px; color: var(--qpc-muted); font-size: 12px; }
.qpc-empty { display: grid; place-items: center; min-height: 130px; padding: 24px; color: var(--qpc-muted); text-align: center; }
.qpc-empty.is-error { color: var(--qpc-red); }
.qpc-workspace { margin-top: 16px; overflow: hidden; border: 1px solid #b8c8d8; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(24,44,70,.11); scroll-margin-top: 78px; }
.qpc-workbar { display: flex; align-items: flex-start; gap: 16px; padding: 17px 18px; background: var(--qpc-navy-2); color: #fff; }
.qpc-workbar h3 { margin: 0; font-size: 18px; }
.qpc-workbar p { margin: 3px 0 0; color: #c0cedc; }
.qpc-work-badges { display: flex; align-items: center; gap: 7px; margin-left: auto; }
.qpc-work-badges > span { padding: 4px 9px; border: 1px solid #56708a; border-radius: 99px; background: rgba(255,255,255,.08); color: #fff; font-size: 12px; font-weight: 800; }
.qpc-work-badges .btn { min-height: 34px; border-color: #8095aa; background: rgba(255,255,255,.1); color: #fff; }
.qpc-stages { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 0 14px; border-bottom: 1px solid var(--qpc-line); background: #f8fafc; }
.qpc-stage { display: flex; align-items: center; gap: 9px; min-height: 72px; padding: 10px 12px; border: 0; border-bottom: 3px solid transparent; background: transparent; text-align: left; cursor: pointer; }
.qpc-stage.is-active { border-color: var(--qpc-blue); background: #fff; }
.qpc-stage-number { display: grid; place-items: center; flex: 0 0 29px; width: 29px; height: 29px; border-radius: 50%; background: #e5ebf1; color: #576a80; font-weight: 900; }
.qpc-stage.is-active .qpc-stage-number { background: var(--qpc-blue); color: #fff; }
.qpc-stage b, .qpc-stage small { display: block; }
.qpc-stage small { color: var(--qpc-muted); font-size: 12px; }
.qpc-work-content { min-height: 320px; padding: 18px; }
.qpc-block-title { margin: 0 0 10px; font-size: 16px; }
.qpc-fact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--qpc-line); border-radius: 9px; background: var(--qpc-line); }
.qpc-fact { min-width: 0; min-height: 73px; padding: 10px 12px; background: #fff; overflow-wrap: anywhere; }
.qpc-fact label { display: block; color: var(--qpc-muted); font-size: 12px; }
.qpc-fact strong { display: block; margin-top: 3px; }
.qpc-quote { padding: 13px 15px; margin: 12px 0 0; border: 0; border-left: 4px solid #8195aa; background: #f5f7f9; white-space: pre-wrap; overflow-wrap: anywhere; }
.qpc-two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; align-items: start; }
.qpc-card { min-width: 0; padding: 14px; border: 1px solid var(--qpc-line); border-radius: 10px; background: #fbfcfd; }
.qpc-card-head { display: flex; align-items: flex-start; gap: 10px; }
.qpc-card-head .btn { margin-left: auto; }
.qpc-ai-progress { min-height: 25px; margin-top: 10px; color: var(--qpc-blue); font-size: 13px; font-weight: 800; }
.qpc-ai-progress.is-error { color: var(--qpc-red); }
.qpc-ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-top: 8px; border: 1px solid #cbd8e6; border-radius: 8px; background: #cbd8e6; }
.qpc-ai-grid .qpc-fact { min-height: 64px; }
.qpc-card h5, .qpc-subtitle { margin: 13px 0 7px; font-size: 13px; }
.qpc-plain-list { margin: 0; padding-left: 20px; color: #334b66; }
.qpc-plain-list li + li { margin-top: 5px; }
.qpc-case { display: grid; gap: 4px; padding: 10px 11px; margin-top: 8px; border: 1px solid #cbd8e6; border-radius: 8px; background: #fff; }
.qpc-case p { margin: 0; color: #3d5168; }
.qpc-case small { color: var(--qpc-muted); }
.qpc-notice { padding: 10px 12px; margin: 7px 0 0; border: 1px solid #c7d8eb; border-radius: 8px; background: #f2f7fd; color: #385978; }
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
.qpc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
.qpc-field { display: grid; gap: 5px; min-width: 0; }
.qpc-field > span { color: #40536a; font-size: 13px; font-weight: 800; }
.qpc-field textarea { min-height: 92px; resize: vertical; line-height: 1.7; }
.qpc-field input, .qpc-field select, .qpc-field textarea { width: 100%; }
.qpc-field input:focus, .qpc-field select:focus, .qpc-field textarea:focus, .qpc-toolbar input:focus, .qpc-toolbar select:focus { border-color: var(--qpc-blue); outline: 2px solid rgba(40,99,159,.12); }
.qpc-wide { grid-column: 1 / -1; }
#qualityChangeReasonField.is-required > span::after { content: " *"; color: var(--qpc-red); }
.qpc-form-feedback { min-height: 23px; margin-top: 9px; color: var(--qpc-red); font-size: 12px; font-weight: 800; }
.qpc-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.qpc-disposition { margin-top: 16px; overflow: hidden; border: 1px solid #b9cfdf; border-top: 3px solid var(--qpc-blue); border-radius: 10px; background: #fbfdff; }
.qpc-disposition-head { display: flex; gap: 12px; padding: 13px 15px; border-bottom: 1px solid #dce6ee; background: #f3f8fc; }
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
.qpc-confirm-icon.is-handoff { background: #e9f1f9; color: #28639f; }
.qpc-confirm-shell h2 { margin: 15px 0 5px; font-size: 21px; }
.qpc-confirm-shell p { margin: 0; color: #304960; font-size: 15px; line-height: 1.7; }
.qpc-confirm-shell small { max-width: 390px; margin-top: 8px; color: var(--qpc-muted); font-size: 12px; line-height: 1.6; }
.qpc-confirm-actions { display: flex; justify-content: center; gap: 10px; width: 100%; margin-top: 22px; }
.qpc-confirm-actions .btn { min-width: 136px; }
.qpc-action-help { max-width: 720px; margin: 8px 0 0; color: var(--qpc-muted); font-size: 13px; line-height: 1.7; }
.qpc-row-assign { min-height: 36px; padding-inline: 14px; text-decoration: none; }
.qpc-stage-empty.is-ready > span { background: #e7f5ef; color: #177057; }
.qpc-stage-empty { display: grid; justify-items: center; min-height: 270px; align-content: center; color: var(--qpc-muted); text-align: center; }
.qpc-stage-empty > span { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #eaf0f5; color: #587087; font-size: 18px; font-weight: 900; }
.qpc-stage-empty h3 { margin: 11px 0 2px; color: var(--qpc-ink); }
.qpc-stage-empty p { max-width: 520px; margin: 0 0 14px; }
.qpc-record-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.qpc-record-card { min-width: 0; padding: 12px; border: 1px solid var(--qpc-line); border-radius: 9px; background: #fff; overflow-wrap: anywhere; }
.qpc-record-card p { margin: 6px 0; color: #3d5168; }
.qpc-record-card small { color: var(--qpc-muted); }
.qpc-chain { display: flex; align-items: stretch; overflow: auto; padding: 7px 2px 14px; }
.qpc-chain-node { position: relative; flex: 1; min-width: 145px; padding: 11px; border: 1px solid #cad6e1; border-radius: 9px; background: #fff; }
.qpc-chain-node + .qpc-chain-node { margin-left: 24px; }
.qpc-chain-node + .qpc-chain-node::before { content: "→"; position: absolute; left: -19px; top: 31px; color: #8291a3; font-weight: 900; }
.qpc-chain-node strong, .qpc-chain-node span, .qpc-chain-node small { display: block; }
.qpc-chain-node span, .qpc-chain-node small { color: var(--qpc-muted); font-size: 12px; }
.qpc-audit { display: grid; gap: 9px; }
.qpc-audit article { padding-left: 20px; border-left: 2px solid #cdd7e1; }
.qpc-audit strong, .qpc-audit span, .qpc-audit small { display: block; }
.qpc-audit span, .qpc-audit small { color: var(--qpc-muted); font-size: 12px; }
.qa-hero { display: flex; align-items: flex-start; gap: 18px; padding: 16px 18px; border: 1px solid #b9ccdd; border-left: 5px solid var(--qpc-blue); border-radius: 10px; background: linear-gradient(105deg, #f6f9fc, #fff); }
.qa-hero h3 { margin: 2px 0 0; font-size: 19px; }
.qa-hero p, .qa-section > header p { margin: 4px 0 0; color: var(--qpc-muted); font-size: 13px; }
.qa-hero-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-left: auto; }
.qa-section { margin-top: 14px; padding: 15px; border: 1px solid var(--qpc-line); border-radius: 10px; background: #fbfcfd; }
.qa-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid #e1e8ef; }
.qa-section > header h4 { margin: 0; font-size: 15px; }
.qa-trace { display: grid; gap: 3px; padding: 10px 12px; border-left: 3px solid #91a8bd; background: #fff; }
.qa-trace + .qa-trace { margin-top: 7px; }
.qa-trace-head { display: flex; align-items: center; gap: 8px; }
.qa-trace-head .qpc-tag { margin-left: auto; }
.qa-trace p, .qa-trace small { margin: 0; color: var(--qpc-muted); font-size: 12px; overflow-wrap: anywhere; }
.qa-original-details { margin-top: 10px; border: 1px solid #cfdae5; border-radius: 8px; background: #fff; }
.qa-original-details summary { padding: 9px 11px; color: #365777; font-size: 13px; font-weight: 800; cursor: pointer; }
.qa-json { max-height: 340px; padding: 11px; margin: 0; overflow: auto; border-top: 1px solid #dbe3eb; background: #f4f7fa; color: #29425c; font: 12px/1.6 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.qa-department-form { margin-top: 12px; }
.qa-department-search { max-width: 560px; margin-bottom: 12px; }
.qa-department-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.qa-department-card { padding: 11px; border: 1px solid #cbd8e4; border-radius: 8px; background: #fff; cursor: pointer; }
.qa-department-card:hover, .qa-department-card:focus-visible { border-color: var(--qpc-blue); outline: 2px solid rgba(40,99,159,.12); }
.qa-department-card p { margin: 5px 0; color: #425970; font-size: 13px; }
.qa-department-card small { color: var(--qpc-muted); }
.qa-check-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.qa-check { display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 7px 9px; border: 1px solid #d2dce6; border-radius: 7px; background: #fff; font-size: 13px; }
.qa-check:has(input:checked) { border-color: #83a9cc; background: #eef6fc; }
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
  .qpc-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .qpc-stages { overflow: auto; grid-template-columns: repeat(5, minmax(178px, 1fr)); }
  .qpc-fact-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qpc-record-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qa-department-grid, .qa-check-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .wb-main-body--quality-center { padding: 14px; }
  .qpc-hero, .qpc-heading, .qpc-panel-head, .qpc-workbar { align-items: flex-start; flex-wrap: wrap; }
  .qpc-caps, .qpc-heading > .btn, .qpc-tabs, .qpc-work-badges { margin-left: 0; }
  .qpc-caps { justify-content: flex-start; }
  .qpc-center { padding: 11px; }
  .qpc-two-column, .qpc-form-grid { grid-template-columns: 1fr; }
  .qpc-wide { grid-column: auto; }
  .qpc-record-grid { grid-template-columns: 1fr; }
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
  .qpc-metrics, .qpc-fact-grid, .qpc-ai-grid { grid-template-columns: 1fr; }
  .qpc-toolbar > * { width: 100%; }
  .qpc-toolbar input { min-width: 0; }
  .qpc-work-badges { flex-wrap: wrap; }
  .qpc-pagination { justify-content: space-between; }
  .qpc-hero h1 { font-size: 22px; }
}
`;
