import { DAILY_REPORTS_PAGE_CSS } from "./daily-reports-page-styles";
import {
  renderWorkbenchPage,
  type WorkbenchNavId,
  type WorkbenchShellRole,
} from "./workbench-shell";

const DAILY_REPORTS_API = "/api/workbench/daily-reports";

export function renderDailyReportsPage(params: {
  role: WorkbenchShellRole;
  activeNav: WorkbenchNavId;
  userLabel?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
  apiBase?: string;
  initialDate?: string;
  canManageRoster?: boolean;
}): string {
  const apiBase = params.apiBase ?? DAILY_REPORTS_API;
  const canManage = Boolean(params.canManageRoster);
  const roleClass =
    params.role === "employee"
      ? "dr-role-employee"
      : params.role === "admin"
        ? "dr-role-admin"
        : "dr-role-manager";
  const pageTitle =
    params.role === "employee"
      ? "日报汇总 · 员工工作台"
      : params.role === "admin"
        ? "日报汇总 · 管理员"
        : "日报汇总 · 主管工作台";
  const description = canManage
    ? "跨组织日报汇总：实时读取各组织目标员工在钉钉提交的日志（含未提交名单），默认查看昨天，可切换日期。管理员可在「管理名单」里分企业搜人、增删被统计的员工。"
    : "跨组织日报汇总：实时读取各组织目标员工在钉钉提交的日志（含未提交名单），默认查看昨天，可切换日期。";

  const rosterToolbar = canManage
    ? `<span class="dr-spacer"></span>
      <button type="button" class="dr-btn dr-btn-primary" id="drmToggle" aria-expanded="false" aria-controls="drmPanel">管理名单</button>`
    : "";
  const rosterPanel = canManage
    ? `<div class="drm-panel" id="drmPanel" aria-hidden="true">
      <div class="drm-inner">
        <div class="drm-head">
          <h3>管理统计名单</h3>
          <span class="drm-hint">分企业搜人 · 加入即校验近 7 天日报</span>
        </div>
        <div class="drm-banner" id="drmBanner" role="status"></div>
        <div class="drm-cols" id="drmCols"><div class="drm-note"><span class="drm-spin"></span> 载入名单…</div></div>
      </div>
    </div>`
    : "";

  return renderWorkbenchPage({
    role: params.role,
    activeNav: params.activeNav,
    title: "日报汇总",
    pageTitle,
    description,
    userLabel: params.userLabel,
    portfolioEnabled: Boolean(params.portfolioEnabled),
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: DAILY_REPORTS_PAGE_CSS,
    mainHtml: `
  <div class="dr-root ${roleClass}">
    <div class="dr-toolbar">
      <label class="dr-filter">
        <span class="dr-field-k">日期</span>
        <input type="date" class="dr-date-input" id="drDate" aria-label="日报日期" />
      </label>
      <button type="button" class="dr-btn" id="drRefresh">刷新</button>
      ${rosterToolbar}
    </div>
    <p class="dr-meta" id="drMeta" aria-live="polite">加载中…</p>
    ${rosterPanel}
    <div class="dr-stack" id="drContent"></div>
  </div>`,
    scriptHtml: `<script>${buildDailyReportsClientJs(apiBase, params.initialDate ?? "", canManage)}</script>`,
  });
}

