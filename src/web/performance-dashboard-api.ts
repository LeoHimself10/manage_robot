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

export type PerformanceChatTurn = { role: "user" | "assistant"; content: string };

const PERF_CHAT_HISTORY_MAX_TURNS = 20;
const PERF_CHAT_TURN_MAX_CHARS = 4000;

/** 解析绩效助手 POST /chat 的 conversationHistory（仅 user/assistant，截断长度与轮数）。 */
export function parsePerformanceConversationHistory(raw: unknown): PerformanceChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: PerformanceChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const role = r.role === "user" ? "user" : r.role === "assistant" ? "assistant" : null;
    const content = String(r.content ?? "").trim();
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, PERF_CHAT_TURN_MAX_CHARS) });
  }
  return out.slice(-PERF_CHAT_HISTORY_MAX_TURNS);
}

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
  // 项目下拉选项必须独立于当前 projectId 过滤，否则筛选某项目后其它项目会从下拉里消失。
  const fullDataset = loadScopedDataset(input.taskStore, input.scope);
  const dataset = projectId
    ? loadScopedDataset(input.taskStore, input.scope, projectId)
    : fullDataset;
  const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
    scopeKind: input.scope.kind,
    windowDays,
    resolveName: input.resolveName,
  });
  const kpi = buildPerformanceSummaryKpi(facts.rows);
  const projectOptions = buildProjectPerformanceRollup(fullDataset, {
    scopeKind: input.scope.kind,
    windowDays,
    asOf: facts.asOf,
  });
  const projects = projectId
    ? buildProjectPerformanceRollup(dataset, {
        scopeKind: input.scope.kind,
        windowDays,
        asOf: facts.asOf,
      })
    : projectOptions;
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
    projectOptions,
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
  const fullDataset = loadScopedDataset(input.taskStore, input.scope);
  const fullDetail = buildEmployeePerformanceDetail(fullDataset, input.userId, {
    scopeKind: input.scope.kind,
    windowDays,
    resolveName: input.resolveName,
  });
  if (!fullDetail) {
    return { ok: false, error: "employee_not_found_in_scope" };
  }
  const employeeProjectOptions = fullDetail.byProject.map((p) => ({
    projectId: p.projectId,
    projectName: p.projectName,
    withDueTotal: p.withDueTotal,
  }));
  const detail = projectId
    ? buildEmployeePerformanceDetail(
        loadScopedDataset(input.taskStore, input.scope, projectId),
        input.userId,
        { scopeKind: input.scope.kind, windowDays, resolveName: input.resolveName },
      )
    : fullDetail;
  if (!detail) {
    return { ok: false, error: "employee_not_found_in_scope" };
  }
  return {
    ok: true,
    scopeKind: input.scope.kind,
    scopeLabel: performanceScopeLabel(input.scope),
    windowDays,
    projectId: projectId ?? "",
    employeeProjectOptions,
    ...detail,
  };
}

export function resolvePerformanceScopeFromSession(session: WorkbenchSession): PerformanceScope {
  return resolvePerformanceScope(session);
}
