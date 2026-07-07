import { dueAtYmdInTz, parseDueAtMs } from "./due-at-parse";
import {
  addDaysToYmd,
  formatDateInTz,
  loadReminderPolicy,
  isInQuietHours,
  isPreDueSendWindow,
  type ReminderPolicy,
} from "./reminder-policy";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export type ReminderTrigger =
  | "manual_chat"
  | "manual_workbench"
  | "scheduler_pre_due"
  | "scheduler_manager_overdue";

export interface PreDueEmployeeReminder {
  subtaskId: string;
  taskId: string;
  planId: string;
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  dueAt: string;
  dueAtMs: number;
  assigneeUserId: string;
  managerUserId: string;
  managerGroupId?: string;
  status: string;
}

export interface ManagerOverdueAlert {
  subtaskId: string;
  taskId: string;
  planId: string;
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  dueAt: string;
  dueAtMs: number;
  assigneeUserId: string;
  managerUserId: string;
  managerGroupId?: string;
  status: string;
  overdueSince: string;
  assigneeDisplayName?: string;
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export function listPreDueEmployeeReminders(
  taskStore: TaskStore,
  now: Date = new Date(),
  policy: ReminderPolicy = loadReminderPolicy(),
): PreDueEmployeeReminder[] {
  if (!policy.enabled) return [];
  if (!isPreDueSendWindow(now, policy)) return [];
  if (isInQuietHours(now, policy.quietHours, policy.timezone)) return [];

  const todayYmd = formatDateInTz(now.toISOString(), policy.timezone);
  const tomorrowYmd = addDaysToYmd(todayYmd, 1);
  const out: PreDueEmployeeReminder[] = [];

  for (const row of taskStore.listActiveSubtasksForReminders()) {
    const dueMs = parseDueAtMs(row.dueAt, policy.timezone);
    if (dueMs === undefined) continue;
    const dueYmd = dueAtYmdInTz(row.dueAt, policy.timezone);
    if (dueYmd !== tomorrowYmd) continue;

    const state = taskStore.getSubtaskReminderState(row.subtaskId);
    if (
      state?.lastPreDueRemindedAt &&
      formatDateInTz(state.lastPreDueRemindedAt, policy.timezone) === todayYmd
    ) {
      continue;
    }

    out.push({
      subtaskId: row.subtaskId,
      taskId: row.taskId,
      planId: row.planId,
      taskNo: row.taskNo,
      taskTitle: row.title,
      subtaskTitle: row.subtaskTitle,
      dueAt: row.dueAt!,
      dueAtMs: dueMs,
      assigneeUserId: row.assigneeUserId,
      managerUserId: row.managerUserId,
      managerGroupId: row.managerGroupId,
      status: row.status,
    });
  }
  return out;
}

export function listManagerOverdueAlerts(
  taskStore: TaskStore,
  now: Date = new Date(),
  policy: ReminderPolicy = loadReminderPolicy(),
  resolveDisplayName?: (userId: string) => string | undefined,
): ManagerOverdueAlert[] {
  if (!policy.enabled) return [];
  if (isInQuietHours(now, policy.quietHours, policy.timezone)) return [];

  const nowMs = now.getTime();
  const out: ManagerOverdueAlert[] = [];

  for (const row of taskStore.listActiveSubtasksForReminders()) {
    const dueMs = parseDueAtMs(row.dueAt, policy.timezone);
    if (dueMs === undefined || nowMs <= dueMs) continue;

    const overdueSince = new Date(dueMs).toISOString();
    const state = taskStore.getSubtaskReminderState(row.subtaskId);
    if (state?.lastManagerOverdueNotifiedAt && state.overdueSince === overdueSince) {
      continue;
    }

    out.push({
      subtaskId: row.subtaskId,
      taskId: row.taskId,
      planId: row.planId,
      taskNo: row.taskNo,
      taskTitle: row.title,
      subtaskTitle: row.subtaskTitle,
      dueAt: row.dueAt!,
      dueAtMs: dueMs,
      assigneeUserId: row.assigneeUserId,
      managerUserId: row.managerUserId,
      managerGroupId: row.managerGroupId,
      status: row.status,
      overdueSince,
      assigneeDisplayName: resolveDisplayName?.(row.assigneeUserId),
    });
  }
  return out;
}

/** @deprecated Scheduler no longer uses overdue employee auto-remind. */
export function listSchedulerEligibleReminders(
  _taskStore: TaskStore,
  _now: Date = new Date(),
  _policy: ReminderPolicy = loadReminderPolicy(),
): never[] {
  return [];
}

export type FollowUpBucket = "overdue" | "due_today" | "due_this_week" | "stale";

export interface FollowUpCandidate {
  subtaskId: string;
  taskId: string;
  taskNo: string;
  taskTitle: string;
  subtaskTitle: string;
  sourceTaskKey: string;
  status: string;
  dueAt?: string;
  assigneeUserId: string;
  assigneeDisplayName?: string;
  updatedAt: string;
  bucket: FollowUpBucket;
}

export function listFollowUpCandidatesForActor(
  taskStore: TaskStore,
  actorUserId: string,
  opts: {
    bucket?: FollowUpBucket;
    isAdmin?: boolean;
    managerGroupId?: string;
    managerGroupMemberUserIds?: string[];
    resolveDisplayName?: (userId: string) => string | undefined;
    now?: Date;
    timezone?: string;
  } = {},
): FollowUpCandidate[] {
  const now = opts.now ?? new Date();
  const timezone = opts.timezone ?? loadReminderPolicy().timezone;
  const nowMs = now.getTime();
  const todayYmd = formatDateInTz(now.toISOString(), timezone);
  const weekEndMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const bucketFilter = opts.bucket;

  const rows = taskStore.listActiveSubtasksForReminders().filter((r) => {
    if (opts.isAdmin) return true;
    if (opts.managerGroupId) {
      const memberUserIds = Array.from(new Set(
        [...(opts.managerGroupMemberUserIds ?? []), actorUserId]
          .map((id) => String(id ?? "").trim())
          .filter(Boolean),
      ));
      return r.managerGroupId === opts.managerGroupId
        || (!r.managerGroupId && memberUserIds.includes(r.managerUserId));
    }
    return r.managerUserId === actorUserId;
  });

  const candidates: FollowUpCandidate[] = [];
  for (const row of rows) {
    const dueMs = parseDueAtMs(row.dueAt, timezone);
    let bucket: FollowUpBucket = "stale";
    if (dueMs !== undefined) {
      const dueYmd =
        dueAtYmdInTz(row.dueAt, timezone) ??
        formatDateInTz(new Date(dueMs).toISOString(), timezone);
      if (nowMs > dueMs) bucket = "overdue";
      else if (dueYmd === todayYmd) bucket = "due_today";
      else if (dueMs <= weekEndMs) bucket = "due_this_week";
      else bucket = "stale";
    }
    if (bucketFilter && bucket !== bucketFilter) continue;
    candidates.push({
      subtaskId: row.subtaskId,
      taskId: row.taskId,
      taskNo: row.taskNo,
      taskTitle: row.title,
      subtaskTitle: row.subtaskTitle,
      sourceTaskKey: row.sourceTaskKey,
      status: row.status,
      dueAt: row.dueAt,
      assigneeUserId: row.assigneeUserId,
      assigneeDisplayName: opts.resolveDisplayName?.(row.assigneeUserId),
      updatedAt: row.updatedAt,
      bucket,
    });
  }
  if (bucketFilter === "stale" || !bucketFilter) {
    candidates.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }
  return candidates;
}
