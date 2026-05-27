/** Display model for project overview cards (task-level, not subtask KPI grid). */

export type ProjectTaskBuckets = {
  needs_manager: number;
  blocked: number;
  waiting_employee: number;
  employee_running: number;
  done: number;
  stopped: number;
};

export type ProjectCardProgressTag = { label: string };

export type ProjectCardProgressBarSeg = { tone: string; pct: number };

export type ProjectCardProgress = {
  pillLabel: string;
  pillTone: "blocked" | "needs" | "waiting" | "running" | "done" | "stopped" | "idle";
  summary: string;
  tags: ProjectCardProgressTag[];
  barSegments: ProjectCardProgressBarSeg[];
};

export function emptyProjectTaskBuckets(): ProjectTaskBuckets {
  return {
    needs_manager: 0,
    blocked: 0,
    waiting_employee: 0,
    employee_running: 0,
    done: 0,
    stopped: 0,
  };
}

export function bumpProjectTaskBucket(buckets: ProjectTaskBuckets, bucket: string): void {
  if (bucket === "needs_manager") buckets.needs_manager += 1;
  else if (bucket === "blocked") buckets.blocked += 1;
  else if (bucket === "waiting_employee") buckets.waiting_employee += 1;
  else if (bucket === "employee_running") buckets.employee_running += 1;
  else if (bucket === "done") buckets.done += 1;
  else if (bucket === "stopped") buckets.stopped += 1;
}

const TAG_META: Array<{ key: keyof ProjectTaskBuckets; label: string }> = [
  { key: "blocked", label: "阻塞" },
  { key: "needs_manager", label: "待您处理" },
  { key: "waiting_employee", label: "待承接" },
  { key: "employee_running", label: "执行中" },
  { key: "done", label: "已完成" },
  { key: "stopped", label: "已停止" },
];

const BAR_ORDER: Array<{ key: keyof ProjectTaskBuckets; tone: string }> = [
  { key: "blocked", tone: "blocked" },
  { key: "needs_manager", tone: "needs" },
  { key: "waiting_employee", tone: "waiting" },
  { key: "employee_running", tone: "running" },
  { key: "done", tone: "done" },
  { key: "stopped", tone: "stopped" },
];

function pillForBucket(bucket: string, taskCount: number): { label: string; tone: ProjectCardProgress["pillTone"] } {
  if (taskCount === 0) return { label: "暂无任务", tone: "idle" };
  if (bucket === "blocked") return { label: "需关注 · 阻塞中", tone: "blocked" };
  if (bucket === "needs_manager") return { label: "待您处理", tone: "needs" };
  if (bucket === "waiting_employee") return { label: "待员工承接", tone: "waiting" };
  if (bucket === "employee_running") return { label: "推进中", tone: "running" };
  if (bucket === "stopped") return { label: "已停止", tone: "stopped" };
  return { label: "进展顺利", tone: "done" };
}

function dominantBucketKey(buckets: ProjectTaskBuckets): keyof ProjectTaskBuckets | "" {
  const order: Array<keyof ProjectTaskBuckets> = [
    "blocked",
    "needs_manager",
    "waiting_employee",
    "employee_running",
    "stopped",
    "done",
  ];
  for (const k of order) {
    if (buckets[k] > 0) return k;
  }
  return "";
}

function summaryLine(taskCount: number, bucket: string, buckets: ProjectTaskBuckets): string {
  if (taskCount === 0) return "暂无主任务 · 可新建或归入";
  const n = String(taskCount);
  if (bucket === "blocked") return `共 ${n} 条主任务，存在交付风险`;
  if (bucket === "needs_manager") return `共 ${n} 条主任务，有待您决策事项`;
  if (bucket === "waiting_employee") return `共 ${n} 条主任务，等待员工承接`;
  if (bucket === "employee_running") return `共 ${n} 条主任务，整体在推进`;
  if (bucket === "stopped") return `共 ${n} 条主任务，部分已停止`;
  if (buckets.done === taskCount) return `共 ${n} 条主任务，均已收尾`;
  return `共 ${n} 条主任务`;
}

export function buildProjectCardProgress(input: {
  taskCount: number;
  taskBuckets: ProjectTaskBuckets;
  attentionBucket: string;
}): ProjectCardProgress {
  const { taskCount, taskBuckets, attentionBucket } = input;
  const pill = pillForBucket(attentionBucket, taskCount);
  const domKey = dominantBucketKey(taskBuckets) || (attentionBucket as keyof ProjectTaskBuckets);
  const tags: ProjectCardProgressTag[] = [];
  for (const meta of TAG_META) {
    if (meta.key === domKey) continue;
    const n = taskBuckets[meta.key];
    if (n <= 0) continue;
    tags.push({ label: `${meta.label} ${n}` });
  }
  const visibleTags = tags.slice(0, 2);
  if (tags.length > 2) {
    const rest = tags.length - 2;
    visibleTags.push({ label: `+${rest} 项` });
  }

  const barSegments: ProjectCardProgressBarSeg[] = [];
  if (taskCount > 0) {
    for (const seg of BAR_ORDER) {
      const n = taskBuckets[seg.key];
      if (n <= 0) continue;
      barSegments.push({ tone: seg.tone, pct: Math.round((n / taskCount) * 1000) / 10 });
    }
    const sum = barSegments.reduce((a, s) => a + s.pct, 0);
    if (barSegments.length > 0 && sum < 99.5) {
      barSegments[barSegments.length - 1]!.pct += 100 - sum;
    }
  }

  return {
    pillLabel: pill.label,
    pillTone: pill.tone,
    summary: summaryLine(taskCount, attentionBucket, taskBuckets),
    tags: visibleTags,
    barSegments,
  };
}
