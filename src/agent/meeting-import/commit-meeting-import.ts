import { randomUUID } from "node:crypto";
import type { PlanSession } from "../../infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import {
  buildPreparePublishArgsFromSession,
  hashAssignmentForStaging,
  hashDraftForStaging,
  isStagingStale,
} from "../publish-helpers";
import {
  buildPublishTaskHandler,
  createRecentPublishStore,
} from "../tools/publish-task";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { MeetingImportCommitResult, MeetingImportCommitRow } from "./types";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

function buildSessionForParentGroup(input: {
  managerUserId: string;
  planId: string;
  parentTitle: string;
  parentDescription: string;
  projectId: string;
  projectName: string;
  rows: MeetingImportCommitRow[];
}): PlanSession {
  const stagedAt = new Date().toISOString();
  const tasks = input.rows.map((row, index) => {
    const id = `task_${index + 1}`;
    return {
      id,
      title: row.title,
      objective: row.objective,
      deliverables: row.deliverables,
      completionCriteria: row.completionCriteria,
      timeNode: row.dueAt ? { dueAt: row.dueAt } : {},
    };
  });
  const assignments = input.rows.map((row, index) => ({
    taskId: `task_${index + 1}`,
    primary: {
      userId: row.assigneeUserId,
      displayName: row.assigneeUserId,
    },
  }));

  const draft = {
    title: input.parentTitle,
    description: input.parentDescription,
    projectId: input.projectId,
    projectName: input.projectName,
    tasks,
    stagedBy: "prepare_publish_task",
    stagedAt,
    stagedDraftHash: "",
    stagedAssignmentHash: "",
  };
  const assignment = {
    assignments,
    stagedBy: "prepare_publish_task",
    stagedAt,
  };
  (draft as Record<string, unknown>).stagedDraftHash = hashDraftForStaging(draft);
  (draft as Record<string, unknown>).stagedAssignmentHash = hashAssignmentForStaging(assignment);

  return {
    planId: input.planId,
    chatKeyHash: `meeting-import:${input.planId}`,
    createdAt: stagedAt,
    updatedAt: stagedAt,
    senderStaffId: input.managerUserId,
    canonicalUserId: input.managerUserId,
    activeProjectId: input.projectId,
    latestDraft: draft,
    latestAssignment: assignment as PlanSession["latestAssignment"],
    conversationHistory: [],
    knownFacts: [],
  };
}

