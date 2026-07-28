import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { DailyReportDigestConfig } from "../daily-report-digest/daily-report-config";
import type { DingTalkContactDirectory } from "../daily-report-digest/dingtalk-contact-search";
import { fetchEmployeeDailyReportsForEval } from "../competency-eval/daily-reports-for-eval";
import {
  analyzeEvalWorkHours,
  normalizeEvalLogAnalysisDimensions,
} from "../competency-eval/log-hours-analysis";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export const GET_EMPLOYEE_DAILY_REPORTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_employee_daily_reports",
    description:
      "拉取指定员工在日期区间内的钉钉日报/工作日志（仅限已配置钉钉组织内员工）。"
      + "返回按日期排序的日志条目，供定性评估分析。"
      + "未传 startYmd/endYmd 时使用系统默认窗口（近 N 天）。",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "被评估员工 userId（先用 search_employees 按姓名换取）。",
        },
        startYmd: {
          type: "string",
          description: "开始日期 YYYY-MM-DD（含）；省略则用默认窗口起点。",
        },
        endYmd: {
          type: "string",
          description: "结束日期 YYYY-MM-DD（含）；省略则默认为今天。",
        },
      },
      required: ["userId"],
    },
  },
};

export const ANALYZE_EMPLOYEE_LOG_HOURS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "analyze_employee_log_hours",
    description:
      "精确分析员工日志中的工时与时间分配。AI选择日期范围、分组维度和筛选条件，工具负责取数、去重、求和及占比计算。"
      + "涉及工时、时间投入、项目占比、工作类型分布时优先使用本工具，不要自行心算。",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "被分析员工 userId（先用 search_employees 按姓名获取）。",
        },
        startYmd: {
          type: "string",
          description: "开始日期 YYYY-MM-DD（含）；省略则使用默认窗口。",
        },
        endYmd: {
          type: "string",
          description: "结束日期 YYYY-MM-DD（含）；省略则默认为今天。",
        },
        groupBy: {
          type: "array",
          description:
            "分组维度，最多组合3项。project=项目，workModule=工作模块，taskType=任务类型，date=日期，template=日志模板。",
          items: {
            type: "string",
            enum: ["project", "workModule", "taskType", "date", "template"],
          },
        },
        projectContains: {
          type: "string",
          description: "仅统计项目名称包含该文字的工时（可选）。",
        },
        workModuleContains: {
          type: "string",
          description: "仅统计工作模块包含该文字的工时（可选）。",
        },
        taskTypeContains: {
          type: "string",
          description: "仅统计任务类型包含该文字的工时（可选）。",
        },
        limit: {
          type: "number",
          description: "最多返回多少个分组，默认50，最大100。",
        },
      },
      required: ["userId"],
    },
  },
};

export function getCompetencyEvalDefaultWindowDays(): number {
  const raw = Number(String(process.env.COMPETENCY_EVAL_DEFAULT_WINDOW_DAYS ?? "30").trim());
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
}

function resolveDefaultReportWindow(timezone = DEFAULT_TIMEZONE): { startYmd: string; endYmd: string } {
  const endYmd = formatDateInTz(new Date().toISOString(), timezone);
  const startYmd = addDaysToYmd(endYmd, -(getCompetencyEvalDefaultWindowDays() - 1));
  return { startYmd, endYmd };
}

export function buildGetEmployeeDailyReportsHandler(deps: {
  actorUserId: string;
  timezone?: string;
  fetchReports?: typeof fetchEmployeeDailyReportsForEval;
  reportConfig?: DailyReportDigestConfig;
  contactDirectory?: DingTalkContactDirectory;
}): ToolHandler {
  const timezone = deps.timezone?.trim() || DEFAULT_TIMEZONE;
  const fetchReports = deps.fetchReports ?? fetchEmployeeDailyReportsForEval;
  return async (args) => {
    const actorUserId = String(deps.actorUserId ?? "").trim();
    if (!actorUserId) {
      return { ok: false, reason: "trusted_actor_required", message: "缺少可信操作者身份。" };
    }

    const userId = String(args?.userId ?? "").trim();
    if (!userId) {
      return { ok: false, reason: "missing_user_id", message: "请提供被评估员工 userId。" };
    }

    let startYmd = String(args?.startYmd ?? "").trim();
    let endYmd = String(args?.endYmd ?? "").trim();
    if (!startYmd || !endYmd) {
      const defaults = resolveDefaultReportWindow(timezone);
      startYmd = startYmd || defaults.startYmd;
      endYmd = endYmd || defaults.endYmd;
    }

    return fetchReports(
      { userId, startYmd, endYmd },
      deps.reportConfig || deps.contactDirectory
        ? {
            config: deps.reportConfig,
            contactDirectory: deps.contactDirectory,
          }
        : undefined,
    );
  };
}

export function buildAnalyzeEmployeeLogHoursHandler(deps: {
  actorUserId: string;
  timezone?: string;
  fetchReports?: typeof fetchEmployeeDailyReportsForEval;
  reportConfig?: DailyReportDigestConfig;
  contactDirectory?: DingTalkContactDirectory;
}): ToolHandler {
  const timezone = deps.timezone?.trim() || DEFAULT_TIMEZONE;
  const fetchReports = deps.fetchReports ?? fetchEmployeeDailyReportsForEval;
  return async (args) => {
    const actorUserId = String(deps.actorUserId ?? "").trim();
    if (!actorUserId) {
      return {
        ok: false,
        reason: "trusted_actor_required",
        message: "缺少可信操作者身份。",
      };
    }

    const userId = String(args?.userId ?? "").trim();
    if (!userId) {
      return {
        ok: false,
        reason: "missing_user_id",
        message: "请提供被分析员工 userId。",
      };
    }

    let startYmd = String(args?.startYmd ?? "").trim();
    let endYmd = String(args?.endYmd ?? "").trim();
    if (!startYmd || !endYmd) {
      const defaults = resolveDefaultReportWindow(timezone);
      startYmd = startYmd || defaults.startYmd;
      endYmd = endYmd || defaults.endYmd;
    }

    const fetched = await fetchReports(
      { userId, startYmd, endYmd },
      deps.reportConfig || deps.contactDirectory
        ? {
            config: deps.reportConfig,
            contactDirectory: deps.contactDirectory,
          }
        : undefined,
    );
    if (!fetched.ok) return fetched;

    const groupBy = normalizeEvalLogAnalysisDimensions(args?.groupBy);
    const analysis = analyzeEvalWorkHours(fetched.workHours, {
      groupBy,
      filters: {
        projectContains: String(args?.projectContains ?? "").trim() || undefined,
        workModuleContains: String(args?.workModuleContains ?? "").trim() || undefined,
        taskTypeContains: String(args?.taskTypeContains ?? "").trim() || undefined,
      },
      limit: Number(args?.limit),
    });
    return {
      ok: true,
      userId,
      startYmd,
      endYmd,
      ...analysis,
    };
  };
}
