import type { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import type { WorkbenchSession } from "./assignment-workbench-session-types";
import {
  buildEmployeePerformanceDetail,
  buildEmployeePerformanceFacts,
  buildPerformanceSummaryKpi,
  buildProjectPerformanceRollup,
  type EmployeePerformanceFacts,
} from "../agent/performance/performance-facts";
import {
  PERFORMANCE_DEFAULT_WINDOW_DAYS,
  periodOptionsFromInput,
  resolvePerformancePeriod,
  resolvePerformanceWindowDays,
  type PerformancePeriodKind,
} from "../agent/performance/performance-period";
import { performanceScopeLabel, resolvePerformanceScope } from "../agent/performance/performance-scope";
import type { PerformanceScope } from "../agent/tools/performance-tools";

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export const PERFORMANCE_DASHBOARD_DEFAULT_WINDOW_DAYS = PERFORMANCE_DEFAULT_WINDOW_DAYS;

export { resolvePerformanceWindowDays, resolvePerformanceScope, performanceScopeLabel };
export type { PerformancePeriodKind };

export function parsePerformanceQueryInput(input: {
  windowDays?: unknown;
  periodKind?: unknown;
  periodAnchor?: unknown;
}) {
  return periodOptionsFromInput(input);
}

export function isPerformanceDashboardEnabled(): boolean {
  return String(process.env.PERFORMANCE_DASHBOARD_ENABLED ?? "1").trim() !== "0";
}

function periodPayloadFields(input: {
  windowDays?: unknown;
  periodKind?: unknown;
  periodAnchor?: unknown;
}) {
  const period = resolvePerformancePeriod(input);
  return {
    periodKind: period.kind,
    periodLabel: period.label,
    periodAnchor: period.periodAnchor,
    windowDays: period.windowDays ?? resolvePerformanceWindowDays(input.windowDays),
    buildOptions: parsePerformanceQueryInput(input),
  };
}

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
    ...(scope.kind === "manager"
      ? { managerUserId: scope.managerUserId, managerGroupId: scope.managerGroupId }
      : {}),
    ...(projectId ? { projectId } : {}),
  });
}

export function buildPerformanceDashboardPayload(input: {
  taskStore: TaskStore;
  scope: PerformanceScope;
  windowDays?: unknown;
  periodKind?: unknown;
  periodAnchor?: unknown;
  projectId?: string;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const periodFields = periodPayloadFields(input);
  const projectId = String(input.projectId ?? "").trim() || undefined;
  const fullDataset = loadScopedDataset(input.taskStore, input.scope);
  const dataset = projectId
    ? loadScopedDataset(input.taskStore, input.scope, projectId)
    : fullDataset;
  const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
    scopeKind: input.scope.kind,
    ...periodFields.buildOptions,
    resolveName: input.resolveName,
  });
  const kpi = buildPerformanceSummaryKpi(facts.rows);
  const rollupOpts = {
    scopeKind: input.scope.kind,
    ...periodFields.buildOptions,
    asOf: facts.asOf,
  };
  const projectOptions = buildProjectPerformanceRollup(fullDataset, rollupOpts);
  const projects = projectId
    ? buildProjectPerformanceRollup(dataset, rollupOpts)
    : projectOptions;
  return {
    ok: true,
    scopeKind: facts.scopeKind,
    scopeLabel: performanceScopeLabel(input.scope),
    windowDays: facts.windowDays,
    periodKind: facts.periodKind,
    periodLabel: facts.periodLabel,
    periodAnchor: facts.periodAnchor,
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
  periodKind?: unknown;
  periodAnchor?: unknown;
  projectId?: string;
  resolveName?: (uid: string) => string | undefined;
}): Record<string, unknown> {
  const periodFields = periodPayloadFields(input);
  const projectId = String(input.projectId ?? "").trim() || undefined;
  const fullDataset = loadScopedDataset(input.taskStore, input.scope);
  const detailOpts = {
    scopeKind: input.scope.kind,
    ...periodFields.buildOptions,
    resolveName: input.resolveName,
  };
  const fullDetail = buildEmployeePerformanceDetail(fullDataset, input.userId, detailOpts);
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
        detailOpts,
      )
    : fullDetail;
  if (!detail) {
    return { ok: false, error: "employee_not_found_in_scope" };
  }
  return {
    ok: true,
    scopeKind: input.scope.kind,
    scopeLabel: performanceScopeLabel(input.scope),
    windowDays: periodFields.windowDays,
    periodKind: periodFields.periodKind,
    periodLabel: periodFields.periodLabel,
    periodAnchor: periodFields.periodAnchor,
    projectId: projectId ?? "",
    employeeProjectOptions,
    ...detail,
  };
}

export function resolvePerformanceScopeFromSession(session: WorkbenchSession): PerformanceScope {
  return resolvePerformanceScope(session);
}
