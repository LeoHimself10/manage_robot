/** 日报汇总页样式：复用工作台全局 token（--primary / --success / --admin 等）。 */
export const DAILY_REPORTS_PAGE_CSS = `
.dr-root{
  --dr-accent: var(--primary);
  --dr-accent-hover: var(--primary-hover);
  --dr-accent-soft: var(--primary-soft);
}
.dr-root.dr-role-employee{
  --dr-accent: var(--success);
  --dr-accent-hover: #047857;
  --dr-accent-soft: #ecfdf5;
}
.dr-root.dr-role-admin{
  --dr-accent: var(--admin);
  --dr-accent-hover: #4f46e5;
  --dr-accent-soft: var(--admin-soft);
}

.dr-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;}
.dr-filter{display:flex;align-items:center;gap:8px;}
.dr-field-k{color:var(--muted);font-size:var(--text-sm);font-weight:500;}
.dr-date-input{
  padding:8px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);
  font:inherit;background:var(--surface);color:var(--text);
  transition:border-color .18s,box-shadow .18s;
}
.dr-date-input:focus{outline:none;border-color:var(--dr-accent);box-shadow:0 0 0 3px var(--dr-accent-soft);}
.dr-spacer{flex:1 1 auto;}
.dr-btn{
  appearance:none;cursor:pointer;font:inherit;font-size:var(--text-sm);
  padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--border);
  background:var(--surface);color:var(--text);
  transition:transform .12s,border-color .18s,background .18s,box-shadow .18s;
}
.dr-btn:hover{border-color:var(--dr-accent);box-shadow:var(--shadow-sm);}
.dr-btn:active{transform:translateY(1px);}
.dr-btn-primary{
  border-color:var(--dr-accent);color:var(--dr-accent);
  background:var(--dr-accent-soft);font-weight:600;
}
.dr-btn-primary[aria-expanded="true"]{
  background:var(--dr-accent);border-color:var(--dr-accent-hover);color:#fff;
}

.dr-meta{color:var(--muted);font-size:var(--text-sm);margin:10px 0 16px;}

.dr-stack{display:flex;flex-direction:column;gap:16px;}
.dr-org{
  position:relative;padding:18px 20px 16px;background:var(--surface);
  border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:var(--shadow);overflow:hidden;
}
.dr-org::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--dr-accent);
}
.dr-org-head{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);
}
.dr-org-title{display:flex;align-items:center;gap:10px;}
.dr-org-mark{
  display:inline-grid;place-items:center;width:28px;height:28px;border-radius:var(--radius-sm);
  border:1px solid var(--dr-accent);color:var(--dr-accent);font-size:13px;font-weight:700;
  background:var(--dr-accent-soft);
}
.dr-org-head h2{font-size:var(--text-md);margin:0;font-weight:600;}
.dr-org-stat{color:var(--muted);font-size:var(--text-sm);white-space:nowrap;display:flex;gap:8px;align-items:center;}
.dr-pill{
  display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;
  font-size:var(--text-xs);border:1px solid var(--border);background:var(--bg);
}
.dr-pill-ok{color:var(--success);border-color:#bbf7d0;background:#ecfdf5;}
.dr-pill-miss{color:var(--warn);border-color:#fed7aa;background:#fff7ed;}

.dr-emp{padding:10px 0;border-bottom:1px dashed var(--border);}
.dr-emp:last-child{border-bottom:0;padding-bottom:2px;}
.dr-emp-name{font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px;font-size:var(--text-base);}
.dr-emp-name::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dr-accent);flex:none;}
.dr-count{color:var(--muted);font-weight:400;font-size:var(--text-xs);}
.dr-rpt{margin:6px 0 8px 14px;padding:6px 0 6px 12px;border-left:2px solid var(--border);}
.dr-rpt-tmpl{color:var(--dr-accent);font-size:var(--text-xs);font-weight:600;margin-bottom:4px;}
.dr-field{display:flex;gap:10px;margin:3px 0;line-height:1.55;font-size:var(--text-base);}
.dr-field .dr-field-k{min-width:88px;flex-shrink:0;color:var(--muted);}
.dr-field-v{white-space:pre-wrap;word-break:break-word;}
.dr-muted{color:var(--muted);}
.dr-missing{
  margin-top:12px;font-size:var(--text-sm);color:var(--warn);
  background:#fff7ed;border:1px solid #fed7aa;border-radius:var(--radius-sm);padding:9px 12px;
}
.dr-missing-lbl{font-weight:600;margin-right:6px;}
.dr-errline{margin-top:8px;font-size:var(--text-sm);color:var(--danger);}
.dr-empty{color:var(--muted);font-size:var(--text-sm);padding:10px 0;}

/* roster panel (admin only) */
.drm-panel{overflow:hidden;max-height:0;opacity:0;transition:max-height .35s ease,opacity .25s,margin .25s;margin:0;}
.drm-panel.open{max-height:1600px;opacity:1;margin:4px 0 18px;}
.drm-inner{
  background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 18px 18px;box-shadow:var(--shadow-sm);
}
.drm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:4px;}
.drm-head h3{margin:0;font-size:var(--text-md);font-weight:600;}
.drm-head .drm-hint{color:var(--muted);font-size:var(--text-xs);}
.drm-banner{
  margin:12px 0 4px;font-size:var(--text-sm);border-radius:var(--radius-sm);
  padding:9px 12px;display:none;
}
.drm-banner.show{display:block;}
.drm-banner.ok{color:var(--success);background:#ecfdf5;border:1px solid #bbf7d0;}
.drm-banner.warn{color:var(--warn);background:#fff7ed;border:1px solid #fed7aa;}
.drm-banner.err{color:var(--danger);background:#fef2f2;border:1px solid #fecaca;}
.drm-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px;}
.drm-col{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;}
.drm-col-head{display:flex;align-items:center;gap:9px;margin-bottom:4px;}
.drm-col-head .dr-org-mark{width:24px;height:24px;font-size:12px;}
.drm-col-head h4{margin:0;font-size:var(--text-base);font-weight:600;}
.drm-cred{font-size:var(--text-xs);color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:1px 8px;}
.drm-cred.indep{color:var(--dr-accent);border-color:var(--dr-accent-soft);background:var(--dr-accent-soft);}
.drm-members{margin:12px 0;display:flex;flex-direction:column;gap:6px;min-height:8px;}
.drm-member{
  display:flex;align-items:center;gap:10px;padding:7px 10px;
  border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);
}
.drm-m-name{font-weight:600;font-size:var(--text-sm);}
.drm-m-uid{color:var(--muted);font-size:var(--text-xs);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.drm-m-spacer{flex:1 1 auto;}
.drm-x{
  appearance:none;border:0;background:transparent;cursor:pointer;color:var(--muted);
  font-size:18px;line-height:1;padding:2px 6px;border-radius:var(--radius-sm);
}
.drm-x:hover{color:var(--danger);background:#fef2f2;}
.drm-members-empty{color:var(--muted);font-size:var(--text-sm);padding:6px 2px;}
.drm-search-wrap{position:relative;}
.drm-search{
  width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--border);
  border-radius:var(--radius-sm);font:inherit;font-size:var(--text-sm);
  background:var(--surface);color:var(--text);
}
.drm-search:focus{outline:none;border-color:var(--dr-accent);box-shadow:0 0 0 3px var(--dr-accent-soft);}
.drm-results{
  margin-top:7px;border:1px solid var(--border);border-radius:var(--radius-sm);
  background:var(--surface);box-shadow:var(--shadow-md);overflow:hidden;display:none;
}
.drm-results.show{display:block;}
.drm-result{
  display:flex;align-items:center;gap:10px;width:100%;text-align:left;
  appearance:none;border:0;border-bottom:1px solid var(--border);background:var(--surface);
  cursor:pointer;padding:9px 12px;font:inherit;color:var(--text);
}
.drm-result:last-child{border-bottom:0;}
.drm-result:hover:not(:disabled){background:var(--dr-accent-soft);}
.drm-result:disabled{cursor:default;color:var(--muted);}
.drm-r-name{font-weight:600;font-size:var(--text-sm);}
.drm-r-dept{color:var(--muted);font-size:var(--text-xs);}
.drm-r-uid{color:var(--muted);font-size:var(--text-xs);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-left:auto;}
.drm-r-tag{font-size:var(--text-xs);color:var(--success);margin-left:auto;}
.drm-note{color:var(--muted);font-size:var(--text-sm);padding:9px 12px;}
.drm-spin{
  display:inline-block;width:13px;height:13px;border:2px solid var(--border);
  border-top-color:var(--dr-accent);border-radius:50%;animation:drSpin .7s linear infinite;vertical-align:-2px;
}
@keyframes drSpin{to{transform:rotate(360deg);}}
`;
