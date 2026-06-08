import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveAssigneeByName } from "../meeting-import/resolve-assignees";
import type { TargetSuggestion } from "./suggest-targets";
import type { TaskIntakePreviewRow, TaskIntakeStructured } from "./types";

/**
 * Map a faithfully-structured task into preview rows, resolving assignee names
 * to userIds via the people directory. Name matching is reused from
 * meeting-import (generic, not meeting-specific).
 *
 * If `suggestions` are provided (from suggestTaskTargets), they are merged into
 * the rows so the UI can pre-populate the target grouping.
 */
export function buildPreviewRows(
  structured: TaskIntakeStructured,
  suggestions?: TargetSuggestion[],
): TaskIntakePreviewRow[] {
  const peopleStore = createPeopleDirectoryStore();
  const suggestionByItemId = new Map(
    (suggestions ?? []).map((s) => [s.itemId, s]),
  );
  try {
    return structured.subtasks.map((sub, index) => {
      const itemId = `ti_${index + 1}`;
      const nameRaw = sub.assigneeName?.trim() ?? "";
      const resolved = nameRaw
        ? resolveAssigneeByName(nameRaw, peopleStore)
        : { needsConfirm: true as const };
      const sug = suggestionByItemId.get(itemId);
      return {
        itemId,
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
        suggestedTargetPlanId: sug?.targetPlanId,
        suggestedTargetTitle: sug?.targetTitle,
        suggestedTargetNo: sug?.targetNo,
        suggestedNewGroupId: sug?.newGroupId,
        suggestedNewGroupTitle: sug?.newGroupTitle,
        suggestedNewGroupDescription: sug?.newGroupDescription,
        suggestedConfidence: sug?.confidence,
        suggestedReason: sug?.reason,
      };
    });
  } finally {
    peopleStore.close();
  }
}
