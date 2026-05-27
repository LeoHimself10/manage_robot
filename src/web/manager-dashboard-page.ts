import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { DASHBOARD_PAGE_CSS } from "./dashboard-page-styles";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";
import { buildWorkbenchFmtTimeClientJs } from "./workbench-datetime";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderManagerDashboardPage(params: {
  userLabel?: string;
  projectPortfolioEnabled?: boolean;
  initialProjectId?: string;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const portfolio = Boolean(params.projectPortfolioEnabled);
  const initialProjectId = escapeHtml(params.initialProjectId ?? "");
  const portfolioNav = portfolio
    ? '<a href="/workbench/manager/projects">项目总览</a>\n        '
    : "";
  const projectFilterBar = portfolio
    ? `<label class="dash-project-filter">项目筛选
        <select id="projectFilter">
          <option value="">全部项目</option>
          <option value="__unassigned__">未归类</option>
        </select>
      </label>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Cache-Control" content="no-cache">
<title>周度 Dashboard · 主管工作台</title>
<style>${WORKBENCH_APP_BASE_CSS}${DASHBOARD_PAGE_CSS}</style>
</head>
<body>
<div class="app-shell app-shell--dashboard">
  <header class="topbar">
    <div>
      <div class="brand">主管工作台</div>
      <h1 class="page-title">周度 Dashboard</h1>
      <p class="page-desc">周会投屏与进展汇报：一屏看清任务节奏、人员负载与关键动态。${who}</p>
    </div>
    <div class="top-actions">
      <nav class="nav-pills" aria-label="主管导航">
        ${portfolioNav}<a href="/workbench/manager/tasks">历史任务</a>
        <a class="active" href="/workbench/manager/dashboard">周度 Dashboard</a>
        <a href="/workbench/manager/chat?thread=main">智能规划助手</a>
        <a href="/workbench/employee?view=new" id="navMyTasks">我负责的任务</a>
      </nav>
      <button type="button" class="btn btn-ghost" id="logoutBtn">退出</button>
    </div>
  </header>

  <div id="historicalBanner" class="info-banner info-banner--note" hidden>
    您正在查看历史周：部分进行中的状态为推算值，请以下方「本周动态」为准做复盘。
  </div>

  <div class="dashboard-stack">
    <section class="card">
        <div class="dash-toolbar">
          <div class="dash-controls">
            <div class="week-nav" aria-label="周导航">
              <button type="button" class="btn btn-ghost btn-sm" id="prevWeekBtn" title="上一周">‹</button>
              <label>中心周
                <input type="date" id="weekInput">
              </label>
              <button type="button" class="btn btn-ghost btn-sm" id="nextWeekBtn" title="下一周">›</button>
              <div class="week-chips">
                <button type="button" class="btn btn-ghost btn-sm week-chip" data-week-offset="-1">上周</button>
                <button type="button" class="btn btn-ghost btn-sm week-chip" data-week-offset="0">本周</button>
                <button type="button" class="btn btn-ghost btn-sm week-chip" data-week-offset="1">下周</button>
              </div>
            </div>
            <label>前后周数
              <select id="spanInput">
                <option value="0">仅本周</option>
                <option value="1" selected>±1 周</option>
                <option value="2">±2 周</option>
                <option value="4">±4 周</option>
                <option value="6">±6 周</option>
              </select>
            </label>
            ${projectFilterBar}
            <button type="button" class="btn btn-primary btn-sm" id="refreshBtn">刷新</button>
          </div>
          <p class="dashboard-note" id="rangeMeta" aria-live="polite">加载中...</p>
        </div>
    </section>

    <section class="kpis kpis--6" aria-live="polite">
      <div class="kpi ok"><div class="lbl">本周完成</div><div class="val" id="kpiCompleted">-</div></div>
      <div class="kpi"><div class="lbl">执行中</div><div class="val" id="kpiInProgress">-</div></div>
      <div class="kpi warn"><div class="lbl">待承接</div><div class="val" id="kpiWaiting">-</div></div>
      <div class="kpi danger"><div class="lbl">阻塞/逾期</div><div class="val" id="kpiBlocked">-</div></div>
      <div class="kpi"><div class="lbl">下周到期</div><div class="val" id="kpiDueNext">-</div></div>
      <div class="kpi"><div class="lbl">本周动态</div><div class="val" id="kpiEvents">-</div></div>
    </section>

    <div class="dashboard-body">
    <main class="dashboard-main">
      <section class="card">
        <div class="section-head">
          <div>
            <h2>任务时间轴</h2>
            <p class="section-sub">主任务可折叠；每行子任务一条 bar，轨道上标注截止日。</p>
          </div>
          <div class="gantt-section-tools">
            <button type="button" class="advisor-trigger-btn" id="openAdvisorDrawerBtn" aria-controls="advisorDrawer">打开周会助手</button>
            <div class="gantt-density" id="ganttDensity" role="group" aria-label="甘特展开">
              <button type="button" class="is-on" data-gantt-mode="all">全部展开</button>
              <button type="button" data-gantt-mode="due">本周期有 due</button>
              <button type="button" data-gantt-mode="fold">全部折叠</button>
            </div>
          </div>
        </div>
        <div class="timeline-wrap" id="taskTimeline"></div>
        <div class="gantt-legend" aria-hidden="true">
          <span><i class="bar-inprogress"></i>执行中</span>
          <span><i class="bar-blocked"></i>阻塞</span>
          <span><i class="bar-done"></i>已完成</span>
          <span><i class="bar-waiting"></i>待承接</span>
          <span><i class="bar-due"></i>截止日</span>
        </div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <h2>明细</h2>
            <p class="section-sub">按任务核对交付，或按人员看过会负载。</p>
          </div>
          <div class="tabs" role="tablist" aria-label="明细视图">
            <button type="button" class="tabs-btn" role="tab" id="tabTasks" aria-selected="true" aria-controls="taskDetailPanel">任务明细</button>
            <button type="button" class="tabs-btn" role="tab" id="tabPeople" aria-selected="false" aria-controls="personDetailPanel">人员负载</button>
          </div>
        </div>
        <div id="taskDetailPanel" class="detail-panel" role="tabpanel"></div>
        <div id="personDetailPanel" class="detail-panel" role="tabpanel" hidden></div>
      </section>

      <section class="card">
        <div class="section-head">
          <div>
            <h2>本周动态</h2>
            <p class="section-sub">关键变更与进展记录。</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="loadMoreBtn" hidden>加载更多</button>
        </div>
        <div class="feed-list" id="feedList"></div>
      </section>
    </main>

    <aside class="dashboard-side">
      <section class="card advisor-card">
        <div class="advisor-card__head">
          <h2>周会助手</h2>
          <p class="section-sub">一键生成本周讨论要点，适合投屏过会。</p>
        </div>
        <div class="advisor-card__body" data-advisor-panel>
          <button type="button" class="btn btn-primary" data-advisor-btn>生成本周要点</button>
          <p class="advisor-meta" data-advisor-meta></p>
          <div class="advisor-empty" data-advisor-empty>尚未生成。点击上方按钮，助手会根据本周任务与动态整理过会议程。</div>
          <div class="advisor-sections" data-advisor-sections hidden></div>
        </div>
      </section>
    </aside>
    </div>
  </div>
</div>

<div class="advisor-drawer-backdrop" id="advisorBackdrop" aria-hidden="true"></div>
<div class="advisor-drawer" id="advisorDrawer" role="dialog" aria-modal="true" aria-labelledby="advisorDrawerTitle" aria-hidden="true">
  <div class="advisor-drawer__head">
    <div>
      <h2 id="advisorDrawerTitle">周会助手</h2>
      <p class="section-sub">一键生成本周讨论要点，适合投屏过会。</p>
    </div>
    <button type="button" class="advisor-drawer__close" id="closeAdvisorDrawerBtn" aria-label="关闭">×</button>
  </div>
  <div class="advisor-drawer__body">
    <div data-advisor-panel>
      <button type="button" class="btn btn-primary" data-advisor-btn>生成本周要点</button>
      <p class="advisor-meta" data-advisor-meta></p>
      <div class="advisor-empty" data-advisor-empty>尚未生成。点击上方按钮，助手会根据本周任务与动态整理过会议程。</div>
      <div class="advisor-sections" data-advisor-sections hidden></div>
    </div>
  </div>
</div>

<script>
${buildWorkbenchViewSwitchClientJs()}
${buildWorkbenchFmtTimeClientJs()}
(function () {
  var portfolioEnabled = ${portfolio ? "true" : "false"};
  var initialProjectId = ${JSON.stringify(params.initialProjectId ?? "")};
  var state = { data: null, nextCursor: null, feedItems: [], advisorGenerated: false, ganttMode: 'all', ganttOpen: {} };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function addDaysYmd(ymd, delta) {
    var p = String(ymd || '').split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function mondayForYmd(ymd) {
    var p = String(ymd || '').split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    var wd = d.getUTCDay() || 7;
    return addDaysYmd(ymd, 1 - wd);
  }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function statusLabel(status) {
    var map = {
      IN_PROGRESS: '执行中',
      ASSIGNED: '待承接',
      CHANGES_REQUESTED: '待调整',
      BLOCKED: '阻塞中',
      DONE: '已完成',
      STOPPED: '已停止',
      REJECTED: '已拒绝'
    };
    return map[status] || String(status || '未知');
  }
  function badgeClassForStatus(status) {
    if (status === 'BLOCKED') return 'badge-danger';
    if (status === 'ASSIGNED' || status === 'CHANGES_REQUESTED') return 'badge-warn';
    if (status === 'IN_PROGRESS') return 'badge-info';
    if (status === 'DONE') return 'badge-ok';
    return 'badge-muted';
  }
  function attentionLabelForGroup(g) {
    var subs = g.subtasks || [];
    if (subs.some(function (s) { return s.status === 'BLOCKED'; })) return '阻塞中';
    if (subs.some(function (s) { return s.status === 'ASSIGNED' || s.status === 'CHANGES_REQUESTED'; })) return '待员工承接';
    if (subs.some(function (s) { return s.status === 'IN_PROGRESS'; })) return '员工执行中';
    return '进行中';
  }
  function badgeClassForAttention(label) {
    if (label === '阻塞中') return 'badge-danger';
    if (label === '待员工承接') return 'badge-warn';
    if (label === '员工执行中') return 'badge-info';
    return 'badge-muted';
  }
  function isCenterWeekDay(ymd, centerMonday) {
    if (!ymd || !centerMonday) return false;
    return ymd >= centerMonday && ymd <= addDaysYmd(centerMonday, 6);
  }
  function isWeekendYmd(ymd) {
    var p = String(ymd || '').split('-').map(Number);
    var wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    return wd === 0 || wd === 6;
  }
  function qs(includeCursor, feedOnly) {
    var week = document.getElementById('weekInput').value || '';
    var span = document.getElementById('spanInput').value || '1';
    var p = new URLSearchParams();
    if (week) p.set('week', week);
    p.set('span', span);
    p.set('feedLimit', '50');
    if (portfolioEnabled) {
      var pid = document.getElementById('projectFilter');
      if (pid && pid.value) p.set('projectId', pid.value);
    }
    if (includeCursor && state.nextCursor) p.set('feedCursor', state.nextCursor);
    if (feedOnly) p.set('feedOnly', '1');
    return p.toString();
  }
  async function loadProjects() {
    if (!portfolioEnabled) return;
    var sel = document.getElementById('projectFilter');
    if (!sel) return;
    try {
      var res = await fetch('/api/workbench/manager/projects');
      var data = await res.json();
      if (!res.ok || !data.ok) return;
      (data.cards || []).forEach(function (c) {
        var pid = String(c.projectId || '');
        if (!pid || pid === '__unassigned__') return;
        var opt = document.createElement('option');
        opt.value = pid;
        opt.textContent = c.name || pid;
        sel.appendChild(opt);
      });
      if (initialProjectId) sel.value = initialProjectId;
    } catch (e) {}
  }
  async function loadDashboard(more) {
    var res = await fetch('/api/workbench/manager/weekly-dashboard?' + qs(Boolean(more), Boolean(more)));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || '加载失败');
    if (more && state.data) {
      state.feedItems = state.feedItems.concat((data.feed && data.feed.items) || []);
      state.nextCursor = data.feed && data.feed.nextCursor;
      state.data.feed = { items: state.feedItems, nextCursor: state.nextCursor };
      renderFeed(state.data);
      document.getElementById('loadMoreBtn').hidden = !state.nextCursor;
      return;
    }
    state.data = data;
    state.feedItems = (data.feed && data.feed.items) || [];
    state.nextCursor = data.feed && data.feed.nextCursor;
    if (data.week && data.week.mondayYmd) document.getElementById('weekInput').value = data.week.mondayYmd;
    render();
  }
  function render() {
    var d = state.data;
    if (!d) return;
    document.getElementById('kpiCompleted').textContent = d.kpi.completedInWeek;
    document.getElementById('kpiInProgress').textContent = d.kpi.inProgress;
    document.getElementById('kpiWaiting').textContent = d.kpi.waitingAccept;
    document.getElementById('kpiBlocked').textContent = d.kpi.blockedOrOverdue;
    document.getElementById('kpiDueNext').textContent = d.kpi.dueNextWeek;
    document.getElementById('kpiEvents').textContent = d.kpi.eventCount;
    var spanLabel = '±' + (d.span != null ? d.span : document.getElementById('spanInput').value) + ' 周';
    document.getElementById('rangeMeta').textContent = d.week.label + ' · 视图 ' + spanLabel + ' · 动态 ' + d.kpi.eventCount + ' 条';
    document.getElementById('historicalBanner').hidden = !d.approxHistoricalState;
    renderTimeline(d);
    renderTaskDetails(d);
    renderPeople(d);
    renderFeed(d);
  }
  function ganttTrackCells(days, centerMonday) {
    return days.map(function (day) {
      var cls = 'gantt-cell';
      if (isCenterWeekDay(day, centerMonday)) cls += ' is-center-week';
      if (isWeekendYmd(day)) cls += ' is-weekend';
      return '<div class="' + cls + '"></div>';
    }).join('');
  }
  function isGanttGroupOpen(taskId) {
    if (state.ganttMode === 'fold') return false;
    if (state.ganttMode === 'due') return true;
    return state.ganttOpen[taskId] !== false;
  }
  function renderSubtaskBar(b, dayCount) {
    var start = typeof b.startDayIndex === 'number' ? b.startDayIndex : b.dayIndex;
    var end = typeof b.endDayIndex === 'number' ? b.endDayIndex : b.dayIndex;
    var dueIdx = typeof b.dueDayIndex === 'number' ? b.dueDayIndex : end;
    if (start > end) { var tmp = start; start = end; end = tmp; }
    var left = (start / dayCount) * 100;
    var width = ((end - start + 1) / dayCount) * 100;
    var dueRight = ((dueIdx + 1) / dayCount) * 100;
    var label = b.title.length > 8 ? b.title.slice(0, 8) + '…' : b.title;
    var dueTag = '截止日 ' + String(b.dueYmd || '').slice(5);
    if (b.isOverdue) dueTag += ' · 逾期';
    return '<span class="gantt-bar status-' + esc(b.status) + '" style="left:' + left + '%;width:' + width + '%" title="' +
      esc(b.title + ' · ' + statusLabel(b.status)) + '">' + esc(label) + '</span>' +
      '<span class="gantt-due-marker" style="left:calc(' + dueRight + '% - 1px)" data-label="' + esc(dueTag) + '" title="' + esc(dueTag) + '"></span>';
  }
  function renderTimeline(d) {
    var days = d.timeline.days || [];
    var centerMonday = d.timeline.centerMondayYmd || (d.week && d.week.mondayYmd) || '';
    var dayCount = days.length || 1;
    var taskRows = (d.timeline.byTask || []).filter(function (row) { return (row.bars || []).length > 0; });
    if (!taskRows.length) {
      document.getElementById('taskTimeline').innerHTML = '<div class="empty-state">本周期暂无带截止日的子任务</div>';
      return;
    }
    var html = '<div class="gantt-table" style="--day-count:' + dayCount + '">';
    html += '<div class="gantt-head"><div class="gantt-label">子任务 · 负责人</div><div class="gantt-days">' + days.map(function (day) {
      var cls = 'gantt-day-h';
      if (isCenterWeekDay(day, centerMonday)) cls += ' is-center-week';
      if (isWeekendYmd(day)) cls += ' is-weekend';
      return '<div class="' + cls + '">' + esc(day.slice(5)) + '</div>';
    }).join('') + '</div></div>';
    taskRows.forEach(function (row) {
      var bars = row.bars || [];
      var open = isGanttGroupOpen(row.taskId);
      html += '<div class="gantt-row gantt-group-head' + (open ? '' : ' is-collapsed') + '" data-task-id="' + esc(row.taskId) + '">' +
        '<div class="gantt-label"><span class="gantt-chev" aria-hidden="true">▾</span>' +
        '<div class="gantt-group-title"><strong title="' + esc(row.taskNo + ' · ' + row.title) + '">' + esc(row.title) + '</strong></div></div>' +
        '<div class="gantt-group-summary">' + bars.length + ' 条子任务 · 点击展开</div></div>';
      if (open) {
        bars.forEach(function (b) {
          html += '<div class="gantt-row gantt-sub-row"><div class="gantt-label">' +
            '<div class="gantt-sub-title"><strong>' + esc(b.title) + '</strong><small>' + esc(b.assigneeName || b.assigneeUserId) + '</small></div>' +
            '<span class="badge ' + badgeClassForStatus(b.status) + '">' + esc(statusLabel(b.status)) + '</span></div>' +
            '<div class="gantt-track-wrap"><div class="gantt-track" style="--day-count:' + dayCount + '">' +
            ganttTrackCells(days, centerMonday) + renderSubtaskBar(b, dayCount) + '</div></div></div>';
        });
      }
    });
    html += '</div>';
    document.getElementById('taskTimeline').innerHTML = html;
  }
  function renderTaskDetails(d) {
    var html = (d.tasks || []).map(function (g) {
      var attn = attentionLabelForGroup(g);
      return '<details class="feed-item"><summary><strong>' + esc(g.task.taskNo) + ' · ' + esc(g.task.title) + '</strong> <span class="badge ' + badgeClassForAttention(attn) + '">' + esc(attn) + '</span></summary>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>子任务</th><th>负责人</th><th>状态</th><th>截止</th></tr></thead><tbody>' +
        (g.subtasks || []).map(function (s) {
          return '<tr><td>' + esc(s.title) + '</td><td>' + esc(s.assigneeName || s.assigneeUserId) + '</td><td><span class="badge ' + badgeClassForStatus(s.status) + '">' + esc(statusLabel(s.status)) + '</span></td><td>' + esc(s.dueAt || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }).join('');
    document.getElementById('taskDetailPanel').innerHTML = html || '<div class="empty-state">暂无任务</div>';
  }
  function renderPeople(d) {
    var rows = d.timeline.byPerson || [];
    var html = '<div class="person-card-grid">' + rows.map(function (p) {
      var dueChips = (p.days || []).filter(function (day) { return day.dueCount > 0; }).map(function (day) {
        return '<span class="due-chip" title="' + esc(day.ymd) + '">' + esc(day.ymd.slice(5)) + ' · ' + day.dueCount + '</span>';
      }).join('');
      var subList = (p.subtasks || []).slice(0, 8).map(function (s) {
        return '<li><span class="badge ' + badgeClassForStatus(s.status) + '">' + esc(statusLabel(s.status)) + '</span> ' + esc(s.taskNo) + ' · ' + esc(s.title) + '</li>';
      }).join('');
      return '<article class="person-card"><div class="person-card__head"><h3>' + esc(p.assigneeName || p.assigneeUserId) + '</h3></div>' +
        '<div class="person-card__stats">' +
        '<span>执行中 <strong>' + p.inProgressCount + '</strong></span>' +
        '<span>阻塞 <strong>' + p.blockedCount + '</strong></span>' +
        '<span>本周期到期 <strong>' + p.dueInSpanCount + '</strong></span>' +
        '<span>下周 <strong>' + p.dueNextWeekCount + '</strong></span>' +
        '</div>' +
        (dueChips ? '<div class="person-card__due">' + dueChips + '</div>' : '') +
        (subList ? '<ul class="person-card__subs">' + subList + '</ul>' : '') +
        '</article>';
    }).join('') + '</div>';
    document.getElementById('personDetailPanel').innerHTML = rows.length ? html : '<div class="empty-state">暂无人员负载</div>';
  }
  function renderFeed(d) {
    var items = (d.feed && d.feed.items) || [];
    document.getElementById('feedList').innerHTML = items.map(function (e) {
      return '<article class="feed-item"><div class="feed-meta"><span>' + fmtTime(e.occurredAt) + '</span><span class="badge badge-muted">' + esc(e.actionLabel || e.eventType) + '</span><span>' + esc(e.actorName || e.actorUserId) + '</span></div>' +
        '<strong>' + esc(e.taskNo || '') + ' ' + esc(e.taskTitle) + '</strong>' +
        (e.subtaskTitle ? '<div>' + esc(e.subtaskTitle) + '</div>' : '') +
        (e.note ? '<p class="dashboard-note">' + esc(e.note) + '</p>' : '') + '</article>';
    }).join('') || '<div class="empty-state">暂无动态</div>';
    document.getElementById('loadMoreBtn').hidden = !state.nextCursor;
  }
  function advisorSectionClass(title) {
    var t = String(title || '');
    if (/阻塞|优先|风险|逾期/.test(t)) return 'advisor-section advisor-section--high';
    if (/建议|动作|跟进/.test(t)) return 'advisor-section advisor-section--mid';
    if (/判断|概览|本周/.test(t)) return 'advisor-section advisor-section--low';
    return 'advisor-section';
  }
  function advisorEls(sel) {
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  function setAdvisorButtons(disabled, text) {
    advisorEls('[data-advisor-btn]').forEach(function (btn) {
      btn.disabled = disabled;
      btn.textContent = text;
    });
  }
  function setAdvisorMeta(text, warn) {
    advisorEls('[data-advisor-meta]').forEach(function (el) {
      el.textContent = text;
      el.classList.toggle('advisor-meta--warn', Boolean(warn));
    });
  }
  function setAdvisorEmptyHidden(hidden) {
    advisorEls('[data-advisor-empty]').forEach(function (el) { el.hidden = hidden; });
  }
  function setAdvisorSections(html, hidden) {
    advisorEls('[data-advisor-sections]').forEach(function (el) {
      el.hidden = hidden;
      if (!hidden) el.innerHTML = html;
    });
  }
  function openAdvisorDrawer() {
    document.getElementById('advisorBackdrop').classList.add('is-open');
    document.getElementById('advisorDrawer').classList.add('is-open');
    document.getElementById('advisorBackdrop').setAttribute('aria-hidden', 'false');
    document.getElementById('advisorDrawer').setAttribute('aria-hidden', 'false');
  }
  function closeAdvisorDrawer() {
    document.getElementById('advisorBackdrop').classList.remove('is-open');
    document.getElementById('advisorDrawer').classList.remove('is-open');
    document.getElementById('advisorBackdrop').setAttribute('aria-hidden', 'true');
    document.getElementById('advisorDrawer').setAttribute('aria-hidden', 'true');
  }
  async function generateAdvisor() {
    setAdvisorButtons(true, '生成中…');
    setAdvisorMeta('正在整理，请稍候…', false);
    try {
      var body = {
        week: document.getElementById('weekInput').value || undefined,
        span: Number(document.getElementById('spanInput').value || 1)
      };
      if (portfolioEnabled) {
        var pf = document.getElementById('projectFilter');
        if (pf && pf.value) body.projectId = pf.value;
      }
      var res = await fetch('/api/workbench/manager/weekly-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || '生成失败');
      state.advisorGenerated = true;
      setAdvisorEmptyHidden(true);
      var metaText = data.renderSource === 'llm' ? '已生成本周要点' : (data.timedOut ? '生成较慢，已使用备用提纲' : '已使用备用提纲');
      setAdvisorMeta(metaText, Boolean(data.timedOut));
      var sectionsHtml = (data.sections || []).map(function (s) {
        return '<section class="' + advisorSectionClass(s.title) + '"><h3>' + esc(s.title) + '</h3><ul>' + (s.bullets || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></section>';
      }).join('');
      setAdvisorSections(sectionsHtml, false);
    } catch (e) {
      setAdvisorMeta(e.message || '生成失败', false);
    } finally {
      setAdvisorButtons(false, '生成本周要点');
    }
  }
  function shiftWeek(deltaWeeks) {
    var cur = document.getElementById('weekInput').value || todayYmd();
    var monday = mondayForYmd(cur);
    document.getElementById('weekInput').value = addDaysYmd(monday, deltaWeeks * 7);
    loadDashboard(false).catch(function (e) { document.getElementById('rangeMeta').textContent = e.message; });
  }
  function setWeekOffset(offset) {
    document.getElementById('weekInput').value = addDaysYmd(mondayForYmd(todayYmd()), offset * 7);
    loadDashboard(false).catch(function (e) { document.getElementById('rangeMeta').textContent = e.message; });
  }
  function bindAutoReload(el) {
    if (!el) return;
    el.addEventListener('change', function () {
      loadDashboard(false).catch(function (e) { document.getElementById('rangeMeta').textContent = e.message; });
    });
  }
  document.getElementById('refreshBtn').addEventListener('click', function () { loadDashboard(false).catch(function (e) { document.getElementById('rangeMeta').textContent = e.message; }); });
  document.getElementById('loadMoreBtn').addEventListener('click', function () { loadDashboard(true).catch(function () {}); });
  advisorEls('[data-advisor-btn]').forEach(function (btn) {
    btn.addEventListener('click', generateAdvisor);
  });
  document.getElementById('openAdvisorDrawerBtn').addEventListener('click', openAdvisorDrawer);
  document.getElementById('closeAdvisorDrawerBtn').addEventListener('click', closeAdvisorDrawer);
  document.getElementById('advisorBackdrop').addEventListener('click', closeAdvisorDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAdvisorDrawer();
  });
  document.getElementById('prevWeekBtn').addEventListener('click', function () { shiftWeek(-1); });
  document.getElementById('nextWeekBtn').addEventListener('click', function () { shiftWeek(1); });
  document.querySelectorAll('[data-week-offset]').forEach(function (btn) {
    btn.addEventListener('click', function () { setWeekOffset(Number(btn.getAttribute('data-week-offset') || 0)); });
  });
  bindAutoReload(document.getElementById('weekInput'));
  bindAutoReload(document.getElementById('spanInput'));
  bindAutoReload(document.getElementById('projectFilter'));
  document.getElementById('tabTasks').addEventListener('click', function () {
    document.getElementById('tabTasks').setAttribute('aria-selected', 'true');
    document.getElementById('tabPeople').setAttribute('aria-selected', 'false');
    document.getElementById('taskDetailPanel').hidden = false;
    document.getElementById('personDetailPanel').hidden = true;
  });
  document.getElementById('tabPeople').addEventListener('click', function () {
    document.getElementById('tabPeople').setAttribute('aria-selected', 'true');
    document.getElementById('tabTasks').setAttribute('aria-selected', 'false');
    document.getElementById('taskDetailPanel').hidden = true;
    document.getElementById('personDetailPanel').hidden = false;
  });
  document.getElementById('taskTimeline').addEventListener('click', function (ev) {
    var head = ev.target.closest('.gantt-group-head');
    if (!head || state.ganttMode !== 'all') return;
    var taskId = head.getAttribute('data-task-id');
    if (!taskId) return;
    state.ganttOpen[taskId] = !isGanttGroupOpen(taskId);
    if (state.data) renderTimeline(state.data);
  });
  document.querySelectorAll('#ganttDensity button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#ganttDensity button').forEach(function (b) { b.classList.remove('is-on'); });
      btn.classList.add('is-on');
      state.ganttMode = btn.getAttribute('data-gantt-mode') || 'all';
      if (state.ganttMode === 'all') state.ganttOpen = {};
      if (state.data) renderTimeline(state.data);
    });
  });
  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  void loadProjects().then(function () {
    return loadDashboard(false);
  }).catch(function (e) { document.getElementById('rangeMeta').textContent = e.message; });
})();
</script>
</body>
</html>`;
}
