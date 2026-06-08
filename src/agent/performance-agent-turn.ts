/**
 * 隔离的「员工交付绩效」问答 Agent 回合。
 *
 * 与 planner/manager 主链路完全解耦：固定 promptProfile/toolProfile=performance，
 * 仅暴露只读统计 + 查人工具，不接 publish FSM、不动 PlanSession 草案，不轮转 planId。
 * 供绩效看板页内置聊天框调用。
 */
import type { QwenPlannerConfig } from "./demo/qwen-planner";
import { runOrchestrator, type OrchestratorResult } from "./orchestrator";
import type { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import type { PerformanceScope } from "./tools/performance-tools";
import { extractPerformanceStreamMessage } from "./performance/performance-stream-message";

const DEFAULT_MAX_ITERATIONS = 4;

export interface PerformancePageQueryContext {
  windowDays?: number;
  projectId?: string;
}

export interface PerformanceAgentTurnInput {
  userMessage: string;
  clientConfig: QwenPlannerConfig;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  /** 受信任的发起人 userId（来自工作台 session，绝不取自模型参数）。 */
  actorUserId: string;
  scope: PerformanceScope;
  /** 与看板表格对齐的筛选（窗口/项目）。 */
  pageQuery?: PerformancePageQueryContext;
  conversationHistory?: Array<{ role: string; content: string }>;
  maxToolIterations?: number;
  currentTimeIso?: string;
  traceId?: string;
  /** SSE 流式：模型终稿 message 字段增量（不含 tool 轮中间态）。 */
  onStreamDelta?: (messagePreview: string) => void;
  onStreamStatus?: (status: "thinking" | "querying") => void;
}

export interface PerformanceAgentTurnResult {
  message: string;
  orchResult: OrchestratorResult;
}

function buildPerformancePageContextPrefix(pageQuery?: PerformancePageQueryContext): string {
  const windowDays = pageQuery?.windowDays && pageQuery.windowDays > 0
    ? Math.floor(pageQuery.windowDays)
    : 90;
  const projectId = String(pageQuery?.projectId ?? "").trim();
  const projectLabel = !projectId
    ? "全部项目"
    : projectId === "__unassigned__"
      ? "未归类"
      : projectId;
  return (
    `[page_context] 当前看板筛选：近 ${windowDays} 天；项目=${projectLabel}；`
    + "口径与上方表格一致（仅含截止时间的有效子任务，**不含已停止 STOPPED 任务**）。"
    + "回答时必须调用 get_employee_performance，直接使用 employees[].lateRateLabel / sampleStatus / kpi，"
    + "禁止自行用 withDueTotal 推算迟交率。\n\n"
  );
}

export async function runPerformanceAgentTurn(
  input: PerformanceAgentTurnInput,
): Promise<PerformanceAgentTurnResult> {
  input.onStreamStatus?.("thinking");
  let lastPreview = "";
  const clientConfig: QwenPlannerConfig = {
    ...input.clientConfig,
    stream: input.onStreamDelta ? true : input.clientConfig.stream,
    streamHooks: input.onStreamDelta
      ? {
          onAssistantDelta: (assembled) => {
            const preview = extractPerformanceStreamMessage(assembled);
            if (preview && preview !== lastPreview) {
              lastPreview = preview;
              input.onStreamDelta?.(preview);
            }
          },
        }
      : input.clientConfig.streamHooks,
  };

  const userMessage = buildPerformancePageContextPrefix(input.pageQuery) + input.userMessage;

  const orchResult = await runOrchestrator(userMessage, {
    clientConfig,
    employeeRepo: input.employeeRepo,
    maxToolIterations: input.maxToolIterations ?? DEFAULT_MAX_ITERATIONS,
    toolProfile: "performance",
    promptProfile: "performance",
    performanceScope: input.scope,
    performanceQueryDefaults: {
      windowDays: input.pageQuery?.windowDays,
      projectId: input.pageQuery?.projectId,
    },
    trustedActorUserId: input.actorUserId,
    sessionContext: {
      conversationHistory: input.conversationHistory,
      currentTimeIso: input.currentTimeIso ?? new Date().toISOString(),
    },
    traceId: input.traceId,
  });
  const message = orchResult.messages[orchResult.messages.length - 1] ?? "";
  return { message, orchResult };
}
