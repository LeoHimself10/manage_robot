import { resolveWorkbenchRole, type WorkbenchRole } from "./workbench-role-resolver";

export interface WorkbenchCapabilities {
  primaryRole: WorkbenchRole;
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
  return {
    primaryRole,
    canManage: primaryRole === "manager",
    canExecuteAsManager: primaryRole === "manager",
  };
}

export function canAccessEmployeeWorkbench(
  caps: WorkbenchCapabilities,
  viewRole: WorkbenchRole,
): boolean {
  if (caps.primaryRole === "employee") return viewRole === "employee";
  if (caps.canExecuteAsManager) return viewRole === "employee";
  return false;
}

export function canAccessManagerWorkbench(
  caps: WorkbenchCapabilities,
  viewRole: WorkbenchRole,
): boolean {
  return caps.canManage && viewRole === "manager";
}

export function sessionPrimaryRole(session: WorkbenchSessionView): WorkbenchRole {
  if (session.primaryRole) return session.primaryRole;
  const caps = resolveWorkbenchCapabilities(session.userId);
  if (caps.primaryRole === "manager" && session.role === "employee") {
    return "manager";
  }
  return session.role;
}

export function normalizeWorkbenchSession<T extends WorkbenchSessionView>(
  session: T,
): T & { primaryRole: WorkbenchRole } {
  const caps = resolveWorkbenchCapabilities(session.userId);
  const primaryRole = caps.primaryRole;

  if (primaryRole === "manager") {
    const view =
      session.primaryRole !== undefined
        ? session.role
        : session.role === "employee"
          ? "employee"
          : "manager";
    const safeView: WorkbenchRole = view === "employee" ? "employee" : "manager";
    return { ...session, primaryRole, role: safeView };
  }

  return { ...session, primaryRole, role: primaryRole };
}

export function refreshSessionFromWhitelist<T extends WorkbenchSessionView>(
  session: T,
): { session: T; changed: boolean } {
  const caps = resolveWorkbenchCapabilities(session.userId);

  if (caps.primaryRole !== "manager") {
    const next = { ...session, primaryRole: caps.primaryRole, role: caps.primaryRole };
    const changed =
      session.role !== next.role
      || session.primaryRole !== next.primaryRole
      || session.primaryRole === undefined;
    return { session: next, changed };
  }

  const normalized = normalizeWorkbenchSession(session);
  const next = {
    ...session,
    primaryRole: "manager" as const,
    role: normalized.role === "employee" ? ("employee" as const) : ("manager" as const),
  };
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
  if (viewRole === "admin") return "/workbench/admin";
  if (viewRole === "manager") return "/workbench/manager/tasks";
  return "/workbench/employee?view=new";
}
