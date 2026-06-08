import type { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import type { WorkbenchSession } from "./assignment-workbench-session-types";
import {
  buildEmployeePerformanceDetail,
  buildEmployeePerformanceFacts,
  buildPerformanceSummaryKpi,
  buildProjectPerformanceRollup,
  type EmployeePerformanceFacts,
} from "../agent/performance/performance-facts";
import { performanceScopeLabel, resolvePerformanceScope } from "../agent/performance/performance-scope";
import type { PerformanceScope } from "../agent/tools/performance-tools";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export const PERFORMANCE_DASHBOARD_DEFAULT_WINDOW_DAYS = 90;

export function isPerformanceDashboardEnabled(): boolean {
  return String(process.env.PERFORMANCE_DASHBOARD_ENABLED ?? "1").trim() !== "0";
}

export function resolvePerformanceWindowDays(raw?: unknown): number {
  const fromArg = Number(raw);
  if (Number.isFinite(fromArg) && fromArg >= 1) return Math.floor(fromArg);
  const fromEnv = Number(String(process.env.PERFORMANCE_WINDOW_DAYS ?? "").trim());
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return PERFORMANCE_DASHBOARD_DEFAULT_WINDOW_DAYS;
}

export { resolvePerformanceScope, performanceScopeLabel };

function loadScopedDataset(
  taskStore: TaskStore,
  scope: PerformanceScope,
  projectId?: string,
) {
  return taskStore.loadPerformanceDataset({
    ...(scope.kind === "manager" ? { managerUserId: scope.managerUserId } : {}),
    ...(projectId ? { projectId } : {}),
  });
}

export function buildPerformanceDashboardPayload(input: {
  taskStore: TaskStore;
  scope: PerformanceScope;
  windowDays?: unknown;
  projectId?: string;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const windowDays = resolvePerformanceWindowDays(input.windowDays);
  const projectId = String(input.projectId ?? "").trim() || undefined;
  const dataset = loadScopedDataset(input.taskStore, input.scope, projectId);
  const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
    scopeKind: input.scope.kind,
    windowDays,
    resolveName: input.resolveName,
  });
  const kpi = buildPerformanceSummaryKpi(facts.rows);
  const projects = buildProjectPerformanceRollup(dataset, {
    scopeKind: input.scope.kind,
    windowDays,
    asOf: facts.asOf,
  });
  return {
    ok: true,
    scopeKind: facts.scopeKind,
    scopeLabel: performanceScopeLabel(input.scope),
    windowDays: facts.windowDays,
    asOf: facts.asOf,
    generatedAt: facts.generatedAt,
    totalSubtasksConsidered: facts.totalSubtasksConsidered,
    projectId: projectId ?? "",
    kpi,
    projects,
    employees: facts.rows,
  };
}

export function buildPerformanceEmployeeDetailPayload(input: {
  taskStore: TaskStore;
  scope: PerformanceScope;
  userId: string;
  windowDays?: unknown;
  projectId?: string;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const windowDays = resolvePerformanceWindowDays(input.windowDays);
  const projectId = String(input.projectId ?? "").trim() || undefined;
  const dataset = loadScopedDataset(input.taskStore, input.scope, projectId);
  const detail = buildEmployeePerformanceDetail(dataset, input.userId, {
    scopeKind: input.scope.kind,
    windowDays,
    resolveName: input.resolveName,
  });
  if (!detail) {
    return { ok: false, error: "employee_not_found_in_scope" };
  }
  return {
    ok: true,
    scopeKind: input.scope.kind,
    scopeLabel: performanceScopeLabel(input.scope),
    windowDays,
    projectId: projectId ?? "",
    ...detail,
  };
}

export function resolvePerformanceScopeFromSession(session: WorkbenchSession): PerformanceScope {
  return resolvePerformanceScope(session);
}
