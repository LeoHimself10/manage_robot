import { DAILY_REPORTS_PAGE_CSS } from "./daily-reports-page-styles";
import { renderWorkbenchPage, type WorkbenchNavId } from "./workbench-shell";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderDailyReportsPage(params: {
  userLabel?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
  apiBase?: string;
  initialDate?: string;
}): string {
  const activeNav: WorkbenchNavId = "mgr-daily-reports";
  const apiBase = params.apiBase ?? "/api/workbench/manager/daily-reports";
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";

  return renderWorkbenchPage({
    role: "manager",
    activeNav,
    title: "日报汇总",
    pageTitle: "日报汇总 · 主管工作台",
    description: `跨组织日报汇总：实时读取各组织目标员工在钉钉提交的日志（含未提交名单），默认查看昨天，可切换日期。同样的内容每天 8:30 自动推送到群。${who}`,
    userLabel: params.userLabel,
    portfolioEnabled: Boolean(params.portfolioEnabled),
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: DAILY_REPORTS_PAGE_CSS,
    mainHtml: `
  <div class="dr-toolbar">
    <label class="dr-filter">
      <span class="dr-field-k">日期</span>
      <input type="date" class="dr-date-input" id="drDate" aria-label="日报日期" />
    </label>
    <button type="button" class="btn btn-secondary" id="drRefresh">刷新</button>
  </div>
  <p class="dr-meta" id="drMeta" aria-live="polite">加载中...</p>
  <div class="dr-stack" id="drContent"></div>`,
    scriptHtml: `<script>${buildDailyReportsClientJs(apiBase, params.initialDate ?? "")}</script>`,
  });
}

function buildDailyReportsClientJs(apiBase: string, initialDate: string): string {
  const api = apiBase.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const initDate = initialDate.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `
(function(){
  var API = '${api}';
  var INIT_DATE = '${initDate}';
  var dateInput = document.getElementById('drDate');
  var refreshBtn = document.getElementById('drRefresh');
  var meta = document.getElementById('drMeta');
  var content = document.getElementById('drContent');
  if (INIT_DATE && dateInput) dateInput.value = INIT_DATE;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmtTime(ms){ if(!ms) return ''; try { return new Date(Number(ms)).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit'}); } catch(e){ return ''; } }
  function renderReport(r){
    var head = r.templateName ? ('<div class="dr-rpt-tmpl">'+esc(r.templateName)+(r.createTime?(' · '+esc(fmtTime(r.createTime))):'')+'</div>') : '';
    var rows = (r.contents||[]).map(function(f){
      var k = esc(f.key); var v = esc(f.value);
      if(k && v) return '<div class="dr-field"><span class="dr-field-k">'+k+'</span><span class="dr-field-v">'+v+'</span></div>';
      return '<div class="dr-field"><span class="dr-field-v">'+(k||v)+'</span></div>';
    }).join('');
    if(!rows) rows = '<div class="dr-field"><span class="dr-field-v dr-muted">（无内容）</span></div>';
    return '<div class="dr-rpt">'+head+rows+'</div>';
  }
  function renderOrg(org){
    var subCount = org.submitted ? org.submitted.length : 0;
    var missCount = org.missing ? org.missing.length : 0;
    var subs = (org.submitted||[]).map(function(emp){
      var multi = (emp.reports && emp.reports.length>1) ? (' <span class="dr-count">'+emp.reports.length+' 篇</span>') : '';
      return '<div class="dr-emp"><div class="dr-emp-name">'+esc(emp.name||emp.userid)+multi+'</div>'+(emp.reports||[]).map(renderReport).join('')+'</div>';
    }).join('');
    if(!subs) subs = '<div class="dr-empty">本组织该日暂无已提交日报</div>';
    var missing = missCount ? ('<div class="dr-missing"><span class="dr-missing-lbl">未提交（'+missCount+'）</span>'+org.missing.map(function(m){return esc(m.name||m.userid);}).join('、')+'</div>') : '';
    var errs = (org.errors && org.errors.length) ? ('<div class="dr-errline">读取失败：'+org.errors.map(function(e){return esc(e.name||e.userid);}).join('、')+'</div>') : '';
    return '<section class="card dr-org"><div class="dr-org-head"><h2>'+esc(org.label)+'</h2><span class="dr-org-stat">已交 '+subCount+' · 未交 '+missCount+'</span></div>'+subs+missing+errs+'</section>';
  }
  function load(){
    meta.textContent = '加载中...';
    content.innerHTML = '';
    var p = new URLSearchParams();
    var d = dateInput && dateInput.value;
    if(d) p.set('date', d);
    fetch(API+'?'+p.toString(), {headers:{Accept:'application/json'}})
      .then(function(r){return r.json();})
      .then(function(data){
        if(!data || data.ok===false){ meta.textContent = '加载失败：'+esc((data&&data.error)||'未知错误'); return; }
        if(dateInput && data.date && !dateInput.value) dateInput.value = data.date;
        var tail = data.errorCount ? (' · 读取失败 '+data.errorCount) : '';
        meta.textContent = (data.dateLabel||data.date||'')+' 汇总 · 已交 '+(data.submittedCount||0)+' · 未交 '+(data.missingCount||0)+tail;
        var html = (data.orgs||[]).map(renderOrg).join('');
        content.innerHTML = html || '<div class="dr-empty">暂无组织配置</div>';
      })
      .catch(function(e){ meta.textContent='加载失败：'+esc(e.message||e); });
  }
  if(dateInput) dateInput.addEventListener('change', load);
  if(refreshBtn) refreshBtn.addEventListener('click', load);
  load();
})();
`;
}
