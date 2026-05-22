import { randomUUID } from "node:crypto";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { isWorkbenchAdmin } from "../../security/workbench-role-resolver";
import { logStructured } from "../../infra/logger";
import {
  formatDateInTz,
  formatYmdDisplayInTz,
  loadReminderPolicy,
  startOfDayInTz,
  type ReminderPolicy,
} from "./reminder-policy";
import {
  buildManagerOverdueMarkdown,
  buildPreDueMarkdown,
  buildReminderMarkdown,
  REMINDER_TEMPLATE_VERSION,
} from "./reminder-templates";
import type { ReminderTrigger } from "./reminder-eligibility";
import { dueAtYmdInTz, parseDueAtMs } from "./due-at-parse";

export interface ReminderSendInput {
  subtaskId: string;
  trigger: "manual_chat" | "manual_workbench";
  actorUserId: string;
  requestedTier?: "day1" | "day2plus";
  tone?: "polite" | "firm";
  customMessage?: string;
}

export interface ReminderSendResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  channels?: string[];
  failed?: Array<{ channel: string; reason: string }>;
  tier?: string;
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;
type PeopleStore = ReturnType<typeof createPeopleDirectoryStore>;

function buildManualSourceId(trigger: "manual_chat" | "manual_workbench", subtaskId: string): string {
  const safeId = subtaskId.replace(/:/g, "-");
  const suffix = trigger === "manual_chat" ? "manual_chat" : "manual_workbench";
  return `followup:${suffix}:${safeId}:${Date.now()}`;
}

function buildSchedulerSourceId(kind: "pre_due" | "manager_overdue", subtaskId: string, now: Date, timezone: string): string {
  const safeId = subtaskId.replace(/:/g, "-");
  const ymd = formatDateInTz(now.toISOString(), timezone).replace(/-/g, "");
  return `followup:${kind}:${safeId}:${ymd}`;
}

function formatDueDisplay(dueAt: string | undefined, timezone: string): string | undefined {
  const ymd = dueAtYmdInTz(dueAt, timezone);
  if (!ymd) return undefined;
  return `${formatYmdDisplayInTz(ymd, timezone)} 18:00`;
}

