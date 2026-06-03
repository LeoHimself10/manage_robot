import { renderWorkbenchPage } from "./workbench-shell";

export function renderAdminOpsDashboardPage(params: { userLabel?: string }): string {
  return renderWorkbenchPage({
    role: "admin",
    activeNav: "adm-ops",
    title: "运营看板",
    pageTitle: "Agent 运营看板",
    description: "Agent 用量、Token 消耗、质量异常与 Eval 健康度。工作台 DAU 统计打开页面、智能助手对话与任务 API 操作，不含「仅任务库更新时间」被动变更。",
    userLabel: params.userLabel,
    mainHtml: `
  <section class="kpis kpis--3" aria-live="polite" style="margin-bottom:16px;">
    <div class="kpi"><div class="lbl">DAU（当日）/ WAU（本周）</div><div class="val" id="kpiUsers">—</div><div class="muted" style="font-size:12px;margin-top:4px;" id="kpiDauDate"></div></div>
    <div class="kpi"><div class="lbl">对话轮次</div><div class="val" id="kpiTurns">—</div></div>
    <div class="kpi"><div class="lbl">Token 消耗</div><div class="val" id="kpiTokens">—</div></div>
  </section>
  <section class="kpis kpis--3" style="margin-bottom:16px;">
    <div class="kpi"><div class="lbl">工作台整体 DAU / WAU（去重）</div><div class="val" id="kpiWorkbenchAll">—</div></div>
    <div class="kpi"><div class="lbl">主管端 DAU / WAU</div><div class="val" id="kpiWorkbenchManager">—</div></div>
    <div class="kpi"><div class="lbl">员工端 DAU / WAU</div><div class="val" id="kpiWorkbenchEmployee">—</div></div>
  </section>
  <section class="kpis kpis--3" style="margin-bottom:16px;">
    <div class="kpi"><div class="lbl">p90 响应 (ms)</div><div class="val" id="kpiP90">—</div></div>
    <div class="kpi"><div class="lbl">质量异常</div><div class="val" id="kpiIncidents">—</div></div>
    <div class="kpi"><div class="lbl">Eval 健康</div><div class="val" id="kpiEval">—</div></div>
  </section>
  <section class="kpis kpis--3" style="margin-bottom:16px;">
    <div class="kpi"><div class="lbl">质检抽样</div><div class="val" id="kpiQualitySampled">—</div></div>
    <div class="kpi"><div class="lbl">规则通过率</div><div class="val" id="kpiQualityPass">—</div></div>
    <div class="kpi"><div class="lbl">Judge 通过率</div><div class="val" id="kpiJudgePass">—</div></div>
  </section>
  <div class="card mgr-list-toolbar form-stack" style="margin-bottom:14px;">
    <label>中心周<input type="date" id="weekInput" /></label>
    <button class="btn btn-primary btn-sm" id="refreshBtn" type="button">刷新</button>
  </div>
  <div class="feedback muted" id="opsFeedback"></div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">每日趋势</h2>
    <div id="trendMount" class="empty-state">加载中…</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">按渠道</h2>
    <div id="channelMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">工作台活跃用户（统计日）</h2>
    <div id="workbenchUserDayMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">工作台活跃用户（本周）</h2>
    <div id="workbenchUserWeekMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">Agent 对话活跃用户 Top</h2>
    <div id="userMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">质量异常</h2>
    <div id="incidentMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">在线质检失败</h2>
    <div id="qualityFailMount" class="empty-state">—</div>
  </div>
  <div class="card" style="margin-bottom:14px;">
    <h2 style="margin:0 0 10px;font-size:15px;">待晋升 Eval 候选</h2>
    <p class="muted" style="font-size:13px;margin:0 0 8px;">CLI: <code>npx tsx scripts/promote-eval-candidate.ts --traceId=…</code></p>
    <div id="candidateMount" class="empty-state">—</div>
  </div>
  <div class="card">
    <h2 style="margin:0 0 10px;font-size:15px;">最近 Eval 运行</h2>
    <div id="evalMount" class="empty-state">—</div>
  </div>`,
    scriptHtml: `<script>
(function () {
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function setFb(msg, kind) {
    var el = document.getElementById('opsFeedback');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }
  function userNameCell(r) {
    var name = esc(r.displayName || r.userId);
    var id = esc(r.userId || '');
    if (r.displayName && r.displayName !== r.userId) {
      return '<td><strong>' + name + '</strong><div class="muted" style="font-size:12px;"><code>' + id + '</code></div></td>';
    }
    return '<td><code>' + id + '</code></td>';
  }
  function renderWorkbenchUsers(rows) {
    if (!rows || !rows.length) return '暂无数据';
    var body = rows.map(function (r) {
      return '<tr>' + userNameCell(r)
        + '<td>' + esc(r.surfaceLabel || '—') + '</td><td>' + esc(r.eventCount) + '</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table class="data"><thead><tr><th>姓名</th><th>端</th><th>事件数</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  async function load() {
    setFb('加载中…', 'muted');
    var week = (document.getElementById('weekInput').value || '').trim();
    var url = '/api/workbench/admin/ops-dashboard?span=1' + (week ? '&week=' + encodeURIComponent(week) : '');
    try {
      var res = await fetch(url);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var k = data.kpi || {};
      setText('kpiUsers', (k.dau || 0) + ' / ' + (k.wau || 0));
      setText('kpiDauDate', k.dauDate ? ('统计日 ' + k.dauDate) : '');
      var wb = k.workbench || {};
      var mgr = wb.manager || {};
      var emp = wb.employee || {};
      setText('kpiWorkbenchAll', (wb.dau || 0) + ' / ' + (wb.wau || 0));
      setText('kpiWorkbenchManager', (mgr.dau || 0) + ' / ' + (mgr.wau || 0));
      setText('kpiWorkbenchEmployee', (emp.dau || 0) + ' / ' + (emp.wau || 0));
      setText('kpiTurns', k.turnCount || 0);
      setText('kpiTokens', (k.totalTokens || 0).toLocaleString());
      setText('kpiP90', Math.round(k.p90LoopMs || 0));
      var inc = 0;
      var ic = k.incidentCount || {};
      Object.keys(ic).forEach(function (key) { inc += Number(ic[key] || 0); });
      setText('kpiIncidents', inc);
      var eh = k.evalHealth || {};
      setText('kpiEval', eh.lastReleaseOk === true ? '通过' : (eh.lastReleaseOk === false ? '失败' : '—'));
      setText('kpiQualitySampled', k.qualitySampledCount != null ? k.qualitySampledCount : '—');
      setText('kpiQualityPass', k.qualityPassRate != null ? Math.round(k.qualityPassRate * 100) + '%' : '—');
      setText('kpiJudgePass', k.judgePassRate != null ? Math.round(k.judgePassRate * 100) + '%' : '—');
      var trend = (data.dailyTrend || []).map(function (d) {
        return '<tr><td>' + esc(d.date) + '</td><td>' + esc(d.turnCount) + '</td><td>' + esc(d.promptTokens + d.completionTokens) + '</td></tr>';
      }).join('');
      document.getElementById('trendMount').innerHTML = trend
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>日期</th><th>轮次</th><th>Tokens</th></tr></thead><tbody>' + trend + '</tbody></table></div>'
        : '暂无数据';
      var ch = (data.byChannel || []).map(function (r) {
        return '<tr><td>' + esc(r.channel) + '</td><td>' + esc(r.turnCount) + '</td><td>' + esc(r.tokens) + '</td></tr>';
      }).join('');
      document.getElementById('channelMount').innerHTML = ch
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>渠道</th><th>轮次</th><th>Tokens</th></tr></thead><tbody>' + ch + '</tbody></table></div>'
        : '暂无数据';
      document.getElementById('workbenchUserDayMount').innerHTML = renderWorkbenchUsers(data.workbenchActiveUsersDay || []);
      document.getElementById('workbenchUserWeekMount').innerHTML = renderWorkbenchUsers(data.workbenchActiveUsersWeek || []);
      var users = (data.byUser || []).map(function (r) {
        return '<tr>' + userNameCell(r) + '<td>' + esc(r.turnCount) + '</td><td>' + esc(r.tokens) + '</td></tr>';
      }).join('');
      document.getElementById('userMount').innerHTML = users
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>姓名</th><th>轮次</th><th>Tokens</th></tr></thead><tbody>' + users + '</tbody></table></div>'
        : '暂无数据';
      var incRows = (data.incidents || []).map(function (r) {
        return '<tr><td><code>' + esc(r.traceId) + '</code></td>' + userNameCell(r) + '<td>' + esc((r.flags || []).join(', ')) + '</td></tr>';
      }).join('');
      document.getElementById('incidentMount').innerHTML = incRows
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>traceId</th><th>姓名</th><th>flags</th></tr></thead><tbody>' + incRows + '</tbody></table></div>'
        : '暂无异常';
      var qf = (data.qualityFails || []).map(function (r) {
        return '<tr><td><code>' + esc(r.traceId) + '</code></td>' + userNameCell(r) + '<td>' + esc((r.reasons || []).join('; ')) + '</td></tr>';
      }).join('');
      document.getElementById('qualityFailMount').innerHTML = qf
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>traceId</th><th>姓名</th><th>原因</th></tr></thead><tbody>' + qf + '</tbody></table></div>'
        : '暂无失败';
      var cand = (data.evalCandidates || []).map(function (r) {
        return '<tr><td><code>' + esc(r.traceId) + '</code></td><td>' + esc(r.createdAt) + '</td><td>' + esc((r.failReasons || []).join('; ')) + '</td></tr>';
      }).join('');
      document.getElementById('candidateMount').innerHTML = cand
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>traceId</th><th>时间</th><th>失败原因</th></tr></thead><tbody>' + cand + '</tbody></table></div>'
        : '暂无待处理候选';
      var evals = (data.evalRuns || []).map(function (r) {
        return '<tr><td>' + esc(r.suite) + '</td><td>' + esc(r.startedAt) + '</td><td>' + (r.allOk ? 'OK' : 'FAIL') + '</td></tr>';
      }).join('');
      document.getElementById('evalMount').innerHTML = evals
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Suite</th><th>时间</th><th>结果</th></tr></thead><tbody>' + evals + '</tbody></table></div>'
        : '暂无 eval 历史';
      setFb('已更新 ' + (data.generatedAt || ''), 'ok');
    } catch (e) {
      setFb(String(e && e.message ? e.message : e), 'err');
    }
  }
  document.getElementById('refreshBtn').addEventListener('click', function () { void load(); });
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });
  void load();
})();
</script>`,
  });
}
