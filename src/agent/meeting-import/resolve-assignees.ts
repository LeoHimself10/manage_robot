import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import type { MeetingImportActionItem } from "./types";

export interface ResolvedAssignee {
  assigneeUserId?: string;
  assigneeDisplayName?: string;
  needsConfirm: boolean;
}

export function resolveAssigneeByName(name: string, peopleStore: { searchContacts(keyword: string, limit?: number): Array<{ userId: string; name: string; active?: boolean }> }): ResolvedAssignee {
  const keyword = name.trim();
  if (!keyword) return { needsConfirm: true };
  const hits = peopleStore.searchContacts(keyword, 8).filter((c) => c.active !== false);
  const exact = hits.find((c) => c.name.trim() === keyword);
  const pick = exact ?? hits[0];
  if (!pick) return { needsConfirm: true };
  return {
    assigneeUserId: pick.userId,
    assigneeDisplayName: pick.name,
    needsConfirm: !exact,
  };
}

export function resolveAssigneesForItems(items: MeetingImportActionItem[]): ResolvedAssignee[] {
  const peopleStore = createPeopleDirectoryStore();
  try {
    return items.map((item) => {
      if (!item.assigneeName?.trim()) return { needsConfirm: true };
      return resolveAssigneeByName(item.assigneeName, peopleStore);
    });
  } finally {
    peopleStore.close();
  }
}
