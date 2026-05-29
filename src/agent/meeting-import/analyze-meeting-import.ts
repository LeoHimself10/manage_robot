import type {
  MeetingImportActionItem,
  MeetingImportParentSuggestion,
  MeetingImportPreviewRow,
  MeetingImportProjectSuggestion,
} from "./types";
import { suggestProjectForMeetingText } from "./suggest-project";
import { defaultSelectedForRelation, rulePrefilterRelation } from "./relation-rules";
import { resolveAssigneesForItems } from "./resolve-assignees";
import { enrichSubtaskFieldsForItems } from "./enrich-subtask-fields";
import { groupParentTasksForItems } from "./group-parent-tasks";

type TaskStore = ReturnType<typeof import("../../infra/workbench-formal-task-store").createWorkbenchFormalTaskStore>;

export async function analyzeMeetingImport(input: {
  taskStore: TaskStore;
  managerUserId: string;
  projectId: string;
  projectName: string;
  items: MeetingImportActionItem[];
  meetingTitle?: string;
}): Promise<MeetingImportPreviewRow[]> {
  const tasks = input.taskStore.listManagerTasks(input.managerUserId, {
    projectId: input.projectId,
  });
  const openSubtasks = input.taskStore.listOpenSubtasksForManagerProject({
    managerUserId: input.managerUserId,
    projectId: input.projectId,
  });

  const subtaskIndex = openSubtasks.map((st) => ({
    taskNo: st.taskNo,
    taskTitle: st.taskTitle,
    subtaskId: st.subtaskId,
    title: st.title,
    planId: st.planId,
  }));

  const relationByItem = input.items.map((item) =>
    rulePrefilterRelation({
      itemTitle: item.title,
      itemExcerpt: item.excerpt,
      subtasks: subtaskIndex,
    }),
  );

  const parentSuggestions = await groupParentTasksForItems({
    items: input.items,
    tasks: tasks.map((t) => ({ taskNo: t.taskNo, planId: t.planId, title: t.title })),
    meetingTitle: input.meetingTitle,
  });

  const enriched = enrichSubtaskFieldsForItems(input.items);
  const assignees = resolveAssigneesForItems(input.items);

  return input.items.map((item, index) => {
    const rel = relationByItem[index] ?? { relationKind: "none" as const, reason: "" };
    const parent = parentSuggestions[index] ?? {
      kind: "new" as const,
      suggestedTitle: input.meetingTitle ? `${input.meetingTitle}跟进` : "会议待办跟进",
      themeKey: "default",
    };
    const fields = enriched[index];
    const assignee = assignees[index];
    return {
      itemId: item.id,
      selected: defaultSelectedForRelation(rel.relationKind),
      title: item.title,
      excerpt: item.excerpt,
      relationKind: rel.relationKind,
      relationReason: rel.reason,
      existingTaskNo: rel.existingTaskNo,
      existingSubtaskId: rel.existingSubtaskId,
      existingSubtaskTitle: rel.existingSubtaskTitle,
      projectId: input.projectId,
      projectName: input.projectName,
      parent,
      assigneeUserId: assignee.assigneeUserId,
      assigneeDisplayName: assignee.assigneeDisplayName,
      assigneeNameRaw: item.assigneeName,
      dueAt: item.dueAt,
      objective: fields.objective,
      deliverables: fields.deliverables,
      completionCriteria: fields.completionCriteria,
      aiReason: parent.reason,
    };
  });
}

export function buildProjectSuggestionForParse(input: {
  taskStore: TaskStore;
  managerUserId: string;
  summaryText: string;
  meetingTitle?: string;
}): MeetingImportProjectSuggestion {
  const projects = input.taskStore.listProjectsForOwner(input.managerUserId);
  return suggestProjectForMeetingText({
    projects,
    summaryText: input.summaryText,
    meetingTitle: input.meetingTitle,
  });
}

export type { MeetingImportProjectSuggestion, MeetingImportPreviewRow, MeetingImportParentSuggestion };
