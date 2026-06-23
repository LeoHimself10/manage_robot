/**
 * 隔离的「能力评估」问答 Agent 回合。
 *
 * 与 planner/manager 主链路完全解耦：固定 promptProfile/toolProfile=competency_eval，
 * 仅暴露 rubric 读取、日报证据与查人工具，不接 publish FSM、不动 PlanSession 草案。
 * 供能力评估页内置聊天框调用。
 */
import type { QwenPlannerConfig } from "../demo/qwen-planner";
import { buildManagerQwenClientConfig } from "../manager-orchestrator-turn";
import { runOrchestrator, type OrchestratorResult } from "../orchestrator";
import { readCompetencyEvalThinkingEnabled } from "./competency-eval-flag";
import type { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import { extractPerformanceStreamMessage } from "../performance/performance-stream-message";
import { getJobReq } from "../../web/competency-eval-api";

const DEFAULT_MAX_ITERATIONS = 6;

export interface CompetencyEvalAgentTurnInput {
  userMessage: string;
  clientConfig: QwenPlannerConfig;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  actorUserId: string;
  activeJobReqId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  maxToolIterations?: number;
  currentTimeIso?: string;
  traceId?: string;
  onStreamDelta?: (messagePreview: string) => void;
  onStreamStatus?: (status: "thinking" | "querying") => void;
}

export interface CompetencyEvalAgentTurnResult {
  message: string;
  orchResult: OrchestratorResult;
}

/** 能力评估专用 Qwen 配置：继承主管超时/流式，thinking 默认开。 */
export function buildCompetencyEvalClientConfig(base: QwenPlannerConfig): QwenPlannerConfig {
  return {
    ...buildManagerQwenClientConfig(base),
    thinking: readCompetencyEvalThinkingEnabled(),
  };
}

function buildJobReqContextPrefix(userId: string, jobReqId: string): string {
  if (!jobReqId) return "";
  const result = getJobReq(userId, jobReqId);
  if (!result.ok) return "";
  return `[context] 岗位要求:\n${result.content}\n\n`;
}

export async function runCompetencyEvalTurn(
  input: CompetencyEvalAgentTurnInput,
): Promise<CompetencyEvalAgentTurnResult> {
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

  const userMessage =
    buildJobReqContextPrefix(
      input.actorUserId,
      input.activeJobReqId ?? "",
    ) + input.userMessage;

  const orchResult = await runOrchestrator(userMessage, {
    clientConfig,
    employeeRepo: input.employeeRepo,
    maxToolIterations: input.maxToolIterations ?? DEFAULT_MAX_ITERATIONS,
    toolProfile: "competency_eval",
    promptProfile: "competency_eval",
    competencyEvalActorUserId: input.actorUserId,
    sessionContext: {
      conversationHistory: input.conversationHistory,
      currentTimeIso: input.currentTimeIso ?? new Date().toISOString(),
    },
    traceId: input.traceId,
  });
  const message = orchResult.messages[orchResult.messages.length - 1] ?? "";
  return { message, orchResult };
}
