import type { SubtaskOpenDeclineKind, WorkbenchTaskStatus } from "../infra/workbench-formal-task-store";

export type ManagerAttentionBucket =
  | "needs_manager"
  | "waiting_employee"
  | "employee_running"
  | "blocked"
  | "done";

export type ManagerAttentionLabel =
  | "待您处理"
  | "待员工承接"
  | "员工执行中"
  | "阻塞中"
  | "已完成";

export type SubtaskBreakdown = {
  needsManager: number;
  waitingAccept: number;
  inProgress: number;
  blocked: number;
  done: number;
  rejected: number;
};

export type SubtaskAttentionInput = {
  status: string;
  openDeclineKind?: SubtaskOpenDeclineKind | null;
};

function normStatus(raw: string): WorkbenchTaskStatus | string {
  const s = String(raw ?? "").trim();
  if (s === "ACCEPTED") return "IN_PROGRESS";
  if (s === "CHANGES_REQUESTED") return "ASSIGNED";
  return s;
}

export function subtaskNeedsManagerAction(s: SubtaskAttentionInput): boolean {
  const st = normStatus(s.status);
  if (st === "REJECTED") return true;
  const k = s.openDeclineKind;
  return k === "changes" || k === "rejected";
}

export function computeSubtaskBreakdown(subtasks: SubtaskAttentionInput[]): SubtaskBreakdown {
  const b: SubtaskBreakdown = {
    needsManager: 0,
    waitingAccept: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    rejected: 0,
  };
  for (const s of subtasks) {
    const st = normStatus(s.status);
    if (st === "DONE") {
      b.done += 1;
      continue;
    }
    if (st === "BLOCKED") b.blocked += 1;
    if (st === "REJECTED") b.rejected += 1;
    if (subtaskNeedsManagerAction(s)) b.needsManager += 1;
    else if (st === "ASSIGNED") b.waitingAccept += 1;
    else if (st === "IN_PROGRESS") b.inProgress += 1;
  }
  return b;
}

/** Display-layer task attention (does not change DB aggregateTaskStatus). */
export function deriveManagerAttentionLabel(subtasks: SubtaskAttentionInput[]): {
  attentionLabel: ManagerAttentionLabel;
  attentionBucket: ManagerAttentionBucket;
  breakdown: SubtaskBreakdown;
  openManagerSubtaskCount: number;
  attentionHint: string;
} {
  const breakdown = computeSubtaskBreakdown(subtasks);
  const openManagerSubtaskCount = breakdown.needsManager;

  if (subtasks.length > 0 && breakdown.done === subtasks.length) {
    return {
      attentionLabel: "已完成",
      attentionBucket: "done",
      breakdown,
      openManagerSubtaskCount,
      attentionHint: "",
    };
  }

  if (breakdown.blocked > 0) {
    const hint =
      breakdown.needsManager > 0
        ? `阻塞 ${breakdown.blocked} · 待您处理 ${breakdown.needsManager}`
        : `阻塞 ${breakdown.blocked}`;
    return {
      attentionLabel: "阻塞中",
      attentionBucket: "blocked",
      breakdown,
      openManagerSubtaskCount,
      attentionHint: hint,
    };
  }

  if (breakdown.needsManager > 0) {
    return {
      attentionLabel: "待您处理",
      attentionBucket: "needs_manager",
      breakdown,
      openManagerSubtaskCount,
      attentionHint: `待您处理 ${breakdown.needsManager}`,
    };
  }

  if (breakdown.waitingAccept > 0) {
    return {
      attentionLabel: "待员工承接",
      attentionBucket: "waiting_employee",
      breakdown,
      openManagerSubtaskCount: 0,
      attentionHint: `未接受 ${breakdown.waitingAccept}`,
    };
  }

  return {
    attentionLabel: "员工执行中",
    attentionBucket: "employee_running",
    breakdown,
    openManagerSubtaskCount: 0,
    attentionHint:
      breakdown.inProgress > 0 ? `执行中 ${breakdown.inProgress}` : "",
  };
}

export function attentionBucketRank(bucket: ManagerAttentionBucket): number {
  if (bucket === "needs_manager") return 0;
  if (bucket === "blocked") return 1;
  if (bucket === "waiting_employee") return 2;
  if (bucket === "employee_running") return 3;
  return 4;
}

export function attentionBadgeClass(bucket: ManagerAttentionBucket): string {
  if (bucket === "needs_manager") return "pending";
  if (bucket === "blocked") return "blocked";
  if (bucket === "waiting_employee") return "assigned";
  if (bucket === "employee_running") return "progress";
  return "done";
}

/** Manager detail subtask filter chip bucket. */
export function managerSubtaskFilterBucket(
  s: SubtaskAttentionInput,
): "needs_manager" | "waiting_employee" | "in_progress" | "done" {
  const st = normStatus(s.status);
  if (st === "DONE") return "done";
  if (subtaskNeedsManagerAction(s)) return "needs_manager";
  if (st === "ASSIGNED") return "waiting_employee";
  return "in_progress";
}

export const EMPLOYEE_KEY_EVENT_TYPES = new Set([
  "TASK_PUBLISHED",
  "SUBTASK_ACCEPTED",
  "SUBTASK_REJECTED",
  "SUBTASK_CHANGES_REQUESTED",
  "SUBTASK_CUSTOMIZE_NOTE",
  "SUBTASK_PROGRESS",
  "MANAGER_DECLINE_CHANGES",
  "MANAGER_ACK_SUBTASK_SIGNAL",
  "MANAGER_REASSIGN",
]);
