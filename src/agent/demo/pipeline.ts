import { randomUUID } from "node:crypto";

import type { CapaAdvisory } from "../../domain/capa";
import { CAPA_DISCLAIMER } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { checkInputQuality } from "./input-qc";
import {
  coerceLlmPlanPayload,
  needsMoreInfoFromLlmPayload,
  validateLlmPlanPayload,
} from "./llm-schema";
import type { ClarificationUxKind, DemoGenerationMetadata, ResponseIntent } from "./llm-types";
import {
  InferenceTrace,
  LlmGateSelfCheck,
  LlmPlanPayload,
  LlmPlannerRequest,
  LlmPlannerResponse,
} from "./llm-types";
import { appendDemoRunAudit } from "../../infra/demo-run-audit";
import { logStructured } from "../../infra/logger";
import { redactCommonPii } from "../../infra/content-filter";
import { savePlanSnapshot } from "../../infra/plan-store";
import { renderPlanDraftMarkdown } from "./markdown-renderer";
import { buildFallbackTrace } from "./qwen-planner";

export type { DemoGenerationMetadata };

export interface TaskPlanningDemoRequest {
  domainHint?: PlanDomain;
  background: string;
  /** DingTalk/session continuity snippet; forwarded to llmPlanner only. */
  sessionDigest?: string;
}

export interface TaskPlanningDemoOptions {
  llmPlanner: (request: LlmPlannerRequest) => Promise<LlmPlannerResponse>;
  /**
   * When true (default), after a failed structural validation the pipeline calls the planner
   * once more with validation errors and the previous JSON for self-correction.
   */
  enableLlmCorrection?: boolean;
}

const LLM_FAILURE_RECOVERY_SUGGESTIONS = [
  "检查 QWEN_API_KEY、网络与模型配额后重试。",
  "若错误与输出格式有关，可联系管理员更新提示词或 Schema 约束。",
  "确认已通过 llmPlanner 调用模型，且输出满足 classification/capa（质量域）/tasks 等字段约束。",
] as const;

const MISSING_PLANNER_MESSAGE =
  "未提供 llmPlanner：基于规则的分类与 WBS 模板已移除，必须通过模型生成草案。";

const DRAFT_INTENTS = new Set<ResponseIntent>(["DRAFT", "REVISE_DRAFT"]);

function isDraftIntent(intent: ResponseIntent): intent is "DRAFT" | "REVISE_DRAFT" {
  return DRAFT_INTENTS.has(intent);
}

