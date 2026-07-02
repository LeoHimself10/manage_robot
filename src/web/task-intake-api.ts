import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { resolveEmployeeProfileDir } from "../infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../integrations/dingtalk/workbench-notify";
import { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import { structureTasksFromText } from "../agent/task-intake/structure-input";
import { buildPreviewRows } from "../agent/task-intake/resolve-assignees";
import { suggestTaskTargets, type ExistingTaskStub } from "../agent/task-intake/suggest-targets";
import { appendTaskIntake, commitTaskIntake } from "../agent/task-intake/commit-task-intake";
import { isTaskIntakeDingTalkMeetingsEnabled } from "../agent/task-intake/dingtalk-meetings-flag";
import { fetchUrlContent } from "../integrations/url-fetch/fetch-url-content";
import {
  DingTalkMeetingApiError,
  createDingTalkMeetingRecordingClient,
  type DingTalkCalendarVideoMeeting,
  type DingTalkMeetingRecordingClient,
  type DingTalkVideoConferenceInfo,
} from "../integrations/dingtalk/meeting-recording";
import {
  createDingTalkMeetingStore,
  type DingTalkMeetingRow,
  type DingTalkMeetingStore,
} from "../infra/dingtalk-meeting-store";
import type {
  TaskIntakeAppendResult,
  TaskIntakeCommitResult,
  TaskIntakeCommitRow,
  TaskIntakePreviewRow,
} from "../agent/task-intake/types";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export class TaskIntakeMeetingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "TaskIntakeMeetingError";
  }
}

function normalizeDueMode(row: TaskIntakeCommitRow): "fixed" | "self" {
  if (row.dueMode === "fixed" || row.dueMode === "self") return row.dueMode;
  return row.dueAt?.trim() ? "fixed" : "self";
}

/** When only one new-parent group is suggested, reuse structure's parentDescription as fallback. */
function applyNewGroupDescriptionFallback(
  rows: TaskIntakePreviewRow[],
  parentDescription: string,
): TaskIntakePreviewRow[] {
  const desc = String(parentDescription ?? "").trim();
  if (!desc) return rows;

  const groupIds = new Set(
    rows.map((r) => r.suggestedNewGroupId).filter((id): id is string => Boolean(id)),
  );
  if (groupIds.size !== 1) return rows;

  const gid = [...groupIds][0]!;
  const hasAnyDesc = rows.some((r) => r.suggestedNewGroupId === gid && r.suggestedNewGroupDescription?.trim());
  if (hasAnyDesc) return rows;

  return rows.map((r) =>
    r.suggestedNewGroupId === gid ? { ...r, suggestedNewGroupDescription: desc } : r,
  );
}

export async function handleTaskIntakePreview(input: {
  pastedText?: string;
  parentTitle?: string;
  docUrl?: string;
  existingTasks?: ExistingTaskStub[];
}): Promise<{
  parentTitle: string;
  parentDescription: string;
  rows: TaskIntakePreviewRow[];
  warnings: string[];
  usedFallback: boolean;
}> {
  const pastedText = String(input.pastedText ?? "");
  const parentTitleHint = String(input.parentTitle ?? "");
  const docUrl = String(input.docUrl ?? "").trim();
  const warnings: string[] = [];
  let sourceText = pastedText;

  if (docUrl) {
    const fetched = await fetchUrlContent({ url: docUrl, maxTextChars: 60_000 });
    if (fetched.ok) {
      const title = fetched.title?.trim() || fetched.finalUrl || fetched.url;
      const linkBlock = [`[url] ${title}`, fetched.text].filter(Boolean).join("\n");
      sourceText = [sourceText.trim(), linkBlock].filter(Boolean).join("\n\n");
      if (fetched.note) warnings.push(fetched.note);
    } else {
      warnings.push(`url_fetch_${fetched.reason}: ${fetched.hint}`);
    }
  }

  // Structure first (faithfully maps pasted text to subtasks).
  const result = await structureTasksFromText({ pastedText: sourceText, parentTitleHint });

  // Then suggest targets — depends on structured subtask list; failure is non-fatal.
  const subtaskStubs = result.structured.subtasks.map((s, i) => ({
    itemId: `ti_${i + 1}`,
    title: s.title,
    objective: s.objective,
  }));
  const suggestions = await suggestTaskTargets({
    subtasks: subtaskStubs,
    existingTasks: input.existingTasks ?? [],
  }).catch(() => undefined);

  let rows = buildPreviewRows(result.structured, suggestions);
  rows = applyNewGroupDescriptionFallback(rows, result.structured.parentDescription);
  return {
    parentTitle: result.structured.parentTitle,
    parentDescription: result.structured.parentDescription,
    rows,
    warnings: [...warnings, ...result.warnings],
    usedFallback: result.usedFallback,
  };
}

