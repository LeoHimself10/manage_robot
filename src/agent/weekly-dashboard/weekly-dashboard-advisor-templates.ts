import type { WeeklyDashboardFacts } from "./weekly-dashboard-facts";

export interface WeeklyAdvisorSection {
  title: string;
  bullets: string[];
}

export interface WeeklyAdvisorResponse {
  sections: WeeklyAdvisorSection[];
  renderSource: "llm" | "template";
  timedOut?: boolean;
}

export function renderWeeklyAdvisorTemplate(facts: WeeklyDashboardFacts): WeeklyAdvisorResponse {
  const k = facts.kpi;
  const focus: string[] = [];
  if (k.blockedOrOverdue > 0) focus.push(`优先处理 ${k.blockedOrOverdue} 个阻塞或逾期子任务，先明确责任人与下一步动作。`);
  if (k.waitingAccept > 0) focus.push(`还有 ${k.waitingAccept} 个子任务待承接，周会后建议逐一确认是否已收到。`);
  if (k.dueNextWeek > 0) focus.push(`下周有 ${k.dueNextWeek} 个子任务到期，提前确认交付物和验收口径。`);
  if (focus.length === 0) focus.push("当前周没有明显阻塞，建议围绕关键交付物确认完成标准和依赖风险。");

  const meeting: string[] = [
    `本周完成 ${k.completedInWeek} 个子任务，执行中 ${k.inProgress} 个。`,
    `本周记录 ${k.eventCount} 条动态，可在下方 feed 回放关键变更。`,
  ];
  if (facts.approxHistoricalState) {
    meeting.push("历史周中的活跃状态为当前状态近似，请以事件记录作为复盘依据。");
  }

  return {
    renderSource: "template",
    sections: [
      { title: "本周判断", bullets: meeting },
      { title: "建议动作", bullets: focus.slice(0, 4) },
    ],
  };
}
