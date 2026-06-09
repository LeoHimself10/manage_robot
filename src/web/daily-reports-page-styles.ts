export const DAILY_REPORTS_PAGE_CSS = `
.dr-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
.dr-date-input{padding:7px 10px;border:1px solid var(--line,#dcdfe6);border-radius:8px;font:inherit;background:#fff;}
.dr-meta{color:var(--muted,#6b7280);font-size:13px;margin:0 0 14px;}
.dr-stack{display:flex;flex-direction:column;gap:16px;}
.dr-org{padding:18px 20px;}
.dr-org-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;border-bottom:1px solid var(--line,#eef0f3);padding-bottom:8px;}
.dr-org-head h2{font-size:16px;margin:0;}
.dr-org-stat{color:var(--muted,#6b7280);font-size:13px;white-space:nowrap;}
.dr-emp{padding:10px 0;border-bottom:1px dashed var(--line,#eef0f3);}
.dr-emp:last-child{border-bottom:0;}
.dr-emp-name{font-weight:600;margin-bottom:6px;}
.dr-count{color:var(--muted,#6b7280);font-weight:400;font-size:12px;}
.dr-rpt{margin:4px 0 8px;padding-left:10px;border-left:3px solid var(--accent,#3b82f6);}
.dr-rpt-tmpl{color:var(--muted,#6b7280);font-size:12px;margin-bottom:3px;}
.dr-field{display:flex;gap:8px;margin:2px 0;line-height:1.5;font-size:14px;}
.dr-field-k{color:var(--muted,#6b7280);min-width:84px;flex-shrink:0;}
.dr-field-v{white-space:pre-wrap;word-break:break-word;}
.dr-muted{color:var(--muted,#9ca3af);}
.dr-missing{margin-top:10px;font-size:13px;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;}
.dr-missing-lbl{font-weight:600;margin-right:6px;}
.dr-errline{margin-top:8px;font-size:12px;color:#b91c1c;}
.dr-empty{color:var(--muted,#9ca3af);font-size:13px;padding:8px 0;}
`;
