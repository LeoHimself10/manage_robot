import { PlanDomain } from "../harness/types";
import type { LlmCorrectionContext } from "./llm-types";
import { LlmPlanPayload, InferenceTrace, TokenUsage } from "./llm-types";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "./qwen-prompt";

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
  traceId?: string;
  correction?: LlmCorrectionContext;
  sessionDigest?: string;
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
            traceId: request.traceId,
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
        await sleepWithJitter(attempt);
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
              content: buildQwenPlannerSystemPrompt(),
            },
            {
              role: "user",
              content: buildQwenPlannerUserPrompt(request),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const detail = errorBody ? `: ${truncateErrorBody(errorBody)}` : "";
        throw new Error(`Qwen API failed: ${response.status}${detail}`);
      }
      return (await response.json()) as ChatCompletionResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

function truncateErrorBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
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

export function sleepWithJitter(
  attempt: number,
  baseMs = 200,
  capMs = 5000
): Promise<void> {
  const exponential = Math.min(capMs, baseMs * Math.pow(2, attempt));
  const jittered = exponential * (0.75 + Math.random() * 0.5);
  return new Promise((resolve) => setTimeout(resolve, jittered));
}
