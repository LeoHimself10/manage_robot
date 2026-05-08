import { normalizeModelPolicy } from "./model-policy";
import {
  LlmPlannerRequest,
  LlmPlannerResponse,
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
): Promise<LlmPlannerResponse> {
  const client = new QwenCompatibleClient(config);
  const response = await client.generateStructuredPlan({
    background: request.background,
    domainHint: request.domainHint,
    traceId: request.traceId,
    correction: request.correction,
    sessionDigest: request.sessionDigest,
  });
  return {
    rawJson: response.payload,
    trace: {
      ...response.trace,
      traceId: request.traceId ?? response.trace.traceId,
    },
  };
}

export function loadQwenPlannerConfigFromEnv():
  | QwenPlannerConfig
  | undefined {
  const apiKey = readNonEmptyEnv("QWEN_API_KEY");
  if (!apiKey) return undefined;

  const policy = normalizeModelPolicy({
    model: readNonEmptyEnv("QWEN_MODEL"),
    temperature: readNumberEnv("QWEN_TEMPERATURE", 0.2),
    maxTokens: readNumberEnv("QWEN_MAX_TOKENS", 2500),
    timeoutMs: readNumberEnv("QWEN_TIMEOUT_MS", 60000),
    maxRetries: readNumberEnv("QWEN_MAX_RETRIES", 1),
    requestBudgetTokens: readNumberEnv("QWEN_REQUEST_BUDGET_TOKENS", 12000),
  });
  const cappedMaxTokens = Math.min(policy.maxTokens, policy.requestBudgetTokens);

  return {
    baseUrl:
      readNonEmptyEnv("QWEN_BASE_URL") ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
    model: policy.model,
    timeoutMs: policy.timeoutMs,
    maxRetries: policy.maxRetries,
    temperature: policy.temperature,
    maxTokens: cappedMaxTokens,
  };
}

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = readNonEmptyEnv(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildFallbackTrace(
  error: unknown,
  traceId?: string
): InferenceTrace {
  return {
    traceId,
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
