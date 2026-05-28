import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import {
  deriveManagerAttentionLabel,
  subtaskNeedsManagerAction,
  type SubtaskAttentionInput,
} from "../../web/workbench-attention";
import { formatWorkbenchDateTime } from "../../web/workbench-datetime";
import { parseDueAtMs } from "../reminders/due-at-parse";
import { formatDateInTz, previousCalendarDayRangeInTz, type CalendarDayRange } from "../reminders/reminder-policy";
import type { DigestAudience } from "./progress-digest-eligibility";
import {
  horizonEndMs,
  isDueInHorizon,
  isOverdueDue,
} from "./progress-digest-due-window";
import type { ProgressDigestContentMode, ProgressDigestPolicy } from "./progress-digest-policy";
import { PROGRESS_DIGEST_EVENT_TYPES } from "./progress-digest-shared";

export type DigestAttentionItem = {
  taskTitle: string;
  taskNo?: string;
  subtaskTitle?: string;
  assigneeNames: string[];
  statusLabel: string;
  dueLabel?: string;
  reasonHint?: string;
  overdue: boolean;
};

export type DigestInProgressItem = {
  taskTitle: string;
  taskNo?: string;
  subtaskTitle?: string;
  assigneeName?: string;
  statusLabel: string;
  dueLabel?: string;
  overdue: boolean;
};

export type DigestRecentUpdate = {
  timeLabel: string;
  actorName: string;
  taskTitle: string;
  subtaskTitle?: string;
  actionLabel: string;
  note?: string;
};

export type DigestSummaryCounts = {
  needsYouCount: number;
  inProgressCount: number;
  waitingAcceptCount: number;
  blockedCount: number;
  overdueCount: number;
};

export type ProgressDigestFactsCore = {
  summary: DigestSummaryCounts;
  needsAttention: DigestAttentionItem[];
  inProgress: DigestInProgressItem[];
  recentUpdates: DigestRecentUpdate[];
};

export type DigestDueSoonItem = {
  taskTitle: string;
  taskNo?: string;
  subtaskTitle?: string;
  assigneeUserId?: string;
  assigneeName?: string;
  statusLabel: string;
  dueLabel: string;
  overdue: boolean;
  dueSortMs: number;
};

export type DeliveryReminderCore = {
  dueSoon: DigestDueSoonItem[];
  skippedNoDueDate: number;
  skippedBeyondHorizon: number;
};

export type ProgressDigestFacts = {
  dateYmd: string;
  dateDisplay: string;
  audience: DigestAudience;
  recipientDisplayName?: string;
  recipientUserId?: string;
  detailUrl: string;
  isBrief: boolean;
  contentMode: ProgressDigestContentMode;
  activityWindow: CalendarDayRange;
  core: ProgressDigestFactsCore;
  managerCore?: ProgressDigestFactsCore;
  employeeCore?: ProgressDigestFactsCore;
  deliveryReminder?: {
    manager?: DeliveryReminderCore;
    employee?: DeliveryReminderCore;
    core?: DeliveryReminderCore;
  };
};

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

function normStatus(raw: string): string {
  const s = String(raw ?? "").trim();
  if (s === "ACCEPTED") return "IN_PROGRESS";
  if (s === "CHANGES_REQUESTED") return "ASSIGNED";
  return s;
}

function employeeStatusLabel(status: string): string {
  const st = normStatus(status);
  if (st === "ASSIGNED") return "待承接";
  if (st === "BLOCKED") return "阻塞中";
  if (st === "IN_PROGRESS") return "执行中";
  if (st === "REJECTED") return "已拒绝";
  if (st === "STOPPED") return "已停止";
  return st;
}

function isOverdue(dueAt: string | undefined, nowMs: number): boolean {
  const dueMs = parseDueAtMs(dueAt);
  return dueMs !== undefined && nowMs > dueMs;
}

function formatTimeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatDueLabel(dueAt: string | undefined, timezone: string): string | undefined {
  const dueMs = parseDueAtMs(dueAt);
  if (dueMs === undefined) return undefined;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(dueMs));
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  if (!month || !day) return formatWorkbenchDateTime(new Date(dueMs).toISOString());
  return `截止 ${month}月${day}日`;
}

