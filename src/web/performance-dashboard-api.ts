import type { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import {
  buildEmployeePerformanceFacts,
  type EmployeePerformanceFacts,
} from "../agent/performance/performance-facts";
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

export function buildPerformanceDashboardPayload(input: {
  taskStore: TaskStore;
  scope: PerformanceScope;
  windowDays?: unknown;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const windowDays = resolvePerformanceWindowDays(input.windowDays);
  const dataset = input.taskStore.loadPerformanceDataset(
    input.scope.kind === "manager" ? { managerUserId: input.scope.managerUserId } : {},
  );
  const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
    scopeKind: input.scope.kind,
    windowDays,
    resolveName: input.resolveName,
  });
  return {
    ok: true,
    scopeKind: facts.scopeKind,
    windowDays: facts.windowDays,
    asOf: facts.asOf,
    generatedAt: facts.generatedAt,
    totalSubtasksConsidered: facts.totalSubtasksConsidered,
    employees: facts.rows,
  };
}
