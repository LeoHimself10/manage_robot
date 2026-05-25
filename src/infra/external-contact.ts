import type { DingTalkContactRow } from "./people-directory-store";

export const EXTERNAL_CONTACT_USER_ID_PREFIX = "ext_";
export const EXTERNAL_CONTACT_SOURCE = "external_manual";

export function isExternalContact(
  userId: string,
  contact?: Pick<DingTalkContactRow, "userId" | "rawJson"> | null,
): boolean {
  const normalized = String(userId ?? "").trim();
  if (normalized.startsWith(EXTERNAL_CONTACT_USER_ID_PREFIX)) return true;
  const row = contact ?? undefined;
  if (!row) return false;
  const source = String(row.rawJson?.source ?? "").trim();
  return source === EXTERNAL_CONTACT_SOURCE;
}
