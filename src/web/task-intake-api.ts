import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { resolveEmployeeProfileDir } from "../infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../integrations/dingtalk/workbench-notify";
import { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import { structureTasksFromText, type TaskIntakeSourceKind } from "../agent/task-intake/structure-input";
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
  DingTalkMinutesError,
  createDingTalkMinutesClient,
  isDingTalkMinutesDwsEnabled,
  type DingTalkMinutesClient,
} from "../integrations/dingtalk/dingtalk-minutes";
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
  sourceKind?: TaskIntakeSourceKind;
  sourceTitle?: string;
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
  const sourceKind = input.sourceKind === "meeting_transcript" ? "meeting_transcript" : "pasted";
  const sourceTitle = String(input.sourceTitle ?? "").trim();
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

  // Structure first: preserve explicit task lists, or extract only clear action items from notes/transcripts.
  const result = await structureTasksFromText({
    pastedText: sourceText,
    parentTitleHint,
    sourceKind,
    sourceTitle,
  });

  // Then suggest targets — depends on structured subtask list; failure is non-fatal.
  const subtaskStubs = result.structured.subtasks.map((s, i) => ({
    itemId: `ti_${i + 1}`,
    title: s.title,
    objective: s.objective,
  }));
  const suggestions = await suggestTaskTargets({
    subtasks: subtaskStubs,
    existingTasks: input.existingTasks ?? [],
    sourceKind,
    sourceTitle,
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
  sourceKind: "video_conference" | "ai_minutes" | "unified";
  taskUuid?: string;
  title: string;
  startTimeMs?: number;
  endTimeMs?: number;
  flashStatus?: string;
  transcriptCached: boolean;
  transcriptSource?: string;
  lastError?: string;
} {
  return {
    conferenceId: row.conferenceId,
    sourceKind: row.sourceKind,
    taskUuid: row.taskUuid,
    title:
      row.title ||
      row.roomCode ||
      (row.taskUuid ? `AI 听记 ${row.taskUuid.slice(-8)}` : row.conferenceId),
    startTimeMs: row.startTimeMs,
    endTimeMs: row.endTimeMs,
    flashStatus: row.flashStatus,
    transcriptCached: row.transcriptCached,
    transcriptSource: row.transcriptSource,
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
  const cloudProbeJobs: Array<{
    meetingId: string;
    videoConferenceId: string;
    unionIds: string[];
  }> = [];
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
      const storedMeeting = input.meetingStore.upsertMeeting({
        conferenceId,
        videoConferenceId: conferenceId,
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
        storedMeeting.conferenceId,
        membersFromCalendarMeeting(input.unionId, event, info),
      );
      if (!storedMeeting.transcriptCached) {
        cloudProbeJobs.push({
          meetingId: storedMeeting.conferenceId,
          videoConferenceId: conferenceId,
          unionIds: uniqueStrings([
            info.creatorUnionId,
            info.hostUnionId,
            event.organizerUnionId,
            input.unionId,
          ]),
        });
      }
    }
  }
  let probeCursor = 0;
  const workers = Array.from(
    { length: Math.min(4, cloudProbeJobs.length) },
    async () => {
      while (probeCursor < cloudProbeJobs.length) {
        const job = cloudProbeJobs[probeCursor];
        probeCursor += 1;
        if (!job) continue;
        try {
          const transcript = await fetchMeetingTranscriptWithCandidates({
            client,
            conferenceId: job.videoConferenceId,
            unionIds: job.unionIds,
          });
          input.meetingStore.setMeetingTranscript({
            conferenceId: job.meetingId,
            transcriptText: transcript.text,
            fetchedAt: transcript.fetchedAt,
            source: "cloud_record",
          });
        } catch (error) {
          input.meetingStore.setMeetingLastError({
            conferenceId: job.meetingId,
            errorText: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  );
  await Promise.all(workers);
  return warnings;
}

async function syncRecentMinutesForManager(input: {
  managerUserId: string;
  unionId: string;
  days: number;
  meetingStore: DingTalkMeetingStore;
  minutesClient?: DingTalkMinutesClient;
  nowMs?: number;
}): Promise<string[]> {
  if (!input.minutesClient && !isDingTalkMinutesDwsEnabled()) return [];
  const client = input.minutesClient ?? createDingTalkMinutesClient();
  const nowMs = input.nowMs ?? Date.now();
  const sinceMs = nowMs - input.days * 24 * 60 * 60 * 1000;
  try {
    const minutes = await client.listAccessible({
      managerUserId: input.managerUserId,
      startTimeMs: sinceMs,
      endTimeMs: nowMs,
      limit: 100,
    });
    for (const item of minutes) {
      const conferenceId = `minutes:${item.taskUuid}`;
      const endTimeMs =
        item.endTimeMs ??
        (item.startTimeMs && item.durationMs
          ? item.startTimeMs + item.durationMs
          : undefined);
      const storedMeeting = input.meetingStore.upsertMeeting({
        conferenceId,
        sourceKind: "ai_minutes",
        taskUuid: item.taskUuid,
        title: item.title,
        creatorUnionId: item.creatorUnionId,
        creatorNick: item.creatorNick,
        startTimeMs: item.startTimeMs,
        endTimeMs,
        status: item.status,
        flashStatus: item.status || "AI 听记可读取",
        rawJson: {
          source: "dws_minutes_backfill",
          detail: item.rawJson ?? {},
        },
      });
      const members = input.meetingStore
        .listMeetingMembers(storedMeeting.conferenceId)
        .map((member) => ({
        unionId: member.unionId,
        userId: member.userId,
        nickName: member.nickName,
        role: member.role,
        }));
      members.push({
        unionId: input.unionId,
        userId: input.managerUserId,
        nickName: undefined,
        role: "authorized_viewer",
      });
      if (item.creatorUnionId) {
        members.push({
          unionId: item.creatorUnionId,
          userId: undefined,
          nickName: item.creatorNick,
          role: "creator",
        });
      }
      input.meetingStore.replaceMeetingMembers(storedMeeting.conferenceId, members);
    }
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`AI 听记补查未完成：${message}`];
  }
}

export async function handleTaskIntakeMeetingsList(input: {
  managerUserId: string;
  days?: number;
  meetingStore?: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
  minutesClient?: DingTalkMinutesClient;
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
    const [calendarWarnings, minutesWarnings] = await Promise.all([
      syncRecentCalendarMeetingsForUnionId({
      unionId,
      days,
      meetingStore,
      meetingClient: input.meetingClient,
      nowMs,
      }),
      syncRecentMinutesForManager({
        managerUserId: input.managerUserId,
        unionId,
        days,
        meetingStore,
        minutesClient: input.minutesClient,
        nowMs,
      }),
    ]);
    const warnings = [...calendarWarnings, ...minutesWarnings];
    return {
      meetings: meetingStore
        .listMeetingsForUnionId({ unionId, sinceMs, limit: 50 })
        .filter((meeting) => meeting.transcriptCached || Boolean(meeting.taskUuid))
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

async function fetchUnifiedMeetingTranscript(input: {
  managerUserId: string;
  managerUnionId: string;
  meeting: DingTalkMeetingRow;
  meetingClient?: DingTalkMeetingRecordingClient;
  minutesClient?: DingTalkMinutesClient;
}): Promise<{ text: string; fetchedAt: string; source: "ai_minutes_dws" | "cloud_record" }> {
  let minutesError: unknown;
  if (input.meeting.taskUuid) {
    try {
      const transcript = await (
        input.minutesClient ?? createDingTalkMinutesClient()
      ).getTranscription({
        managerUserId: input.managerUserId,
        taskUuid: input.meeting.taskUuid,
      });
      return { ...transcript, source: "ai_minutes_dws" };
    } catch (error) {
      minutesError = error;
    }
  }

  let cloudError: unknown;
  if (input.meeting.videoConferenceId) {
    try {
      const transcript = await fetchMeetingTranscriptWithCandidates({
        client: input.meetingClient ?? createDingTalkMeetingRecordingClient(),
        conferenceId: input.meeting.videoConferenceId,
        unionIds: uniqueStrings([
          input.meeting.creatorUnionId,
          input.meeting.hostUnionId,
          input.managerUnionId,
        ]),
      });
      return { ...transcript, source: "cloud_record" };
    } catch (error) {
      cloudError = error;
    }
  }

  if (minutesError) throw minutesError;
  if (cloudError) throw cloudError;
  throw new DingTalkMinutesError("empty_transcript", "该会议没有可读取的 AI 听记");
}

export async function handleTaskIntakeMeetingPreview(input: {
  managerUserId: string;
  conferenceId: string;
  existingTasks?: ExistingTaskStub[];
  meetingStore?: DingTalkMeetingStore;
  meetingClient?: DingTalkMeetingRecordingClient;
  minutesClient?: DingTalkMinutesClient;
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
      try {
        const transcript = await fetchUnifiedMeetingTranscript({
          managerUserId: input.managerUserId,
          managerUnionId: unionId,
          meeting,
          meetingClient: input.meetingClient,
          minutesClient: input.minutesClient,
        });
        transcriptText = transcript.text;
        meetingStore.setMeetingTranscript({
          conferenceId,
          transcriptText,
          fetchedAt: transcript.fetchedAt,
          source: transcript.source,
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
        if (
          err instanceof DingTalkMinutesError &&
          (err.code === "auth_required" || err.code === "not_configured")
        ) {
          throw new TaskIntakeMeetingError(
            "minutes_auth_required",
            "当前主管尚未完成钉钉 AI 听记授权，请授权后重试",
            403,
          );
        }
        if (err instanceof DingTalkMinutesError && err.code === "empty_transcript") {
          throw new TaskIntakeMeetingError("meeting_transcript_empty", message, 404);
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
      sourceKind: "meeting_transcript",
      sourceTitle: meetingTitle,
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
  const peopleStore = createPeopleDirectoryStore();
  const notifier = createWorkbenchPublishNotifier();
  try {
    return await appendTaskIntake({
      taskStore: input.taskStore,
      managerUserId: input.managerUserId,
      targetPlanId: input.targetPlanId,
      rows: input.rows,
      actorName: input.actorName,
      notifier,
      getContact: (userId) => peopleStore.getContact(userId),
    });
  } finally {
    peopleStore.close();
  }
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
