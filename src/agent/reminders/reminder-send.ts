import { randomUUID } from "node:crypto";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { isWorkbenchAdmin } from "../../security/workbench-role-resolver";
import { logStructured } from "../../infra/logger";
import {
  formatDateInTz,
  loadReminderPolicy,
  startOfDayInTz,
  type ReminderPolicy,
} from "./reminder-policy";
import { buildReminderMarkdown, REMINDER_TEMPLATE_VERSION } from "./reminder-templates";
import type { ReminderTrigger } from "./reminder-eligibility";
import { parseDueAtMs } from "./due-at-parse";

export interface ReminderSendInput {
  subtaskId: string;
  trigger: ReminderTrigger;
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

function buildSourceId(trigger: ReminderTrigger, subtaskId: string, now: Date, timezone: string): string {
  const safeId = subtaskId.replace(/:/g, "-");
  if (trigger === "scheduler") {
    const ymd = formatDateInTz(now.toISOString(), timezone).replace(/-/g, "");
    return `followup:scheduler:${safeId}:${ymd}`;
  }
  const suffix = trigger === "manual_chat" ? "manual_chat" : "manual_workbench";
  return `followup:${suffix}:${safeId}:${Date.now()}`;
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
  const dueMs = parseDueAtMs(subtask.dueAt);
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
  if (input.trigger === "scheduler" && overdueDays < 1) {
    return { ok: false, skipped: "not_overdue" };
  }
  let tier =
    input.requestedTier ??
    (overdueDays > policy.tier2AfterOverdueDays ? "day2plus" : "day1");

  if (input.trigger === "scheduler") {
    const todayYmd = formatDateInTz(nowIso, policy.timezone);
    const state = deps.taskStore.getSubtaskReminderState(input.subtaskId);
    if (state?.lastRemindedAt && formatDateInTz(state.lastRemindedAt, policy.timezone) === todayYmd) {
      return { ok: false, skipped: "already_sent_today" };
    }
    const claim = deps.taskStore.tryClaimSchedulerReminder({
      subtaskId: input.subtaskId,
      overdueSince,
      nowIso,
      tier,
      todayStartIso: startOfDayInTz(now, policy.timezone),
      schedulerSourceId: buildSourceId("scheduler", input.subtaskId, now, policy.timezone),
    });
    if (!claim.claimed) {
      return { ok: false, skipped: claim.reason ?? "claim_failed" };
    }
  } else {
    deps.taskStore.recordManualReminder({
      subtaskId: input.subtaskId,
      overdueSince,
      nowIso,
      manualSourceId: buildSourceId(input.trigger, input.subtaskId, now, policy.timezone),
    });
  }

  const { subject, markdown } = buildReminderMarkdown({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskTitle: subtask.title,
    managerDisplayName: managerContact?.name,
    overdueDays,
    tone: input.tone,
    customMessage: input.customMessage,
  });

  const sourceId = buildSourceId(input.trigger, input.subtaskId, now, policy.timezone);
  const notifyResult = await deps.notifier.notifySubtaskReminder({
    taskNo: task.taskNo,
    taskTitle: task.title,
    subtaskId: input.subtaskId,
    subtaskTitle: subtask.title,
    assigneeUserId: subtask.assigneeUserId,
    unionId: contact?.unionId,
    managerUserId: task.managerUserId,
    managerDisplayName: managerContact?.name,
    subject,
    markdown,
    tier,
    sourceId,
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
    tier,
    channels,
    templateVersion: REMINDER_TEMPLATE_VERSION,
    trigger: input.trigger,
    sourceId,
    failed: failedChannels,
  };

  if (channels.length > 0) {
    deps.taskStore.appendTaskEvent({
      taskId: task.taskId,
      subtaskId: input.subtaskId,
      eventType: "SUBTASK_REMIND_SENT",
      actorUserId: input.actorUserId,
      payload,
    });
    logStructured({
      event: "subtask_remind_sent",
      subtaskId: input.subtaskId,
      taskNo: task.taskNo,
      trigger: input.trigger,
      tier,
      channels,
    });
    return { ok: true, channels, failed: failedChannels, tier };
  }

  deps.taskStore.appendTaskEvent({
    taskId: task.taskId,
    subtaskId: input.subtaskId,
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

export async function polishManualReminderMessage(input: {
  baseMarkdown: string;
  tone?: "polite" | "firm";
  timeoutMs: number;
  enabled: boolean;
}): Promise<string | undefined> {
  if (!input.enabled) return undefined;
  // Lightweight LLM polish deferred: return undefined to use template (callers may extend later).
  void input.timeoutMs;
  return undefined;
}

export function newManualSourceId(): string {
  return randomUUID();
}
