import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { resolveEmployeeProfileDir } from "../infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../integrations/dingtalk/workbench-notify";
import { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import {
  analyzeMeetingImport,
  buildProjectSuggestionForParse,
} from "../agent/meeting-import/analyze-meeting-import";
import { commitMeetingImport } from "../agent/meeting-import/commit-meeting-import";
import { parseMeetingDocumentToItems } from "../agent/meeting-import/parse-input";
import type {
  MeetingImportCommitRow,
  MeetingImportPreviewRow,
} from "../agent/meeting-import/types";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export function normalizeCommitRowsFromPreview(
  rows: MeetingImportPreviewRow[],
): MeetingImportCommitRow[] {
  return rows.map((row) => ({
    itemId: row.itemId,
    selected: row.selected,
    title: row.title,
    excerpt: row.excerpt,
    projectId: row.projectId,
    parentKind: row.parent.kind,
    planId: row.parent.planId,
    taskNo: row.parent.taskNo,
    newParentTitle: row.parent.suggestedTitle,
    themeKey: row.parent.themeKey,
    assigneeUserId: row.assigneeUserId ?? "",
    dueAt: row.dueAt,
    objective: row.objective,
    deliverables: row.deliverables,
    completionCriteria: row.completionCriteria,
    manuallyEdited: row.manuallyEdited,
  }));
}

export async function handleMeetingImportParse(input: {
  taskStore: TaskStore;
  managerUserId: string;
  pastedText?: string;
  docUrl?: string;
  meetingTitle?: string;
  meetingDate?: string;
}): Promise<{
  items: Awaited<ReturnType<typeof parseMeetingDocumentToItems>>["items"];
  warnings: string[];
  sourceTextHash: string;
  projectSuggestion: ReturnType<typeof buildProjectSuggestionForParse>;
  batchId: string;
}> {
  const parsed = await parseMeetingDocumentToItems({
    pastedText: input.pastedText,
    docUrl: input.docUrl,
    meetingTitle: input.meetingTitle,
    meetingDate: input.meetingDate,
  });
  const batch = input.taskStore.createMeetingImportBatch({
    managerUserId: input.managerUserId,
    meetingTitle: input.meetingTitle,
    meetingDate: input.meetingDate,
    docUrl: input.docUrl,
    sourceTextHash: parsed.sourceTextHash,
    status: "analyzed",
  });
  const projectSuggestion = buildProjectSuggestionForParse({
    taskStore: input.taskStore,
    managerUserId: input.managerUserId,
    summaryText: parsed.text,
    meetingTitle: input.meetingTitle,
  });
  return {
    items: parsed.items,
    warnings: parsed.warnings,
    sourceTextHash: parsed.sourceTextHash,
    projectSuggestion,
    batchId: batch.batchId,
  };
}

export async function handleMeetingImportAnalyze(input: {
  taskStore: TaskStore;
  managerUserId: string;
  batchId: string;
  projectId: string;
  projectName: string;
  items: Parameters<typeof analyzeMeetingImport>[0]["items"];
  meetingTitle?: string;
}): Promise<{ rows: MeetingImportPreviewRow[] }> {
  const batch = input.taskStore.getMeetingImportBatch(input.batchId, input.managerUserId);
  if (!batch) throw new Error("batch_not_found");
  const rows = await analyzeMeetingImport({
    taskStore: input.taskStore,
    managerUserId: input.managerUserId,
    projectId: input.projectId,
    projectName: input.projectName,
    items: input.items,
    meetingTitle: input.meetingTitle ?? batch.meetingTitle,
  });
  return { rows };
}

export async function handleMeetingImportCommit(input: {
  taskStore: TaskStore;
  managerUserId: string;
  batchId: string;
  projectId: string;
  projectName: string;
  meetingTitle?: string;
  rows: MeetingImportCommitRow[];
  actorName?: string;
}): Promise<Awaited<ReturnType<typeof commitMeetingImport>>> {
  const batch = input.taskStore.getMeetingImportBatch(input.batchId, input.managerUserId);
  if (!batch) throw new Error("batch_not_found");
  const peopleStore = createPeopleDirectoryStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();
  try {
    const initiatorDepartment =
      employeeRepo.get(input.managerUserId)?.department?.trim() ||
      peopleStore.getContact(input.managerUserId)?.departmentNames?.[0]?.trim() ||
      "未配置部门";
    return await commitMeetingImport({
      taskStore: input.taskStore,
      managerUserId: input.managerUserId,
      batchId: input.batchId,
      projectId: input.projectId,
      projectName: input.projectName,
      meetingTitle: input.meetingTitle ?? batch.meetingTitle,
      rows: input.rows,
      initiatorDepartment,
      actorName: input.actorName,
      getContact: (uid) => peopleStore.getContact(uid),
      notifier,
    });
  } finally {
    peopleStore.close();
  }
}
