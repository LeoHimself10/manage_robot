import { randomUUID } from "node:crypto";
import type { PlanSession } from "../../infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { splitListCell } from "../../web/draft-excel-grid";
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
import type { TaskIntakeCommitResult, TaskIntakeCommitRow } from "./types";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

const STAGED_DEEP_LINK = "/workbench/manager/chat?thread=main&openDraftEditor=1";

export interface BuildTaskIntakeDraftResult {
  planId: string;
  draft: Record<string, unknown>;
  assignment: Record<string, unknown>;
}

/** Build a publish-ready session draft (one parent + N subtasks) from intake rows. */
export function buildTaskIntakeSession(input: {
  managerUserId: string;
  planId: string;
  parentTitle: string;
  parentDescription: string;
  projectId?: string;
  projectName?: string;
  rows: TaskIntakeCommitRow[];
}): PlanSession {
  const stagedAt = new Date().toISOString();
  // Mirror the agent publish shape: list fields are arrays, written to the
  // subtask rich columns (deliverables/completionCriteria/actions/dependsOn).
  const tasks = input.rows.map((row, index) => ({
    id: `task_${index + 1}`,
    title: row.title,
    objective: row.objective,
    deliverables: splitListCell(row.deliverables),
    completionCriteria: splitListCell(row.completionCriteria),
    actions: splitListCell(row.actions),
    dependencyTaskIds: splitListCell(row.dependsOn),
    timeNode: row.dueAt ? { dueAt: row.dueAt } : {},
  }));
  const assignments = input.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => Boolean(row.assigneeUserId?.trim()))
    .map(({ row, index }) => ({
      taskId: `task_${index + 1}`,
      primary: { userId: row.assigneeUserId, displayName: row.assigneeUserId },
    }));

  const draft: Record<string, unknown> = {
    title: input.parentTitle,
    description: input.parentDescription,
    tasks,
    stagedBy: "prepare_publish_task",
    stagedAt,
    stagedDraftHash: "",
    stagedAssignmentHash: "",
  };
  if (input.projectId) {
    draft.projectId = input.projectId;
    draft.projectName = input.projectName ?? "";
  }
  const assignment = { assignments, stagedBy: "prepare_publish_task", stagedAt };
  draft.stagedDraftHash = hashDraftForStaging(draft);
  draft.stagedAssignmentHash = hashAssignmentForStaging(assignment);

  return {
    planId: input.planId,
    chatKeyHash: `task-intake:${input.planId}`,
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

export async function commitTaskIntake(input: {
  taskStore: TaskStore;
  managerUserId: string;
  parentTitle: string;
  parentDescription: string;
  projectId?: string;
  projectName?: string;
  rows: TaskIntakeCommitRow[];
  initiatorDepartment: string;
  actorName?: string;
  getContact: (userId: string) => { active?: boolean; unionId?: string; name?: string } | undefined;
  notifier: WorkbenchPublishNotifier;
  /** Persist the draft into the manager's main thread session (web layer wiring). */
  stageDraft: (input: { draft: Record<string, unknown>; assignment: Record<string, unknown> }) => void;
}): Promise<TaskIntakeCommitResult> {
  const selected = input.rows.filter((r) => r.selected);
  const errors: TaskIntakeCommitResult["errors"] = [];

  if (selected.length === 0) {
    return { mode: "empty", subtaskCount: 0, errors };
  }

  // Required fields aligned with the agent publish gate (prepare_publish_task):
  // parent title + description, and every subtask title.
  const parentTitle = input.parentTitle.trim();
  const parentDescription = input.parentDescription.trim();
  const validationErrors: TaskIntakeCommitResult["errors"] = [];
  if (!parentTitle) {
    validationErrors.push({ itemId: "parentTitle", message: "请填写父任务标题（必填）" });
  }
  if (!parentDescription) {
    validationErrors.push({ itemId: "parentDescription", message: "请填写父任务描述/背景（必填）" });
  }
  for (const row of selected) {
    const label = row.title || row.itemId;
    if (!row.title.trim()) {
      validationErrors.push({ itemId: row.itemId, message: "子任务标题不能为空（必填）" });
    }
    if (!(row.objective ?? "").trim()) {
      validationErrors.push({ itemId: row.itemId, message: `「${label}」目标不能为空（必填）` });
    }
    if (!row.deliverables.trim()) {
      validationErrors.push({ itemId: row.itemId, message: `「${label}」交付物不能为空（必填）` });
    }
    if (!row.completionCriteria.trim()) {
      validationErrors.push({ itemId: row.itemId, message: `「${label}」完成标准不能为空（必填）` });
    }
    if (!(row.dueAt ?? "").trim()) {
      validationErrors.push({ itemId: row.itemId, message: `「${label}」截止日期不能为空（必填）` });
    }
  }
  if (validationErrors.length > 0) {
    return { mode: "invalid", subtaskCount: selected.length, errors: validationErrors };
  }

  const fullCoverage = selected.every((r) => Boolean(r.assigneeUserId?.trim()));
  const planId = randomUUID();
  const session = buildTaskIntakeSession({
    managerUserId: input.managerUserId,
    planId,
    parentTitle,
    parentDescription,
    projectId: input.projectId,
    projectName: input.projectName,
    rows: selected,
  });

  // Some subtasks lack an assignee → stage the whole draft for the manager to
  // finish 点将 in the Excel editor, instead of publishing a partial task.
  if (!fullCoverage) {
    input.stageDraft({
      draft: session.latestDraft as Record<string, unknown>,
      assignment: session.latestAssignment as Record<string, unknown>,
    });
    return {
      mode: "staged",
      subtaskCount: selected.length,
      stagedDeepLink: STAGED_DEEP_LINK,
      errors,
    };
  }

  if (!buildPreparePublishArgsFromSession(session) || isStagingStale(session)) {
    return {
      mode: "staged",
      subtaskCount: selected.length,
      stagedDeepLink: STAGED_DEEP_LINK,
      errors: [{ itemId: "*", message: "发布草案校验失败，已转为暂存草案" }],
    };
  }

  const recentPublished = createRecentPublishStore();
  const handler = buildPublishTaskHandler({
    trustedActorUserId: input.managerUserId,
    currentSessionPlanId: planId,
    currentSession: session,
    actorName: input.actorName,
    initiatorDepartment: input.initiatorDepartment,
    publishFromSession: (pub) =>
      input.taskStore.publishFromSession({
        ...pub,
        projectId: input.projectId ?? null,
      }),
    appendTaskEvent: (ev) => input.taskStore.appendTaskEvent(ev),
    getContact: input.getContact,
    notifier: input.notifier,
    recentPublished,
  });

  const pub = (await handler({
    planId,
    confirmationContext: "task-intake-wizard",
  })) as { ok?: boolean; reason?: string; task?: { taskNo?: string; title?: string } };

  if (!pub.ok) {
    return {
      mode: "staged",
      subtaskCount: selected.length,
      stagedDeepLink: STAGED_DEEP_LINK,
      errors: [{ itemId: "*", message: String(pub.reason ?? "publish_failed") }],
    };
  }

  return {
    mode: "published",
    subtaskCount: selected.length,
    task: {
      taskNo: String(pub.task?.taskNo ?? ""),
      title: String(pub.task?.title ?? parentTitle),
      planId,
    },
    errors,
  };
}
