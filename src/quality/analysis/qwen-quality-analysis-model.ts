import {
  QwenCompatibleClient,
  type CallWithToolsResult,
  type QwenCompatibleClientConfig,
} from "../../agent/demo/qwen-compatible-client";
import { normalizeModelPolicy } from "../../agent/demo/model-policy";
import {
  QUALITY_ANALYSIS_MODEL_CONFIG_ID,
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  type QualityAnalysisInput,
} from "./quality-analysis-contracts";
import { buildQualityAnalysisMessages } from "./quality-analysis-prompt";

export interface QualityAnalysisModelResponse {
  payload: unknown;
  rawContent: string;
  trace: CallWithToolsResult["trace"];
  timing: CallWithToolsResult["timing"];
  messages: ReturnType<typeof buildQualityAnalysisMessages>;
}

export interface QualityAnalysisModelAdapter {
  generate(input: QualityAnalysisInput): Promise<QualityAnalysisModelResponse>;
}

export interface QwenQualityAnalysisConfig {
  modelConfigId: typeof QUALITY_ANALYSIS_MODEL_CONFIG_ID;
  clientConfig: QwenCompatibleClientConfig;
}

function envText(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function envNumber(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = Number(envText(env, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envBool(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = envText(env, name)?.toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no"].includes(raw)) return false;
  if (["1", "true", "yes"].includes(raw)) return true;
  return fallback;
}

export function loadQwenQualityAnalysisConfig(
  env: Record<string, string | undefined> = process.env,
): QwenQualityAnalysisConfig | undefined {
  const apiKey = envText(env, "QWEN_API_KEY") ?? envText(env, "DASHSCOPE_API_KEY");
  if (!apiKey) return undefined;
  const qualityTimeoutMs = Math.max(envNumber(
    env,
    "QUALITY_ANALYSIS_QWEN_TIMEOUT_MS",
    envNumber(env, "QWEN_TIMEOUT_MS", 120_000),
  ), 120_000);
  const policy = normalizeModelPolicy({
    model: envText(env, "QWEN_MODEL"),
    temperature: 0,
    maxTokens: envNumber(env, "QWEN_MAX_TOKENS", 8_000),
    timeoutMs: qualityTimeoutMs,
    maxRetries: envNumber(env, "QWEN_MAX_RETRIES", 1),
    requestBudgetTokens: envNumber(env, "QWEN_REQUEST_BUDGET_TOKENS", 16_000),
  });
  return {
    modelConfigId: QUALITY_ANALYSIS_MODEL_CONFIG_ID,
    clientConfig: {
      baseUrl: envText(env, "QWEN_BASE_URL")
        ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey,
      model: policy.model,
      timeoutMs: policy.timeoutMs,
      maxRetries: policy.maxRetries,
      temperature: 0,
      maxTokens: Math.min(policy.maxTokens, policy.requestBudgetTokens),
      stream: envBool(env, "QWEN_STREAM", true),
      thinking: envBool(env, "QWEN_THINKING", true),
    },
  };
}

function enrichModelPayload(input: QualityAnalysisInput, payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const raw = payload as Record<string, unknown>;
  return {
    ...raw,
    schemaVersion: QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
    requestId: input.runMetadata.requestId,
    confirmedCategoryReference:
      input.ruleContext.confirmedCategoryReadOnly ?? "未提供人工确认分类",
  };
}

export class QwenQualityAnalysisModel implements QualityAnalysisModelAdapter {
  private readonly client: QwenCompatibleClient;

  constructor(private readonly config: QwenQualityAnalysisConfig) {
    this.client = new QwenCompatibleClient(config.clientConfig);
  }

  async generate(input: QualityAnalysisInput): Promise<QualityAnalysisModelResponse> {
    if (input.runMetadata.modelConfigId !== this.config.modelConfigId) {
      throw new Error("质量初析模型配置编号不一致");
    }
    const messages = buildQualityAnalysisMessages(input);
    const result = await this.client.callWithTools({
      traceId: input.runMetadata.requestId,
      messages,
      tools: [],
      toolHandlers: {},
      maxIterations: 1,
      maxToolCalls: 0,
      maxTotalMs: this.config.clientConfig.timeoutMs,
      maxTotalTokens: Math.max(16_000, this.config.clientConfig.maxTokens * 2),
    });
    if (result.toolCallsExecuted !== 0) throw new Error("质量初析禁止工具调用");
    return {
      payload: enrichModelPayload(input, result.payload),
      rawContent: result.rawContent,
      trace: result.trace,
      timing: result.timing,
      messages,
    };
  }
}
