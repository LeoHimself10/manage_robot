import { renderWorkbenchPage } from "./workbench-shell";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PERFORMANCE_PAGE_CSS = `
.perf-stack{display:flex;flex-direction:column;gap:16px;}
.perf-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;}
.perf-field{display:flex;flex-direction:column;gap:4px;font-size:13px;}
.perf-field .lbl{color:var(--wb-muted,#667);font-size:12px;}
.perf-meta{color:var(--wb-muted,#667);font-size:12px;margin:0;}
.perf-table-wrap{overflow-x:auto;}
table.perf-table{width:100%;border-collapse:collapse;font-size:13px;}
table.perf-table th,table.perf-table td{padding:8px 10px;border-bottom:1px solid var(--wb-border,#e5e7eb);text-align:right;white-space:nowrap;}
table.perf-table th:first-child,table.perf-table td:first-child{text-align:left;position:sticky;left:0;background:var(--wb-card,#fff);}
table.perf-table th{font-weight:600;color:var(--wb-muted,#556);cursor:default;}
table.perf-table tbody tr:hover{background:rgba(0,0,0,.03);}
.perf-rate{font-weight:600;}
.perf-rate.is-high{color:#c0392b;}
.perf-rate.is-mid{color:#b9770e;}
.perf-rate.is-low{color:#1e8449;}
.perf-badge{display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;background:#f3f4f6;color:#555;}
.perf-badge.warn{background:#fef3c7;color:#92600a;}
.perf-empty{padding:24px;text-align:center;color:var(--wb-muted,#667);}
.perf-chat{display:flex;flex-direction:column;gap:10px;}
.perf-chat-log{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;padding:4px;}
.perf-msg{padding:8px 12px;border-radius:10px;max-width:88%;white-space:pre-wrap;font-size:13px;line-height:1.5;}
.perf-msg.user{align-self:flex-end;background:#2563eb;color:#fff;}
.perf-msg.bot{align-self:flex-start;background:#f1f5f9;color:#0f172a;}
.perf-chat-row{display:flex;gap:8px;}
.perf-chat-row textarea{flex:1;resize:vertical;min-height:42px;padding:8px;border:1px solid var(--wb-border,#e5e7eb);border-radius:8px;font:inherit;}
`;

export function renderPerformanceDashboardPage(params: {
  userLabel?: string;
  canViewAll?: boolean;
  showAdminOpsLink?: boolean;
  portfolioEnabled?: boolean;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const scopeLabel = params.canViewAll ? "全员（管理员视角）" : "您名下员工";
  const desc = `员工交付绩效画像：准时率、迟交次数、平均迟交天数、当前逾期与被催情况，辅助绩效考核。当前范围：${scopeLabel}。${who}`;
  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-perf",
    title: "交付绩效",
    pageTitle: "交付绩效 · 主管工作台",
    description: desc,
    userLabel: params.userLabel,
    portfolioEnabled: Boolean(params.portfolioEnabled),
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: PERFORMANCE_PAGE_CSS,
    mainHtml: `
  <div class="perf-stack">
    <section class="card">
      <div class="perf-toolbar">
        <label class="perf-field">
          <span class="lbl">统计窗口</span>
          <select class="dash-select" id="perfWindow">
            <option value="30">近 30 天</option>
            <option value="90" selected>近 90 天</option>
            <option value="180">近 180 天</option>
            <option value="365">近 1 年</option>
          </select>
        </label>
        <label class="perf-field">
          <span class="lbl">只看迟交</span>
          <select class="dash-select" id="perfFilter">
            <option value="all" selected>全部员工</option>
            <option value="late">有迟交记录</option>
            <option value="overdue">当前有逾期</option>
          </select>
        </label>
        <div class="perf-field">
          <span class="lbl">&nbsp;</span>
          <button type="button" class="btn btn-primary" id="perfRefresh">刷新</button>
        </div>
      </div>
      <p class="perf-meta" id="perfMeta" aria-live="polite">加载中...</p>
      <div class="perf-table-wrap">
        <table class="perf-table">
          <thead>
            <tr>
              <th>员工</th>
              <th title="迟交完成数 / 已完成数">迟交率</th>
              <th>迟交数</th>
              <th>已完成</th>
              <th title="迟交子任务的平均迟交天数">平均迟交(天)</th>
              <th>最大迟交(天)</th>
              <th title="当前进行中且已逾期">当前逾期</th>
              <th title="自动+手动催办累计">被催次数</th>
              <th title="名下被改派过的子任务数，影响归因">改派</th>
            </tr>
          </thead>
          <tbody id="perfBody"></tbody>
        </table>
      </div>
      <div class="perf-empty" id="perfEmpty" hidden>暂无可统计的交付数据（仅统计有截止时间的子任务）。</div>
    </section>

    <section class="card perf-chat">
      <h2 style="margin:0 0 4px;font-size:15px;">绩效问答助手</h2>
      <p class="perf-meta">向助手提问，例如「谁最近经常迟交？」「张三的准时率怎么样？」（只读分析，不会修改任何任务）。</p>
      <div class="perf-chat-log" id="perfChatLog"></div>
      <div class="perf-chat-row">
        <textarea id="perfChatInput" placeholder="输入问题，回车发送（Shift+Enter 换行）"></textarea>
        <button type="button" class="btn btn-primary" id="perfChatSend">发送</button>
      </div>
    </section>
  </div>`,
    scriptHtml: `<script>${PERFORMANCE_PAGE_CLIENT_JS}</script>`,
  });
}

