import { existsSync, readFileSync } from "node:fs";
import { resolveWorkbenchDynamicManagersPath } from "./workbench-manager-dynamic-path";

/**
 * Workbench manager whitelist.
 * Empty/missing config => deny all (safer default than initiator whitelist).
 */
export function isWorkbenchManager(userId: string): boolean {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return false;
  return listWorkbenchManagerIds().has(normalizedUserId);
}

export function listWorkbenchManagerIds(): Set<string> {
  const allow = new Set<string>();
  const file = process.env.WORKBENCH_MANAGER_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        arr.map((x) => String(x).trim()).filter(Boolean).forEach((id) => allow.add(id));
      }
    } catch {
      // keep reading other sources
    }
  }

  const raw = process.env.WORKBENCH_MANAGER_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => allow.add(id));
  }

  const dynamicFile = resolveWorkbenchDynamicManagersPath();
  if (existsSync(dynamicFile)) {
    try {
      const arr = JSON.parse(readFileSync(dynamicFile, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        arr.map((x) => String(x).trim()).filter(Boolean).forEach((id) => allow.add(id));
      }
    } catch {
      // ignore malformed dynamic list
    }
  }
  return allow;
}
