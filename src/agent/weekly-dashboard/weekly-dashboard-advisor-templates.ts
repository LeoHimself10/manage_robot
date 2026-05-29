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
  const progress: string[] = [
    `本周完成 ${k.completedInWeek} 个子任务，执行中 ${k.inProgress} 个。`,
    `本周记录 ${k.eventCount} 条动态，可在下方 feed 回放关键变更。`,
  ];
  if (k.waitingAccept > 0) progress.push(`仍有 ${k.waitingAccept} 个子任务待承接。`);
  if (k.blockedOrOverdue > 0) progress.push(`${k.blockedOrOverdue} 个子任务处于阻塞或逾期状态。`);
  if (facts.approxHistoricalState) {
    progress.push("历史周中的活跃状态为当前状态近似，请以事件记录作为复盘依据。");
  }

  const nextWeek: string[] = [];
  if (k.blockedOrOverdue > 0) nextWeek.push(`优先处理 ${k.blockedOrOverdue} 个阻塞或逾期子任务，明确责任人与下一步动作。`);
  if (k.waitingAccept > 0) nextWeek.push(`跟进 ${k.waitingAccept} 个待承接子任务，确认是否已收到并安排启动。`);
  if (k.dueNextWeek > 0) nextWeek.push(`下周有 ${k.dueNextWeek} 个子任务到期，提前确认交付物、验收口径与依赖风险。`);
  if (k.inProgress > 0 && nextWeek.length < 3) {
    nextWeek.push(`围绕 ${k.inProgress} 个执行中子任务，确认本周剩余时间与关键里程碑是否对齐。`);
  }
  if (nextWeek.length === 0) {
    nextWeek.push("当前无明显阻塞，建议聚焦关键交付物，提前对齐下周优先级与资源安排。");
  }

  return {
    renderSource: "template",
    sections: [
      { title: "本周进展", bullets: progress.slice(0, 4) },
      { title: "下周推进建议", bullets: nextWeek.slice(0, 4) },
    ],
  };
}