export async function sendSubtaskReminder(input: ReminderSendInput, deps: {
  taskStore: TaskStore;
  notifier: WorkbenchPublishNotifier;
  peopleStore: PeopleStore;
  policy?: ReminderPolicy;
}): Promise<ReminderSendResult> {
  const policy = deps.policy ?? loadReminderPolicy();
  const pair = deps.taskStore.getSubtaskWithTask(input.subtaskId);
  if (!pair) {
    return { ok: false, error: "subtask_not_found" };
  }
  const { task, subtask } = pair;
  if (subtask.status !== "IN_PROGRESS" && subtask.status !== "BLOCKED") {
    return { ok: false, error: "invalid_status", skipped: "only_in_progress_or_blocked" };
  }
  const dueMs = parseDueAtMs(subtask.dueAt, policy.timezone);
  if (dueMs === undefined) {
    return { ok: false, error: "due_at_unparseable" };
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const isAdmin = isWorkbenchAdmin(input.actorUserId);
  if (!isAdmin && task.managerUserId !== input.actorUserId) {
    return { ok: false, error: "forbidden" };
  }

  const contact = deps.peopleStore.getContact(subtask.assigneeUserId);
  const managerContact = deps.peopleStore.getContact(task.managerUserId);
  const overdueSince =
    deps.taskStore.getSubtaskReminderState(input.subtaskId)?.overdueSince ??
    new Date(dueMs).toISOString();

  const dueYmd = formatDateInTz(new Date(dueMs).toISOString(), policy.timezone);
  const nowYmd = formatDateInTz(nowIso, policy.timezone);
  const dueParts = dueYmd.split("-").map(Number);
  const nowParts = nowYmd.split("-").map(Number);
  const overdueDays = Math.max(
    0,
    Math.floor(
      (Date.UTC(nowParts[0]!, nowParts[1]! - 1, nowParts[2]!) -
        Date.UTC(dueParts[0]!, dueParts[1]! - 1, dueParts[2]!)) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const tier =
    input.requestedTier ??
    (overdueDays > policy.tier2AfterOverdueDays ? "day2plus" : "day1");

  deps.taskStore.recordManualReminder({
    subtaskId: input.subtaskId,
    overdueSince,
    nowIso,
    manualSourceId: buildManualSourceId(input.trigger, input.subtaskId),
  });

  const { subject, markdown } = buildReminderMarkdown({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskTitle: subtask.title,
    managerDisplayName: managerContact?.name,
    overdueDays: Math.max(1, overdueDays),
    tone: input.tone,
    customMessage: input.customMessage,
  });

  const sourceId = buildManualSourceId(input.trigger, input.subtaskId);
  return deliverEmployeeReminder({
    taskStore: deps.taskStore,
    notifier: deps.notifier,
    task,
    subtask,
    contact,
    managerContact,
    subject,
    markdown,
    tier,
    sourceId,
    trigger: input.trigger,
    actorUserId: input.actorUserId,
  });
}

async function deliverEmployeeReminder(input: {
  taskStore: TaskStore;
  notifier: WorkbenchPublishNotifier;
  task: { taskId: string; taskNo: string; title: string; managerUserId: string };
  subtask: { subtaskId: string; title: string; assigneeUserId: string };
  contact?: { unionId?: string };
  managerContact?: { name?: string };
  subject: string;
  markdown: string;
  tier: "day1" | "day2plus";
  sourceId: string;
  trigger: ReminderTrigger;
  actorUserId: string;
}): Promise<ReminderSendResult> {
  const notifyResult = await input.notifier.notifySubtaskReminder({
    taskNo: input.task.taskNo,
    taskTitle: input.task.title,
    subtaskId: input.subtask.subtaskId,
    subtaskTitle: input.subtask.title,
    assigneeUserId: input.subtask.assigneeUserId,
    unionId: input.contact?.unionId,
    managerUserId: input.task.managerUserId,
    managerDisplayName: input.managerContact?.name,
    subject: input.subject,
    markdown: input.markdown,
    tier: input.tier,
    sourceId: input.sourceId,
  });

  const channels: string[] = [];
  const failedChannels: Array<{ channel: string; reason: string }> = [];
  if (notifyResult.success[0]?.todoId) channels.push("todo");
  if (notifyResult.success[0]?.robotMessageKey) channels.push("robot");
  if (notifyResult.success[0]?.cardMessageId) channels.push("card");
  for (const f of notifyResult.failed) {
    const reason = f.reason;
    if (reason.includes("todo")) failedChannels.push({ channel: "todo", reason });
    else if (reason.includes("robot")) failedChannels.push({ channel: "robot", reason });
    else if (reason.includes("card")) failedChannels.push({ channel: "card", reason });
    else failedChannels.push({ channel: "unknown", reason });
  }

  const payload = {
    tier: input.tier,
    channels,
    templateVersion: REMINDER_TEMPLATE_VERSION,
    trigger: input.trigger,
    sourceId: input.sourceId,
    failed: failedChannels,
  };

  if (channels.length > 0) {
    input.taskStore.appendTaskEvent({
      taskId: input.task.taskId,
      subtaskId: input.subtask.subtaskId,
      eventType: "SUBTASK_REMIND_SENT",
      actorUserId: input.actorUserId,
      payload,
    });
    logStructured({
      event: "subtask_remind_sent",
      subtaskId: input.subtask.subtaskId,
      taskNo: input.task.taskNo,
      trigger: input.trigger,
      tier: input.tier,
      channels,
    });
    return { ok: true, channels, failed: failedChannels, tier: input.tier };
  }

  input.taskStore.appendTaskEvent({
    taskId: input.task.taskId,
    subtaskId: input.subtask.subtaskId,
    eventType: "SUBTASK_REMIND_NOTIFY_FAILED",
    actorUserId: input.actorUserId,
    payload: { ...payload, skippedReason: notifyResult.skippedReason },
  });
  return {
    ok: false,
    error: "notify_failed",
    failed: failedChannels,
    skipped: notifyResult.skippedReason,
  };
}

export async function sendPreDueEmployeeReminder(
  subtaskId: string,
  deps: {
    taskStore: TaskStore;
    notifier: WorkbenchPublishNotifier;
    peopleStore: PeopleStore;
    policy?: ReminderPolicy;
  },
): Promise<ReminderSendResult> {
  const policy = deps.policy ?? loadReminderPolicy();
  const pair = deps.taskStore.getSubtaskWithTask(subtaskId);
  if (!pair) return { ok: false, error: "subtask_not_found" };
  const { task, subtask } = pair;
  if (subtask.status !== "IN_PROGRESS" && subtask.status !== "BLOCKED") {
    return { ok: false, skipped: "only_in_progress_or_blocked" };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const sourceId = buildSchedulerSourceId("pre_due", subtaskId, now, policy.timezone);
  const claim = deps.taskStore.tryClaimPreDueReminder({
    subtaskId,
    nowIso,
    todayStartIso: startOfDayInTz(now, policy.timezone),
    sourceId,
  });
  if (!claim.claimed) {
    return { ok: false, skipped: claim.reason ?? "claim_failed" };
  }

  const managerContact = deps.peopleStore.getContact(task.managerUserId);
  const contact = deps.peopleStore.getContact(subtask.assigneeUserId);
  const { subject, markdown } = buildPreDueMarkdown({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskTitle: subtask.title,
    managerDisplayName: managerContact?.name,
    dueDisplay: formatDueDisplay(subtask.dueAt, policy.timezone),
  });

  return deliverEmployeeReminder({
    taskStore: deps.taskStore,
    notifier: deps.notifier,
    task,
    subtask,
    contact,
    managerContact,
    subject,
    markdown,
    tier: "day1",
    sourceId,
    trigger: "scheduler_pre_due",
    actorUserId: task.managerUserId,
  });
}

export async function sendManagerOverdueAlert(
  input: {
    subtaskId: string;
    overdueSince: string;
    assigneeDisplayName?: string;
  },
  deps: {
    taskStore: TaskStore;
    notifier: WorkbenchPublishNotifier;
    peopleStore: PeopleStore;
    policy?: ReminderPolicy;
  },
): Promise<ReminderSendResult> {
  const policy = deps.policy ?? loadReminderPolicy();
  const pair = deps.taskStore.getSubtaskWithTask(input.subtaskId);
  if (!pair) return { ok: false, error: "subtask_not_found" };
  const { task, subtask } = pair;

  const now = new Date();
  const nowIso = now.toISOString();
  const sourceId = buildSchedulerSourceId("manager_overdue", input.subtaskId, now, policy.timezone);
  const claim = deps.taskStore.tryClaimManagerOverdueAlert({
    subtaskId: input.subtaskId,
    overdueSince: input.overdueSince,
    nowIso,
    sourceId,
  });
  if (!claim.claimed) {
    return { ok: false, skipped: claim.reason ?? "claim_failed" };
  }

  const assigneeName =
    input.assigneeDisplayName ??
    deps.peopleStore.getContact(subtask.assigneeUserId)?.name;
  const { subject, markdown } = buildManagerOverdueMarkdown({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskTitle: subtask.title,
    assigneeDisplayName: assigneeName,
    dueDisplay: formatDueDisplay(subtask.dueAt, policy.timezone),
  });

  const baseUrl = (
    process.env.WORKBENCH_NOTIFY_MANAGER_DETAIL_URL_BASE ||
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ||
    ""
  ).replace(/\/+$/, "");
  const detailUrl = baseUrl
    ? `${baseUrl}/workbench/manager/task?taskNo=${encodeURIComponent(task.taskNo)}`
    : undefined;

  const notifyResult = await deps.notifier.notifyManagerSubtaskOverdue({
    managerUserId: task.managerUserId,
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskId: subtask.subtaskId,
    subtaskTitle: subtask.title,
    assigneeUserId: subtask.assigneeUserId,
    assigneeDisplayName: assigneeName,
    subject,
    markdown,
    detailUrl,
    sourceId,
  });

  if (notifyResult.success.length > 0) {
    deps.taskStore.appendTaskEvent({
      taskId: task.taskId,
      subtaskId: subtask.subtaskId,
      eventType: "MANAGER_OVERDUE_ALERT_SENT",
      actorUserId: task.managerUserId,
      payload: { sourceId, templateVersion: REMINDER_TEMPLATE_VERSION },
    });
    logStructured({
      event: "manager_overdue_alert_sent",
      subtaskId: subtask.subtaskId,
      taskNo: task.taskNo,
      managerUserId: task.managerUserId,
    });
    return { ok: true, channels: ["robot"] };
  }

  deps.taskStore.appendTaskEvent({
    taskId: task.taskId,
    subtaskId: subtask.subtaskId,
    eventType: "MANAGER_OVERDUE_ALERT_FAILED",
    actorUserId: task.managerUserId,
    payload: { sourceId, reason: notifyResult.skippedReason ?? notifyResult.failed[0]?.reason },
  });
  return {
    ok: false,
    error: "notify_failed",
    skipped: notifyResult.skippedReason ?? notifyResult.failed[0]?.reason,
  };
}

export async function polishManualReminderMessage(input: {
  baseMarkdown: string;
  tone?: "polite" | "firm";
  timeoutMs: number;
  enabled: boolean;
}): Promise<string | undefined> {
  if (!input.enabled) return undefined;
  void input.timeoutMs;
  return undefined;
}

export function newManualSourceId(): string {
  return randomUUID();
}
