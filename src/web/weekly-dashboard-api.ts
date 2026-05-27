import { buildWeeklyDashboardFacts, type WeeklyFeedItem } from "../agent/weekly-dashboard/weekly-dashboard-facts";
import { buildWeeklyDashboardTimeline } from "../agent/weekly-dashboard/weekly-dashboard-timeline";
import {
  clampWeeklyDashboardSpan,
  clampWeeklyFeedLimit,
  loadWeeklyDashboardPolicy,
  type WeeklyDashboardPolicy,
} from "../agent/weekly-dashboard/weekly-dashboard-policy";
import { summarizeWeeklyAdvisorWithLlm } from "../agent/weekly-dashboard/weekly-dashboard-advisor-llm";
import { presentWorkbenchTaskEvent } from "../infra/workbench-event-present";
import type { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

function enrichFeedActionLabels(
  items: WeeklyFeedItem[],
  resolveName?: (uid: string) => string | undefined,
): WeeklyFeedItem[] {
  return items.map((item) => {
    const row = {
      event_type: item.eventType,
      occurred_at: item.occurredAt,
      actor_user_id: item.actorUserId,
      note: item.note,
      subtask_id: item.subtaskId,
      payload_json: item.payload ? JSON.stringify(item.payload) : undefined,
    };
    const presented = presentWorkbenchTaskEvent(row, {
      resolveActorName: resolveName
        ? (userId) => resolveName(userId) ?? userId
        : undefined,
    });
    return { ...item, actionLabel: presented.title };
  });
}

export function serializeWeeklyDashboardForClient(input: {
  facts: ReturnType<typeof buildWeeklyDashboardFacts>;
  timeline: ReturnType<typeof buildWeeklyDashboardTimeline>;
  resolveName?: (uid: string) => string | undefined;
  feedOnly?: boolean;
}): Record<string, unknown> {
  const { facts, timeline, resolveName, feedOnly } = input;
  if (feedOnly) {
    return {
      ok: true,
      week: facts.week,
      approxHistoricalState: facts.approxHistoricalState,
      kpi: { eventCount: facts.kpi.eventCount },
      feed: {
        items: enrichFeedActionLabels(facts.feed.items, resolveName),
        nextCursor: facts.feed.nextCursor,
      },
    };
  }

  const tasks = facts.tasks.map((group) => ({
    task: group.task,
    subtasks: group.subtasks.map((s) => ({
      ...s,
      assigneeName: resolveName?.(s.assigneeUserId),
    })),
  }));

  return {
    ok: true,
    week: facts.week,
    span: facts.span,
    approxHistoricalState: facts.approxHistoricalState,
    kpi: facts.kpi,
    tasks,
    timeline: {
      days: timeline.days,
      centerMondayYmd: facts.week.mondayYmd,
      byTask: timeline.byTask,
      byPerson: timeline.byPerson.map((p) => ({
        ...p,
        assigneeName: p.assigneeName ?? resolveName?.(p.assigneeUserId),
      })),
    },
    feed: {
      items: enrichFeedActionLabels(facts.feed.items, resolveName),
      nextCursor: facts.feed.nextCursor,
    },
  };
}

export function buildWeeklyDashboardHttpPayload(input: {
  taskStore: TaskStore;
  managerUserId: string;
  week?: string;
  span?: unknown;
  feedCursor?: string;
  feedLimit?: unknown;
  projectId?: string;
  feedOnly?: boolean;
  now?: Date;
  policy?: WeeklyDashboardPolicy;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const policy = input.policy ?? loadWeeklyDashboardPolicy();
  const span = clampWeeklyDashboardSpan(input.span, policy);
  const feedLimit = clampWeeklyFeedLimit(input.feedLimit, policy);
  const facts = buildWeeklyDashboardFacts({
    taskStore: input.taskStore,
    managerUserId: input.managerUserId,
    week: input.week,
    span,
    feedCursor: input.feedCursor,
    feedLimit,
    projectId: input.projectId,
    feedOnly: input.feedOnly,
    now: input.now,
    policy,
    resolveName: input.resolveName,
  });
  if (input.feedOnly) {
    return serializeWeeklyDashboardForClient({ facts, timeline: { days: [], byTask: [], byPerson: [] }, resolveName: input.resolveName, feedOnly: true });
  }
  const timeline = buildWeeklyDashboardTimeline({ facts, resolveName: input.resolveName });
  return serializeWeeklyDashboardForClient({ facts, timeline, resolveName: input.resolveName });
}

export async function buildWeeklyAdvisorHttpPayload(input: {
  taskStore: TaskStore;
  managerUserId: string;
  week?: string;
  span?: unknown;
  projectId?: string;
  policy?: WeeklyDashboardPolicy;
  resolveName?: (uid: string) => string | undefined;
}): Promise<Record<string, unknown>> {
  const policy = input.policy ?? loadWeeklyDashboardPolicy();
  const span = clampWeeklyDashboardSpan(input.span, policy);
  const facts = buildWeeklyDashboardFacts({
    taskStore: input.taskStore,
    managerUserId: input.managerUserId,
    week: input.week,
    span,
    policy,
    projectId: input.projectId,
    resolveName: input.resolveName,
  });
  const advisor = await summarizeWeeklyAdvisorWithLlm(facts, policy);
  return { ok: true, ...advisor };
}
