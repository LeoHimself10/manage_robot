import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveAssigneeByName } from "../meeting-import/resolve-assignees";
import type { TaskIntakePreviewRow, TaskIntakeStructured } from "./types";

/**
 * Map a faithfully-structured task into preview rows, resolving assignee names
 * to userIds via the people directory. Name matching is reused from
 * meeting-import (generic, not meeting-specific).
 */
export function buildPreviewRows(structured: TaskIntakeStructured): TaskIntakePreviewRow[] {
  const peopleStore = createPeopleDirectoryStore();
  try {
    return structured.subtasks.map((sub, index) => {
      const nameRaw = sub.assigneeName?.trim() ?? "";
      const resolved = nameRaw
        ? resolveAssigneeByName(nameRaw, peopleStore)
        : { needsConfirm: true as const };
      return {
        itemId: `ti_${index + 1}`,
        selected: true,
        title: sub.title,
        objective: sub.objective ?? "",
        deliverables: sub.deliverables ?? "",
        completionCriteria: sub.completionCriteria ?? "",
        actions: sub.actions ?? "",
        dependsOn: sub.dependsOn ?? "",
        dueAt: sub.dueAt,
        assigneeUserId: resolved.assigneeUserId,
        assigneeDisplayName: resolved.assigneeDisplayName,
        assigneeNameRaw: nameRaw || undefined,
        needsConfirm: !resolved.assigneeUserId,
      };
    });
  } finally {
    peopleStore.close();
  }
}
