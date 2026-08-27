import { existsSync, readFileSync } from "node:fs";
import { listWorkbenchManagerIds } from "./workbench-manager-whitelist";
import { getAdminTestActor } from "../testing/admin-test-actors";

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

/** True when user is on manager whitelist (independent of primaryRole). */
export function isAlsoWorkbenchManager(userId: string): boolean {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return false;
  if (getAdminTestActor(normalized)?.workbenchRole === "manager") return true;
  return listWorkbenchManagerIds().has(normalized);
}

/** DingTalk outbound footer: admin-only users; dual admin+manager use workbench nav instead. */
export function shouldAppendAdminOpsLinkToDingtalkOutbound(userId: string): boolean {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return false;
  if (!isWorkbenchAdmin(normalized)) return false;
  if (isAlsoWorkbenchManager(normalized)) return false;
  return true;
}

export function resolveWorkbenchRole(userId: string): WorkbenchRole {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return "employee";
  if (isWorkbenchAdmin(normalized)) return "admin";
  const testActor = getAdminTestActor(normalized);
  if (testActor) return testActor.workbenchRole;
  if (listWorkbenchManagerIds().has(normalized)) return "manager";
  return "employee";
}
