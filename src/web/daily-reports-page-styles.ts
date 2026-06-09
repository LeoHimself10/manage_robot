export const DAILY_REPORTS_PAGE_CSS = `
.dr-root{
  --dr-ink:#211c17;
  --dr-paper:#fdfbf6;
  --dr-paper-2:#f6f1e7;
  --dr-line:#e6dfd0;
  --dr-line-soft:#efe9dc;
  --dr-muted:#8c8578;
  --dr-seal:#c0392b;
  --dr-seal-deep:#9c2b21;
  --dr-seal-soft:#f9e9e6;
  --dr-jade:#15803d;
  --dr-jade-soft:#e8f3ea;
  --dr-amber:#b45309;
  --dr-amber-soft:#fdf1e3;
  color:var(--dr-ink);
}
.dr-serif{font-family:"Songti SC","STSong","Georgia",serif;}

/* ---- toolbar ---- */
.dr-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;}
.dr-filter{display:flex;align-items:center;gap:8px;}
.dr-field-k{color:var(--dr-muted);font-size:12px;letter-spacing:.14em;text-transform:uppercase;}
.dr-date-input{padding:8px 11px;border:1px solid var(--dr-line);border-radius:9px;font:inherit;background:var(--dr-paper);color:var(--dr-ink);transition:border-color .18s,box-shadow .18s;}
.dr-date-input:focus{outline:none;border-color:var(--dr-seal);box-shadow:0 0 0 3px var(--dr-seal-soft);}
.dr-spacer{flex:1 1 auto;}
.dr-btn{appearance:none;cursor:pointer;font:inherit;font-size:13px;padding:8px 14px;border-radius:9px;border:1px solid var(--dr-line);background:var(--dr-paper);color:var(--dr-ink);transition:transform .12s,border-color .18s,background .18s,box-shadow .18s;}
.dr-btn:hover{border-color:var(--dr-seal);box-shadow:0 1px 0 var(--dr-line);}
.dr-btn:active{transform:translateY(1px);}
.dr-btn-seal{border-color:var(--dr-seal);color:var(--dr-seal-deep);background:linear-gradient(180deg,#fff,var(--dr-seal-soft));font-weight:600;}
.dr-btn-seal[aria-expanded="true"]{background:var(--dr-seal);border-color:var(--dr-seal-deep);color:#fff;}

.dr-meta{color:var(--dr-muted);font-size:13px;margin:10px 0 16px;letter-spacing:.01em;}

/* ---- report stack ---- */
.dr-stack{display:flex;flex-direction:column;gap:18px;}
.dr-org{
  position:relative;padding:20px 22px 18px;background:
    linear-gradient(180deg,var(--dr-paper),var(--dr-paper));
  border:1px solid var(--dr-line);border-radius:14px;
  box-shadow:0 1px 2px rgba(33,28,23,.04),0 10px 24px -18px rgba(33,28,23,.5);
  overflow:hidden;animation:drRise .5s cubic-bezier(.2,.7,.2,1) both;
}
.dr-org::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--dr-seal),var(--dr-seal-deep));}
.dr-org:nth-child(1){animation-delay:.02s;}
.dr-org:nth-child(2){animation-delay:.10s;}
.dr-org:nth-child(3){animation-delay:.18s;}
.dr-org:nth-child(4){animation-delay:.26s;}
@keyframes drRise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.dr-org-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--dr-line-soft);}
.dr-org-title{display:flex;align-items:center;gap:10px;}
.dr-seal-mark{
  display:inline-grid;place-items:center;width:30px;height:30px;border-radius:7px;
  border:1.5px solid var(--dr-seal);color:var(--dr-seal-deep);font-size:14px;font-weight:700;
  background:var(--dr-seal-soft);font-family:"Songti SC","STSong",serif;
}
.dr-org-head h2{font-size:18px;margin:0;letter-spacing:.02em;}
.dr-org-stat{color:var(--dr-muted);font-size:12.5px;white-space:nowrap;display:flex;gap:10px;align-items:center;}
.dr-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--dr-line);}
.dr-pill-ok{color:var(--dr-jade);background:var(--dr-jade-soft);border-color:#cfe7d5;}
.dr-pill-miss{color:var(--dr-amber);background:var(--dr-amber-soft);border-color:#f3dcc0;}

.dr-emp{padding:12px 0;border-bottom:1px dashed var(--dr-line);}
.dr-emp:last-child{border-bottom:0;padding-bottom:2px;}
.dr-emp-name{font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px;}
.dr-emp-name::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dr-seal);flex:none;}
.dr-count{color:var(--dr-muted);font-weight:400;font-size:12px;}
.dr-rpt{margin:6px 0 8px 14px;padding:8px 0 8px 12px;border-left:2px solid var(--dr-line);}
.dr-rpt-tmpl{color:var(--dr-seal-deep);font-size:11.5px;letter-spacing:.04em;margin-bottom:5px;font-weight:600;}
.dr-field{display:flex;gap:10px;margin:3px 0;line-height:1.6;font-size:13.5px;}
.dr-field .dr-field-k{min-width:88px;flex-shrink:0;text-transform:none;letter-spacing:0;font-size:13px;}
.dr-field-v{white-space:pre-wrap;word-break:break-word;}
.dr-muted{color:var(--dr-muted);}
.dr-missing{margin-top:12px;font-size:13px;color:var(--dr-amber);background:var(--dr-amber-soft);border:1px solid #f3dcc0;border-radius:9px;padding:9px 12px;}
.dr-missing-lbl{font-weight:600;margin-right:6px;}
.dr-errline{margin-top:8px;font-size:12px;color:var(--dr-seal-deep);}
.dr-empty{color:var(--dr-muted);font-size:13px;padding:10px 0;}

/* ---- roster manager panel ---- */
.drm-panel{overflow:hidden;max-height:0;opacity:0;transition:max-height .42s cubic-bezier(.2,.7,.2,1),opacity .3s,margin .3s;margin:0;}
.drm-panel.open{max-height:1600px;opacity:1;margin:4px 0 18px;}
.drm-inner{
  background:linear-gradient(180deg,var(--dr-paper-2),var(--dr-paper));
  border:1px solid var(--dr-line);border-radius:14px;padding:18px 20px 20px;
  box-shadow:inset 0 1px 0 #fff,0 14px 30px -24px rgba(33,28,23,.6);
}
.drm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px;}
.drm-head h3{margin:0;font-size:16px;letter-spacing:.02em;}
.drm-head .drm-hint{color:var(--dr-muted);font-size:12px;}
.drm-banner{margin:12px 0 4px;font-size:13px;border-radius:9px;padding:9px 12px;display:none;animation:drStamp .35s cubic-bezier(.2,.9,.3,1.2) both;}
.drm-banner.show{display:block;}
.drm-banner.ok{color:var(--dr-jade);background:var(--dr-jade-soft);border:1px solid #cfe7d5;}
.drm-banner.warn{color:var(--dr-amber);background:var(--dr-amber-soft);border:1px solid #f3dcc0;}
.drm-banner.err{color:var(--dr-seal-deep);background:var(--dr-seal-soft);border:1px solid #f0ccc6;}
@keyframes drStamp{from{opacity:0;transform:scale(.96) rotate(-.4deg);}to{opacity:1;transform:none;}}
.drm-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:14px;}
.drm-col{background:var(--dr-paper);border:1px solid var(--dr-line);border-radius:12px;padding:14px 14px 16px;}
.drm-col-head{display:flex;align-items:center;gap:9px;margin-bottom:4px;}
.drm-col-head .dr-seal-mark{width:26px;height:26px;font-size:13px;}
.drm-col-head h4{margin:0;font-size:15px;}
.drm-cred{font-size:11px;letter-spacing:.06em;color:var(--dr-muted);border:1px solid var(--dr-line);border-radius:999px;padding:1px 8px;}
.drm-cred.indep{color:var(--dr-seal-deep);border-color:#f0ccc6;background:var(--dr-seal-soft);}
.drm-members{margin:12px 0;display:flex;flex-direction:column;gap:6px;min-height:8px;}
.drm-member{display:flex;align-items:center;gap:10px;padding:7px 10px;border:1px solid var(--dr-line-soft);border-radius:9px;background:#fff;transition:border-color .15s,box-shadow .15s;}
.drm-member:hover{border-color:var(--dr-line);box-shadow:0 1px 0 var(--dr-line-soft);}
.drm-m-name{font-weight:600;font-size:13.5px;}
.drm-m-uid{color:var(--dr-muted);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.drm-m-spacer{flex:1 1 auto;}
.drm-x{appearance:none;border:0;background:transparent;cursor:pointer;color:var(--dr-muted);font-size:18px;line-height:1;padding:2px 6px;border-radius:7px;transition:color .15s,background .15s;}
.drm-x:hover{color:var(--dr-seal);background:var(--dr-seal-soft);}
.drm-members-empty{color:var(--dr-muted);font-size:12.5px;padding:6px 2px;}
.drm-search-wrap{position:relative;}
.drm-search{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--dr-line);border-radius:9px;font:inherit;font-size:13.5px;background:var(--dr-paper-2);color:var(--dr-ink);transition:border-color .18s,box-shadow .18s,background .18s;}
.drm-search:focus{outline:none;border-color:var(--dr-seal);background:#fff;box-shadow:0 0 0 3px var(--dr-seal-soft);}
.drm-results{margin-top:7px;border:1px solid var(--dr-line);border-radius:10px;background:#fff;box-shadow:0 16px 30px -22px rgba(33,28,23,.65);overflow:hidden;display:none;}
.drm-results.show{display:block;}
.drm-result{display:flex;align-items:center;gap:10px;width:100%;text-align:left;appearance:none;border:0;border-bottom:1px solid var(--dr-line-soft);background:#fff;cursor:pointer;padding:9px 12px;font:inherit;color:var(--dr-ink);transition:background .12s;}
.drm-result:last-child{border-bottom:0;}
.drm-result:hover:not(:disabled){background:var(--dr-seal-soft);}
.drm-result:disabled{cursor:default;color:var(--dr-muted);}
.drm-r-name{font-weight:600;font-size:13.5px;}
.drm-r-dept{color:var(--dr-muted);font-size:11.5px;}
.drm-r-uid{color:var(--dr-muted);font-size:10.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-left:auto;}
.drm-r-tag{font-size:11px;color:var(--dr-jade);margin-left:auto;}
.drm-note{color:var(--dr-muted);font-size:12px;padding:9px 12px;}
.drm-spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dr-line);border-top-color:var(--dr-seal);border-radius:50%;animation:drSpin .7s linear infinite;vertical-align:-2px;}
@keyframes drSpin{to{transform:rotate(360deg);}}
`;
