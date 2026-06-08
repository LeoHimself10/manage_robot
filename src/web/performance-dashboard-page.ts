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
    ? `<label class="perf-filter-block">
        <span class="perf-filter-lbl">项目筛选</span>
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
      <div class="perf-kpi"><div class="perf-kpi-lbl">统计员工</div><div class="perf-kpi-val" id="kpiEmployees">—</div><div class="perf-kpi-sub" id="kpiScoredSub">—</div></div>
      <div class="perf-kpi"><div class="perf-kpi-lbl">有迟交记录</div><div class="perf-kpi-val is-warn" id="kpiLate">—</div><div class="perf-kpi-sub">有完成样本且至少 1 次迟交</div></div>
      <div class="perf-kpi"><div class="perf-kpi-lbl">当前逾期子任务</div><div class="perf-kpi-val is-danger" id="kpiOverdue">—</div><div class="perf-kpi-sub">进行中且已过截止</div></div>
      <div class="perf-kpi"><div class="perf-kpi-lbl">平均迟交率</div><div class="perf-kpi-val" id="kpiAvgRate">—</div><div class="perf-kpi-sub">仅含「有完成样本」员工</div></div>
    </section>

    <section class="card perf-toolbar-card">
      <div class="perf-filter-grid">
        <label class="perf-filter-block">
          <span class="perf-filter-lbl">统计窗口</span>
          <select class="dash-select" id="perfWindow">
            <option value="30">近 30 天</option>
            <option value="90" selected>近 90 天</option>
            <option value="180">近 180 天</option>
            <option value="365">近 1 年</option>
          </select>
        </label>
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
        <div class="perf-filter-block">
          <span class="perf-filter-lbl">&nbsp;</span>
          <button type="button" class="btn btn-primary" id="perfRefresh">刷新</button>
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
              <th title="迟交子任务的平均迟交天数">均迟交(天)</th>
              <th>当前逾期</th>
              <th title="自动+手动催办累计">被催</th>
              <th title="名下被改派过的子任务数">改派</th>
            </tr>
          </thead>
          <tbody id="perfBody"></tbody>
        </table>
      </div>
      <div class="perf-empty" id="perfEmpty" hidden>暂无可统计的交付数据（仅统计有截止时间的子任务）。</div>
    </section>

    <section class="card perf-detail" id="perfDetail" aria-live="polite">
      <div class="perf-detail-head">
        <div>
          <h2 class="perf-detail-title" id="detailTitle">员工详情</h2>
          <p class="perf-meta" id="detailMeta" style="margin:4px 0 0;border:0;padding:0;"></p>
        </div>
        <div class="perf-detail-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="detailClose">关闭详情</button>
        </div>
      </div>
      <div class="perf-chart-row">
        <div class="perf-chart-card">
          <h3>完成交付构成</h3>
          <div class="perf-donut-wrap">
            <div class="perf-donut" id="detailDonut"><div class="perf-donut-hole" id="detailDonutPct">—</div></div>
            <div class="perf-legend" id="detailDonutLegend"></div>
          </div>
        </div>
        <div class="perf-chart-card">
          <h3>按项目分布（迟交/逾期）</h3>
          <div class="perf-bar-list" id="detailProjectBars"></div>
        </div>
      </div>
      <div class="perf-chart-card" style="margin-bottom:14px;">
        <h3>按任务展开</h3>
        <div style="overflow-x:auto;">
          <table class="perf-task-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>项目</th>
                <th class="num">子任务</th>
                <th class="num">迟交</th>
                <th class="num">逾期</th>
              </tr>
            </thead>
            <tbody id="detailTaskBody"></tbody>
          </table>
        </div>
      </div>
      <div class="perf-chart-card">
        <h3>子任务明细</h3>
        <div style="overflow-x:auto;max-height:320px;overflow-y:auto;">
          <table class="perf-task-table">
            <thead>
              <tr>
                <th>子任务</th>
                <th>任务</th>
                <th>项目</th>
                <th>状态</th>
                <th class="num">迟交(天)</th>
                <th class="num">被催</th>
              </tr>
            </thead>
            <tbody id="detailSubBody"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card perf-chat-card perf-chat">
      <h2>绩效问答助手</h2>
      <p class="perf-meta">向助手提问，例如「谁最近经常迟交？」「张三的准时率怎么样？」（只读分析，不会修改任何任务）。</p>
      <div class="perf-chat-log" id="perfChatLog"></div>
      <div class="perf-chat-row">
        <textarea id="perfChatInput" placeholder="输入问题，回车发送（Shift+Enter 换行）"></textarea>
        <button type="button" class="btn btn-primary" id="perfChatSend">发送</button>
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
  var windowSel = document.getElementById('perfWindow');
  var filterSel = document.getElementById('perfFilter');
  var projectSel = document.getElementById('perfProject');
  var refreshBtn = document.getElementById('perfRefresh');
  var chatLog = document.getElementById('perfChatLog');
  var chatInput = document.getElementById('perfChatInput');
  var chatSend = document.getElementById('perfChatSend');
  var detailPanel = document.getElementById('perfDetail');
  var detailClose = document.getElementById('detailClose');
  var lastRows = [];
  var lastProjects = [];
  var selectedUserId = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pct(r){ return (r*100).toFixed(r>=0.1?0:1) + '%'; }
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
  function tagLabel(t){
    return {on_time:'准时',late:'迟交',overdue:'逾期',pending:'进行中',stopped:'已终止'}[t]||t;
  }
  function tagClass(t){
    return {on_time:'perf-tag-ok',late:'perf-tag-late',overdue:'perf-tag-late',pending:'perf-tag-pending'}[t]||'';
  }

  function queryParams(extra){
    var p = new URLSearchParams();
    p.set('windowDays', windowSel.value);
    if(PORTFOLIO && projectSel && projectSel.value) p.set('projectId', projectSel.value);
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
    document.getElementById('kpiAvgRate').className = 'perf-kpi-val' + (avg!=null && avg>=0.2 ? ' is-warn' : avg!=null && avg>=0.4 ? ' is-danger' : '');
  }

  function fillProjectOptions(projects){
    if(!PORTFOLIO || !projectSel) return;
    var cur = projectSel.value;
    while(projectSel.options.length > 2) projectSel.remove(2);
    (projects||[]).forEach(function(p){
      if(p.projectId==='__unassigned__') return;
      var opt = document.createElement('option');
      opt.value = p.projectId;
      opt.textContent = p.projectName + ' (' + p.employeeCount + '人)';
      projectSel.appendChild(opt);
    });
    if(cur) projectSel.value = cur;
  }

  function render(rows){
    var shown = applyFilter(rows);
    body.innerHTML = '';
    document.querySelectorAll('#perfBody tr.is-active').forEach(function(tr){ tr.classList.remove('is-active'); });
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
        '<td>'+(r.sampleStatus==='scored'?(r.avgLateDays||0).toFixed(2):'—')+'</td>'+
        '<td>'+r.currentlyOverdue+'</td>'+
        '<td>'+r.remindedCount+'</td>'+
        '<td>'+reassign+'</td>';
      tr.addEventListener('click', function(){ openDetail(r.userId, r.name||r.userId); });
      body.appendChild(tr);
    });
  }

  function renderDonut(emp){
    var onTime = emp.onTimeDone||0;
    var late = emp.lateDone||0;
    var total = onTime+late;
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
    donut.style.background = 'conic-gradient(#dc2626 0 '+ (latePct*100) +'%, #16a34a '+ (latePct*100) +'% 100%)';
    legend.innerHTML =
      '<div class="perf-legend-row"><span class="perf-legend-dot" style="background:#16a34a"></span>准时 '+onTime+'</div>'+
      '<div class="perf-legend-row"><span class="perf-legend-dot" style="background:#dc2626"></span>迟交 '+late+'</div>';
  }

  function renderProjectBars(byProject){
    var el = document.getElementById('detailProjectBars');
    if(!byProject||!byProject.length){ el.innerHTML='<div class="perf-meta">暂无项目维度数据</div>'; return; }
    var max = Math.max.apply(null, byProject.map(function(p){ return p.lateDone+p.currentlyOverdue; }).concat([1]));
    el.innerHTML = byProject.slice(0,8).map(function(p){
      var score = p.lateDone+p.currentlyOverdue;
      var w = Math.round(score/max*100);
      var cls = p.currentlyOverdue>0?' is-danger':(p.lateDone>0?' is-warn':'');
      return '<div class="perf-bar-row"><div class="perf-bar-label"><span>'+esc(p.projectName)+'</span><span>'+p.lateDone+'迟 / '+p.currentlyOverdue+'逾</span></div><div class="perf-bar-track"><div class="perf-bar-fill'+cls+'" style="width:'+w+'%"></div></div></div>';
    }).join('');
  }

  function renderDetailTables(byTask, subtasks){
    var taskBody = document.getElementById('detailTaskBody');
    var subBody = document.getElementById('detailSubBody');
    taskBody.innerHTML = (byTask||[]).map(function(t){
      var label = esc(t.taskNo ? t.taskNo+' · '+t.taskTitle : t.taskTitle);
      return '<tr><td>'+label+'</td><td>'+esc(t.projectName||'—')+'</td><td class="num">'+t.withDueTotal+'</td><td class="num">'+t.lateDone+'</td><td class="num">'+t.currentlyOverdue+'</td></tr>';
    }).join('') || '<tr><td colspan="5">暂无任务数据</td></tr>';
    subBody.innerHTML = (subtasks||[]).slice(0,100).map(function(s){
      return '<tr><td>'+esc(s.subtaskTitle)+'</td><td>'+esc(s.taskTitle)+'</td><td>'+esc(s.projectName||'—')+'</td><td><span class="'+tagClass(s.deliveryTag)+'">'+tagLabel(s.deliveryTag)+'</span></td><td class="num">'+(s.lateDays!=null?s.lateDays.toFixed(2):'—')+'</td><td class="num">'+s.remindedCount+'</td></tr>';
    }).join('') || '<tr><td colspan="6">暂无子任务</td></tr>';
  }

  function openDetail(userId, displayName){
    selectedUserId = userId;
    render(lastRows);
    detailPanel.classList.add('is-open');
    document.getElementById('detailTitle').textContent = displayName + ' · 交付详情';
    document.getElementById('detailMeta').textContent = '加载中...';
    fetch(API_BASE+'/employee?'+queryParams({userId:userId}), {headers:{'Accept':'application/json'}})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d||d.ok===false){ document.getElementById('detailMeta').textContent='加载失败'; return; }
        var emp = d.employee;
        document.getElementById('detailMeta').textContent =
          (emp.lateRateLabel||'—')+' · 已完成 '+emp.doneTotal+' · 进行中 '+emp.inFlightTotal+' · 当前逾期 '+emp.currentlyOverdue;
        renderDonut(emp);
        renderProjectBars(d.byProject);
        renderDetailTables(d.byTask, d.subtasks);
        detailPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
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
        lastProjects = d.projects || [];
        renderKpi(d.kpi);
        fillProjectOptions(lastProjects);
        var asOf = d.asOf ? new Date(d.asOf).toLocaleString('zh-CN') : '';
        meta.textContent = (d.scopeLabel||'')+' · 窗口 '+d.windowDays+' 天 · 参与统计子任务 '+d.totalSubtasksConsidered+' 条 · 截至 '+asOf;
        render(lastRows);
        if(selectedUserId){
          var row = lastRows.find(function(r){return r.userId===selectedUserId;});
          if(row) openDetail(row.userId, row.name||row.userId);
        }
      })
      .catch(function(e){ meta.textContent = '加载失败：'+esc(e.message||e); });
  }

  function addMsg(text, who){
    var div = document.createElement('div');
    div.className = 'perf-msg '+(who==='user'?'user':'bot');
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    return div;
  }

  function chatPageQuery(){
    var q = { message: '', windowDays: Number(windowSel.value)||90, stream: true };
    if(PORTFOLIO && projectSel && projectSel.value) q.projectId = projectSel.value;
    return q;
  }

  function parseSseBlock(block){
    var event = 'message';
    var data = '';
    block.split('\\n').forEach(function(line){
      if(line.indexOf('event:')===0) event = line.slice(6).trim();
      else if(line.indexOf('data:')===0) data = line.slice(5).trim();
    });
    if(!data) return null;
    try { return { event: event, data: JSON.parse(data) }; } catch(e){ return null; }
  }

  function sendChat(){
    var msg = (chatInput.value||'').trim();
    if(!msg) return;
    chatInput.value='';
    addMsg(msg,'user');
    var pending = addMsg('正在分析...','bot');
    chatSend.disabled = true;
    var payload = chatPageQuery();
    payload.message = msg;
    fetch(API_BASE+'/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body: JSON.stringify(payload)
    }).then(function(r){
      if(!r.ok || !r.body) throw new Error('HTTP '+r.status);
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      function pump(){
        return reader.read().then(function(chunk){
          if(chunk.done){
            if(!pending.textContent || pending.textContent==='正在分析...' || pending.textContent==='正在查询数据...'){
              pending.textContent = '未收到回复，请重试。';
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
              if(ev.data.phase==='thinking') pending.textContent = '正在分析...';
              if(ev.data.phase==='querying') pending.textContent = '正在查询数据...';
            } else if(ev.event==='delta' && ev.data.message){
              pending.textContent = ev.data.message;
              chatLog.scrollTop = chatLog.scrollHeight;
            } else if(ev.event==='done' && ev.data.message){
              pending.textContent = ev.data.message;
            } else if(ev.event==='error'){
              pending.textContent = '出错了：'+(ev.data.error||'未知错误');
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function(e){ pending.textContent = '请求失败：'+(e.message||e); })
      .finally(function(){ chatSend.disabled=false; });
  }

  refreshBtn.addEventListener('click', load);
  windowSel.addEventListener('change', load);
  if(projectSel) projectSel.addEventListener('change', load);
  filterSel.addEventListener('change', function(){ render(lastRows); });
  detailClose.addEventListener('click', function(){
    selectedUserId=null;
    detailPanel.classList.remove('is-open');
    render(lastRows);
  });
  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
  load();
})();
`;
}
