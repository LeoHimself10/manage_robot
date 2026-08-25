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

export class QualityAnalysisModelCallError extends Error {
  readonly code: "MODEL_TIMEOUT" | "MODEL_CALL_FAILED";
  readonly model: string;
  readonly durationMs: number;

  constructor(input: {
    code: "MODEL_TIMEOUT" | "MODEL_CALL_FAILED";
    model: string;
    durationMs: number;
    cause: unknown;
  }) {
    const reason = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(reason, { cause: input.cause });
    this.name = "QualityAnalysisModelCallError";
    this.code = input.code;
    this.model = input.model;
    this.durationMs = input.durationMs;
  }
}

function envText(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function envNumber(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = Number(envText(env, name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadQwenQualityAnalysisConfig(
  env: Record<string, string | undefined> = process.env,
): QwenQualityAnalysisConfig | undefined {
  const apiKey = envText(env, "QWEN_API_KEY") ?? envText(env, "DASHSCOPE_API_KEY");
  if (!apiKey) return undefined;
  const qualityTimeoutMs = envNumber(
    env,
    "QUALITY_ANALYSIS_QWEN_TIMEOUT_MS",
    envNumber(env, "QWEN_TIMEOUT_MS", 60_000),
  );
  const qualityMaxTokens = Math.min(
    envNumber(env, "QUALITY_ANALYSIS_QWEN_MAX_TOKENS", 3_500),
    4_000,
  );
  const policy = normalizeModelPolicy({
    model: envText(env, "QWEN_MODEL"),
    temperature: 0,
    maxTokens: qualityMaxTokens,
    timeoutMs: qualityTimeoutMs,
    maxRetries: 0,
    requestBudgetTokens: Math.max(8_000, qualityMaxTokens * 2),
  });
  return {
    modelConfigId: QUALITY_ANALYSIS_MODEL_CONFIG_ID,
    clientConfig: {
      baseUrl: envText(env, "QWEN_BASE_URL")
        ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey,
      model: policy.model,
      timeoutMs: policy.timeoutMs,
      maxRetries: 0,
      temperature: 0,
      maxTokens: policy.maxTokens,
      stream: false,
      thinking: false,
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
    const startedAt = Date.now();
    let result: Awaited<ReturnType<QwenCompatibleClient["generateJson"]>>;
    try {
      result = await this.client.generateJson({
        traceId: input.runMetadata.requestId,
        messages,
        maxRetries: 0,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new QualityAnalysisModelCallError({
        code: /请求超时|\btimeout\b/i.test(reason) ? "MODEL_TIMEOUT" : "MODEL_CALL_FAILED",
        model: this.config.clientConfig.model,
        durationMs: Date.now() - startedAt,
        cause: error,
      });
    }
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
