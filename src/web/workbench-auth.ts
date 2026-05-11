import { verifyAssignmentEntry } from "../security/web-entry-token";
import type { WorkbenchRole } from "./workbench-types";

export interface WorkbenchIdentity {
  planId: string;
  userId: string;
  role: WorkbenchRole;
}

export function resolveWorkbenchIdentityFromToken(
  token: string,
): WorkbenchIdentity {
  const verified = verifyAssignmentEntry(token);
  return {
    planId: verified.planId,
    userId: verified.userId,
    role: verified.role,
  };
}

export function ensureWorkbenchAccess(role: WorkbenchRole, path: string): void {
  if (role === "employee" && path.startsWith("/workbench/manager")) {
    throw new Error("Forbidden: employee cannot access manager workbench");
  }
}
