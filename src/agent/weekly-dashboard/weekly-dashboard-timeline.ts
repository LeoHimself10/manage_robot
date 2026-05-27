import type { WorkbenchSubtaskRow } from "../../infra/workbench-formal-task-store";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { parseDueAtMs } from "../reminders/due-at-parse";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";
import { listSpanDays, type WeeklyDashboardFacts } from "./weekly-dashboard-facts";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export interface SubtaskTimelineAnchors {
  acceptedYmd?: string;
  doneYmd?: string;
}

export interface TaskTimelineBar {
  subtaskId: string;
  title: string;
  assigneeUserId: string;
  assigneeName?: string;
  status: string;
  dueYmd: string;
  isOverdue: boolean;
  /** @deprecated use endDayIndex */
  dayIndex: number;
  startDayIndex: number;
  endDayIndex: number;
  dueDayIndex: number;
}

export interface TaskTimelineRow {
  taskId: string;
  taskNo: string;
  title: string;
  bars: TaskTimelineBar[];
}

export interface PersonLoadDay {
  ymd: string;
  dueCount: number;
}

export interface PersonLoadRow {
  assigneeUserId: string;
  assigneeName?: string;
  inProgressCount: number;
  blockedCount: number;
  dueInSpanCount: number;
  dueNextWeekCount: number;
  days: PersonLoadDay[];
  subtasks: Array<{
    taskNo: string;
    taskTitle: string;
    subtaskId: string;
    title: string;
    status: string;
    dueAt?: string;
  }>;
}

export interface WeeklyDashboardTimeline {
  days: string[];
  byTask: TaskTimelineRow[];
  byPerson: PersonLoadRow[];
}

const TERMINAL_STATUSES = new Set(["DONE", "STOPPED"]);
const ACTIVE_END_TODAY = new Set(["IN_PROGRESS", "BLOCKED", "ASSIGNED", "CHANGES_REQUESTED"]);

function dueYmd(s: WorkbenchSubtaskRow, timezone: string): string | undefined {
  const ms = parseDueAtMs(s.dueAt);
  if (ms === undefined) return undefined;
  return formatDateInTz(new Date(ms).toISOString(), timezone);
}

function ymdFromIso(iso: string | undefined, timezone: string): string | undefined {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return undefined;
  return formatDateInTz(new Date(ms).toISOString(), timezone);
}

function barIsOverdue(s: WorkbenchSubtaskRow, atMs: number): boolean {
  const status = String(s.status ?? "");
  if (TERMINAL_STATUSES.has(status)) return false;
  const dueMs = parseDueAtMs(s.dueAt);
  return dueMs !== undefined && dueMs < atMs;
}

function clampDayIndex(days: string[], ymd: string): number {
  const exact = days.indexOf(ymd);
  if (exact >= 0) return exact;
  if (!days.length) return -1;
  if (ymd < days[0]!) return 0;
  if (ymd > days[days.length - 1]!) return days.length - 1;
  return days.findIndex((d) => d >= ymd);
}

/** Bar start/end from accept/publish + done/today; due marker uses dueDayIndex separately. */
export function computeTaskTimelineBarSpan(input: {
  status: string;
  days: string[];
  dueYmd: string;
  publishedYmd: string;
  todayYmd: string;
  anchors?: SubtaskTimelineAnchors;
  doneFallbackYmd?: string;
}): { startDayIndex: number; endDayIndex: number; dueDayIndex: number } | undefined {
  const dueDayIndex = input.days.indexOf(input.dueYmd);
  if (dueDayIndex < 0) return undefined;

  const startYmd = input.anchors?.acceptedYmd ?? input.publishedYmd;
  let startDayIndex = clampDayIndex(input.days, startYmd);
  if (startDayIndex < 0) return undefined;

  const status = String(input.status ?? "");
  let endYmd = input.todayYmd;
  if (status === "DONE") {
    endYmd = input.anchors?.doneYmd ?? input.doneFallbackYmd ?? input.todayYmd;
  } else if (!ACTIVE_END_TODAY.has(status)) {
    endYmd = input.todayYmd;
  }

  let endDayIndex = clampDayIndex(input.days, endYmd);
  if (endDayIndex < 0) return undefined;
  if (startDayIndex > endDayIndex) startDayIndex = endDayIndex;

  return { startDayIndex, endDayIndex, dueDayIndex };
}

