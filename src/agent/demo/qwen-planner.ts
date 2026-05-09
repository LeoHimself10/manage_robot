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
    maxTokens: readNumberEnv("QWEN_MAX_TOKENS", 4000),
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
    /** 默认开启 SSE 拼装；`QWEN_STREAM=0|false|no` 时改为单次整包响应 */
    stream: readQwenStreamEnabled(),
    /** Qwen3 thinking 默认开启；`QWEN_THINKING=0|false|no` 时关闭 */
    thinking: readQwenThinkingEnabled(),
  };
}

/** 默认 true（Qwen3 thinking 提升推理质量）；`QWEN_THINKING=0|false|no` 时关闭 */
function readQwenThinkingEnabled(): boolean {
  const v = process.env.QWEN_THINKING?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

/** 默认 true；仅当 `QWEN_STREAM` 为 0 / false / no 时关闭 */
function readQwenStreamEnabled(): boolean {
  const v = process.env.QWEN_STREAM?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
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
