import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import {
  buildEmployeePerformanceFacts,
  type EmployeePerformanceFacts,
} from "../performance/performance-facts";

export const GET_EMPLOYEE_PERFORMANCE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_employee_performance",
    description:
      "读取员工交付绩效统计（迟交/准时率/平均迟交天数/当前逾期/被催次数/被改派标注），按迟交率排序，"
      + "用于回答「谁经常迟交/延期」「某员工准时率」等绩效问题。仅统计有截止时间的子任务；范围由后端按角色限定"
      + "（主管=本人名下，admin/老板=全员），无需也无法在参数中指定范围。",
    parameters: {
      type: "object",
      properties: {
        windowDays: {
          type: "number",
          description: "统计窗口天数（按截止时间回溯），默认 90；最小 1。",
        },
        limit: {
          type: "number",
          description: "返回排行前 N 名（默认全部）。",
        },
      },
      required: [],
    },
  },
};

export interface PerformanceScope {
  kind: "manager" | "all";
  managerUserId?: string;
}

export function buildGetEmployeePerformanceHandler(deps: {
  taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
  peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
  scope: PerformanceScope;
  defaultWindowDays?: number;
}): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const peopleStore = deps.peopleStore ?? createPeopleDirectoryStore();
  return (args: Record<string, unknown>) => {
    const windowDaysArg = Number(args?.windowDays);
    const windowDays = Number.isFinite(windowDaysArg) && windowDaysArg >= 1
      ? Math.floor(windowDaysArg)
      : deps.defaultWindowDays;
    const limitArg = Number(args?.limit);
    const limit = Number.isFinite(limitArg) && limitArg >= 1 ? Math.floor(limitArg) : undefined;

    const dataset = taskStore.loadPerformanceDataset(
      deps.scope.kind === "manager" ? { managerUserId: deps.scope.managerUserId } : {},
    );
    const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
      scopeKind: deps.scope.kind,
      windowDays,
      resolveName: (userId) => peopleStore.getContact(userId)?.name?.trim() || undefined,
    });
    const rows = limit ? facts.rows.slice(0, limit) : facts.rows;
    return {
      ok: true,
      scopeKind: facts.scopeKind,
      windowDays: facts.windowDays,
      asOf: facts.asOf,
      totalSubtasksConsidered: facts.totalSubtasksConsidered,
      employees: rows,
    };
  };
}
