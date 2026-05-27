import type { createWorkbenchFormalTaskStore, WorkbenchSubtaskRow, WorkbenchTaskRow } from "../../infra/workbench-formal-task-store";
import { parseDueAtMs } from "../reminders/due-at-parse";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";
import { buildWeekSpanRange, isCurrentWeek, nextWeekRange, type WeekRange, type WeekSpanRange } from "./week-range";
import { loadWeeklyDashboardPolicy, type WeeklyDashboardPolicy } from "./weekly-dashboard-policy";

export const WEEKLY_DASHBOARD_EVENT_TYPES = [
  "TASK_PUBLISHED",
  "SUBTASK_ACCEPTED",
  "SUBTASK_REJECTED",
  "SUBTASK_PROGRESS",
  "SUBTASK_CHANGES_REQUESTED",
  "SUBTASK_CUSTOMIZE_NOTE",
  "SUBTASK_REMINDER_SENT",
  "MANAGER_DECLINE_CHANGES",
  "SUBTASK_REASSIGNED",
];

const ACTIVE_STATUSES = new Set(["ASSIGNED", "CHANGES_REQUESTED", "IN_PROGRESS", "BLOCKED"]);
const TERMINAL_STATUSES = new Set(["DONE", "STOPPED"]);

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export interface WeeklyDashboardTaskGroup {
  task: WorkbenchTaskRow;
  subtasks: WorkbenchSubtaskRow[];
}

export interface WeeklyDashboardKpi {
  completedInWeek: number;
  inProgress: number;
  waitingAccept: number;
  blockedOrOverdue: number;
  eventCount: number;
  dueNextWeek: number;
}