function formatDateDisplay(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month}月${day}日`;
}

function eventActionLabel(eventType: string): string {
  switch (eventType) {
    case "SUBTASK_ACCEPTED":
      return "接受任务";
    case "SUBTASK_REJECTED":
      return "拒绝承接";
    case "SUBTASK_PROGRESS":
      return "提交进度";
    case "SUBTASK_CHANGES_REQUESTED":
      return "申请修改";
    case "SUBTASK_CUSTOMIZE_NOTE":
      return "补充说明";
    default:
      return "更新任务";
  }
}

function formatDueLabelForDelivery(
  dueAt: string | undefined,
  overdue: boolean,
  timezone: string,
): string {
  if (overdue) return "已逾期";
  const dueMs = parseDueAtMs(dueAt, timezone);
  if (dueMs === undefined) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(dueMs));
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  if (!month || !day) return formatWorkbenchDateTime(new Date(dueMs).toISOString());
  return `${month}月${day}日`;
}

export function dueSoonItemKey(item: Pick<DigestDueSoonItem, "taskNo" | "subtaskTitle">): string {
  return `${String(item.taskNo ?? "").trim()}:${String(item.subtaskTitle ?? "").trim()}`;
}

export function dedupeCombinedManagerDueSoon(
  manager: DeliveryReminderCore,
  employee: DeliveryReminderCore,
  userId: string,
): DigestDueSoonItem[] {
  const selfKeys = new Set(
    employee.dueSoon
      .filter(() => true)
      .map((item) => dueSoonItemKey(item)),
  );
  return manager.dueSoon.filter((item) => {
    if (item.assigneeUserId === userId && selfKeys.has(dueSoonItemKey(item))) return false;
    return true;
  });
}

function sortDueSoonItems(items: DigestDueSoonItem[]): DigestDueSoonItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueSortMs - b.dueSortMs;
  });
}

function emptyDeliveryCore(): DeliveryReminderCore {
  return { dueSoon: [], skippedNoDueDate: 0, skippedBeyondHorizon: 0 };
}

function buildManagerDeliveryCore(
  taskStore: TaskStore,
  userId: string,
  policy: ProgressDigestPolicy,
  now: Date,
  resolveName?: (uid: string) => string | undefined,
): DeliveryReminderCore {
  const core = emptyDeliveryCore();
  const nowMs = now.getTime();
  const horizonEnd = horizonEndMs(now, policy.horizonDays, policy.timezone);

  for (const t of taskStore.listManagerTasks(userId)) {
    const detail = taskStore.getTaskDetail(t.taskNo);
    if (!detail) continue;
    const subInputs: SubtaskAttentionInput[] = detail.subtasks.map((s) => ({
      status: String(s.status ?? ""),
      openDeclineKind: taskStore.getSubtaskOpenDeclineKind(s.subtaskId),
    }));
    const attn = deriveManagerAttentionLabel(subInputs);
    if (attn.attentionLabel === "已完成" || attn.attentionLabel === "已停止") continue;

    for (const s of detail.subtasks) {
      const st = normStatus(String(s.status ?? ""));
      if (st === "DONE" || st === "STOPPED") continue;
      const dueMs = parseDueAtMs(s.dueAt, policy.timezone);
      if (dueMs === undefined) {
        core.skippedNoDueDate += 1;
        continue;
      }
      if (!isDueInHorizon(s.dueAt, horizonEnd, policy.timezone)) {
        core.skippedBeyondHorizon += 1;
        continue;
      }
      const overdue = isOverdueDue(s.dueAt, nowMs, policy.timezone);
      const assigneeUserId = String(s.assigneeUserId ?? "").trim();
      core.dueSoon.push({
        taskTitle: t.title,
        taskNo: t.taskNo,
        subtaskTitle: s.title,
        assigneeUserId: assigneeUserId || undefined,
        assigneeName: resolveName?.(assigneeUserId) || assigneeUserId || undefined,
        statusLabel: employeeStatusLabel(st),
        dueLabel: formatDueLabelForDelivery(s.dueAt, overdue, policy.timezone),
        overdue,
        dueSortMs: dueMs,
      });
    }
  }

  core.dueSoon = sortDueSoonItems(core.dueSoon);
  return core;
}

function buildEmployeeDeliveryCore(
  taskStore: TaskStore,
  userId: string,
  policy: ProgressDigestPolicy,
  now: Date,
): DeliveryReminderCore {
  const core = emptyDeliveryCore();
  const nowMs = now.getTime();
  const horizonEnd = horizonEndMs(now, policy.horizonDays, policy.timezone);

  for (const s of taskStore.listEmployeeSubtasks(userId)) {
    const st = normStatus(String(s.status ?? ""));
    if (st === "DONE" || st === "STOPPED") continue;
    const dueMs = parseDueAtMs(s.dueAt, policy.timezone);
    if (dueMs === undefined) {
      core.skippedNoDueDate += 1;
      continue;
    }
    if (!isDueInHorizon(s.dueAt, horizonEnd, policy.timezone)) {
      core.skippedBeyondHorizon += 1;
      continue;
    }
    const overdue = isOverdueDue(s.dueAt, nowMs, policy.timezone);
    core.dueSoon.push({
      taskTitle: s.taskTitle || s.title,
      taskNo: s.taskNo,
      subtaskTitle: s.title,
      statusLabel: employeeStatusLabel(st),
      dueLabel: formatDueLabelForDelivery(s.dueAt, overdue, policy.timezone),
      overdue,
      dueSortMs: dueMs,
    });
  }

  core.dueSoon = sortDueSoonItems(core.dueSoon);
  return core;
}

function isDeliveryBrief(
  audience: DigestAudience,
  userId: string,
  delivery: NonNullable<ProgressDigestFacts["deliveryReminder"]>,
): boolean {
  if (audience === "combined" && delivery.manager && delivery.employee) {
    const teamItems = dedupeCombinedManagerDueSoon(delivery.manager, delivery.employee, userId);
    return delivery.employee.dueSoon.length + teamItems.length === 0;
  }
  const single = delivery.core ?? delivery.manager ?? delivery.employee;
  return (single?.dueSoon.length ?? 0) === 0;
}

function buildDeliveryReminderFacts(input: {
  taskStore: TaskStore;
  userId: string;
  audience: DigestAudience;
  policy: ProgressDigestPolicy;
  detailUrl: string;
  now: Date;
  resolveName?: (uid: string) => string | undefined;
}): ProgressDigestFacts {
  const activityWindow = previousCalendarDayRangeInTz(input.now, input.policy.timezone);
  const baseFacts = {
    dateYmd: formatDateInTz(input.now.toISOString(), input.policy.timezone),
    dateDisplay: formatDateDisplay(input.now, input.policy.timezone),
    recipientDisplayName: input.resolveName?.(input.userId),
    recipientUserId: input.userId,
    detailUrl: input.detailUrl,
    activityWindow,
    contentMode: input.policy.contentMode,
    core: emptyCore(),
  };

  if (input.audience === "combined") {
    const manager = buildManagerDeliveryCore(
      input.taskStore,
      input.userId,
      input.policy,
      input.now,
      input.resolveName,
    );
    const employee = buildEmployeeDeliveryCore(
      input.taskStore,
      input.userId,
      input.policy,
      input.now,
    );
    const deliveryReminder = { manager, employee };
    return {
      ...baseFacts,
      audience: input.audience,
      deliveryReminder,
      isBrief: isDeliveryBrief(input.audience, input.userId, deliveryReminder),
    };
  }

  const singleCore =
    input.audience === "manager"
      ? buildManagerDeliveryCore(
          input.taskStore,
          input.userId,
          input.policy,
          input.now,
          input.resolveName,
        )
      : buildEmployeeDeliveryCore(input.taskStore, input.userId, input.policy, input.now);
  const deliveryReminder = { core: singleCore };
  return {
    ...baseFacts,
    audience: input.audience,
    deliveryReminder,
    isBrief: isDeliveryBrief(input.audience, input.userId, deliveryReminder),
  };
}

function emptyCore(): ProgressDigestFactsCore {
  return {
    summary: {
      needsYouCount: 0,
      inProgressCount: 0,
      waitingAcceptCount: 0,
      blockedCount: 0,
      overdueCount: 0,
    },
    needsAttention: [],
    inProgress: [],
    recentUpdates: [],
  };
}

function buildRecentUpdates(
  taskStore: TaskStore,
  input: {
    userId: string;
    role: "manager" | "employee";
    sinceIso: string;
    untilIso: string;
    timezone: string;
    limit: number;
    resolveName?: (uid: string) => string | undefined;
  },
): DigestRecentUpdate[] {
  const events =
    input.role === "manager"
      ? taskStore.listTaskEventsForManagerSince({
          managerUserId: input.userId,
          sinceIso: input.sinceIso,
          untilIso: input.untilIso,
          eventTypes: [...PROGRESS_DIGEST_EVENT_TYPES],
          limit: input.limit,
        })
      : taskStore.listTaskEventsForEmployeeSince({
          assigneeUserId: input.userId,
          sinceIso: input.sinceIso,
          untilIso: input.untilIso,
          eventTypes: [...PROGRESS_DIGEST_EVENT_TYPES],
          limit: input.limit,
        });

  return events.map((row) => {
    const actorId = String(row.actor_user_id ?? "").trim();
    const note = String(row.note ?? "").trim();
    return {
      timeLabel: formatTimeLabel(String(row.occurred_at ?? ""), input.timezone),
      actorName: input.resolveName?.(actorId) || actorId || "系统",
      taskTitle: String(row.task_title ?? "").trim() || "任务",
      subtaskTitle: String(row.subtask_title ?? "").trim() || undefined,
      actionLabel: eventActionLabel(String(row.event_type ?? "")),
      note: note || undefined,
    };
  });
}

function buildManagerCore(
  taskStore: TaskStore,
  userId: string,
  policy: ProgressDigestPolicy,
  now: Date,
  activityWindow: CalendarDayRange,
  resolveName?: (uid: string) => string | undefined,
): ProgressDigestFactsCore {
  const nowMs = now.getTime();
  const core = emptyCore();

  for (const t of taskStore.listManagerTasks(userId)) {
    const detail = taskStore.getTaskDetail(t.taskNo);
    if (!detail) continue;
    const subInputs: SubtaskAttentionInput[] = detail.subtasks.map((s) => ({
      status: String(s.status ?? ""),
      openDeclineKind: taskStore.getSubtaskOpenDeclineKind(s.subtaskId),
    }));
    const attn = deriveManagerAttentionLabel(subInputs);
    if (attn.attentionLabel === "已完成" || attn.attentionLabel === "已停止") continue;

    for (const s of detail.subtasks) {
      const st = normStatus(String(s.status ?? ""));
      if (st === "DONE" || st === "STOPPED") continue;
      const overdue = isOverdue(s.dueAt, nowMs);
      const assigneeName = resolveName?.(s.assigneeUserId) || s.assigneeUserId;
      const dueLabel = formatDueLabel(s.dueAt, policy.timezone);

      if (st === "ASSIGNED") core.summary.waitingAcceptCount += 1;
      if (st === "IN_PROGRESS") core.summary.inProgressCount += 1;
      if (st === "BLOCKED") core.summary.blockedCount += 1;
      if (overdue) core.summary.overdueCount += 1;

      const needsMgr =
        subtaskNeedsManagerAction({
          status: st,
          openDeclineKind: taskStore.getSubtaskOpenDeclineKind(s.subtaskId),
        }) || st === "BLOCKED" || st === "REJECTED" || overdue;

      if (needsMgr) {
        core.summary.needsYouCount += 1;
        let reasonHint: string | undefined;
        if (st === "REJECTED") reasonHint = "请在工作台确认是否改派或调整任务";
        else if (st === "BLOCKED") reasonHint = "请关注阻塞原因并协调资源";
        else if (overdue) reasonHint = "子任务已逾期，请跟进";
        else if (
          subtaskNeedsManagerAction({
            status: st,
            openDeclineKind: taskStore.getSubtaskOpenDeclineKind(s.subtaskId),
          })
        )
          reasonHint = "员工申请需要您处理";
        core.needsAttention.push({
          taskTitle: t.title,
          taskNo: t.taskNo,
          subtaskTitle: s.title,
          assigneeNames: assigneeName ? [assigneeName] : [],
          statusLabel: employeeStatusLabel(st),
          dueLabel,
          reasonHint,
          overdue,
        });
      } else {
        core.inProgress.push({
          taskTitle: t.title,
          taskNo: t.taskNo,
          subtaskTitle: s.title,
          assigneeName,
          statusLabel: employeeStatusLabel(st),
          dueLabel,
          overdue,
        });
      }
    }
  }

  core.recentUpdates = buildRecentUpdates(taskStore, {
    userId,
    role: "manager",
    sinceIso: activityWindow.sinceIso,
    untilIso: activityWindow.untilIso,
    timezone: policy.timezone,
    limit: 5,
    resolveName,
  });
  return core;
}

function buildEmployeeCore(
  taskStore: TaskStore,
  userId: string,
  policy: ProgressDigestPolicy,
  now: Date,
  activityWindow: CalendarDayRange,
  resolveName?: (uid: string) => string | undefined,
): ProgressDigestFactsCore {
  const nowMs = now.getTime();
  const core = emptyCore();

  for (const s of taskStore.listEmployeeSubtasks(userId)) {
    const st = normStatus(String(s.status ?? ""));
    if (st === "DONE" || st === "STOPPED") continue;
    const overdue = isOverdue(s.dueAt, nowMs);
    const dueLabel = formatDueLabel(s.dueAt, policy.timezone);
    const taskTitle = s.taskTitle || s.title;
    const subtaskTitle = s.title;

    if (st === "ASSIGNED") core.summary.waitingAcceptCount += 1;
    if (st === "IN_PROGRESS") core.summary.inProgressCount += 1;
    if (st === "BLOCKED") core.summary.blockedCount += 1;
    if (overdue) core.summary.overdueCount += 1;

    const needsYou = st === "ASSIGNED" || st === "BLOCKED" || overdue || st === "REJECTED";
    const base = {
      taskTitle,
      taskNo: s.taskNo,
      subtaskTitle,
      statusLabel: employeeStatusLabel(st),
      dueLabel,
      overdue,
    };

    if (needsYou) {
      core.summary.needsYouCount += 1;
      let reasonHint: string | undefined;
      if (st === "ASSIGNED") reasonHint = "请尽快在工作台接受或反馈";
      else if (st === "BLOCKED") reasonHint = "请说明阻塞原因或申请支持";
      else if (overdue) reasonHint = "该任务已逾期，请优先处理";
      core.needsAttention.push({
        ...base,
        assigneeNames: [],
        reasonHint,
      });
    } else {
      core.inProgress.push({
        ...base,
        assigneeName: resolveName?.(userId),
      });
    }
  }

  core.recentUpdates = buildRecentUpdates(taskStore, {
    userId,
    role: "employee",
    sinceIso: activityWindow.sinceIso,
    untilIso: activityWindow.untilIso,
    timezone: policy.timezone,
    limit: 5,
    resolveName,
  });
  return core;
}

function hasActiveWork(
  taskStore: TaskStore,
  userId: string,
  audience: DigestAudience,
): boolean {
  if (audience === "manager") return taskStore.hasActiveTasksAsManager(userId);
  if (audience === "employee") return taskStore.hasActiveSubtasksAsEmployee(userId);
  return (
    taskStore.hasActiveTasksAsManager(userId) ||
    taskStore.hasActiveSubtasksAsEmployee(userId)
  );
}

export function buildProgressDigestFacts(input: {
  taskStore: TaskStore;
  userId: string;
  audience: DigestAudience;
  policy: ProgressDigestPolicy;
  detailUrl: string;
  now?: Date;
  resolveName?: (uid: string) => string | undefined;
}): ProgressDigestFacts {
  const now = input.now ?? new Date();

  if (input.policy.contentMode === "delivery_reminder") {
    return buildDeliveryReminderFacts({ ...input, now });
  }

  const dateYmd = formatDateInTz(now.toISOString(), input.policy.timezone);
  const activityWindow = previousCalendarDayRangeInTz(now, input.policy.timezone);
  const isBrief = !hasActiveWork(input.taskStore, input.userId, input.audience);
  const recipientDisplayName = input.resolveName?.(input.userId);

  const baseFacts = {
    dateYmd,
    dateDisplay: formatDateDisplay(now, input.policy.timezone),
    recipientDisplayName,
    recipientUserId: input.userId,
    detailUrl: input.detailUrl,
    activityWindow,
    contentMode: input.policy.contentMode,
  };

  if (input.audience === "combined") {
    const managerCore = buildManagerCore(
      input.taskStore,
      input.userId,
      input.policy,
      now,
      activityWindow,
      input.resolveName,
    );
    const employeeCore = buildEmployeeCore(
      input.taskStore,
      input.userId,
      input.policy,
      now,
      activityWindow,
      input.resolveName,
    );
    return {
      ...baseFacts,
      audience: input.audience,
      isBrief,
      core: emptyCore(),
      managerCore,
      employeeCore,
    };
  }

  const core =
    input.audience === "manager"
      ? buildManagerCore(
          input.taskStore,
          input.userId,
          input.policy,
          now,
          activityWindow,
          input.resolveName,
        )
      : buildEmployeeCore(
          input.taskStore,
          input.userId,
          input.policy,
          now,
          activityWindow,
          input.resolveName,
        );

  return {
    ...baseFacts,
    audience: input.audience,
    isBrief,
    core,
  };
}