const PERFORMANCE_PAGE_CLIENT_JS = `
(function(){
  var body = document.getElementById('perfBody');
  var meta = document.getElementById('perfMeta');
  var empty = document.getElementById('perfEmpty');
  var windowSel = document.getElementById('perfWindow');
  var filterSel = document.getElementById('perfFilter');
  var refreshBtn = document.getElementById('perfRefresh');
  var chatLog = document.getElementById('perfChatLog');
  var chatInput = document.getElementById('perfChatInput');
  var chatSend = document.getElementById('perfChatSend');
  var lastRows = [];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pct(r){ return (r*100).toFixed(r>=0.1?0:1) + '%'; }
  function rateClass(r){ return r>=0.4?'is-high':(r>=0.15?'is-mid':'is-low'); }

  function applyFilter(rows){
    var f = filterSel.value;
    if(f==='late') return rows.filter(function(r){return r.lateDone>0;});
    if(f==='overdue') return rows.filter(function(r){return r.currentlyOverdue>0;});
    return rows;
  }

  function render(rows){
    var shown = applyFilter(rows);
    body.innerHTML = '';
    if(!shown.length){ empty.hidden=false; return; }
    empty.hidden=true;
    shown.forEach(function(r){
      var tr = document.createElement('tr');
      var name = esc(r.name || r.userId);
      var reassign = r.reassignedInvolved>0 ? '<span class="perf-badge warn">'+r.reassignedInvolved+'</span>' : '<span class="perf-badge">0</span>';
      tr.innerHTML =
        '<td>'+name+'</td>'+
        '<td><span class="perf-rate '+rateClass(r.lateRate)+'">'+pct(r.lateRate)+'</span></td>'+
        '<td>'+r.lateDone+'</td>'+
        '<td>'+r.doneTotal+'</td>'+
        '<td>'+(r.avgLateDays||0).toFixed(2)+'</td>'+
        '<td>'+(r.maxLateDays||0).toFixed(2)+'</td>'+
        '<td>'+r.currentlyOverdue+'</td>'+
        '<td>'+r.remindedCount+'</td>'+
        '<td>'+reassign+'</td>';
      body.appendChild(tr);
    });
  }

  function load(){
    meta.textContent = '加载中...';
    fetch('/api/workbench/manager/performance?windowDays='+encodeURIComponent(windowSel.value), {headers:{'Accept':'application/json'}})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d || d.ok===false){ meta.textContent = '加载失败：'+esc((d&&d.error)||'未知错误'); return; }
        lastRows = d.employees || [];
        var asOf = d.asOf ? new Date(d.asOf).toLocaleString('zh-CN') : '';
        meta.textContent = '范围：'+(d.scopeKind==='all'?'全员':'本人名下')+' · 窗口 '+d.windowDays+' 天 · 参与统计子任务 '+d.totalSubtasksConsidered+' 条 · 截至 '+asOf;
        render(lastRows);
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

  function sendChat(){
    var msg = (chatInput.value||'').trim();
    if(!msg) return;
    chatInput.value='';
    addMsg(msg,'user');
    var pending = addMsg('思考中...','bot');
    chatSend.disabled = true;
    fetch('/api/workbench/manager/performance/chat', {
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({ message: msg })
    }).then(function(r){return r.json();})
      .then(function(d){
        pending.textContent = (d && d.ok!==false && d.message) ? d.message : ('出错了：'+((d&&d.error)||'未知错误'));
      })
      .catch(function(e){ pending.textContent = '请求失败：'+(e.message||e); })
      .finally(function(){ chatSend.disabled=false; });
  }

  refreshBtn.addEventListener('click', load);
  windowSel.addEventListener('change', load);
  filterSel.addEventListener('change', function(){ render(lastRows); });
  chatSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
  load();
})();
`;
