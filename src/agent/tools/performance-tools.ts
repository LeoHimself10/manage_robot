import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import {
  buildEmployeePerformanceDetail,
  buildEmployeePerformanceFacts,
  buildPerformanceSummaryKpi,
  type EmployeePerformanceFacts,
} from "../performance/performance-facts";
import {
  type PerformancePeriodKind,
  periodOptionsFromInput,
  resolvePerformancePeriod,
  resolvePerformanceWindowDays,
} from "../performance/performance-period";

export const GET_EMPLOYEE_PERFORMANCE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_employee_performance",
    description:
      "读取员工交付绩效统计（迟交/准时率/平均迟交天数/当前逾期/被催次数/被改派标注），按迟交率排序，"
      + "用于回答「谁经常迟交/延期」「某员工准时率」「本月/本季度/本年绩效」等问题。"
      + "口径与绩效看板表格一致：仅统计有截止时间的子任务，**不含已停止(STOPPED)任务**；"
      + "无完成样本时 lateRate 为 null，请用 lateRateLabel 展示。范围由后端按角色限定。"
      + "periodKind=month|quarter|year 时按**自然月/季/年**统计（periodAnchor 可指定 YYYY-MM / YYYY-Q1 / YYYY）；"
      + "rolling 时用 windowDays（近 N 天）。未传时与 page_context 一致。"
      + "传入 employeeUserId 时返回该员工的按项目/按任务明细（byProject / byTask / subtasks）。",
    parameters: {
      type: "object",
      properties: {
        windowDays: {
          type: "number",
          description: "滚动窗口天数（periodKind=rolling 或未传 periodKind 时）；未传则用页面当前窗口。",
        },
        periodKind: {
          type: "string",
          enum: ["rolling", "month", "quarter", "year"],
          description: "统计周期：rolling=近N天；month/quarter/year=自然月/季/年（北京时间）。",
        },
        periodAnchor: {
          type: "string",
          description: "自然周期锚点：月=YYYY-MM，季=YYYY-Q1~Q4，年=YYYY；省略=当前月/季/年。",
        },
        projectId: {
          type: "string",
          description: "按项目筛选（与看板项目下拉一致）；空=全部；__unassigned__=未归类。",
        },
        employeeUserId: {
          type: "string",
          description:
            "指定员工 userId（先用 search_employees 按姓名换取）。传入后返回该员工的按项目/按任务明细，而非全员排行。",
        },
        limit: {
          type: "number",
          description: "返回排行前 N 名（默认全部）；仅在未指定 employeeUserId 时生效。",
        },
      },
      required: [],
    },
  },
};

export interface PerformanceScope {
  kind: "manager" | "all";
  managerUserId?: string;
  managerGroupId?: string;
  managerGroupMemberUserIds?: string[];
}

export interface PerformanceQueryDefaults {
  windowDays?: number;
  projectId?: string;
  periodKind?: PerformancePeriodKind;
  periodAnchor?: string;
}

function resolveToolPeriodArgs(
  args: Record<string, unknown>,
  deps: { queryDefaults?: PerformanceQueryDefaults; defaultWindowDays?: number },
) {
  const windowDaysArg = Number(args?.windowDays);
  const hasWindowArg = Number.isFinite(windowDaysArg) && windowDaysArg >= 1;
  const periodKindRaw = String(args?.periodKind ?? deps.queryDefaults?.periodKind ?? "").trim();
  const periodAnchor = String(args?.periodAnchor ?? deps.queryDefaults?.periodAnchor ?? "").trim();
  const buildOptions = periodOptionsFromInput({
    windowDays: hasWindowArg
      ? Math.floor(windowDaysArg)
      : deps.queryDefaults?.windowDays ?? deps.defaultWindowDays,
    periodKind: periodKindRaw || undefined,
    periodAnchor,
  });
  const period = resolvePerformancePeriod(buildOptions);
  return { buildOptions, period };
}

export function buildGetEmployeePerformanceHandler(deps: {
  taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
  peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
  scope: PerformanceScope;
  defaultWindowDays?: number;
  queryDefaults?: PerformanceQueryDefaults;
}): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const peopleStore = deps.peopleStore ?? createPeopleDirectoryStore();
  const defaultWindowDays = deps.defaultWindowDays ?? resolvePerformanceWindowDays();
  return (args: Record<string, unknown>) => {
    const { buildOptions, period } = resolveToolPeriodArgs(args, {
      queryDefaults: deps.queryDefaults,
      defaultWindowDays,
    });
    const projectId = String(args?.projectId ?? deps.queryDefaults?.projectId ?? "").trim() || undefined;
    const employeeUserId = String(args?.employeeUserId ?? "").trim() || undefined;
    const limitArg = Number(args?.limit);
    const limit = Number.isFinite(limitArg) && limitArg >= 1 ? Math.floor(limitArg) : undefined;
    const resolveName = (userId: string) => peopleStore.getContact(userId)?.name?.trim() || undefined;

    const dataset = taskStore.loadPerformanceDataset({
      ...(deps.scope.kind === "manager"
        ? {
            managerUserId: deps.scope.managerUserId,
            managerGroupId: deps.scope.managerGroupId,
            managerGroupMemberUserIds: deps.scope.managerGroupMemberUserIds,
          }
        : {}),
      ...(projectId ? { projectId } : {}),
    });

    const periodFields = {
      periodKind: period.kind,
      periodLabel: period.label,
      periodAnchor: period.periodAnchor,
      windowDays: period.windowDays ?? resolvePerformanceWindowDays(buildOptions.windowDays),
    };

    if (employeeUserId) {
      const detail = buildEmployeePerformanceDetail(dataset, employeeUserId, {
        scopeKind: deps.scope.kind,
        ...buildOptions,
        resolveName,
      });
      if (!detail) {
        return {
          ok: true,
          mode: "employee_detail",
          employeeUserId,
          found: false,
          ...periodFields,
          projectId: projectId ?? "",
          excludesStoppedTasks: true,
          note: "该员工在当前范围/周期内无有效（含截止、非已停止）子任务样本。",
        };
      }
      return {
        ok: true,
        mode: "employee_detail",
        found: true,
        ...periodFields,
        asOf: period.asOf,
        projectId: projectId ?? "",
        excludesStoppedTasks: true,
        employee: detail.employee,
        byProject: detail.byProject,
        byTask: detail.byTask,
        subtasks: detail.subtasks.slice(0, 60),
      };
    }

    const facts: EmployeePerformanceFacts = buildEmployeePerformanceFacts(dataset, {
      scopeKind: deps.scope.kind,
      ...buildOptions,
      resolveName,
    });
    const rows = limit ? facts.rows.slice(0, limit) : facts.rows;
    const kpi = buildPerformanceSummaryKpi(facts.rows);
    return {
      ok: true,
      mode: "ranking",
      scopeKind: facts.scopeKind,
      ...periodFields,
      asOf: facts.asOf,
      projectId: projectId ?? "",
      totalSubtasksConsidered: facts.totalSubtasksConsidered,
      excludesStoppedTasks: true,
      kpi,
      employees: rows,
    };
  };
}
