import { createPeopleDirectoryStore } from "../../infra/people-directory-store";

const BOT_NAME_RE = /机器人|T-/;

export function isBotLikeContactName(name: string): boolean {
  return BOT_NAME_RE.test(name.trim());
}

export function listOrgScanContacts(deps?: {
  peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
}): Array<{ userid: string; name: string }> {
  const store = deps?.peopleStore ?? createPeopleDirectoryStore();
  try {
    return store
      .listContacts()
      .filter((c) => c.active && !isBotLikeContactName(c.name))
      .map((c) => ({ userid: c.userId, name: c.name.trim() || c.userId }));
  } finally {
    if (!deps?.peopleStore) store.close();
  }
}
