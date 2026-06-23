import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { DailyReportDigestConfig } from "../daily-report-digest/daily-report-config";
import { fetchEmployeeDailyReportsForEval } from "../competency-eval/daily-reports-for-eval";
import { getRubric, listRubrics } from "../competency-eval/rubric-store";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export const LIST_RUBRICS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_rubrics",
    description:
      "列出当前用户已上传的能力评估标准（rubric）文档。返回 rubricId、标题、维度数量与上传时间，"
      + "用于切换评估标准或确认 activeRubricId。",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const GET_RUBRIC_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_rubric",
    description:
      "读取指定能力评估标准的原文 Markdown 与已提取的评估维度列表。"
      + "仅可访问当前用户本人上传的标准。",
    parameters: {
      type: "object",
      properties: {
        rubricId: {
          type: "string",
          description: "list_rubrics 返回的 rubricId。",
        },
      },
      required: ["rubricId"],
    },
  },
};

export const GET_EMPLOYEE_DAILY_REPORTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_employee_daily_reports",
    description:
      "拉取指定员工在日期区间内的钉钉日报/工作日志（仅可评估日报名单内员工）。"
      + "返回按日期排序的日志条目，供对照 rubric 维度做证据型评估。"
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

export function getCompetencyEvalDefaultWindowDays(): number {
  const raw = Number(String(process.env.COMPETENCY_EVAL_DEFAULT_WINDOW_DAYS ?? "30").trim());
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
}

function resolveDefaultReportWindow(timezone = DEFAULT_TIMEZONE): { startYmd: string; endYmd: string } {
  const endYmd = formatDateInTz(new Date().toISOString(), timezone);
  const startYmd = addDaysToYmd(endYmd, -(getCompetencyEvalDefaultWindowDays() - 1));
  return { startYmd, endYmd };
}

export function buildListRubricsHandler(deps: { actorUserId: string }): ToolHandler {
  return () => {
    const actorUserId = String(deps.actorUserId ?? "").trim();
    if (!actorUserId) {
      return { ok: false, reason: "trusted_actor_required", message: "缺少可信操作者身份。" };
    }
    const items = listRubrics(actorUserId);
    return { ok: true, items };
  };
}

export function buildGetRubricHandler(deps: { actorUserId: string }): ToolHandler {
  return (args) => {
    const actorUserId = String(deps.actorUserId ?? "").trim();
    if (!actorUserId) {
      return { ok: false, reason: "trusted_actor_required", message: "缺少可信操作者身份。" };
    }
    const rubricId = String(args?.rubricId ?? "").trim();
    if (!rubricId) {
      return { ok: false, reason: "missing_rubric_id", message: "请提供 rubricId。" };
    }

    const result = getRubric(actorUserId, rubricId);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.reason === "not_found" ? "未找到该评估标准或无权访问。" : "评估标准数据损坏。",
      };
    }

    return {
      ok: true,
      rubricId: result.extracted.rubricId,
      title: result.extracted.title,
      dimensions: result.extracted.dimensions,
      outputColumns: result.extracted.outputColumns,
      sourceMarkdown: result.sourceMarkdown,
    };
  };
}

export function buildGetEmployeeDailyReportsHandler(deps: {
  actorUserId: string;
  timezone?: string;
  fetchReports?: typeof fetchEmployeeDailyReportsForEval;
  reportConfig?: DailyReportDigestConfig;
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
      deps.reportConfig ? { config: deps.reportConfig } : undefined,
    );
  };
}
