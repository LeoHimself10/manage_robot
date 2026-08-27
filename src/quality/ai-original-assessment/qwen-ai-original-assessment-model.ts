import {
  QwenCompatibleClient,
  type CallWithToolsResult,
  type QwenCompatibleClientConfig,
} from "../../agent/demo/qwen-compatible-client";
import { normalizeModelPolicy } from "../../agent/demo/model-policy";
import {
  AI_ORIGINAL_ASSESSMENT_OUTPUT_SCHEMA_VERSION,
  type AiOriginalAssessmentInput,
} from "./ai-original-assessment-contracts";
import {
  buildAiOriginalAssessmentV0Messages,
  type AiOriginalAssessmentPromptMessage,
} from "./ai-original-assessment-v0-prompt";
import { AI_ORIGINAL_ASSESSMENT_V0_MODEL_CONFIG_ID } from
  "./ai-original-assessment-v0-context";

export interface AiOriginalAssessmentModelRequest {
  input: AiOriginalAssessmentInput;
}

export interface AiOriginalAssessmentModelResponse {
  payload: unknown;
  rawContent: string;
  messages: AiOriginalAssessmentPromptMessage[];
  trace: CallWithToolsResult["trace"];
  toolCallsExecuted: number;
}

export interface AiOriginalAssessmentModelAdapter {
  generate(request: AiOriginalAssessmentModelRequest): Promise<AiOriginalAssessmentModelResponse>;
}

export interface QwenAiOriginalAssessmentConfig {
  modelConfigId: string;
  clientConfig: QwenCompatibleClientConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HANDLING_RECOMMENDATIONS = new Set([
  "ORDINARY",
  "NEEDS_INFO",
  "QUALITY_ANOMALY",
]);

/**
 * Qwen occasionally copies the OTHER_UNCLEAR secondary category into the
 * handling field even though the semantic choice is unambiguous. Correct only
 * those two exact, policy-defined pairs. Every other invalid value still fails
 * the normal output validator; this is not a general schema-coercion escape.
 */
function normalizeUnambiguousHandlingRecommendation(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const handling = String(payload.handlingRecommendation ?? "").trim();
  if (HANDLING_RECOMMENDATIONS.has(handling)) return payload;
  const primary = String(payload.primaryCategoryCode ?? "").trim();
  const secondary = String(payload.secondaryCategoryCode ?? "").trim();
  if (primary !== "OTHER_UNCLEAR" || handling !== secondary) return payload;
  if (secondary === "OTHER_GENERAL") {
    return { ...payload, handlingRecommendation: "ORDINARY" };
  }
  if (secondary === "INSUFFICIENT_INFO") {
    return { ...payload, handlingRecommendation: "NEEDS_INFO" };
  }
  return payload;
}

/**
 * 这些字段由服务端输入唯一决定，不再让模型消耗token重复抄写。
 * 业务字段仍由模型生成，随后继续通过原有完整Schema与业务校验。
 */
export function enrichAiOriginalAssessmentModelPayload(
  input: AiOriginalAssessmentInput,
  payload: unknown,
): unknown {
  if (!isRecord(payload)) return payload;
  const normalizedPayload = normalizeUnambiguousHandlingRecommendation(payload);
  const {
    schemaVersion: _ignoredSchemaVersion,
    requestId: _ignoredRequestId,
    provenance: _ignoredProvenance,
    ...businessPayload
  } = normalizedPayload;
  return {
    schemaVersion: AI_ORIGINAL_ASSESSMENT_OUTPUT_SCHEMA_VERSION,
    requestId: input.runMetadata.requestId,
    ...businessPayload,
    provenance: {
      modelConfigId: input.runMetadata.modelConfigId,
      promptVersion: input.runMetadata.promptVersion,
      categoryDictionaryVersion: input.categoryDictionary.version,
      caseLibraryVersion: input.runMetadata.caseLibraryVersion,
    },
  };
}

function readNonEmptyEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function readPositiveNumber(
  env: Record<string, string | undefined>,
  name: string,
): number | undefined {
  const raw = readNonEmptyEnv(env, name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function loadQwenAiOriginalAssessmentConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): QwenAiOriginalAssessmentConfig | undefined {
  const apiKey = readNonEmptyEnv(env, "DASHSCOPE_API_KEY")
    ?? readNonEmptyEnv(env, "QWEN_API_KEY");
  if (!apiKey) return undefined;
  const policy = normalizeModelPolicy({
    model: readNonEmptyEnv(env, "QWEN_MODEL"),
    temperature: 0,
    maxTokens: readPositiveNumber(env, "QWEN_MAX_TOKENS"),
    timeoutMs: readPositiveNumber(env, "QWEN_TIMEOUT_MS"),
    maxRetries: 0,
    requestBudgetTokens: readPositiveNumber(env, "QWEN_REQUEST_BUDGET_TOKENS"),
  });

  return {
    modelConfigId: AI_ORIGINAL_ASSESSMENT_V0_MODEL_CONFIG_ID,
    clientConfig: {
      baseUrl: readNonEmptyEnv(env, "QWEN_BASE_URL")
        ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey,
      model: policy.model,
      timeoutMs: policy.timeoutMs,
      maxRetries: 0,
      temperature: 0,
      maxTokens: Math.min(policy.maxTokens, policy.requestBudgetTokens),
      stream: false,
      thinking: false,
    },
  };
}

export class QwenAiOriginalAssessmentModel implements AiOriginalAssessmentModelAdapter {
  private readonly client: QwenCompatibleClient;

  constructor(private readonly config: QwenAiOriginalAssessmentConfig) {
    this.client = new QwenCompatibleClient(config.clientConfig);
  }

  async generate(
    request: AiOriginalAssessmentModelRequest,
  ): Promise<AiOriginalAssessmentModelResponse> {
    if (request.input.runMetadata.modelConfigId !== this.config.modelConfigId) {
      throw new Error(
        `模型配置编号不一致，应为${this.config.modelConfigId}`,
      );
    }
    const messages = buildAiOriginalAssessmentV0Messages({
      assessmentInput: request.input,
    });
    const result = await this.client.callWithTools({
      traceId: request.input.runMetadata.requestId,
      messages,
      tools: [],
      toolHandlers: {},
      maxIterations: 1,
      maxToolCalls: 0,
      maxTotalMs: this.config.clientConfig.timeoutMs,
      // 紧凑提示仍保留完整27类候选；预算覆盖输入和受控输出即可。
      maxTotalTokens: Math.max(8_000, this.config.clientConfig.maxTokens * 2),
    });
    if (result.toolCallsExecuted !== 0) {
      throw new Error("AI原始研判V0禁止执行工具调用");
    }
    return {
      payload: enrichAiOriginalAssessmentModelPayload(request.input, result.payload),
      rawContent: result.rawContent,
      messages,
      trace: result.trace,
      toolCallsExecuted: result.toolCallsExecuted,
    };
  }
}
