import { existsSync, readFileSync } from "node:fs";

/**
 * Workbench manager whitelist.
 * Empty/missing config => deny all (safer default than initiator whitelist).
 */
export function isWorkbenchManager(userId: string): boolean {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return false;

  const file = process.env.WORKBENCH_MANAGER_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        const allow = new Set(arr.map((x) => String(x).trim()).filter(Boolean));
        return allow.has(normalizedUserId);
      }
    } catch {
      // fall through to env list
    }
  }

  const raw = process.env.WORKBENCH_MANAGER_USER_IDS?.trim();
  if (!raw) return false;
  const allow = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return allow.has(normalizedUserId);
}