function nextWeekBoundsYmd(centerMondayYmd: string): { start: string; end: string } {
  const [y, m, d] = centerMondayYmd.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d! + 7));
  const end = new Date(Date.UTC(y!, m! - 1, d! + 14));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function loadSubtaskTimelineAnchors(
  taskStore: TaskStore,
  subtaskIds: string[],
  timezone: string,
): Map<string, SubtaskTimelineAnchors> {
  const raw = taskStore.listSubtaskTimelineAnchorEvents(subtaskIds);
  const out = new Map<string, SubtaskTimelineAnchors>();
  for (const row of raw) {
    const sid = String(row.subtask_id ?? "").trim();
    if (!sid) continue;
    const entry = out.get(sid) ?? {};
    const eventType = String(row.event_type ?? "");
    const ymd = ymdFromIso(String(row.occurred_at ?? ""), timezone);
    if (!ymd) continue;
    if (eventType === "SUBTASK_ACCEPTED" && !entry.acceptedYmd) {
      entry.acceptedYmd = ymd;
    }
    if (eventType === "SUBTASK_PROGRESS") {
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(row.payload_json ?? "")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch {
        payload = {};
      }
      if (String(payload.progressStatus ?? "").toUpperCase() === "DONE") {
        entry.doneYmd = ymd;
      }
    }
    out.set(sid, entry);
  }
  return out;
}

export function buildWeeklyDashboardTimeline(input: {
  facts: WeeklyDashboardFacts;
  taskStore: TaskStore;
  resolveName?: (uid: string) => string | undefined;
}): WeeklyDashboardTimeline {
  const days = listSpanDays(input.facts.weekSpan);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const nowMs = Date.parse(input.facts.generatedAt);
  const todayYmd = formatDateInTz(input.facts.generatedAt, input.facts.timezone);
  const byTask: TaskTimelineRow[] = [];
  const people = new Map<string, PersonLoadRow>();
  const next = nextWeekBoundsYmd(input.facts.week.mondayYmd);

  const subtaskIds = input.facts.tasks.flatMap((g) => g.subtasks.map((s) => s.subtaskId));
  const anchorsBySubtask = loadSubtaskTimelineAnchors(input.taskStore, subtaskIds, input.facts.timezone);

  const ensurePerson = (uid: string): PersonLoadRow => {
    const existing = people.get(uid);
    if (existing) return existing;
    const row: PersonLoadRow = {
      assigneeUserId: uid,
      assigneeName: input.resolveName?.(uid),
      inProgressCount: 0,
      blockedCount: 0,
      dueInSpanCount: 0,
      dueNextWeekCount: 0,
      days: days.map((ymd) => ({ ymd, dueCount: 0 })),
      subtasks: [],
    };
    people.set(uid, row);
    return row;
  };

  for (const group of input.facts.tasks) {
    const row: TaskTimelineRow = {
      taskId: group.task.taskId,
      taskNo: group.task.taskNo,
      title: group.task.title,
      bars: [],
    };
    const publishedYmd = ymdFromIso(group.task.publishedAt, input.facts.timezone)
      ?? ymdFromIso(group.task.createdAt, input.facts.timezone)
      ?? todayYmd;
    for (const s of group.subtasks) {
      const uid = s.assigneeUserId;
      const person = ensurePerson(uid);
      const status = String(s.status ?? "");
      if (status === "IN_PROGRESS") person.inProgressCount += 1;
      if (status === "BLOCKED") person.blockedCount += 1;
      const ymd = dueYmd(s, input.facts.timezone);
      if (ymd) {
        if (dayIndex.has(ymd)) {
          const idx = dayIndex.get(ymd)!;
          person.dueInSpanCount += 1;
          person.days[idx]!.dueCount += 1;
          const span = computeTaskTimelineBarSpan({
            status,
            days,
            dueYmd: ymd,
            publishedYmd,
            todayYmd,
            anchors: anchorsBySubtask.get(s.subtaskId),
            doneFallbackYmd: ymdFromIso(s.updatedAt, input.facts.timezone),
          });
          if (span) {
            row.bars.push({
              subtaskId: s.subtaskId,
              title: s.title,
              assigneeUserId: uid,
              assigneeName: input.resolveName?.(uid),
              status,
              dueYmd: ymd,
              isOverdue: barIsOverdue(s, nowMs),
              dayIndex: span.endDayIndex,
              startDayIndex: span.startDayIndex,
              endDayIndex: span.endDayIndex,
              dueDayIndex: span.dueDayIndex,
            });
          }
        }
        if (ymd >= next.start && ymd < next.end) person.dueNextWeekCount += 1;
      }
      person.subtasks.push({
        taskNo: group.task.taskNo,
        taskTitle: group.task.title,
        subtaskId: s.subtaskId,
        title: s.title,
        status,
        dueAt: s.dueAt,
      });
    }
    byTask.push(row);
  }

  return {
    days,
    byTask,
    byPerson: [...people.values()].sort((a, b) =>
      (b.blockedCount - a.blockedCount)
      || (b.dueInSpanCount - a.dueInSpanCount)
      || a.assigneeUserId.localeCompare(b.assigneeUserId),
    ),
  };
}
