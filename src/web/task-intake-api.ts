import { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { resolveEmployeeProfileDir } from "../infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../integrations/dingtalk/workbench-notify";
import { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import { structureTasksFromText } from "../agent/task-intake/structure-input";
import { buildPreviewRows } from "../agent/task-intake/resolve-assignees";
import { appendTaskIntake, commitTaskIntake } from "../agent/task-intake/commit-task-intake";
import type {
  TaskIntakeAppendResult,
  TaskIntakeCommitResult,
  TaskIntakeCommitRow,
  TaskIntakePreviewRow,
} from "../agent/task-intake/types";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export async function handleTaskIntakePreview(input: {
  pastedText?: string;
  parentTitle?: string;
}): Promise<{
  parentTitle: string;
  parentDescription: string;
  rows: TaskIntakePreviewRow[];
  warnings: string[];
  usedFallback: boolean;
}> {
  const result = await structureTasksFromText({
    pastedText: String(input.pastedText ?? ""),
    parentTitleHint: String(input.parentTitle ?? ""),
  });
  const rows = buildPreviewRows(result.structured);
  return {
    parentTitle: result.structured.parentTitle,
    parentDescription: result.structured.parentDescription,
    rows,
    warnings: result.warnings,
    usedFallback: result.usedFallback,
  };
}

export async function handleTaskIntakeAppend(input: {
  taskStore: TaskStore;
  managerUserId: string;
  targetPlanId: string;
  rows: TaskIntakeCommitRow[];
  actorName?: string;
}): Promise<TaskIntakeAppendResult> {
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