export type TaskPlanningDemoResult =
  | {
      status: "NEEDS_MORE_INFO";
      traceId: string;
      questions: string[];
      missingFields: string[];
      /** 模型标记：寒暄/非任务(NON_TASK) vs 任务信息缺口(TASK_GAP)；渠道文案以 openQuestions 为准 */
      clarificationUx?: ClarificationUxKind;
      markdown?: undefined;
      classification?: undefined;
      capaAdvisory?: undefined;
      tasks?: undefined;
      gate?: undefined;
      generation?: undefined;
    }
  | {
      status: "CONVERSATION";
      traceId: string;
      responseIntent: Exclude<ResponseIntent, "DRAFT" | "REVISE_DRAFT">;
      assistantMessage: string;
      questions: string[];
      missingFields: string[];
      clarificationUx?: ClarificationUxKind;
      markdown?: undefined;
      classification?: ClassificationResult;
      capaAdvisory?: CapaAdvisory;
      tasks?: undefined;
      gate?: undefined;
      generation?: DemoGenerationMetadata;
    }
  | {
      status: "GENERATION_FAILED";
      traceId: string;
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
      traceId: string;
      responseIntent: "DRAFT" | "REVISE_DRAFT";
      assistantMessage: string;
      questions: string[];
      missingFields: string[];
      classification: ClassificationResult;
      capaAdvisory?: CapaAdvisory;
      tasks: TaskPackage[];
      gate: LlmGateSelfCheck;
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

function sumTokenTotals(traces: InferenceTrace[]): number {
  return traces.reduce((acc, t) => acc + (t.tokenUsage?.totalTokens ?? 0), 0);
}

export async function createTaskPlanningDemo(
  request: TaskPlanningDemoRequest,
  options: TaskPlanningDemoOptions
): Promise<TaskPlanningDemoResult> {
  const traceId = randomUUID();
  const auditWallStart = performance.now();
  const auditWallMs = () => Math.round(performance.now() - auditWallStart);

  const inputQuality = checkInputQuality(request);
  const correctionEnabled = options.enableLlmCorrection !== false;

  if (!inputQuality.canGenerateWbs) {
    appendDemoRunAudit({
      traceId,
      status: "NEEDS_MORE_INFO",
      reason: "thin_input_or_qc_blocked",
      wallClockMs: auditWallMs(),
    });
    return {
      status: "NEEDS_MORE_INFO",
      traceId,
      questions: inputQuality.questions,
      missingFields: inputQuality.missingFields,
    };
  }

  if (typeof options?.llmPlanner !== "function") {
    appendDemoRunAudit({
      traceId,
      status: "GENERATION_FAILED",
      reason: MISSING_PLANNER_MESSAGE,
      wallClockMs: auditWallMs(),
    });
    return {
      status: "GENERATION_FAILED",
      traceId,
      reason: MISSING_PLANNER_MESSAGE,
      recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
      missingFields: inputQuality.missingFields,
    };
  }

  try {
    const traces: InferenceTrace[] = [];
    let plannerMs = 0;
    let coerceMs = 0;
    let validateMs = 0;

    const runValidate = (payload: LlmPlanPayload) => {
      const needsMoreInfo = needsMoreInfoFromLlmPayload(payload);
      const validation = validateLlmPlanPayload(payload, {
        allowEmptyTasks: !isDraftIntent(payload.responseIntent),
      });
      return { needsMoreInfo, validation };
    };

    const plannerStart1 = performance.now();
    let plannerResponse = await options.llmPlanner({
      background: request.background,
      domainHint: request.domainHint,
      traceId,
      sessionDigest: request.sessionDigest,
    });
    plannerMs += performance.now() - plannerStart1;
    let correctionUsed = false;
    const activeTraceFrom = (t: InferenceTrace): InferenceTrace => ({
      ...t,
      traceId,
    });
    let activeTrace: InferenceTrace = activeTraceFrom(plannerResponse.trace);
    traces.push(activeTrace);

    let c0 = performance.now();
    let normalized = coerceLlmPlanPayload(plannerResponse.rawJson);
    coerceMs += performance.now() - c0;
    let v0 = performance.now();
    let { validation } = runValidate(normalized);
    validateMs += performance.now() - v0;

    if (!validation.valid && correctionEnabled) {
      correctionUsed = true;
      const prevRaw = plannerResponse.rawJson;
      const plannerStart2 = performance.now();
      plannerResponse = await options.llmPlanner({
        background: request.background,
        domainHint: request.domainHint,
        traceId,
        sessionDigest: request.sessionDigest,
        correction: {
          previousRawJson: stringifyForCorrection(prevRaw),
          validationErrors: validation.errors,
        },
      });
      plannerMs += performance.now() - plannerStart2;
      activeTrace = activeTraceFrom(plannerResponse.trace);
      traces.push(activeTrace);
      c0 = performance.now();
      normalized = coerceLlmPlanPayload(plannerResponse.rawJson);
      coerceMs += performance.now() - c0;
      v0 = performance.now();
      ({ validation } = runValidate(normalized));
      validateMs += performance.now() - v0;
    }

    if (!validation.valid) {
      const reasonMsg = validation.errors.join("; ");
      appendDemoRunAudit({
        traceId,
        status: "GENERATION_FAILED",
        reason: reasonMsg.slice(0, 2000),
        tokenTotals: sumTokenTotals(traces),
        wallClockMs: auditWallMs(),
        timingsMs: { plannerMs, coerceMs, validateMs },
        correctionUsed,
      });
      return {
        status: "GENERATION_FAILED",
        traceId,
        reason: reasonMsg,
        recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
        trace: activeTrace,
        missingFields: inputQuality.missingFields,
      };
    }

    const classification = normalized.classification;
    let capaAdvisory =
      classification.domain === "QUALITY" ? normalized.capaAdvisory : undefined;
    capaAdvisory = ensureCapaDisclaimer(capaAdvisory);

    const responseIntent = normalized.responseIntent;
    if (!isDraftIntent(responseIntent)) {
      appendDemoRunAudit({
        traceId,
        status: "NEEDS_MORE_INFO",
        reason: `llm_response_intent_${responseIntent.toLowerCase()}`,
        tokenTotals: sumTokenTotals(traces),
        wallClockMs: auditWallMs(),
        timingsMs: { plannerMs, coerceMs, validateMs },
        correctionUsed,
      });
      return {
        status: "CONVERSATION",
        traceId,
        responseIntent,
        assistantMessage: normalized.assistantMessage,
        questions: normalized.openQuestions,
        missingFields: classification.missingInformation,
        clarificationUx: normalized.clarificationUx,
        classification,
        capaAdvisory,
        generation: {
          trace: activeTrace,
          traces,
          correctionUsed,
          timings: { plannerMs, coerceMs, validateMs, gateMs: 0, renderMs: 0 },
        },
      };
    }

    const tasks = normalized.tasks;
    const openQuestions = [...normalized.openQuestions];

    let gateMs = 0;
    const gateStart = performance.now();
    const gate: LlmGateSelfCheck =
      normalized.gateSelfCheck ?? { passed: true, missingByTask: [] };
    gateMs += performance.now() - gateStart;

    const mergedOpenQuestions = uniq([
      ...inputQuality.questions,
      ...classification.missingInformation,
      ...(capaAdvisory?.promptingQuestions ?? []),
      ...openQuestions,
    ]);
    let renderMs = 0;
    const renderStart = performance.now();
    let markdown = renderPlanDraftMarkdown({
      summary: request.background.trim(),
      classification,
      capaAdvisory,
      tasks,
      gate,
      openQuestions: mergedOpenQuestions,
    });
    markdown = redactCommonPii(markdown);
    renderMs += performance.now() - renderStart;

    const timings = {
      plannerMs,
      coerceMs,
      validateMs,
      gateMs,
      renderMs,
    };

    const tokenTotals = sumTokenTotals(traces);

    const wallClockMs = auditWallMs();
    logStructured({
      event: "demo_draft_ready",
      traceId,
      correctionUsed,
      timings,
      wallClockMs,
      tokenTotals,
      traceCount: traces.length,
      responseIntent,
      taskCount: tasks.length,
    });

    appendDemoRunAudit({
      traceId,
      status: "DRAFT_READY",
      gatePassed: gate.passed,
      tokenTotals,
      wallClockMs,
      timingsMs: timings,
      correctionUsed,
      skipTimingStdout: true,
    });

    savePlanSnapshot(traceId, {
      traceId,
      status: "DRAFT_READY",
      classification,
      capaAdvisory,
      tasks,
      gate,
      markdownCharCount: markdown.length,
      markdownPreview: markdown.slice(0, 6000),
    });

    return {
      status: "DRAFT_READY",
      traceId,
      responseIntent,
      assistantMessage: normalized.assistantMessage,
      questions: mergedOpenQuestions,
      missingFields: inputQuality.missingFields,
      classification,
      capaAdvisory,
      tasks,
      gate,
      markdown,
      generation: {
        trace: activeTrace,
        traces,
        correctionUsed,
        timings,
      },
    };
  } catch (error) {
    const trace = buildFallbackTrace(error, traceId);
    appendDemoRunAudit({
      traceId,
      status: "GENERATION_FAILED",
      reason:
        trace.errorCode ??
        (error instanceof Error ? error.message : "unknown_error").slice(0, 2000),
      tokenTotals: trace.tokenUsage.totalTokens,
      wallClockMs: auditWallMs(),
    });
    return {
      status: "GENERATION_FAILED",
      traceId,
      reason: error instanceof Error ? error.message : "unknown_error",
      recoverySuggestions: [...LLM_FAILURE_RECOVERY_SUGGESTIONS],
      trace,
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