export interface WeeklyFeedItem {
  id: string;
  taskId: string;
  taskNo?: string;
  taskTitle: string;
  subtaskId?: string;
  subtaskTitle?: string;
  eventType: string;
  actionLabel?: string;
  actorUserId: string;
  actorName?: string;
  note?: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface WeeklyDashboardFacts {
  managerUserId: string;
  timezone: string;
  generatedAt: string;
  span: number;
  week: WeekRange;
  weekSpan: WeekSpanRange;
  approxHistoricalState: boolean;
  kpi: WeeklyDashboardKpi;
  tasks: WeeklyDashboardTaskGroup[];
  feed: { items: WeeklyFeedItem[]; nextCursor?: string };
}

function parsePayload(raw: unknown): Record<string, unknown> {
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dueYmdInTz(dueAt: string | undefined, timezone: string): string | undefined {
  const ms = parseDueAtMs(dueAt);
  if (ms === undefined) return undefined;
  return formatDateInTz(new Date(ms).toISOString(), timezone);
}

function dueInRange(dueAt: string | undefined, rangeStartIso: string, rangeEndIso: string): boolean {
  const ms = parseDueAtMs(dueAt);
  if (ms === undefined) return false;
  return ms >= Date.parse(rangeStartIso) && ms < Date.parse(rangeEndIso);
}

function isOverdueAt(dueAt: string | undefined, atMs: number): boolean {
  const dueMs = parseDueAtMs(dueAt);
  return dueMs !== undefined && dueMs < atMs;
}

function taskIsActive(task: WorkbenchTaskRow): boolean {
  return !TERMINAL_STATUSES.has(String(task.status ?? ""));
}

function taskPublishedInWeek(task: WorkbenchTaskRow, week: WeekRange): boolean {
  const ms = Date.parse(task.publishedAt);
  return Number.isFinite(ms) && ms >= Date.parse(week.startIso) && ms < Date.parse(week.endIso);
}

function taskHasDueInSpan(subtasks: WorkbenchSubtaskRow[], span: WeekSpanRange): boolean {
  return subtasks.some((s) => dueInRange(s.dueAt, span.rangeStartIso, span.rangeEndIso));
}

function taskHasActiveSpanApprox(subtasks: WorkbenchSubtaskRow[], span: WeekSpanRange, timezone: string): boolean {
  return subtasks.some((s) => {
    const status = String(s.status ?? "");
    if (!ACTIVE_STATUSES.has(status)) return false;
    const dueYmd = dueYmdInTz(s.dueAt, timezone);
    if (!dueYmd) return true;
    return dueYmd >= span.rangeStartYmd && dueYmd < span.rangeEndYmd;
  });
}

function completedSubtaskIdsInWeek(events: Array<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (String(e.event_type ?? "") !== "SUBTASK_PROGRESS") continue;
    const payload = parsePayload(e.payload_json);
    if (String(payload.progressStatus ?? "").toUpperCase() === "DONE") {
      const sid = String(e.subtask_id ?? "").trim();
      if (sid) out.add(sid);
    }
  }
  return out;
}

function mapFeedItem(row: Record<string, unknown>, resolveName?: (uid: string) => string | undefined): WeeklyFeedItem {
  const actor = String(row.actor_user_id ?? "").trim();
  const payload = parsePayload(row.payload_json);
  return {
    id: String(row.id ?? ""),
    taskId: String(row.task_id ?? ""),
    taskNo: String(row.task_no ?? "").trim() || undefined,
    taskTitle: String(row.task_title ?? "").trim() || "任务",
    subtaskId: String(row.subtask_id ?? "").trim() || undefined,
    subtaskTitle: String(row.subtask_title ?? "").trim() || undefined,
    eventType: String(row.event_type ?? ""),
    actorUserId: actor,
    actorName: resolveName?.(actor),
    note: String(row.note ?? "").trim() || undefined,
    occurredAt: String(row.occurred_at ?? ""),
    payload,
  };
}

export function buildWeeklyDashboardFacts(input: {
  taskStore: TaskStore;
  managerUserId: string;
  week?: string;
  span?: number;
  feedCursor?: string;
  feedLimit?: number;
  projectId?: string;
  feedOnly?: boolean;
  now?: Date;
  policy?: WeeklyDashboardPolicy;
  resolveName?: (uid: string) => string | undefined;
}): WeeklyDashboardFacts {
  const policy = input.policy ?? loadWeeklyDashboardPolicy();
  const span = Math.max(0, Math.min(Math.floor(input.span ?? policy.defaultSpan), policy.maxSpan));
  const now = input.now ?? new Date();
  const weekSpan = buildWeekSpanRange({
    centerWeek: input.week,
    span,
    now,
    timezone: policy.timezone,
  });
  const current = isCurrentWeek({ center: weekSpan.center, now, timezone: policy.timezone });
  const projectFilter = String(input.projectId ?? "").trim();
  const allTaskSummaries = input.taskStore.listManagerTasks(
    input.managerUserId,
    projectFilter ? { projectId: projectFilter } : undefined,
  );
  const eventQuery = {
    managerUserId: input.managerUserId,
    sinceIso: weekSpan.center.startIso,
    untilIso: weekSpan.center.endIso,
    eventTypes: WEEKLY_DASHBOARD_EVENT_TYPES,
  };
  const feedOffset = Math.max(0, Number(String(input.feedCursor ?? "").replace(/^offset:/, "")) || 0);
  const feedLimit = Math.max(1, Math.min(input.feedLimit ?? policy.feedPageSize, policy.feedMaxPageSize));
  const feedRows = input.taskStore.listTaskEventsForManagerSince({
    ...eventQuery,
    limit: feedLimit + 1,
    offset: feedOffset,
  });
  const pageRows = feedRows.slice(0, feedLimit);
  const feed = {
    items: pageRows.map((row) => mapFeedItem(row, input.resolveName)),
    nextCursor: feedRows.length > feedLimit ? `offset:${feedOffset + feedLimit}` : undefined,
  };

  if (input.feedOnly) {
    return {
      managerUserId: input.managerUserId,
      timezone: policy.timezone,
      generatedAt: now.toISOString(),
      span,
      week: weekSpan.center,
      weekSpan,
      approxHistoricalState: !current,
      kpi: {
        completedInWeek: 0,
        inProgress: 0,
        waitingAccept: 0,
        blockedOrOverdue: 0,
        eventCount: input.taskStore.countTaskEventsForManagerInRange(eventQuery).count,
        dueNextWeek: 0,
      },
      tasks: [],
      feed,
    };
  }

  const eventRowsInWeek = input.taskStore.listTaskEventsForManagerSince({
    ...eventQuery,
    limit: 500,
  });
  const eventTaskIds = new Set(eventRowsInWeek.map((e) => String(e.task_id ?? "")).filter(Boolean));
  const groups: WeeklyDashboardTaskGroup[] = [];

  for (const summary of allTaskSummaries) {
    const detail = input.taskStore.getTaskDetail(summary.taskNo);
    if (!detail) continue;
    const include = current
      ? taskIsActive(detail.task)
      : eventTaskIds.has(detail.task.taskId)
        || taskPublishedInWeek(detail.task, weekSpan.center)
        || taskHasDueInSpan(detail.subtasks, weekSpan)
        || taskHasActiveSpanApprox(detail.subtasks, weekSpan, policy.timezone);
    if (include) groups.push({ task: detail.task, subtasks: detail.subtasks });
  }

  const nextWeek = nextWeekRange(weekSpan.center, policy.timezone);
  const nowForOverdue = current ? now.getTime() : Date.parse(weekSpan.center.endIso);
  const completedInWeekIds = completedSubtaskIdsInWeek(eventRowsInWeek);
  const kpi: WeeklyDashboardKpi = {
    completedInWeek: completedInWeekIds.size,
    inProgress: 0,
    waitingAccept: 0,
    blockedOrOverdue: 0,
    eventCount: input.taskStore.countTaskEventsForManagerInRange(eventQuery).count,
    dueNextWeek: 0,
  };

  for (const group of groups) {
    for (const s of group.subtasks) {
      if (completedInWeekIds.has(s.subtaskId)) continue;
      const status = String(s.status ?? "");
      if (status === "IN_PROGRESS") kpi.inProgress += 1;
      if (status === "ASSIGNED" || status === "CHANGES_REQUESTED") kpi.waitingAccept += 1;
      const overdue = !TERMINAL_STATUSES.has(status) && isOverdueAt(s.dueAt, nowForOverdue);
      if (status === "BLOCKED" || overdue) kpi.blockedOrOverdue += 1;
      if (dueInRange(s.dueAt, nextWeek.startIso, nextWeek.endIso)) kpi.dueNextWeek += 1;
    }
  }

  return {
    managerUserId: input.managerUserId,
    timezone: policy.timezone,
    generatedAt: now.toISOString(),
    span,
    week: weekSpan.center,
    weekSpan,
    approxHistoricalState: !current,
    kpi,
    tasks: groups,
    feed,
  };
}

export function listSpanDays(span: WeekSpanRange): string[] {
  const days: string[] = [];
  for (let ymd = span.rangeStartYmd; ymd < span.rangeEndYmd; ymd = addDaysToYmd(ymd, 1)) {
    days.push(ymd);
  }
  return days;
}
