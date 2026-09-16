(function(root){
  const day=86400000;
  const time=value=>{if(!value)return NaN;const raw=String(value);return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T23:59:59+08:00':/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)?raw.replace(' ','T')+'+08:00':raw);};
  function summarize(events,days=30,now=Date.now()){
    const end=Math.floor((now+8*3600000)/day)*day-8*3600000+day;
    const start=end-days*day;
    const inRange=value=>time(value)>=start&&time(value)<end&&time(value)<=now;
    const rows=events.filter(e=>e.real).map(e=>{
      const record=e.real.finalReview?.event||{}, history=e.real.finalReview?.history||[];
      const nodes=e.real.finalReview?.nodes||[];
      const due=[...new Map(nodes.filter(n=>n.work?.subtaskId).map(n=>[n.work.subtaskId,n.work])).values()]
        .filter(w=>!['DONE','CANCELLED'].includes(w.formalStatus)&&time(w.dueAt)<now).map(w=>time(w.dueAt));
      const closed=e.mode==='closed';
      const closedAt=history.find(h=>h.action==='QUALITY_CLOSED')?.occurredAt;
      return {e,id:e.id,closed,createdAt:record.submittedAt||record.createdAt,
        closedAt,overdue:!closed&&due.length>0,overdueDays:due.length?Math.max(1,Math.ceil((now-Math.min(...due))/day)):0,
        high:!closed&&e.risk==='高风险',waitDays:Math.max(0,Math.floor((now-time(record.updatedAt||record.createdAt))/day))||0,
        returned:history.some(h=>h.action==='QUALITY_RETURNED_NODE'&&inRange(h.occurredAt)),
        reopened:history.some(h=>h.action==='QUALITY_REOPENED'&&inRange(h.occurredAt)),
        periodClosed:history.some(h=>h.action==='QUALITY_CLOSED'&&inRange(h.occurredAt)),
        periodNew:inRange(record.submittedAt||record.createdAt)};
    });
    const ids=predicate=>rows.filter(predicate).map(r=>r.id);
    const groups={analysis:ids(r=>r.e.mode==='analysis'),review:ids(r=>r.e.mode==='quality'),
      overdue:ids(r=>r.overdue),high:ids(r=>r.high),closed:ids(r=>r.closed&&inRange(r.closedAt)),
      periodNew:ids(r=>r.periodNew),periodClosed:ids(r=>r.periodClosed),periodReturned:ids(r=>r.returned),periodReopened:ids(r=>r.reopened)};
    const focus=rows.filter(r=>!r.closed&&(r.overdue||r.high||r.waitDays>=7||['returned','reopened'].includes(r.e.mode)))
      .sort((a,b)=>Number(b.high)-Number(a.high)||b.overdueDays-a.overdueDays||b.waitDays-a.waitDays);
    groups.focus=focus.map(r=>r.id);
    const buckets=Array.from({length:days===7?7:days===30?5:3},(_,i)=>{
      const count=days===7?7:days===30?5:3,lo=start+Math.floor(days*i/count)*day,hi=start+Math.floor(days*(i+1)/count)*day;
      return {label:new Date(lo+8*3600000).toISOString().slice(5,10),
        added:rows.filter(r=>time(r.createdAt)>=lo&&time(r.createdAt)<hi&&time(r.createdAt)<=now).length,
        closed:rows.filter(r=>(r.e.real.finalReview?.history||[]).some(h=>h.action==='QUALITY_CLOSED'&&time(h.occurredAt)>=lo&&time(h.occurredAt)<hi&&time(h.occurredAt)<=now)).length};
    });
    return {groups,focus,buckets,start,end,rows};
  }
  root.QualityDashboardData=Object.freeze({summarize});
})(globalThis);
