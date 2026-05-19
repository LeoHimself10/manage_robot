import { parseDueAtMs } from "./due-at-parse";
import {
  formatDateInTz,
  loadReminderPolicy,
  isInQuietHours,
  type ReminderPolicy,
} from "./reminder-policy";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { resolveTierFromOverdueDays } from "./reminder-templates";

export type ReminderTrigger = "scheduler" | "manual_chat" | "manual_workbench";

export interface EligibleSubtaskReminder {
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
  status: string;
  overdueDays: number;
  overdueSince: string;
  tier: "day1" | "day2plus";
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

function overdueDaysBetween(dueMs: number, nowMs: number, timezone: string): number {
  const dueYmd = formatDateInTz(new Date(dueMs).toISOString(), timezone);
  const nowYmd = formatDateInTz(new Date(nowMs).toISOString(), timezone);
  const dueParts = dueYmd.split("-").map(Number);
  const nowParts = nowYmd.split("-").map(Number);
  const dueDate = Date.UTC(dueParts[0]!, dueParts[1]! - 1, dueParts[2]!);
  const nowDate = Date.UTC(nowParts[0]!, nowParts[1]! - 1, nowParts[2]!);
  const diff = Math.floor((nowDate - dueDate) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff);
}

export function listSchedulerEligibleReminders(
  taskStore: TaskStore,
  now: Date = new Date(),
  policy: ReminderPolicy = loadReminderPolicy(),
): EligibleSubtaskReminder[] {
  if (!policy.enabled) return [];
  if (isInQuietHours(now, policy.quietHours)) return [];
  const nowMs = now.getTime();
  const out: EligibleSubtaskReminder[] = [];
  for (const row of taskStore.listActiveSubtasksForReminders()) {
    const dueMs = parseDueAtMs(row.dueAt);
    if (dueMs === undefined || nowMs <= dueMs) continue;
    const state = taskStore.getSubtaskReminderState(row.subtaskId);
    const todayYmd = formatDateInTz(now.toISOString(), policy.timezone);
    if (
      state?.lastRemindedAt &&
      formatDateInTz(state.lastRemindedAt, policy.timezone) === todayYmd
    ) {
      continue;
    }
    const overdueDays = overdueDaysBetween(dueMs, nowMs, policy.timezone);
    const overdueSince = state?.overdueSince ?? new Date(dueMs).toISOString();
    const tier = resolveTierFromOverdueDays(overdueDays, policy.tier2AfterOverdueDays);
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
      status: row.status,
      overdueDays,
      overdueSince,
      tier,
    });
  }
  return out;
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
    return r.managerUserId === actorUserId;
  });

  const candidates: FollowUpCandidate[] = [];
  for (const row of rows) {
    const dueMs = parseDueAtMs(row.dueAt);
    let bucket: FollowUpBucket = "stale";
    if (dueMs !== undefined) {
      const dueYmd = formatDateInTz(new Date(dueMs).toISOString(), timezone);
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