export async function commitMeetingImport(input: {
  taskStore: TaskStore;
  managerUserId: string;
  batchId: string;
  projectId: string;
  projectName: string;
  meetingTitle?: string;
  rows: MeetingImportCommitRow[];
  initiatorDepartment: string;
  actorName?: string;
  getContact: (userId: string) => { active?: boolean; unionId?: string; name?: string } | undefined;
  notifier: WorkbenchPublishNotifier;
}): Promise<MeetingImportCommitResult> {
  const result: MeetingImportCommitResult = {
    batchId: input.batchId,
    createdTasks: [],
    appendedSubtasks: [],
    skipped: [],
    errors: [],
  };

  const selected = input.rows.filter((r) => r.selected);
  for (const row of input.rows.filter((r) => !r.selected)) {
    result.skipped.push(row.itemId);
  }

  for (const row of selected) {
    if (!row.assigneeUserId?.trim()) {
      result.errors.push({ itemId: row.itemId, message: "缺少负责人" });
      continue;
    }
  }

  const validSelected = selected.filter((r) => r.assigneeUserId?.trim());
  const newGroups = new Map<string, MeetingImportCommitRow[]>();
  const appendRows: MeetingImportCommitRow[] = [];

  for (const row of validSelected) {
    if (row.parentKind === "existing" && row.planId) {
      appendRows.push(row);
      continue;
    }
    const theme = row.themeKey?.trim() || row.newParentTitle?.trim() || "meeting-default";
    const list = newGroups.get(theme) ?? [];
    list.push(row);
    newGroups.set(theme, list);
  }

  const recentPublished = createRecentPublishStore();

  for (const [themeKey, groupRows] of newGroups.entries()) {
    const planId = randomUUID();
    const parentTitle =
      groupRows[0]?.newParentTitle?.trim() ||
      input.meetingTitle?.trim() ||
      `会议待办-${themeKey}`;
    const session = buildSessionForParentGroup({
      managerUserId: input.managerUserId,
      planId,
      parentTitle,
      parentDescription: `来自会议入库批次 ${input.batchId}`,
      projectId: input.projectId,
      projectName: input.projectName,
      rows: groupRows,
    });

    if (!buildPreparePublishArgsFromSession(session) || isStagingStale(session)) {
      for (const row of groupRows) {
        result.errors.push({ itemId: row.itemId, message: "发布草案校验失败" });
      }
      continue;
    }

    try {
      const handler = buildPublishTaskHandler({
        trustedActorUserId: input.managerUserId,
        currentSessionPlanId: planId,
        currentSession: session,
        actorName: input.actorName,
        initiatorDepartment: input.initiatorDepartment,
        publishFromSession: (pub) =>
          input.taskStore.publishFromSession({ ...pub, projectId: input.projectId }),
        appendTaskEvent: (ev) => input.taskStore.appendTaskEvent(ev),
        getContact: input.getContact,
        notifier: input.notifier,
        recentPublished,
      });

      const pub = (await handler({
        planId,
        confirmationContext: "meeting-import-wizard",
      })) as { ok?: boolean; reason?: string; task?: { taskNo?: string; title?: string } };
      if (!pub.ok) {
        for (const row of groupRows) {
          result.errors.push({
            itemId: row.itemId,
            message: String((pub as { reason?: string }).reason ?? "publish_failed"),
          });
        }
        continue;
      }

      const task = pub.task;
      const taskNo = String(task?.taskNo ?? "");
      const published = input.taskStore
        .listManagerTasks(input.managerUserId)
        .find((t: { planId: string }) => t.planId === planId);
      if (published) {
        input.taskStore.setTaskSourceMeetingBatch({
          taskId: published.taskId,
          managerUserId: input.managerUserId,
          sourceMeetingBatchId: input.batchId,
        });
        const detail = input.taskStore.getTaskDetail(planId);
        if (detail) {
          for (const row of groupRows) {
            const sub = detail.subtasks.find((s: { title: string }) => s.title === row.title);
            if (sub) {
              input.taskStore.setSubtaskMeetingSource({
                subtaskId: sub.subtaskId,
                managerUserId: input.managerUserId,
                sourceMeetingBatchId: input.batchId,
                sourceExcerpt: row.excerpt,
              });
            }
          }
        }
      }

      result.createdTasks.push({
        taskNo,
        title: String(task?.title ?? parentTitle),
        planId,
        subtaskCount: groupRows.length,
      });
    } catch (err) {
      for (const row of groupRows) {
        result.errors.push({
          itemId: row.itemId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const row of appendRows) {
    const planId = String(row.planId ?? "").trim();
    if (!planId) {
      result.errors.push({ itemId: row.itemId, message: "缺少 planId" });
      continue;
    }
    try {
      const appended = input.taskStore.appendSubtaskFromMeetingImport({
        planId,
        managerUserId: input.managerUserId,
        title: row.title,
        assigneeUserId: row.assigneeUserId,
        objective: row.objective,
        deliverables: row.deliverables,
        completionCriteria: row.completionCriteria,
        dueAt: row.dueAt,
        clientRequestId: `mib:${input.batchId}:${row.itemId}`.slice(0, 128),
        sourceMeetingBatchId: input.batchId,
        sourceExcerpt: row.excerpt,
        note: "meeting import append",
        actorName: input.actorName,
      });
      if (!appended.duplicated) {
        void input.notifier.notifyPublishedTask({
          taskNo: appended.task.taskNo,
          title: appended.task.title,
          managerUserId: input.managerUserId,
          managerDisplayName: input.actorName,
          taskDescription: appended.task.description,
          assignees: [
            {
              userId: row.assigneeUserId,
              displayName: input.getContact(row.assigneeUserId)?.name,
              subtasks: [{ title: appended.subtask.title }],
            },
          ],
        }).catch(() => undefined);
      }
      result.appendedSubtasks.push({
        taskNo: appended.task.taskNo,
        subtaskTitle: appended.subtask.title,
        subtaskId: appended.subtask.subtaskId,
      });
    } catch (err) {
      result.errors.push({
        itemId: row.itemId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.createdTasks.length > 0 || result.appendedSubtasks.length > 0) {
    const anchorPlanId =
      result.createdTasks[0]?.planId ??
      appendRows[0]?.planId ??
      "";
    if (anchorPlanId) {
      input.taskStore.appendTaskEvent({
        taskId: `task:${anchorPlanId}`,
        eventType: "MEETING_IMPORT_COMMITTED",
        actorUserId: input.managerUserId,
        note: input.meetingTitle ?? "meeting import",
        payload: {
          batchId: input.batchId,
          created: result.createdTasks.length,
          appended: result.appendedSubtasks.length,
          skipped: result.skipped.length,
          errors: result.errors.length,
        },
      });
    }
  }

  input.taskStore.updateMeetingImportBatchStatus({
    batchId: input.batchId,
    managerUserId: input.managerUserId,
    status: result.errors.length > 0 && result.createdTasks.length === 0 && result.appendedSubtasks.length === 0
      ? "failed"
      : "committed",
  });

  return result;
}
