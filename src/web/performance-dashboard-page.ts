import { PERFORMANCE_PAGE_CSS } from "./performance-page-styles";
import { renderWorkbenchPage, type WorkbenchNavId, type WorkbenchShellRole } from "./workbench-shell";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderPerformanceDashboardPage(params: {
  userLabel?: string;
  role?: WorkbenchShellRole;
  scopeLabel?: string;
  apiBase?: string;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
}): string {
  const role = params.role ?? "manager";
  const activeNav: WorkbenchNavId = role === "admin" ? "adm-perf" : "mgr-perf";
  const scopeLabel = escapeHtml(params.scopeLabel ?? "您名下员工");
  const apiBase = escapeHtml(params.apiBase ?? "/api/workbench/manager/performance");
  const who = params.userLabel ? escapeHtml(params.userLabel) : role === "admin" ? "管理员" : "主管";
  const portfolio = Boolean(params.portfolioEnabled);
  const pageTitle = role === "admin" ? "交付绩效 · 管理员" : "交付绩效 · 主管工作台";
  const projectFilter = portfolio
    ? `<label class="perf-filter-block is-grow">
        <span class="perf-filter-lbl">项目</span>
        <select class="dash-select" id="perfProject">
          <option value="">全部项目</option>
          <option value="__unassigned__">未归类</option>
        </select>
      </label>`
    : "";

  const desc = `员工交付绩效画像：准时率、迟交次数、平均迟交天数、当前逾期与被催情况，辅助绩效考核。当前范围：${scopeLabel}。${who}`;

  return renderWorkbenchPage({
    role,
    activeNav,
    title: "交付绩效",
    pageTitle,
    description: desc,
    userLabel: params.userLabel,
    portfolioEnabled: portfolio,
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: PERFORMANCE_PAGE_CSS,
    mainBodyClass: "app-shell--performance",
    mainHtml: `
  <div class="perf-stack">
    <section class="perf-kpi-grid" id="perfKpiGrid" aria-live="polite">
      <div class="perf-kpi is-primary"><div class="perf-kpi-lbl">统计员工</div><div class="perf-kpi-val" id="kpiEmployees">—</div><div class="perf-kpi-sub" id="kpiScoredSub">—</div></div>
      <div class="perf-kpi is-warn"><div class="perf-kpi-lbl">有迟交记录</div><div class="perf-kpi-val" id="kpiLate">—</div><div class="perf-kpi-sub">有完成样本且至少 1 次迟交</div></div>
      <div class="perf-kpi is-danger"><div class="perf-kpi-lbl">当前逾期子任务</div><div class="perf-kpi-val" id="kpiOverdue">—</div><div class="perf-kpi-sub">进行中且已过截止</div></div>
      <div class="perf-kpi is-accent"><div class="perf-kpi-lbl">平均迟交率</div><div class="perf-kpi-val" id="kpiAvgRate">—</div><div class="perf-kpi-sub">仅含「有完成样本」员工</div></div>
    </section>

    <section class="card perf-toolbar-card">
      <div class="perf-toolbar-top">
        <div class="perf-seg-block">
          <span class="perf-filter-lbl">统计窗口</span>
          <div class="perf-segmented" id="perfWindow" role="group" aria-label="统计窗口">
            <button type="button" data-window="30">30 天</button>
            <button type="button" data-window="90" class="is-on">90 天</button>
            <button type="button" data-window="180">180 天</button>
            <button type="button" data-window="365">1 年</button>
          </div>
        </div>
        ${projectFilter}
        <label class="perf-filter-block">
          <span class="perf-filter-lbl">列表筛选</span>
          <select class="dash-select" id="perfFilter">
            <option value="all" selected>全部员工</option>
            <option value="scored">有完成样本</option>
            <option value="late">有迟交记录</option>
            <option value="overdue">当前有逾期</option>
            <option value="insufficient">待完成（样本不足）</option>
          </select>
        </label>
        <span class="perf-toolbar-spacer"></span>
        <div class="perf-filter-block">
          <span class="perf-filter-lbl">&nbsp;</span>
          <button type="button" class="btn btn-secondary" id="perfRefresh">刷新</button>
        </div>
      </div>
      <p class="perf-meta" id="perfMeta" aria-live="polite">加载中...</p>
      <div class="perf-table-wrap">
        <table class="perf-table">
          <thead>
            <tr>
              <th>员工</th>
              <th title="迟交完成数 / 已完成数；无完成样本显示 —">迟交率</th>
              <th>迟交</th>
              <th>已完成</th>
              <th>进行中</th>
              <th title="迟交子任务的平均迟交天数">均迟交</th>
              <th>当前逾期</th>
              <th title="自动+手动催办累计">被催</th>
              <th title="名下被改派过的子任务数">改派</th>
            </tr>
          </thead>
          <tbody id="perfBody"></tbody>
        </table>
      </div>
      <div class="perf-empty" id="perfEmpty" hidden>暂无可统计的交付数据（仅统计有截止时间、未停止的子任务）。</div>
    </section>

    <section class="card perf-detail" id="perfDetail" aria-live="polite">
      <div class="perf-detail-head">
        <div class="perf-detail-id">
          <div class="perf-detail-avatar" id="detailAvatar">—</div>
          <div>
            <h2 class="perf-detail-title" id="detailTitle">员工详情</h2>
            <p class="perf-detail-meta" id="detailMeta"></p>
          </div>
        </div>
        <div class="perf-detail-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="detailAsk">让助手按项目点评</button>
          <button type="button" class="btn btn-ghost btn-sm" id="detailClose">关闭</button>
        </div>
      </div>
      <div class="perf-mini-kpis" id="detailMiniKpis"></div>
      <div class="perf-chart-row">
        <div class="perf-chart-card">
          <h3>完成交付构成</h3>
          <div class="perf-donut-wrap">
            <div class="perf-donut" id="detailDonut"><div class="perf-donut-hole" id="detailDonutPct">—</div></div>
            <div class="perf-legend" id="detailDonutLegend"></div>
          </div>
        </div>
        <div class="perf-chart-card">
          <h3>按项目分布（迟交 / 逾期）</h3>
          <div class="perf-bar-list" id="detailProjectBars"></div>
        </div>
      </div>
      <div class="perf-chart-card" style="margin-bottom:14px;">
        <h3>按任务展开</h3>
        <div class="perf-subtable-wrap">
          <table class="perf-task-table">
            <thead>
              <tr><th>任务</th><th>项目</th><th class="num">子任务</th><th class="num">迟交</th><th class="num">逾期</th></tr>
            </thead>
            <tbody id="detailTaskBody"></tbody>
          </table>
        </div>
      </div>
      <div class="perf-chart-card">
        <h3>子任务明细</h3>
        <div class="perf-subtable-wrap is-scroll">
          <table class="perf-task-table">
            <thead>
              <tr><th>子任务</th><th>任务</th><th>项目</th><th>状态</th><th class="num">迟交(天)</th><th class="num">被催</th></tr>
            </thead>
            <tbody id="detailSubBody"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card perf-chat-card">
      <div class="perf-chat-head">
        <div class="perf-chat-head-avatar">AI</div>
        <div>
          <h2>绩效问答助手</h2>
          <p>只读分析，不会修改任何任务 · 口径与上表一致</p>
        </div>
        <span class="perf-chat-status">在线</span>
      </div>
      <div class="perf-chat-log" id="perfChatLog">
        <div class="perf-chat-empty" id="perfChatEmpty">
          <p>问我关于团队交付的任何问题 👇</p>
          <div class="perf-chips" id="perfChips">
            <button type="button" class="perf-chip" data-q="谁最近经常迟交？">谁最近经常迟交？</button>
            <button type="button" class="perf-chip" data-q="整体准时率怎么样？">整体准时率怎么样？</button>
            <button type="button" class="perf-chip" data-q="当前有哪些逾期需要关注？">当前有哪些逾期？</button>
          </div>
        </div>
      </div>
      <div class="perf-composer">
        <textarea id="perfChatInput" rows="1" placeholder="输入问题，回车发送（Shift+Enter 换行）"></textarea>
        <button type="button" class="perf-send" id="perfChatSend" aria-label="发送" title="发送">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
        </button>
      </div>
    </section>
  </div>`,
    scriptHtml: `<script>${buildPerformanceClientJs(apiBase, portfolio)}</script>`,
  });
}