function buildDailyReportsClientJs(
  apiBase: string,
  initialDate: string,
  canManageRoster: boolean,
): string {
  const api = apiBase.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const initDate = initialDate.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const canManage = canManageRoster ? "true" : "false";
  const rosterBlock = canManageRoster
    ? `
  var ROSTER = API + '/roster';
  var CONTACTS = API + '/contacts';
  var toggle = document.getElementById('drmToggle');
  var panel = document.getElementById('drmPanel');
  var cols = document.getElementById('drmCols');
  var banner = document.getElementById('drmBanner');
  var rosterLoaded = false;
  function showBanner(kind, msg){
    banner.className = 'drm-banner show ' + kind;
    banner.innerHTML = msg;
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(function(){ banner.className='drm-banner'; }, 7000);
  }
  function renderRoster(orgs){
    if(!orgs || !orgs.length){ cols.innerHTML='<div class="drm-note">配置里没有组织</div>'; return; }
    cols.innerHTML = orgs.map(function(o){
      var mark = esc((o.label||'·').slice(0,1));
      var cred = o.usesDeployedCredentials
        ? '<span class="drm-cred">复用部署凭证</span>'
        : '<span class="drm-cred indep">独立应用</span>';
      var members = (o.employees||[]).map(function(e){
        return '<div class="drm-member"><span class="drm-m-name">'+esc(e.name||e.userid)+'</span>'
          + '<span class="drm-m-uid">'+esc(e.userid)+'</span><span class="drm-m-spacer"></span>'
          + '<button class="drm-x" title="移除" data-action="remove" data-org="'+esc(o.label)+'" data-userid="'+esc(e.userid)+'">×</button></div>';
      }).join('');
      if(!members) members = '<div class="drm-members-empty">暂无成员</div>';
      return '<section class="drm-col">'
        + '<div class="drm-col-head"><span class="dr-org-mark">'+mark+'</span><h4>'+esc(o.label)+'</h4>'+cred+'</div>'
        + '<div class="drm-members">'+members+'</div>'
        + '<div class="drm-search-wrap"><input class="drm-search" data-org="'+esc(o.label)+'" placeholder="在'+esc(o.label)+'里按姓名搜索…" autocomplete="off" />'
        + '<div class="drm-results" data-results="'+esc(o.label)+'"></div></div>'
        + '</section>';
    }).join('');
  }
  function loadRoster(){
    cols.innerHTML = '<div class="drm-note"><span class="drm-spin"></span> 载入名单…</div>';
    fetch(ROSTER, {headers:{Accept:'application/json'}})
      .then(function(r){return r.json();})
      .then(function(data){
        if(!data || data.ok===false){ cols.innerHTML='<div class="drm-note">载入失败：'+esc((data&&data.error)||'未知错误')+'</div>'; return; }
        rosterLoaded = true;
        renderRoster(data.orgs);
        prewarm(data.orgs);
      })
      .catch(function(e){ cols.innerHTML='<div class="drm-note">载入失败：'+esc(e.message||e)+'</div>'; });
  }
  function prewarm(orgs){
    (orgs||[]).forEach(function(o){
      fetch(CONTACTS+'?org='+encodeURIComponent(o.label)+'&q=', {headers:{Accept:'application/json'}}).catch(function(){});
    });
  }
  function resultsBox(org){ return cols.querySelector('.drm-results[data-results="'+(window.CSS&&CSS.escape?CSS.escape(org):org)+'"]'); }
  function doSearch(org, q){
    var box = resultsBox(org);
    if(!box) return;
    if(!q){ box.className='drm-results'; box.innerHTML=''; return; }
    box.className='drm-results show';
    box.innerHTML='<div class="drm-note"><span class="drm-spin"></span> 搜索中…</div>';
    fetch(CONTACTS+'?org='+encodeURIComponent(org)+'&q='+encodeURIComponent(q), {headers:{Accept:'application/json'}})
      .then(function(r){return r.json();})
      .then(function(data){
        if(!data || data.ok===false){ box.innerHTML='<div class="drm-note">'+esc((data&&data.error)||'搜索失败')+'</div>'; return; }
        var list = data.candidates||[];
        if(!list.length){ box.innerHTML='<div class="drm-note">无匹配（首次搜索需枚举通讯录，请稍候重试）</div>'; return; }
        box.innerHTML = list.map(function(c){
          var dept = (c.departments&&c.departments.length)?('<span class="drm-r-dept">'+esc(c.departments.slice(0,2).join(' / '))+'</span>'):'';
          if(c.inRoster){
            return '<button class="drm-result" disabled><span class="drm-r-name">'+esc(c.name||c.userid)+'</span>'+dept+'<span class="drm-r-tag">已在名单</span></button>';
          }
          return '<button class="drm-result" data-action="add" data-org="'+esc(org)+'" data-userid="'+esc(c.userid)+'" data-name="'+esc(c.name||'')+'">'
            + '<span class="drm-r-name">'+esc(c.name||c.userid)+'</span>'+dept+'<span class="drm-r-uid">'+esc(c.userid)+'</span></button>';
        }).join('');
      })
      .catch(function(e){ box.innerHTML='<div class="drm-note">搜索失败：'+esc(e.message||e)+'</div>'; });
  }
  function postRoster(payload){
    return fetch(ROSTER, {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json();});
  }
  function addMember(org, userid, name){
    showBanner('ok', '<span class="drm-spin"></span> 正在加入 '+esc(name||userid)+'…');
    postRoster({action:'add', org:org, userid:userid, name:name}).then(function(data){
      if(!data || data.ok===false){ showBanner('err', '加入失败：'+esc((data&&data.error)||'未知错误')); return; }
      renderRoster(data.orgs);
      var v = data.validation||{};
      var who = esc(name||userid);
      if(v.error){ showBanner('warn', '已加入 '+who+'，但校验日报出错：'+esc(v.error)); }
      else if(v.hasRecentLog){ showBanner('ok', '已加入 '+who+' ✓ 近 '+(v.days||7)+' 天有 '+(v.count||0)+' 篇日报'+(v.templates&&v.templates.length?('（'+esc(v.templates.slice(0,2).join('、'))+'）'):'')); }
      else { showBanner('warn', '已加入 '+who+'，但近 '+(v.days||7)+' 天在该企业无日报 —— 请确认是否选错企业'); }
      load();
    }).catch(function(e){ showBanner('err', '加入失败：'+esc(e.message||e)); });
  }
  function removeMember(org, userid){
    postRoster({action:'remove', org:org, userid:userid}).then(function(data){
      if(!data || data.ok===false){ showBanner('err', '移除失败：'+esc((data&&data.error)||'未知错误')); return; }
      renderRoster(data.orgs);
      showBanner('ok', '已移除');
      load();
    }).catch(function(e){ showBanner('err', '移除失败：'+esc(e.message||e)); });
  }
  cols.addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]');
    if(!btn) return;
    var action = btn.getAttribute('data-action');
    var org = btn.getAttribute('data-org');
    var userid = btn.getAttribute('data-userid');
    if(action==='add'){ addMember(org, userid, btn.getAttribute('data-name')||''); }
    else if(action==='remove'){ removeMember(org, userid); }
  });
  var searchTimers = {};
  cols.addEventListener('input', function(e){
    var inp = e.target;
    if(!inp.classList || !inp.classList.contains('drm-search')) return;
    var org = inp.getAttribute('data-org');
    var q = inp.value.trim();
    clearTimeout(searchTimers[org]);
    searchTimers[org] = setTimeout(function(){ doSearch(org, q); }, 320);
  });
  function openPanel(){
    panel.classList.add('open');
    panel.setAttribute('aria-hidden','false');
    toggle.setAttribute('aria-expanded','true');
    if(!rosterLoaded) loadRoster();
  }
  function closePanel(){
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden','true');
    toggle.setAttribute('aria-expanded','false');
  }
  if(toggle) toggle.addEventListener('click', function(){
    if(panel.classList.contains('open')) closePanel(); else openPanel();
  });`
    : "";

  return `
(function(){
  var API = '${api}';
  var INIT_DATE = '${initDate}';
  var CAN_MANAGE = ${canManage};
  var dateInput = document.getElementById('drDate');
  var refreshBtn = document.getElementById('drRefresh');
  var meta = document.getElementById('drMeta');
  var content = document.getElementById('drContent');
  if (INIT_DATE && dateInput) dateInput.value = INIT_DATE;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmtTime(ms){ if(!ms) return ''; try { return new Date(Number(ms)).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit'}); } catch(e){ return ''; } }

  function fieldDisplay(f){
    var parts = [];
    if (String(f.value||'').trim()) parts.push(String(f.value));
    var att = f.attachments || [];
    if (att.length) {
      var names = att.map(function(a){ return a.name||'附件'; }).join('、');
      parts.push('附件 ' + att.length + ' 个：' + names);
    }
    return parts.join('\\n');
  }
  function renderReport(r){
    var head = r.templateName ? ('<div class="dr-rpt-tmpl">'+esc(r.templateName)+(r.createTime?(' · '+esc(fmtTime(r.createTime))):'')+'</div>') : '';
    var rows = (r.contents||[]).filter(function(f){
      return String(f.value||'').trim() || (f.attachments && f.attachments.length);
    }).map(function(f){
      var k = esc(f.key); var v = esc(fieldDisplay(f));
      return '<div class="dr-field"><span class="dr-field-k">'+k+'</span><span class="dr-field-v">'+v+'</span></div>';
    }).join('');
    if (r.images && r.images.length) {
      var imgNames = r.images.map(function(a){ return esc(a.name||'图片'); }).join('、');
      rows += '<div class="dr-field"><span class="dr-field-k">图片</span><span class="dr-field-v">附件 '+r.images.length+' 个：'+imgNames+'</span></div>';
    }
    if(!rows) rows = '<div class="dr-field"><span class="dr-field-v dr-muted">（无内容）</span></div>';
    return '<div class="dr-rpt">'+head+rows+'</div>';
  }
  function renderOrg(org){
    var subCount = org.submitted ? org.submitted.length : 0;
    var missCount = org.missing ? org.missing.length : 0;
    var mark = esc((org.label||'·').slice(0,1));
    var subs = (org.submitted||[]).map(function(emp){
      var multi = (emp.reports && emp.reports.length>1) ? (' <span class="dr-count">'+emp.reports.length+' 篇</span>') : '';
      return '<div class="dr-emp"><div class="dr-emp-name">'+esc(emp.name||emp.userid)+multi+'</div>'+(emp.reports||[]).map(renderReport).join('')+'</div>';
    }).join('');
    if(!subs) subs = '<div class="dr-empty">本组织该日暂无已提交日报</div>';
    var missing = missCount ? ('<div class="dr-missing"><span class="dr-missing-lbl">未提交（'+missCount+'）</span>'+org.missing.map(function(m){return esc(m.name||m.userid);}).join('、')+'</div>') : '';
    var errs = (org.errors && org.errors.length) ? ('<div class="dr-errline">读取失败：'+org.errors.map(function(e){return esc(e.name||e.userid);}).join('、')+'</div>') : '';
    return '<section class="dr-org">'
      + '<div class="dr-org-head"><div class="dr-org-title"><span class="dr-org-mark">'+mark+'</span><h2>'+esc(org.label)+'</h2></div>'
      + '<span class="dr-org-stat"><span class="dr-pill dr-pill-ok">已交 '+subCount+'</span><span class="dr-pill dr-pill-miss">未交 '+missCount+'</span></span></div>'
      + subs + missing + errs + '</section>';
  }
  function load(){
    meta.textContent = '加载中…';
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
        content.innerHTML = (data.orgs||[]).map(renderOrg).join('') || '<div class="dr-empty">暂无组织配置</div>';
      })
      .catch(function(e){ meta.textContent='加载失败：'+esc(e.message||e); });
  }
  ${rosterBlock}
  if(dateInput) dateInput.addEventListener('change', load);
  if(refreshBtn) refreshBtn.addEventListener('click', load);
  load();
})();
`;
}
