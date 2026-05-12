import { existsSync, readFileSync } from "node:fs";
import { listWorkbenchManagerIds } from "./workbench-manager-whitelist";

export type WorkbenchRole = "admin" | "manager" | "employee";

function listWorkbenchAdminIds(): Set<string> {
  const allow = new Set<string>();
  const file = process.env.WORKBENCH_ADMIN_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        arr.map((x) => String(x).trim()).filter(Boolean).forEach((id) => allow.add(id));
      }
    } catch {
      // ignore malformed files; fallback to env list
    }
  }
  const raw = process.env.WORKBENCH_ADMIN_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => allow.add(id));
  }
  return allow;
}

export function isWorkbenchAdmin(userId: string): boolean {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return false;
  return listWorkbenchAdminIds().has(normalized);
}

export function resolveWorkbenchRole(userId: string): WorkbenchRole {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return "employee";
  if (isWorkbenchAdmin(normalized)) return "admin";
  if (listWorkbenchManagerIds().has(normalized)) return "manager";
  return "employee";
}
