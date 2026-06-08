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

const DEFAULT_MAX_ITERATIONS = 4;

export interface PerformanceAgentTurnInput {
  userMessage: string;
  clientConfig: QwenPlannerConfig;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  /** 受信任的发起人 userId（来自工作台 session，绝不取自模型参数）。 */
  actorUserId: string;
  scope: PerformanceScope;
  conversationHistory?: Array<{ role: string; content: string }>;
  maxToolIterations?: number;
  currentTimeIso?: string;
  traceId?: string;
}

export interface PerformanceAgentTurnResult {
  message: string;
  orchResult: OrchestratorResult;
}

export async function runPerformanceAgentTurn(
  input: PerformanceAgentTurnInput,
): Promise<PerformanceAgentTurnResult> {
  const orchResult = await runOrchestrator(input.userMessage, {
    clientConfig: input.clientConfig,
    employeeRepo: input.employeeRepo,
    maxToolIterations: input.maxToolIterations ?? DEFAULT_MAX_ITERATIONS,
    toolProfile: "performance",
    promptProfile: "performance",
    performanceScope: input.scope,
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
