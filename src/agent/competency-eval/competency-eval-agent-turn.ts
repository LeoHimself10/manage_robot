/**
 * 隔离的「能力评估」问答 Agent 回合。
 *
 * 与 planner/manager 主链路完全解耦：固定 promptProfile/toolProfile=competency_eval，
 * 仅暴露 rubric 读取、日报证据与查人工具，不接 publish FSM、不动 PlanSession 草案。
 * 供能力评估页内置聊天框调用。
 */
import type { QwenPlannerConfig } from "../demo/qwen-planner";
import { runOrchestrator, type OrchestratorResult } from "../orchestrator";
import type { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import { extractPerformanceStreamMessage } from "../performance/performance-stream-message";
import { getRubric } from "./rubric-store";

const DEFAULT_MAX_ITERATIONS = 6;

export interface CompetencyEvalAgentTurnInput {
  userMessage: string;
  clientConfig: QwenPlannerConfig;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  actorUserId: string;
  activeRubricId?: string;
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

export function buildCompetencyEvalContextPrefix(input: {
  actorUserId: string;
  activeRubricId?: string;
}): string {
  const actorUserId = String(input.actorUserId ?? "").trim();
  const rubricId = String(input.activeRubricId ?? "").trim();

  if (!rubricId) {
    return (
      "[context] activeRubricId=\n"
      + "当前未选定评估标准。请先在工作台上传能力评估标准文档，或调用 list_rubrics 查看已上传列表并选定 activeRubricId。\n\n"
    );
  }

  let titlePart = "";
  if (actorUserId) {
    const rubric = getRubric(actorUserId, rubricId);
    if (rubric.ok && rubric.extracted.title?.trim()) {
      titlePart = `；title=${rubric.extracted.title.trim()}`;
    }
  }

  return `[context] activeRubricId=${rubricId}${titlePart}\n\n`;
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
    buildCompetencyEvalContextPrefix({
      actorUserId: input.actorUserId,
      activeRubricId: input.activeRubricId,
    }) + input.userMessage;

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