function buildPerformanceClientJs(apiBase: string, portfolioEnabled: boolean): string {
  const api = apiBase.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const portfolio = portfolioEnabled ? "true" : "false";
  return `
(function(){
  var API_BASE = '${api}';
  var PORTFOLIO = ${portfolio};
  var body = document.getElementById('perfBody');
  var meta = document.getElementById('perfMeta');
  var empty = document.getElementById('perfEmpty');
  var windowSeg = document.getElementById('perfWindow');
  var filterSel = document.getElementById('perfFilter');
  var projectSel = document.getElementById('perfProject');
  var refreshBtn = document.getElementById('perfRefresh');
  var chatLog = document.getElementById('perfChatLog');
  var chatEmpty = document.getElementById('perfChatEmpty');
  var chatInput = document.getElementById('perfChatInput');
  var chatSend = document.getElementById('perfChatSend');
  var detailPanel = document.getElementById('perfDetail');
  var detailClose = document.getElementById('detailClose');
  var detailAsk = document.getElementById('detailAsk');
  var lastRows = [];
  var selectedUserId = null;
  var selectedName = null;
  var windowDays = 90;
  var streaming = false;
  var CHAT_STORE_KEY = 'perf_chat_history_v1:' + API_BASE;
  var chatHistory = [];

  function loadChatHistory(){
    try {
      var raw = sessionStorage.getItem(CHAT_STORE_KEY);
      if(!raw) return [];
      var parsed = JSON.parse(raw);
      if(!Array.isArray(parsed)) return [];
      return parsed.filter(function(t){
        return t && (t.role==='user' || t.role==='assistant') && String(t.content||'').trim();
      }).slice(-20);
    } catch(e){ return []; }
  }

  function saveChatHistory(){
    try { sessionStorage.setItem(CHAT_STORE_KEY, JSON.stringify(chatHistory.slice(-20))); } catch(e){}
  }

  function pushChatTurn(role, content){
    var text = String(content||'').trim();
    if(!text) return;
    chatHistory.push({ role: role, content: text.slice(0, 4000) });
    if(chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    saveChatHistory();
  }

  chatHistory = loadChatHistory();

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function fmt(s){ return esc(s).replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>'); }
  function pct(r){ return (r*100).toFixed(r>=0.1?0:1) + '%'; }
  function initials(name){ var n=String(name||'').trim(); return n? n.slice(0,2) : '—'; }
  function rateClass(r, status){
    if(status && status!=='scored') return 'is-muted';
    if(r==null) return 'is-muted';
    return r>=0.4?'is-high':(r>=0.15?'is-mid':'is-low');
  }
  function sampleBadge(s){
    if(s==='scored') return '';
    if(s==='insufficient') return '<span class="perf-badge info">待完成</span>';
    return '<span class="perf-badge muted">无活跃</span>';
  }
  function tagLabel(t){ return {on_time:'准时',late:'迟交',overdue:'逾期',pending:'进行中',stopped:'已终止'}[t]||t; }
  function tagClass(t){ return {on_time:'ok',late:'late',overdue:'late',pending:'pending',stopped:'stopped'}[t]||''; }

  function currentProjectId(){ return (PORTFOLIO && projectSel && projectSel.value) ? projectSel.value : ''; }

  function queryParams(extra){
    var p = new URLSearchParams();
    p.set('windowDays', windowDays);
    var pid = currentProjectId();
    if(pid) p.set('projectId', pid);
    if(extra) Object.keys(extra).forEach(function(k){ if(extra[k]!=null) p.set(k, extra[k]); });
    return p.toString();
  }

  function applyFilter(rows){
    var f = filterSel.value;
    if(f==='scored') return rows.filter(function(r){return r.sampleStatus==='scored';});
    if(f==='late') return rows.filter(function(r){return r.lateDone>0;});
    if(f==='overdue') return rows.filter(function(r){return r.currentlyOverdue>0;});
    if(f==='insufficient') return rows.filter(function(r){return r.sampleStatus==='insufficient';});
    return rows;
  }

  function renderKpi(kpi){
    if(!kpi) return;
    document.getElementById('kpiEmployees').textContent = kpi.employeeCount;
    document.getElementById('kpiScoredSub').textContent = '有完成样本 '+kpi.scoredEmployeeCount+' 人';
    document.getElementById('kpiLate').textContent = kpi.employeesWithLate;
    document.getElementById('kpiOverdue').textContent = kpi.totalCurrentlyOverdue;
    var avg = kpi.avgLateRateAmongScored;
    document.getElementById('kpiAvgRate').textContent = avg==null ? '—' : pct(avg);
  }

  function fillProjectOptions(projectOptions){
    if(!PORTFOLIO || !projectSel) return;
    var cur = projectSel.value;
    while(projectSel.options.length > 2) projectSel.remove(2);
    (projectOptions||[]).forEach(function(p){
      if(p.projectId==='__unassigned__') return;
      var opt = document.createElement('option');
      opt.value = p.projectId;
      opt.textContent = p.projectName + ' (' + p.employeeCount + '人)';
      projectSel.appendChild(opt);
    });
    if(cur){
      var has = Array.prototype.some.call(projectSel.options, function(o){return o.value===cur;});
      projectSel.value = has ? cur : '';
    }
  }

  function render(rows){
    var shown = applyFilter(rows);
    body.innerHTML = '';
    if(!shown.length){ empty.hidden=false; return; }
    empty.hidden=true;
    shown.forEach(function(r){
      var tr = document.createElement('tr');
      tr.dataset.userId = r.userId;
      if(selectedUserId===r.userId) tr.classList.add('is-active');
      var name = esc(r.name || r.userId);
      var sub = r.sampleStatus==='scored'
        ? ('已完成 '+r.doneTotal+' · 进行中 '+r.inFlightTotal)
        : (r.sampleStatus==='insufficient' ? ('进行中 '+r.inFlightTotal+(r.currentlyOverdue>0?' · 逾期 '+r.currentlyOverdue:'')) : '窗口内无活跃交付');
      var rateTxt = esc(r.lateRateLabel || '—');
      var reassign = r.reassignedInvolved>0 ? '<span class="perf-badge warn">'+r.reassignedInvolved+'</span>' : '<span class="perf-badge">0</span>';
      tr.innerHTML =
        '<td><div class="perf-name-cell"><span class="perf-name-main">'+name+' '+sampleBadge(r.sampleStatus)+'</span><span class="perf-name-sub">'+esc(sub)+'</span></div></td>'+
        '<td><span class="perf-rate '+rateClass(r.lateRate,r.sampleStatus)+'">'+rateTxt+'</span></td>'+
        '<td>'+r.lateDone+'</td>'+
        '<td>'+r.doneTotal+'</td>'+
        '<td>'+r.inFlightTotal+'</td>'+
        '<td>'+(r.sampleStatus==='scored'?(r.avgLateDays||0).toFixed(1):'—')+'</td>'+
        '<td>'+r.currentlyOverdue+'</td>'+
        '<td>'+r.remindedCount+'</td>'+
        '<td>'+reassign+'</td>';
      tr.addEventListener('click', function(){ openDetail(r.userId, r.name||r.userId); });
      body.appendChild(tr);
    });
  }

  function miniKpi(lbl, val){ return '<div class="perf-mini"><div class="perf-mini-lbl">'+esc(lbl)+'</div><div class="perf-mini-val">'+esc(val)+'</div></div>'; }

  function renderMiniKpis(emp){
    document.getElementById('detailMiniKpis').innerHTML =
      miniKpi('迟交率', emp.lateRateLabel||'—')+
      miniKpi('已完成', emp.doneTotal)+
      miniKpi('当前逾期', emp.currentlyOverdue)+
      miniKpi('平均迟交(天)', emp.sampleStatus==='scored'?(emp.avgLateDays||0).toFixed(1):'—');
  }

  function renderDonut(emp){
    var onTime = emp.onTimeDone||0, late = emp.lateDone||0, total = onTime+late;
    var hole = document.getElementById('detailDonutPct');
    var donut = document.getElementById('detailDonut');
    var legend = document.getElementById('detailDonutLegend');
    if(total<=0){
      hole.textContent='—';
      donut.style.background='#f1f5f9';
      legend.innerHTML='<div class="perf-legend-row">暂无已完成样本</div>';
      return;
    }
    var latePct = late/total;
    hole.textContent = pct(latePct);
    donut.style.background = 'conic-gradient(#dc2626 0 '+(latePct*100)+'%, #059669 '+(latePct*100)+'% 100%)';
    legend.innerHTML =
      '<div class="perf-legend-row"><span class="perf-legend-dot" style="background:#059669"></span>准时 '+onTime+'</div>'+
      '<div class="perf-legend-row"><span class="perf-legend-dot" style="background:#dc2626"></span>迟交 '+late+'</div>';
  }

  function renderProjectBars(byProject){
    var el = document.getElementById('detailProjectBars');
    if(!byProject||!byProject.length){ el.innerHTML='<div class="perf-meta" style="border:0;padding:0;margin:0;">暂无项目维度数据</div>'; return; }
    var max = Math.max.apply(null, byProject.map(function(p){ return p.withDueTotal; }).concat([1]));
    el.innerHTML = byProject.slice(0,10).map(function(p){
      var score = p.lateDone+p.currentlyOverdue;
      var w = Math.max(4, Math.round(p.withDueTotal/max*100));
      var cls = p.currentlyOverdue>0?' is-danger':(p.lateDone>0?' is-warn':' is-ok');
      return '<div class="perf-bar-row"><div class="perf-bar-label"><span>'+esc(p.projectName)+'</span><span class="muted">'+p.doneTotal+'完成 · '+p.lateDone+'迟 · '+p.currentlyOverdue+'逾</span></div><div class="perf-bar-track"><div class="perf-bar-fill'+cls+'" style="width:'+w+'%"></div></div></div>';
    }).join('');
  }

  function renderDetailTables(byTask, subtasks){
    document.getElementById('detailTaskBody').innerHTML = (byTask||[]).map(function(t){
      var label = esc(t.taskNo ? t.taskNo+' · '+t.taskTitle : t.taskTitle);
      return '<tr><td>'+label+'</td><td>'+esc(t.projectName||'—')+'</td><td class="num">'+t.withDueTotal+'</td><td class="num">'+t.lateDone+'</td><td class="num">'+t.currentlyOverdue+'</td></tr>';
    }).join('') || '<tr><td colspan="5" style="color:var(--muted);">暂无任务数据</td></tr>';
    document.getElementById('detailSubBody').innerHTML = (subtasks||[]).slice(0,100).map(function(s){
      return '<tr><td>'+esc(s.subtaskTitle)+'</td><td>'+esc(s.taskTitle)+'</td><td>'+esc(s.projectName||'—')+'</td><td><span class="perf-pill '+tagClass(s.deliveryTag)+'">'+tagLabel(s.deliveryTag)+'</span></td><td class="num">'+(s.lateDays!=null?s.lateDays.toFixed(1):'—')+'</td><td class="num">'+s.remindedCount+'</td></tr>';
    }).join('') || '<tr><td colspan="6" style="color:var(--muted);">暂无子任务</td></tr>';
  }

  function openDetail(userId, displayName){
    selectedUserId = userId;
    selectedName = displayName;
    Array.prototype.forEach.call(document.querySelectorAll('#perfBody tr'), function(tr){
      tr.classList.toggle('is-active', tr.dataset.userId===userId);
    });
    detailPanel.classList.add('is-open');
    document.getElementById('detailAvatar').textContent = initials(displayName);
    document.getElementById('detailTitle').textContent = displayName + ' · 交付详情';
    document.getElementById('detailMeta').textContent = '加载中...';
    fetch(API_BASE+'/employee?'+queryParams({userId:userId}), {headers:{'Accept':'application/json'}})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d||d.ok===false){ document.getElementById('detailMeta').textContent='加载失败'; return; }
        var emp = d.employee;
        document.getElementById('detailMeta').textContent =
          '迟交率 '+(emp.lateRateLabel||'—')+' · 进行中 '+emp.inFlightTotal+' · 被催 '+emp.remindedCount+(currentProjectId()?' · 已按项目筛选':'');
        renderMiniKpis(emp);
        renderDonut(emp);
        renderProjectBars(d.byProject);
        renderDetailTables(d.byTask, d.subtasks);
        detailPanel.scrollIntoView({behavior:'smooth',block:'start'});
      })
      .catch(function(e){ document.getElementById('detailMeta').textContent='加载失败：'+(e.message||e); });
  }

  function load(){
    meta.textContent = '加载中...';
    fetch(API_BASE+'?'+queryParams(), {headers:{'Accept':'application/json'}})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d || d.ok===false){ meta.textContent = '加载失败：'+esc((d&&d.error)||'未知错误'); return; }
        lastRows = d.employees || [];
        renderKpi(d.kpi);
        fillProjectOptions(d.projectOptions || d.projects);
        var asOf = d.asOf ? new Date(d.asOf).toLocaleString('zh-CN') : '';
        meta.textContent = (d.scopeLabel||'')+' · 窗口 '+d.windowDays+' 天 · 参与统计子任务 '+d.totalSubtasksConsidered+' 条（不含已停止）· 截至 '+asOf;
        render(lastRows);
        if(selectedUserId){
          var row = lastRows.find(function(r){return r.userId===selectedUserId;});
          if(row) openDetail(row.userId, row.name||row.userId);
          else { detailPanel.classList.remove('is-open'); selectedUserId=null; }
        }
      })
      .catch(function(e){ meta.textContent = '加载失败：'+esc(e.message||e); });
  }

  /* ---------- chat ---------- */
  function hideEmpty(){ if(chatEmpty){ chatEmpty.style.display='none'; } }

  function addMsg(who){
    hideEmpty();
    var row = document.createElement('div');
    row.className = 'perf-msg-row '+(who==='user'?'is-user':'is-bot');
    var avatar = document.createElement('div');
    avatar.className = 'perf-avatar '+(who==='user'?'is-user':'is-bot');
    avatar.textContent = who==='user' ? '我' : 'AI';
    var bubble = document.createElement('div');
    bubble.className = 'perf-bubble';
    row.appendChild(avatar);
    row.appendChild(bubble);
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
    return bubble;
  }

  function showTyping(bubble){ bubble.innerHTML = '<span class="perf-dots"><i></i><i></i><i></i></span>'; }

  function autoGrow(){
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(140, chatInput.scrollHeight) + 'px';
  }

  function parseSseBlock(block){
    var event='message', data='';
    block.split('\\n').forEach(function(line){
      if(line.indexOf('event:')===0) event = line.slice(6).trim();
      else if(line.indexOf('data:')===0) data = line.slice(5).trim();
    });
    if(!data) return null;
    try { return { event: event, data: JSON.parse(data) }; } catch(e){ return null; }
  }

  function restoreChatFromHistory(){
    if(!chatHistory.length) return;
    chatHistory.forEach(function(turn){
      var bubble = addMsg(turn.role === 'user' ? 'user' : 'bot');
      if(turn.role === 'user') bubble.textContent = turn.content;
      else bubble.innerHTML = fmt(turn.content);
    });
  }

  function sendChat(text){
    var msg = (text!=null?text:chatInput.value||'').trim();
    if(!msg || streaming) return;
    streaming = true;
    chatInput.value=''; autoGrow();
    var u = addMsg('user'); u.textContent = msg;
    var bubble = addMsg('bot');
    showTyping(bubble);
    chatSend.disabled = true;
    var hasText = false;
    var finalMessage = '';
    var payload = {
      message: msg,
      windowDays: windowDays,
      stream: true,
      conversationHistory: chatHistory.slice()
    };
    var pid = currentProjectId();
    if(pid) payload.projectId = pid;
    fetch(API_BASE+'/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body: JSON.stringify(payload)
    }).then(function(r){
      if(!r.ok || !r.body) throw new Error('HTTP '+r.status);
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function setStream(t){ hasText=true; bubble.innerHTML = fmt(t)+'<span class="perf-stream-cursor"></span>'; chatLog.scrollTop = chatLog.scrollHeight; }
      function pump(){
        return reader.read().then(function(chunk){
          if(chunk.done){
            if(!hasText) bubble.textContent = '未收到回复，请重试。';
            else {
              bubble.innerHTML = bubble.innerHTML.replace(/<span class="perf-stream-cursor"><\\/span>/,'');
              if(!finalMessage){
                finalMessage = bubble.textContent || '';
              }
            }
            return;
          }
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split('\\n\\n');
          buf = parts.pop() || '';
          parts.forEach(function(block){
            var ev = parseSseBlock(block);
            if(!ev) return;
            if(ev.event==='status'){
              if(!hasText) showTyping(bubble);
            } else if(ev.event==='delta' && ev.data.message){
              setStream(ev.data.message);
            } else if(ev.event==='done' && ev.data.message){
              hasText=true;
              finalMessage = String(ev.data.message||'');
              bubble.innerHTML = fmt(finalMessage);
            } else if(ev.event==='error'){
              bubble.textContent = '出错了：'+(ev.data.error||'未知错误');
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function(e){ bubble.textContent = '请求失败：'+(e.message||e); })
      .finally(function(){
        if(finalMessage){
          pushChatTurn('user', msg);
          pushChatTurn('assistant', finalMessage);
        }
        streaming=false;
        chatSend.disabled=false;
        chatInput.focus();
      });
  }

  restoreChatFromHistory();

  /* ---------- wiring ---------- */
  Array.prototype.forEach.call(windowSeg.querySelectorAll('button'), function(btn){
    btn.addEventListener('click', function(){
      Array.prototype.forEach.call(windowSeg.querySelectorAll('button'), function(b){ b.classList.remove('is-on'); });
      btn.classList.add('is-on');
      windowDays = Number(btn.dataset.window)||90;
      load();
    });
  });
  refreshBtn.addEventListener('click', load);
  if(projectSel) projectSel.addEventListener('change', load);
  filterSel.addEventListener('change', function(){ render(lastRows); });
  detailClose.addEventListener('click', function(){
    selectedUserId=null;
    detailPanel.classList.remove('is-open');
    Array.prototype.forEach.call(document.querySelectorAll('#perfBody tr.is-active'), function(tr){ tr.classList.remove('is-active'); });
  });
  detailAsk.addEventListener('click', function(){
    if(!selectedName) return;
    var proj = (PORTFOLIO && projectSel && projectSel.value && projectSel.selectedIndex>1) ? ('在「'+projectSel.options[projectSel.selectedIndex].text.replace(/\\s*\\(\\d+人\\)$/,'')+'」项目中') : '按项目维度';
    sendChat('请'+proj+'点评 '+selectedName+' 最近的交付表现。');
    document.querySelector('.perf-chat-card').scrollIntoView({behavior:'smooth',block:'start'});
  });
  chatSend.addEventListener('click', function(){ sendChat(); });
  chatInput.addEventListener('input', autoGrow);
  chatInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
  Array.prototype.forEach.call(document.querySelectorAll('.perf-chip'), function(chip){
    chip.addEventListener('click', function(){ sendChat(chip.dataset.q); });
  });
  load();
})();
`;
}
