'use strict';
let dashboardDays=30,dashboardExpanded=false,dashboardFilter='';
const dashboardPanel=document.createElement('section');
dashboardPanel.className='panel quality-dashboard';dashboardPanel.setAttribute('aria-label','质量处理总览');
document.querySelector('section.panel').before(dashboardPanel);
const dashboardSummary=()=>QualityDashboardData.summarize(storeData.events,dashboardDays);
const dashboardLabels={analysis:'待我初析',review:'待我终验',overdue:'超期未闭环',high:'高风险未关闭',closed:'所选时段已关闭',focus:'重点关注',periodNew:'时段内新增',periodClosed:'时段内流程完成',periodReturned:'时段内质量退回',periodReopened:'时段内重开'};
function renderDashboard(){
  const d=dashboardSummary(),count=k=>d.groups[k].length;
  const metrics=[['analysis','待我初析','核对分析，形成处理要求'],['review','待我终验','查看证据包并确认处理结果'],['overdue','超期未闭环','正式任务期限 · 按事件去重'],['high','高风险未关闭','持续关注处理进展'],['closed','所选时段已关闭','按最近一次终验关闭日期']];
  const button=(key,label,help)=>`<button class="qd-metric ${['overdue','high'].includes(key)?'qd-alert':''}" data-dashboard-filter="${key}" aria-pressed="${dashboardFilter===key}"><span>${label}</span><strong>${count(key)}<small> 件</small></strong><small>${help}</small></button>`;
  const max=Math.max(1,...d.buckets.flatMap(b=>[b.added,b.closed]));
  dashboardPanel.innerHTML=`<div class="qd-heading"><h2>质量处理总览</h2><span>当前待办不受时段限制</span><small>更新于 ${esc(tongRealNow())}</small></div>
    <div class="qd-metrics">${metrics.map(m=>button(...m)).join('')}</div>
    <div class="qd-focus"><div><h3>重点关注</h3><p>高风险、超期及等待较久的事件</p><button class="text-btn" data-dashboard-filter="focus">查看全部关注事件 →</button></div><div class="qd-focus-list">${d.focus.slice(0,3).map(r=>`<button class="qd-focus-row" data-dashboard-open="${esc(r.id)}"><span>${esc(r.e.source.title)}<small>${esc(r.e.no)} · ${esc(r.e.source.model||'型号未提供')}</small></span><span>${badge(r.overdue?'超期 '+r.overdueDays+' 天':r.high?'高风险':'等待 '+r.waitDays+' 天','red')}</span><small>${esc(statusText[r.e.mode])}</small><small>${esc(owner(r.e))}</small></button>`).join('')||'<p class="qd-empty">暂无需要重点关注的事件</p>'}</div></div>
    <div class="qd-period"><div><h3>阶段与趋势</h3><small>新增、关闭、质量退回与重开按所选时段统计</small></div><div class="qd-actions">${[[7,'最近一周'],[30,'最近一个月'],[90,'最近三个月']].map(([days,label])=>`<button class="btn ${days===dashboardDays?'active':''}" data-dashboard-days="${days}" aria-pressed="${days===dashboardDays}">${label}</button>`).join('')}<button class="btn" data-dashboard-expand aria-expanded="${dashboardExpanded}">${dashboardExpanded?'收起统计 ↑':'展开统计 ↓'}</button></div></div>
    ${dashboardExpanded?`<div class="qd-stats"><div class="qd-period-metrics">${[['periodNew','新增事件'],['periodClosed','流程完成'],['periodReturned','质量退回'],['periodReopened','事件重开']].map(([key,label])=>button(key,label,'时段内按事件去重')).join('')}</div><h3>事件新增与关闭趋势</h3><p class="qd-legend">蓝色：新增　绿色：关闭；同一事件在同一时间段内去重</p><div class="qd-chart">${d.buckets.map(b=>`<div class="qd-chart-item"><div class="qd-bars"><span style="height:${Math.max(2,b.added/max*90)}px" aria-label="新增 ${b.added} 件"><b>${b.added}</b></span><span class="closed" style="height:${Math.max(2,b.closed/max*90)}px" aria-label="关闭 ${b.closed} 件"><b>${b.closed}</b></span></div><small>${b.label} 起</small></div>`).join('')}</div></div>`:''}`;
}
const dashboardOriginalFiltered=filtered;
filtered=function(){const list=dashboardOriginalFiltered();if(!dashboardFilter)return list;const ids=new Set(dashboardSummary().groups[dashboardFilter]||[]);return list.filter(e=>ids.has(e.id));};
const dashboardOriginalRender=render;
render=function(){renderDashboard();dashboardOriginalRender();if(dashboardFilter)$('resultSummary').append(document.createTextNode(' · '+dashboardLabels[dashboardFilter]));$('clearFilters').hidden=!(dashboardFilter||state.query||state.risk||state.department);};
dashboardPanel.addEventListener('click',ev=>{
  const b=ev.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-dashboard-expand')){dashboardExpanded=!dashboardExpanded;renderDashboard();return;}
  if(b.dataset.dashboardDays){dashboardDays=Number(b.dataset.dashboardDays);render();return;}
  readEditor();
  if(b.dataset.dashboardFilter){dashboardFilter=b.dataset.dashboardFilter;state.scope='全部事件';state.query='';state.risk='';state.department='';state.selected=null;$('searchInput').value='';$('riskFilter').value='';$('departmentFilter').value='';}
  if(b.dataset.dashboardOpen){dashboardFilter='';state.scope='全部事件';state.query='';state.risk='';state.department='';state.selected=b.dataset.dashboardOpen;state.tab='source';$('searchInput').value='';$('riskFilter').value='';$('departmentFilter').value='';}
  render();document.querySelector('section.panel[aria-label="质量事件列表"]').scrollIntoView({block:'start',behavior:'smooth'});
});
document.addEventListener('click',ev=>{if(ev.target.closest('[data-scope],#clearFilters,[data-action="clear"]'))dashboardFilter='';},true);
renderDashboard();