function normalizeDays(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 14;
  return Math.min(Math.floor(raw), 90);
}

function resolveManagerUnionId(userId: string): string {
  const peopleStore = createPeopleDirectoryStore();
  try {
    const unionId = peopleStore.getContact(userId)?.unionId?.trim();
    if (!unionId) {
      throw new TaskIntakeMeetingError(
        "manager_union_id_missing",
        "当前账号缺少钉钉 unionId，请先开启/完成通讯录同步",
        400,
      );
    }
    return unionId;
  } finally {
    peopleStore.close();
  }
}

function presentMeeting(row: DingTalkMeetingRow): {
  conferenceId: string;
  title: string;
  startTimeMs?: number;
  endTimeMs?: number;
  flashStatus?: string;
  transcriptCached: boolean;
  lastError?: string;
} {
  return {
    conferenceId: row.conferenceId,
    title: row.title || row.roomCode || row.conferenceId,
    startTimeMs: row.startTimeMs,
    endTimeMs: row.endTimeMs,
    flashStatus: row.flashStatus,
    transcriptCached: row.transcriptCached,
    lastError: row.lastError,
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function conferenceMatchesCalendarEvent(
  info: DingTalkVideoConferenceInfo,
  event: DingTalkCalendarVideoMeeting,
  sinceMs: number,
  nowMs: number,
): boolean {
  const start = Number(info.startTimeMs ?? 0);
  if (!Number.isFinite(start) || start <= 0) return true;
  if (start < sinceMs || start > nowMs + 24 * 60 * 60 * 1000) return false;
  const eventStart = Number(event.startTimeMs ?? 0);
  if (!Number.isFinite(eventStart) || eventStart <= 0) return true;
  const eventEnd = Number(event.endTimeMs ?? eventStart);
  const lower = eventStart - 30 * 60 * 1000;
  const upper = eventEnd + 2 * 60 * 60 * 1000;
  return start >= lower && start <= upper;
}

function membersFromCalendarMeeting(
  unionId: string,
  event: DingTalkCalendarVideoMeeting,
  info: DingTalkVideoConferenceInfo,
) {
  return uniqueStrings([
    unionId,
    event.organizerUnionId,
    info.creatorUnionId,
    info.hostUnionId,
    ...(event.attendeeUnionIds ?? []),
  ]).map((memberUnionId) => ({
    unionId: memberUnionId,
    role: memberUnionId === unionId ? "current_user" : memberUnionId === info.creatorUnionId ? "creator" : undefined,
  }));
}

async function syncRecentCalendarMeetingsForUnionId(input: {
  unionId: string;
  days: number;
  meetingStore: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
  nowMs?: number;
}): Promise<string[]> {
  const client = input.meetingClient ?? createDingTalkMeetingRecordingClient();
  if (!client.listCalendarVideoMeetings) return [];
  const nowMs = input.nowMs ?? Date.now();
  const sinceMs = nowMs - input.days * 24 * 60 * 60 * 1000;
  const warnings: string[] = [];
  let events: DingTalkCalendarVideoMeeting[] = [];
  try {
    events = await client.listCalendarVideoMeetings({
      unionId: input.unionId,
      timeMinMs: sinceMs,
      timeMaxMs: nowMs,
      maxResults: 50,
    });
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
    return warnings;
  }

  const seen = new Set<string>();
  for (const event of events) {
    const historical = event.roomCode && client.listVideoConferencesByRoomCode
      ? await client.listVideoConferencesByRoomCode({ roomCode: event.roomCode, maxResults: 20 }).catch((err) => {
          warnings.push(err instanceof Error ? err.message : String(err));
          return [] as DingTalkVideoConferenceInfo[];
        })
      : [];
    const infos = historical.filter((info) => conferenceMatchesCalendarEvent(info, event, sinceMs, nowMs));
    if (!infos.length && event.conferenceId) {
      infos.push({
        conferenceId: event.conferenceId,
        title: event.title,
        roomCode: event.roomCode,
        creatorUnionId: event.organizerUnionId,
        startTimeMs: event.startTimeMs,
        endTimeMs: event.endTimeMs,
        status: "calendar",
      });
    }
    for (const info of infos) {
      const conferenceId = String(info.conferenceId ?? "").trim();
      if (!conferenceId || seen.has(conferenceId)) continue;
      seen.add(conferenceId);
      input.meetingStore.upsertMeeting({
        conferenceId,
        title: info.title || event.title,
        roomCode: info.roomCode || event.roomCode,
        scheduleConferenceId: info.scheduleConferenceId || event.conferenceId,
        creatorUnionId: info.creatorUnionId || event.organizerUnionId,
        creatorUserId: info.creatorUserId,
        creatorNick: info.creatorNick,
        hostUnionId: info.hostUnionId,
        startTimeMs: info.startTimeMs || event.startTimeMs,
        endTimeMs: info.endTimeMs || event.endTimeMs,
        status: info.status || "calendar",
        flashStatus: info.flashStatus || "AI 听记待读取",
        rawJson: {
          source: "calendar_backfill",
          calendarEvent: event.rawJson ?? {},
          historicalConference: info,
        },
      });
      input.meetingStore.replaceMeetingMembers(
        conferenceId,
        membersFromCalendarMeeting(input.unionId, event, info),
      );
    }
  }
  return warnings;
}

export async function handleTaskIntakeMeetingsList(input: {
  managerUserId: string;
  days?: number;
  meetingStore?: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
  nowMs?: number;
}): Promise<{ meetings: ReturnType<typeof presentMeeting>[]; warnings?: string[] }> {
  if (!isTaskIntakeDingTalkMeetingsEnabled()) {
    throw new TaskIntakeMeetingError("meetings_disabled", "DingTalk meetings import is disabled", 404);
  }
  const unionId = resolveManagerUnionId(input.managerUserId);
  const days = normalizeDays(input.days);
  const nowMs = input.nowMs ?? Date.now();
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const ownStore = input.meetingStore ? undefined : createDingTalkMeetingStore();
  const meetingStore = input.meetingStore ?? ownStore!;
  try {
    const warnings = await syncRecentCalendarMeetingsForUnionId({
      unionId,
      days,
      meetingStore,
      meetingClient: input.meetingClient,
      nowMs,
    });
    return {
      meetings: meetingStore
        .listMeetingsForUnionId({ unionId, sinceMs, limit: 50 })
        .map(presentMeeting),
      warnings: warnings.length ? warnings : undefined,
    };
  } finally {
    ownStore?.close();
  }
}

async function fetchMeetingTranscriptWithCandidates(input: {
  client: DingTalkMeetingRecordingClient;
  conferenceId: string;
  unionIds: string[];
}): Promise<{ text: string; fetchedAt: string }> {
  let lastError: unknown;
  for (const unionId of input.unionIds) {
    try {
      const transcript = await input.client.getCloudRecordTranscript({
        conferenceId: input.conferenceId,
        unionId,
      });
      return { text: transcript.text, fetchedAt: transcript.fetchedAt };
    } catch (err) {
      lastError = err;
      if (err instanceof DingTalkMeetingApiError && (err.code === "config_missing" || err.code === "token_failed")) {
        throw err;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "meeting transcript fetch failed"));
}

export async function handleTaskIntakeMeetingPreview(input: {
  managerUserId: string;
  conferenceId: string;
  existingTasks?: ExistingTaskStub[];
  meetingStore?: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
}): Promise<Awaited<ReturnType<typeof handleTaskIntakePreview>> & { meeting: ReturnType<typeof presentMeeting> }> {
  if (!isTaskIntakeDingTalkMeetingsEnabled()) {
    throw new TaskIntakeMeetingError("meetings_disabled", "DingTalk meetings import is disabled", 404);
  }
  const conferenceId = String(input.conferenceId ?? "").trim();
  if (!conferenceId) {
    throw new TaskIntakeMeetingError("conference_id_required", "conferenceId is required", 400);
  }
  const unionId = resolveManagerUnionId(input.managerUserId);
  const ownStore = input.meetingStore ? undefined : createDingTalkMeetingStore();
  const meetingStore = input.meetingStore ?? ownStore!;
  try {
    const meeting = meetingStore.getMeeting(conferenceId);
    if (!meeting) {
      throw new TaskIntakeMeetingError("meeting_not_found", "会议不存在或尚未进入缓存", 404);
    }
    if (!meetingStore.userCanAccessMeeting(conferenceId, unionId)) {
      throw new TaskIntakeMeetingError("meeting_not_accessible", "当前用户无权导入该会议", 403);
    }
    let transcriptText = meeting.transcriptText?.trim() ?? "";
    if (!transcriptText) {
      const client = input.meetingClient ?? createDingTalkMeetingRecordingClient();
      try {
        const transcript = await fetchMeetingTranscriptWithCandidates({
          client,
          conferenceId,
          unionIds: uniqueStrings([meeting.creatorUnionId, meeting.hostUnionId, unionId]),
        });
        transcriptText = transcript.text;
        meetingStore.setMeetingTranscript({
          conferenceId,
          transcriptText,
          fetchedAt: transcript.fetchedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        meetingStore.setMeetingLastError({ conferenceId, errorText: message });
        if (err instanceof DingTalkMeetingApiError && err.code === "empty_transcript") {
          throw new TaskIntakeMeetingError("meeting_transcript_empty", "该会议暂未生成可导入的转写正文", 404);
        }
        if (err instanceof DingTalkMeetingApiError && err.code === "permission_denied") {
          throw new TaskIntakeMeetingError("meeting_transcript_denied", "钉钉拒绝读取该会议转写", 403);
        }
        throw new TaskIntakeMeetingError("meeting_transcript_fetch_failed", message, 502);
      }
    }
    if (!transcriptText.trim()) {
      throw new TaskIntakeMeetingError("meeting_transcript_empty", "该会议暂未生成可导入的转写正文", 404);
    }
    const meetingTitle = meeting.title || meeting.roomCode || "钉钉会议";
    const pastedText = transcriptText.trim();
    const preview = await handleTaskIntakePreview({
      pastedText,
      parentTitle: `${meetingTitle}跟进`,
      existingTasks: input.existingTasks,
    });
    return {
      ...preview,
      meeting: presentMeeting({ ...meeting, transcriptText, transcriptCached: true }),
    };
  } finally {
    ownStore?.close();
  }
}

export async function handleTaskIntakeAppend(input: {
  taskStore: TaskStore;
  managerUserId: string;
  targetPlanId: string;
  rows: TaskIntakeCommitRow[];
  actorName?: string;
}): Promise<TaskIntakeAppendResult> {
  for (const row of input.rows) {
    row.dueMode = normalizeDueMode(row);
    row.dueExpectation = String(row.dueExpectation ?? "").trim();
  }
  return appendTaskIntake({
    taskStore: input.taskStore,
    managerUserId: input.managerUserId,
    targetPlanId: input.targetPlanId,
    rows: input.rows,
    actorName: input.actorName,
  });
}

export async function handleTaskIntakeCommit(input: {
  taskStore: TaskStore;
  managerUserId: string;
  parentTitle: string;
  parentDescription: string;
  projectId?: string;
  projectName?: string;
  rows: TaskIntakeCommitRow[];
  actorName?: string;
  stageDraft: (input: { draft: Record<string, unknown>; assignment: Record<string, unknown> }) => void;
}): Promise<TaskIntakeCommitResult> {
  for (const row of input.rows) {
    row.dueMode = normalizeDueMode(row);
    row.dueExpectation = String(row.dueExpectation ?? "").trim();
  }
  const peopleStore = createPeopleDirectoryStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();
  try {
    const initiatorDepartment =
      employeeRepo.get(input.managerUserId)?.department?.trim() ||
      peopleStore.getContact(input.managerUserId)?.departmentNames?.[0]?.trim() ||
      "未配置部门";
    return await commitTaskIntake({
      taskStore: input.taskStore,
      managerUserId: input.managerUserId,
      parentTitle: input.parentTitle,
      parentDescription: input.parentDescription,
      projectId: input.projectId,
      projectName: input.projectName,
      rows: input.rows,
      initiatorDepartment,
      actorName: input.actorName,
      getContact: (uid) => peopleStore.getContact(uid),
      notifier,
      stageDraft: input.stageDraft,
    });
  } finally {
    peopleStore.close();
  }
}
