import { CapaAdvisory, CAPA_DISCLAIMER } from "../../domain/capa";
import { coerceLlmPlanPayload, validateLlmPlanPayload } from "./llm-schema";
import { normalizeModelPolicy } from "./model-policy";
import {
  LlmPlannerRequest,
  LlmPlanResult,
  InferenceTrace,
  TokenUsage,
} from "./llm-types";
import {
  QwenCompatibleClient,
  QwenCompatibleClientConfig,
} from "./qwen-compatible-client";

export interface QwenPlannerConfig extends QwenCompatibleClientConfig {}

export async function runQwenPlanner(
  request: LlmPlannerRequest,
  config: QwenPlannerConfig
): Promise<LlmPlanResult> {
  const client = new QwenCompatibleClient(config);
  const response = await client.generateStructuredPlan(request);
  const payload = coerceLlmPlanPayload(response.payload, {
    domainHint: request.domainHint,
    background: request.background,
  });
  const validation = validateLlmPlanPayload(payload);
  if (!validation.valid) {
    throw new Error(`Qwen payload schema validation failed: ${validation.errors.join("; ")}`);
  }

  const capaAdvisory =
    payload.classification.domain === "QUALITY"
      ? ensureCapaDisclaimer(payload.capaAdvisory!)
      : undefined;

  return {
    classification: payload.classification,
    capaAdvisory,
    tasks: payload.tasks,
    openQuestions: payload.openQuestions,
    trace: response.trace,
  };
}

export function loadQwenPlannerConfigFromEnv():
  | QwenPlannerConfig
  | undefined {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) return undefined;

  const policy = normalizeModelPolicy({
    model: process.env.QWEN_MODEL,
    temperature: Number(process.env.QWEN_TEMPERATURE ?? 0.2),
    maxTokens: Number(process.env.QWEN_MAX_TOKENS ?? 2500),
    timeoutMs: Number(process.env.QWEN_TIMEOUT_MS ?? 20000),
    maxRetries: Number(process.env.QWEN_MAX_RETRIES ?? 1),
    requestBudgetTokens: Number(process.env.QWEN_REQUEST_BUDGET_TOKENS ?? 12000),
  });
  const cappedMaxTokens = Math.min(policy.maxTokens, policy.requestBudgetTokens);

  return {
    baseUrl:
      process.env.QWEN_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
    model: policy.model,
    timeoutMs: policy.timeoutMs,
    maxRetries: policy.maxRetries,
    temperature: policy.temperature,
    maxTokens: cappedMaxTokens,
  };
}

export function buildFallbackTrace(error: unknown): InferenceTrace {
  return {
    requestId: `error_${Date.now()}`,
    model: process.env.QWEN_MODEL ?? "qwen-plus",
    tokenUsage: zeroTokenUsage(),
    latencyMs: 0,
    errorCode: error instanceof Error ? error.message : "unknown_error",
  };
}

function zeroTokenUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function ensureCapaDisclaimer(capaAdvisory: CapaAdvisory): CapaAdvisory {
  return {
    ...capaAdvisory,
    disclaimer: capaAdvisory.disclaimer.trim() || CAPA_DISCLAIMER,
  };
}
