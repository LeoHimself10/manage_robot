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
  type DingTalkMeetingRecordingClient,
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

export async function handleTaskIntakeMeetingsList(input: {
  managerUserId: string;
  days?: number;
  meetingStore?: DingTalkMeetingStore;
}): Promise<{ meetings: ReturnType<typeof presentMeeting>[] }> {
  if (!isTaskIntakeDingTalkMeetingsEnabled()) {
    throw new TaskIntakeMeetingError("meetings_disabled", "DingTalk meetings import is disabled", 404);
  }
  const unionId = resolveManagerUnionId(input.managerUserId);
  const days = normalizeDays(input.days);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const ownStore = input.meetingStore ? undefined : createDingTalkMeetingStore();
  const meetingStore = input.meetingStore ?? ownStore!;
  try {
    return {
      meetings: meetingStore
        .listMeetingsForUnionId({ unionId, sinceMs, limit: 50 })
        .map(presentMeeting),
    };
  } finally {
    ownStore?.close();
  }
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
        const transcript = await client.getCloudRecordTranscript({ conferenceId, unionId });
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
    const pastedText = [`[meeting] ${meetingTitle}`, transcriptText].join("\n");
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
