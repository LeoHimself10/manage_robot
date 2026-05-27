import type { WorkbenchSubtaskRow } from "../../infra/workbench-formal-task-store";
import { parseDueAtMs } from "../reminders/due-at-parse";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";
import { listSpanDays, type WeeklyDashboardFacts } from "./weekly-dashboard-facts";

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

function dueYmd(s: WorkbenchSubtaskRow, timezone: string): string | undefined {
  const ms = parseDueAtMs(s.dueAt);
  if (ms === undefined) return undefined;
  return formatDateInTz(new Date(ms).toISOString(), timezone);
}

const TERMINAL_STATUSES = new Set(["DONE", "STOPPED"]);

function barIsOverdue(s: WorkbenchSubtaskRow, atMs: number): boolean {
  const status = String(s.status ?? "");
  if (TERMINAL_STATUSES.has(status)) return false;
  const dueMs = parseDueAtMs(s.dueAt);
  return dueMs !== undefined && dueMs < atMs;
}

function leadDaysForStatus(status: string): number {
  if (status === "IN_PROGRESS") return 5;
  if (status === "BLOCKED") return 4;
  if (status === "DONE") return 0;
  if (status === "ASSIGNED" || status === "CHANGES_REQUESTED") return 2;
  return 2;
}

function barSpanForDue(input: {
  dueYmd: string;
  status: string;
  days: string[];
}): { startDayIndex: number; endDayIndex: number } | undefined {
  const endDayIndex = input.days.indexOf(input.dueYmd);
  if (endDayIndex < 0) return undefined;
  const lead = leadDaysForStatus(input.status);
  const startYmd = lead > 0 ? addDaysToYmd(input.dueYmd, -lead) : input.dueYmd;
  let startDayIndex = input.days.findIndex((d) => d >= startYmd);
  if (startDayIndex < 0) startDayIndex = 0;
  if (startDayIndex > endDayIndex) startDayIndex = endDayIndex;
  return { startDayIndex, endDayIndex };
}

function nextWeekBoundsYmd(centerMondayYmd: string): { start: string; end: string } {
  const [y, m, d] = centerMondayYmd.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, d! + 7));
  const end = new Date(Date.UTC(y!, m! - 1, d! + 14));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function buildWeeklyDashboardTimeline(input: {
  facts: WeeklyDashboardFacts;
  resolveName?: (uid: string) => string | undefined;
}): WeeklyDashboardTimeline {
  const days = listSpanDays(input.facts.weekSpan);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const nowMs = Date.parse(input.facts.generatedAt);
  const byTask: TaskTimelineRow[] = [];
  const people = new Map<string, PersonLoadRow>();
  const next = nextWeekBoundsYmd(input.facts.week.mondayYmd);

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
          const span = barSpanForDue({ dueYmd: ymd, status, days });
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
