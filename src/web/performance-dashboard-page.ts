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
      <div class="perf-detail-toolbar">
        <label class="perf-filter-block is-grow">
          <span class="perf-filter-lbl">项目筛选</span>
          <select class="dash-select" id="detailProject">
            <option value="">全部项目</option>
          </select>
        </label>
      </div>
      <div class="perf-mini-kpis" id="detailMiniKpis"></div>
      <div class="perf-chart-card perf-stack-summary">
        <h3>交付四态构成</h3>
        <div class="perf-stack-row is-total" id="detailTotalStack"></div>
        <div class="perf-stack-legend" id="detailStackLegend"></div>
      </div>
      <div class="perf-chart-card">
        <h3>按项目分布</h3>
        <div class="perf-stack-list" id="detailProjectStacks"></div>
      </div>
      <div class="perf-chart-card perf-accordion-card">
        <button type="button" class="perf-accordion-toggle" id="detailTasksToggle" aria-expanded="false">
          <span id="detailTasksToggleLabel">任务与子任务明细</span>
          <span class="perf-accordion-chevron" aria-hidden="true">▸</span>
        </button>
        <div class="perf-accordion-body" id="detailTasksBody" hidden></div>
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
    scriptHtml: `<script src="/static/performance-chat-markdown.js"></script><script>${buildPerformanceClientJs(apiBase, portfolio)}</script>`,
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
  var detailProjectSel = document.getElementById('detailProject');
  var detailTasksToggle = document.getElementById('detailTasksToggle');
  var detailTasksBody = document.getElementById('detailTasksBody');
  var detailProjectId = '';
  var lastDetailProjectOptions = [];
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
  function fmtAssistant(s){
    if(typeof window.formatPerfAssistantHtml === 'function'){
      return window.formatPerfAssistantHtml(String(s||''));
    }
    return fmt(s);
  }
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
  function tagLabel(t){ return {on_time:'准时完成',late:'迟交完成',overdue:'进行中已逾期',pending:'进行中未逾期',stopped:'已终止'}[t]||t; }
  function tagClass(t){ return {on_time:'ok',late:'late',overdue:'overdue',pending:'pending',stopped:'stopped'}[t]||''; }

  function deliveryCounts(source){
    var onTime = source.onTimeDone||0;
    var late = source.lateDone||0;
    var overdue = source.currentlyOverdue||0;
    var pending = source.pendingInFlight;
    if(pending == null) pending = Math.max(0, (source.inFlightTotal||0) - overdue);
    var total = onTime + late + pending + overdue;
    if(!total && source.withDueTotal) total = source.withDueTotal;
    return { onTime: onTime, late: late, pending: pending, overdue: overdue, total: total };
  }

  function stackLegendHtml(counts){
    return [
      ['准时完成', counts.onTime, 'is-on-time'],
      ['迟交完成', counts.late, 'is-late'],
      ['进行中未逾期', counts.pending, 'is-pending'],
      ['进行中已逾期', counts.overdue, 'is-overdue'],
    ].map(function(row){
      return '<span class="perf-stack-legend-item '+row[2]+'"><i></i>'+esc(row[0])+' '+row[1]+'</span>';
    }).join('');
  }

  function renderStackedBar(counts, label){
    var total = counts.total;
    if(total <= 0){
      return '<div class="perf-stack-row"><div class="perf-stack-label">'+esc(label||'—')+'</div><div class="perf-stack-track is-empty"><span class="perf-stack-empty">暂无有效子任务</span></div></div>';
    }
    var segs = [
      { cls: 'is-on-time', n: counts.onTime },
      { cls: 'is-late', n: counts.late },
      { cls: 'is-pending', n: counts.pending },
      { cls: 'is-overdue', n: counts.overdue },
    ];
    var bar = segs.map(function(s){
      if(s.n <= 0) return '';
      var w = Math.max(0.35, (s.n / total) * 100);
      return '<span class="perf-stack-seg '+s.cls+'" style="width:'+w.toFixed(2)+'%" title="'+s.n+'/'+total+'"></span>';
    }).join('');
    var sub = counts.onTime+'准 · '+counts.late+'迟 · '+counts.pending+'进行 · '+counts.overdue+'逾';
    return '<div class="perf-stack-row"><div class="perf-stack-label"><span>'+esc(label||'合计')+'</span><span class="muted">'+total+' 条 · '+esc(sub)+'</span></div><div class="perf-stack-track">'+bar+'</div></div>';
  }

  function fillDetailProjectOptions(options){
    if(!detailProjectSel) return;
    var cur = detailProjectId;
    while(detailProjectSel.options.length > 1) detailProjectSel.remove(1);
    (options||[]).forEach(function(p){
      if(p.projectId==='__unassigned__') return;
      var opt = document.createElement('option');
      opt.value = p.projectId;
      opt.textContent = p.projectName + (p.withDueTotal != null ? (' ('+p.withDueTotal+'条)') : '');
      detailProjectSel.appendChild(opt);
    });
    var has = cur && Array.prototype.some.call(detailProjectSel.options, function(o){ return o.value===cur; });
    detailProjectSel.value = has ? cur : '';
    if(!has) detailProjectId = detailProjectSel.value || '';
  }

  function detailQueryParams(userId){
    var p = new URLSearchParams();
    p.set('windowDays', windowDays);
    p.set('userId', userId);
    if(detailProjectId) p.set('projectId', detailProjectId);
    return p.toString();
  }

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
    var c = deliveryCounts(emp);
    document.getElementById('detailMiniKpis').innerHTML =
      miniKpi('准时完成', c.onTime)+
      miniKpi('迟交完成', c.late)+
      miniKpi('进行中未逾期', c.pending)+
      miniKpi('进行中已逾期', c.overdue)+
      miniKpi('迟交率', emp.lateRateLabel||'—')+
      miniKpi('被催次数', emp.remindedCount||0);
  }

  function renderDeliveryStacks(emp, byProject){
    var totalCounts = deliveryCounts(emp);
    document.getElementById('detailTotalStack').innerHTML = renderStackedBar(totalCounts, '窗口内合计');
    document.getElementById('detailStackLegend').innerHTML = stackLegendHtml(totalCounts);
    var el = document.getElementById('detailProjectStacks');
    if(!byProject || !byProject.length){
      el.innerHTML = '<div class="perf-meta" style="border:0;padding:0;margin:0;">暂无项目维度数据</div>';
      return;
    }
    el.innerHTML = byProject.slice(0, 12).map(function(p){
      return renderStackedBar(deliveryCounts(p), p.projectName);
    }).join('');
  }

  function renderTaskAccordion(byTask){
    var toggleLabel = document.getElementById('detailTasksToggleLabel');
    var tasks = byTask || [];
    if(toggleLabel) toggleLabel.textContent = '任务与子任务明细（'+tasks.length+' 个任务，点击展开）';
    if(detailTasksToggle) detailTasksToggle.setAttribute('aria-expanded', 'false');
    if(detailTasksBody){
      detailTasksBody.hidden = true;
      if(!tasks.length){
        detailTasksBody.innerHTML = '<div class="perf-meta" style="padding:12px 0;margin:0;">暂无任务数据</div>';
        return;
      }
      detailTasksBody.innerHTML = tasks.map(function(t, idx){
        var label = esc(t.taskNo ? t.taskNo+' · '+t.taskTitle : t.taskTitle);
        var c = deliveryCounts(t);
        var headSub = c.total+' 子任务 · '+c.onTime+'准 · '+c.late+'迟 · '+c.pending+'进行 · '+c.overdue+'逾';
        var subs = (t.subtasks||[]).map(function(s){
          return '<tr><td>'+esc(s.subtaskTitle)+'</td><td><span class="perf-pill '+tagClass(s.deliveryTag)+'">'+tagLabel(s.deliveryTag)+'</span></td><td class="num">'+(s.lateDays!=null?s.lateDays.toFixed(1):'—')+'</td><td class="num">'+s.remindedCount+'</td></tr>';
        }).join('');
        return '<div class="perf-task-group" data-task-idx="'+idx+'">'+
          '<button type="button" class="perf-task-head" aria-expanded="false">'+
            '<span class="perf-task-head-main">'+label+'</span>'+
            '<span class="perf-task-head-sub">'+esc(t.projectName||'—')+' · '+esc(headSub)+'</span>'+
            '<span class="perf-accordion-chevron" aria-hidden="true">▸</span>'+
          '</button>'+
          '<div class="perf-task-body" hidden>'+
            '<div class="perf-subtable-wrap is-scroll">'+
              '<table class="perf-task-table"><thead><tr><th>子任务</th><th>交付状态</th><th class="num">迟交(天)</th><th class="num">被催</th></tr></thead><tbody>'+
              (subs || '<tr><td colspan="4" style="color:var(--muted);">暂无子任务</td></tr>')+
              '</tbody></table></div></div></div>';
      }).join('');
      Array.prototype.forEach.call(detailTasksBody.querySelectorAll('.perf-task-head'), function(btn){
        btn.addEventListener('click', function(){
          var expanded = btn.getAttribute('aria-expanded') === 'true';
          btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
          var body = btn.nextElementSibling;
          if(body) body.hidden = expanded;
        });
      });
    }
  }

  function renderDetailView(d){
    var emp = d.employee;
    var projLabel = detailProjectId && detailProjectSel && detailProjectSel.selectedIndex > 0
      ? detailProjectSel.options[detailProjectSel.selectedIndex].text.replace(/\\s*\\(\\d+条\\)$/,'')
      : '';
    document.getElementById('detailMeta').textContent =
      '迟交率 '+(emp.lateRateLabel||'—')+' · 进行中 '+emp.inFlightTotal+' · 被催 '+emp.remindedCount+
      (projLabel ? (' · 项目：'+projLabel) : '');
    renderMiniKpis(emp);
    renderDeliveryStacks(emp, d.byProject);
    renderTaskAccordion(d.byTask);
  }

  function loadDetail(userId, displayName, resetProjectFilter){
    if(resetProjectFilter) detailProjectId = '';
    selectedUserId = userId;
    selectedName = displayName;
    Array.prototype.forEach.call(document.querySelectorAll('#perfBody tr'), function(tr){
      tr.classList.toggle('is-active', tr.dataset.userId===userId);
    });
    detailPanel.classList.add('is-open');
    document.getElementById('detailAvatar').textContent = initials(displayName);
    document.getElementById('detailTitle').textContent = displayName + ' · 交付详情';
    document.getElementById('detailMeta').textContent = '加载中...';
    fetch(API_BASE+'/employee?'+detailQueryParams(userId), {headers:{'Accept':'application/json'}})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d||d.ok===false){ document.getElementById('detailMeta').textContent='加载失败'; return; }
        if(d.employeeProjectOptions && d.employeeProjectOptions.length) lastDetailProjectOptions = d.employeeProjectOptions;
        fillDetailProjectOptions(lastDetailProjectOptions);
        renderDetailView(d);
        detailPanel.scrollIntoView({behavior:'smooth',block:'start'});
      })
      .catch(function(e){ document.getElementById('detailMeta').textContent='加载失败：'+(e.message||e); });
  }

  function openDetail(userId, displayName){
    loadDetail(userId, displayName, true);
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
          if(row) loadDetail(row.userId, row.name||row.userId, false);
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
      else bubble.innerHTML = fmtAssistant(turn.content);
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
      function setStream(t){ hasText=true; bubble.innerHTML = fmtAssistant(t)+'<span class="perf-stream-cursor"></span>'; chatLog.scrollTop = chatLog.scrollHeight; }
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
              bubble.innerHTML = fmtAssistant(finalMessage);
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
  if(detailProjectSel) detailProjectSel.addEventListener('change', function(){
    detailProjectId = detailProjectSel.value || '';
    if(selectedUserId && selectedName) loadDetail(selectedUserId, selectedName, false);
  });
  if(detailTasksToggle && detailTasksBody){
    detailTasksToggle.addEventListener('click', function(){
      var open = detailTasksToggle.getAttribute('aria-expanded') === 'true';
      detailTasksToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      detailTasksBody.hidden = open;
      var label = document.getElementById('detailTasksToggleLabel');
      if(label){
        var n = detailTasksBody.querySelectorAll('.perf-task-group').length;
        label.textContent = open
          ? ('任务与子任务明细（'+n+' 个任务，点击展开）')
          : ('任务与子任务明细（'+n+' 个任务，点击收起）');
      }
    });
  }
  filterSel.addEventListener('change', function(){ render(lastRows); });
  detailClose.addEventListener('click', function(){
    selectedUserId=null;
    detailProjectId='';
    detailPanel.classList.remove('is-open');
    Array.prototype.forEach.call(document.querySelectorAll('#perfBody tr.is-active'), function(tr){ tr.classList.remove('is-active'); });
  });
  detailAsk.addEventListener('click', function(){
    if(!selectedName) return;
    var proj = detailProjectId && detailProjectSel && detailProjectSel.selectedIndex > 0
      ? ('在「'+detailProjectSel.options[detailProjectSel.selectedIndex].text.replace(/\\s*\\(\\d+条\\)$/,'')+'」项目中')
      : ((PORTFOLIO && projectSel && projectSel.value && projectSel.selectedIndex>1)
        ? ('在「'+projectSel.options[projectSel.selectedIndex].text.replace(/\\s*\\(\\d+人\\)$/,'')+'」项目中')
        : '按项目维度');
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
