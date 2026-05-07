import { PlanDomain } from "../harness/types";
import { LlmPlanPayload, InferenceTrace, TokenUsage } from "./llm-types";

export interface QwenCompatibleClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
}

export interface GenerateStructuredPlanRequest {
  background: string;
  domainHint?: PlanDomain;
}

export interface GenerateStructuredPlanResult {
  payload: LlmPlanPayload;
  trace: InferenceTrace;
  rawContent: string;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
}

export class QwenCompatibleClient {
  constructor(private readonly config: QwenCompatibleClientConfig) {}

  async generateStructuredPlan(
    request: GenerateStructuredPlanRequest
  ): Promise<GenerateStructuredPlanResult> {
    let lastError: unknown = null;
    const startedAt = Date.now();
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        const response = await this.callChatCompletions(request);
        const content = extractAssistantContent(response);
        const payload = parseAssistantJsonPayload(content) as LlmPlanPayload;
        return {
          payload,
          rawContent: content,
          trace: {
            requestId: response.id ?? `req_${Date.now()}`,
            model: response.model ?? this.config.model,
            tokenUsage: toTokenUsage(response),
            latencyMs: Date.now() - startedAt,
          },
        };
      } catch (error) {
        lastError = error;
        if (attempt === this.config.maxRetries) {
          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Qwen request failed after retries");
  }

  private async callChatCompletions(
    request: GenerateStructuredPlanRequest
  ): Promise<ChatCompletionResponse> {
    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: {
            type: "json_object",
          },
          messages: [
            {
              role: "system",
              content:
                [
                  "你是任务规划助手，请仅输出 JSON，不要输出解释文字。",
                  "JSON 顶层字段必须为 classification、tasks、openQuestions，可选 capaAdvisory。",
                  "classification 必须是对象：{domain, subtype, confidence, rationale, missingInformation}。",
                  "tasks 必须是数组，元素字段：id,title,objective,collaborators,inputMaterials,actions,deliverables,completionCriteria,timeNode,feedbackFrequency,risksAndOpenQuestions,dependencyTaskIds。",
                  "timeNode 字段必须包含 checkpoints 和 dueAt。",
                ].join(" "),
            },
            {
              role: "user",
              content: [
                `domainHint: ${request.domainHint ?? "UNSPECIFIED"}`,
                "请基于以下背景生成结构化任务拆解：",
                request.background,
              ].join("\n"),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Qwen API failed: ${response.status}`);
      }
      return (await response.json()) as ChatCompletionResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseAssistantJsonPayload(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const normalized = (fenced ?? content).trim();
  return JSON.parse(normalized);
}

function extractAssistantContent(response: ChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error("Qwen API returned empty assistant content");
  }
  return content;
}

function toTokenUsage(response: ChatCompletionResponse): TokenUsage {
  return {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
}
