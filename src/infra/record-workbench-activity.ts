import {
  getWorkbenchActivityStore,
  type WorkbenchActivityKind,
  type WorkbenchActivitySurface,
} from "./workbench-activity-store";

export function recordWorkbenchUsageAsync(input: {
  userId: string;
  surface: WorkbenchActivitySurface;
  path: string;
  kind?: WorkbenchActivityKind;
}): void {
  if (process.env.AGENT_METRICS_ENABLED === "0") return;
  setImmediate(() => {
    try {
      getWorkbenchActivityStore().recordEvent(input);
    } catch {
      // best-effort observability
    }
  });
}

/** @deprecated use recordWorkbenchUsageAsync */
export function recordWorkbenchPageViewAsync(input: {
  userId: string;
  surface: WorkbenchActivitySurface;
  path: string;
}): void {
  recordWorkbenchUsageAsync({ ...input, kind: "page_view" });
}

export function resolveWorkbenchSurfaceFromPath(pathname: string): WorkbenchActivitySurface {
  if (pathname.startsWith("/workbench/employee")) return "employee";
  if (pathname.startsWith("/workbench/admin")) return "admin";
  return "manager";
}

export function resolveWorkbenchSurfaceFromRole(
  role: string,
  pathname?: string,
): WorkbenchActivitySurface {
  if (role === "employee") return "employee";
  if (role === "admin") return "admin";
  if (pathname) return resolveWorkbenchSurfaceFromPath(pathname);
  return "manager";
}

/** Task actions / API usage (employee accept, progress, manager APIs, etc.). */
export function recordWorkbenchApiActivityAsync(input: {
  userId: string;
  role: string;
  path: string;
}): void {
  recordWorkbenchUsageAsync({
    userId: input.userId,
    surface: resolveWorkbenchSurfaceFromRole(input.role, input.path),
    path: input.path,
    kind: "api",
  });
}
