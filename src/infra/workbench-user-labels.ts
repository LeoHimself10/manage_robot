import { createPeopleDirectoryStore } from "./people-directory-store";

type PeopleDirectoryStore = ReturnType<typeof createPeopleDirectoryStore>;

export function resolveWorkbenchUserDisplayName(
  userId: string,
  store?: PeopleDirectoryStore,
): string {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return "";
  const people = store ?? createPeopleDirectoryStore();
  return people.getContact(normalized)?.name?.trim() || normalized;
}

export function resolveWorkbenchUserDisplayNames(
  userIds: Iterable<string>,
  store?: PeopleDirectoryStore,
): Map<string, string> {
  const people = store ?? createPeopleDirectoryStore();
  const out = new Map<string, string>();
  for (const raw of userIds) {
    const userId = String(raw ?? "").trim();
    if (!userId || out.has(userId)) continue;
    out.set(userId, resolveWorkbenchUserDisplayName(userId, people));
  }
  return out;
}
