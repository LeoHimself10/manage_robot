import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { DemoGateResult, validateDemoGate } from "./gate";
import { checkInputQuality } from "./input-qc";
import { coerceLlmPlanPayload, validateLlmPlanPayload } from "./llm-schema";
import { InferenceTrace, LlmPlanResult, LlmPlannerRequest } from "./llm-types";
import { renderPlanDraftMarkdown } from "./markdown-renderer";
import { buildFallbackTrace } from "./qwen-planner";

export interface TaskPlanningDemoRequest {
  domainHint?: PlanDomain;
  background: string;
}

export interface TaskPlanningDemoOptions {
  llmPlanner: (request: LlmPlannerRequest) => Promise<LlmPlanResult>;
}

export interface DemoGenerationMetadata {
  trace?: InferenceTrace;
}

const LLM_FAILURE_RECOVERY_SUGGESTIONS = [
  "检查 QWEN_API_KEY、网络与模型配额后重试。",
  "若错误与输出格式有关，可联系管理员更新提示词或 Schema 约束。",
  "确认已通过 llmPlanner 调用模型，且输出满足 classification/capa（质量域）/tasks 等字段约束。",
] as const;

const MISSING_PLANNER_MESSAGE =
  "未提供 llmPlanner：基于规则的分类与 WBS 模板已移除，必须通过模型生成草案。";

export type TaskPlanningDemoResult =
  | {
      status: "NEEDS_MORE_INFO";
      questions: string[];
      missingFields: string[];
      markdown?: undefined;
      classification?: undefined;
      capaAdvisory?: undefined;
      tasks?: undefined;
      gate?: undefined;
      generation?: undefined;
    }
  | {
      status: "GENERATION_FAILED";
      reason: string;
      recoverySuggestions: string[];
      trace?: InferenceTrace;
      missingFields: string[];
      markdown?: undefined;
      classification?: undefined;
      capaAdvisory?: undefined;
      tasks?: undefined;
      gate?: undefined;
      generation?: undefined;
    }
  | {
      status: "DRAFT_READY";
      questions: string[];
      missingFields: string[];
      classification: ClassificationResult;
      capaAdvisory?: CapaAdvisory;
      tasks: TaskPackage[];
      gate: DemoGateResult;
      markdown: string;
      generation: DemoGenerationMetadata;
    };

export async function createTaskPlanningDemo(
  request: TaskPlanningDemoRequest,
  options: TaskPlanningDemoOptions
): Promise<TaskPlanningDemoResult> {
  const inputQuality = checkInputQuality(request);

  if (!inputQuality.canGenerateWbs) {
    return {
      status: "NEEDS_MORE_INFO",
      questions: inputQuality.questions,
      missingFields: inputQuality.missingFields,
    };
  }

  if (typeof options?.llmPlanner !== "function") {
    return {
      status: "GENERATION_FAILED",
      reason: MISSING_PLANNER_MESSAGE,
      recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
      missingFields: inputQuality.missingFields,
    };
  }

  try {
    const llmRaw = await options.llmPlanner({
      background: request.background,
      domainHint: request.domainHint,
    });
    const llmResult = coerceLlmPlanPayload(llmRaw, {
      domainHint: request.domainHint,
      background: request.background,
    });
    const validation = validateLlmPlanPayload(llmResult);
    if (!validation.valid) {
      throw new Error(validation.errors.join("; "));
    }

    const classification = llmResult.classification;
    const capaAdvisory =
      classification.domain === "QUALITY" ? llmResult.capaAdvisory : undefined;
    const tasks = llmResult.tasks;
    const openQuestions = [...llmResult.openQuestions];

    const gate = validateDemoGate(tasks);
    const mergedOpenQuestions = uniq([
      ...inputQuality.questions,
      ...classification.missingInformation,
      ...(capaAdvisory?.promptingQuestions ?? []),
      ...openQuestions,
    ]);
    const markdown = renderPlanDraftMarkdown({
      summary: request.background.trim(),
      classification,
      capaAdvisory,
      tasks,
      gate,
      openQuestions: mergedOpenQuestions,
    });

    return {
      status: "DRAFT_READY",
      questions: mergedOpenQuestions,
      missingFields: inputQuality.missingFields,
      classification,
      capaAdvisory,
      tasks,
      gate,
      markdown,
      generation: {
        trace: llmRaw.trace,
      },
    };
  } catch (error) {
    return {
      status: "GENERATION_FAILED",
      reason: error instanceof Error ? error.message : "unknown_error",
      recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
      trace: buildFallbackTrace(error),
      missingFields: inputQuality.missingFields,
    };
  }
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}
