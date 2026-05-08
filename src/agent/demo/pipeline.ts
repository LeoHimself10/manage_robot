import { randomUUID } from "node:crypto";

import type { CapaAdvisory } from "../../domain/capa";
import { CAPA_DISCLAIMER } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { DemoGateResult, validateDemoGate } from "./gate";
import { checkInputQuality } from "./input-qc";
import {
  coerceLlmPlanPayload,
  needsMoreInfoFromLlmPayload,
  validateLlmPlanPayload,
} from "./llm-schema";
import {
  InferenceTrace,
  LlmPlanPayload,
  LlmPlannerRequest,
  LlmPlannerResponse,
} from "./llm-types";
import { renderPlanDraftMarkdown } from "./markdown-renderer";
import { buildFallbackTrace } from "./qwen-planner";

export interface TaskPlanningDemoRequest {
  domainHint?: PlanDomain;
  background: string;
}

export interface TaskPlanningDemoOptions {
  llmPlanner: (request: LlmPlannerRequest) => Promise<LlmPlannerResponse>;
  /**
   * When true (default), after a failed structural validation the pipeline calls the planner
   * once more with validation errors and the previous JSON for self-correction.
   */
  enableLlmCorrection?: boolean;
}

export interface DemoGenerationMetadata {
  trace?: InferenceTrace;
  correctionUsed?: boolean;
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

function ensureCapaDisclaimer(
  capaAdvisory: CapaAdvisory | undefined
): CapaAdvisory | undefined {
  if (!capaAdvisory) return undefined;
  const disclaimer =
    typeof capaAdvisory.disclaimer === "string" &&
    capaAdvisory.disclaimer.trim().length > 0
      ? capaAdvisory.disclaimer
      : CAPA_DISCLAIMER;
  return { ...capaAdvisory, disclaimer };
}

export async function createTaskPlanningDemo(
  request: TaskPlanningDemoRequest,
  options: TaskPlanningDemoOptions
): Promise<TaskPlanningDemoResult> {
  const inputQuality = checkInputQuality(request);
  const traceId = randomUUID();
  const correctionEnabled = options.enableLlmCorrection !== false;

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
    let plannerResponse = await options.llmPlanner({
      background: request.background,
      domainHint: request.domainHint,
      traceId,
    });
    let correctionUsed = false;
    let activeTrace: InferenceTrace = {
      ...plannerResponse.trace,
      traceId,
    };

    const runValidate = (normalized: LlmPlanPayload) => {
      const needsMoreInfo = needsMoreInfoFromLlmPayload(normalized);
      const validation = validateLlmPlanPayload(normalized, {
        allowEmptyTasks: needsMoreInfo,
      });
      return { needsMoreInfo, validation };
    };

    let normalized = coerceLlmPlanPayload(plannerResponse.rawJson);
    let { needsMoreInfo, validation } = runValidate(normalized);

    if (!validation.valid && correctionEnabled) {
      correctionUsed = true;
      plannerResponse = await options.llmPlanner({
        background: request.background,
        domainHint: request.domainHint,
        traceId,
        correction: {
          previousRawJson: stringifyForCorrection(plannerResponse.rawJson),
          validationErrors: validation.errors,
        },
      });
      activeTrace = { ...plannerResponse.trace, traceId };
      normalized = coerceLlmPlanPayload(plannerResponse.rawJson);
      ({ needsMoreInfo, validation } = runValidate(normalized));
    }

    if (!validation.valid) {
      return {
        status: "GENERATION_FAILED",
        reason: validation.errors.join("; "),
        recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
        trace: activeTrace,
        missingFields: inputQuality.missingFields,
      };
    }

    const classification = normalized.classification;
    let capaAdvisory =
      classification.domain === "QUALITY" ? normalized.capaAdvisory : undefined;
    capaAdvisory = ensureCapaDisclaimer(capaAdvisory);

    if (needsMoreInfo) {
      return {
        status: "NEEDS_MORE_INFO",
        questions: normalized.openQuestions,
        missingFields: classification.missingInformation,
      };
    }

    const tasks = normalized.tasks;
    const openQuestions = [...normalized.openQuestions];

    const gate = validateDemoGate(tasks);
    validateGateSelfCheckConsistency(normalized.gateSelfCheck, gate);
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
        trace: activeTrace,
        correctionUsed,
      },
    };
  } catch (error) {
    return {
      status: "GENERATION_FAILED",
      reason: error instanceof Error ? error.message : "unknown_error",
      recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
      trace: buildFallbackTrace(error, traceId),
      missingFields: inputQuality.missingFields,
    };
  }
}

function stringifyForCorrection(rawJson: unknown): string {
  try {
    return JSON.stringify(rawJson, null, 2);
  } catch {
    return String(rawJson);
  }
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

function validateGateSelfCheckConsistency(
  selfCheck: LlmPlanPayload["gateSelfCheck"],
  gate: DemoGateResult
): void {
  if (!selfCheck) return;
  if (selfCheck.passed !== gate.passed) {
    throw new Error("gateSelfCheck is inconsistent with dispatch gate result");
  }
}
