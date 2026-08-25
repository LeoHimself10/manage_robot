import {
  isAlsoWorkbenchManager,
  resolveWorkbenchRole,
  type WorkbenchRole,
} from "./workbench-role-resolver";

export interface WorkbenchCapabilities {
  primaryRole: WorkbenchRole;
  alsoManager: boolean;
  canAccessAdmin: boolean;
  canManage: boolean;
  canExecuteAsManager: boolean;
}

export interface WorkbenchSessionView {
  userId: string;
  role: WorkbenchRole;
  primaryRole?: WorkbenchRole;
}

export function resolveWorkbenchCapabilities(userId: string): WorkbenchCapabilities {
  const primaryRole = resolveWorkbenchRole(userId);
  const alsoManager = primaryRole !== "manager" && isAlsoWorkbenchManager(userId);
  // Base roles are mutually exclusive in the workbench. An administrator may
  // still appear in a legacy manager allowlist, but that does not grant a
  // writable manager session; administrators use the read-only perspectives.
  const canManage = primaryRole === "manager";
  return {
    primaryRole,
    alsoManager,
    canAccessAdmin: primaryRole === "admin",
    canManage,
    canExecuteAsManager: canManage,
  };
}

export function canAccessEmployeeWorkbench(
  caps: WorkbenchCapabilities,
  viewRole: WorkbenchRole,
): boolean {
  return caps.primaryRole === "employee" && viewRole === "employee";
}

export function canAccessManagerWorkbench(
  caps: WorkbenchCapabilities,
  viewRole: WorkbenchRole,
): boolean {
  return caps.canManage && viewRole === "manager";
}

export function sessionPrimaryRole(session: WorkbenchSessionView): WorkbenchRole {
  return session.primaryRole ?? resolveWorkbenchCapabilities(session.userId).primaryRole;
}

export function normalizeWorkbenchSession<T extends WorkbenchSessionView>(
  session: T,
): T & { primaryRole: WorkbenchRole } {
  const caps = resolveWorkbenchCapabilities(session.userId);
  return { ...session, primaryRole: caps.primaryRole, role: caps.primaryRole };
}

export function refreshSessionFromWhitelist<T extends WorkbenchSessionView>(
  session: T,
): { session: T; changed: boolean } {
  const caps = resolveWorkbenchCapabilities(session.userId);
  const next = { ...session, primaryRole: caps.primaryRole, role: caps.primaryRole };
  const changed =
    session.primaryRole !== next.primaryRole
    || session.role !== next.role
    || session.primaryRole === undefined;
  return { session: next, changed };
}

export function allowsEmployeeSession(session: WorkbenchSessionView): boolean {
  const caps = resolveWorkbenchCapabilities(session.userId);
  const normalized = normalizeWorkbenchSession(session);
  return canAccessEmployeeWorkbench(caps, normalized.role);
}

export function allowsManagerSession(session: WorkbenchSessionView): boolean {
  const caps = resolveWorkbenchCapabilities(session.userId);
  const normalized = normalizeWorkbenchSession(session);
  return canAccessManagerWorkbench(caps, normalized.role);
}

export function defaultRedirectForView(viewRole: WorkbenchRole): string {
  if (viewRole === "admin") return "/workbench/admin/ops";
  if (viewRole === "manager") return "/workbench/manager/tasks";
  return "/workbench/employee?view=new";
}

/** DingTalk / test login landing: administrators always enter the operations view. */
export function defaultLoginViewRole(userId: string): WorkbenchRole {
  const caps = resolveWorkbenchCapabilities(userId);
  return caps.primaryRole;
}
