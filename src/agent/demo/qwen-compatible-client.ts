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
  /** OpenAI-compatible SSE；拼满 assistant content 后再 JSON.parse（钉钉终稿仍为完整一条） */
  stream?: boolean;
  /** 仅在 stream=true 时：每收到可解析的 SSE 片段后回调（由调用方节流/脱敏） */
  streamHooks?: {
    onAssistantDelta?: (assembledContent: string) => void;
  };
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

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface CallWithToolsRequest {
  traceId?: string;
  messages: Array<{ role: string; content?: string; tool_call_id?: string; tool_calls?: unknown[] }>;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  /** v0.2: default 1 (single tool_call, then force JSON) */
  maxIterations?: number;
}

export interface CallWithToolsResult {
  payload: unknown;
  rawContent: string;
  trace: InferenceTrace;
  toolCallsExecuted: number;
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
    finish_reason?: string | null;
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

interface SseAssembledResponse {
  content: string;
  id?: string;
  model?: string;
  usage?: ChatCompletionResponse["usage"];
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

  private buildChatCompletionPayload(
    request: GenerateStructuredPlanRequest
  ): Record<string, unknown> {
    // 不显式传 OpenAI 兼容的 response_format：部分网关在与 SSE 同开时首 token / 整段延迟明显；
    // 结构化输出仅靠系统提示约束 + 下游 JSON 解析（含 ```json 围栏剥离）。
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
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
    };
    if (this.config.stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  private async postChatCompletions(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isLikelyFetchAbort(error)) {
        throw new Error(
          `Qwen 请求超时（已超过 ${this.config.timeoutMs} ms）。请在环境中增大 QWEN_TIMEOUT_MS（上限 120000），或略降 QWEN_MAX_TOKENS；若偶发可保留 QWEN_MAX_RETRIES>=1。`
        );
      }
      throw error;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const detail = errorBody ? `: ${truncateErrorBody(errorBody)}` : "";
      throw new Error(`Qwen API failed: ${response.status}${detail}`);
    }

    try {
      if ((body as { stream?: boolean }).stream) {
        if (!response.body) {
          throw new Error("Qwen stream response has no body");
        }
        const onDelta = this.config.streamHooks?.onAssistantDelta;
        const assembled = await readSseChatCompletionStream(
          response.body,
          onDelta ? (acc) => onDelta(acc.content) : undefined
        );
        return sseAssembledToChatResponse(assembled);
      }

      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      if (isLikelyFetchAbort(error)) {
        throw new Error(
          `Qwen 请求超时（已超过 ${this.config.timeoutMs} ms）。请在环境中增大 QWEN_TIMEOUT_MS（上限 120000），或略降 QWEN_MAX_TOKENS；若偶发可保留 QWEN_MAX_RETRIES>=1。`
        );
      }
      throw error;
    }
  }

  private async callChatCompletions(
    request: GenerateStructuredPlanRequest
  ): Promise<ChatCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await this.postChatCompletions(
        this.buildChatCompletionPayload(request),
        controller.signal
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async callWithTools(
    request: CallWithToolsRequest
  ): Promise<CallWithToolsResult> {
    const maxIterations = request.maxIterations ?? 1;
    if (maxIterations !== 1) {
      throw new Error(
        `v0.2 only supports maxIterations=1, got ${maxIterations}`
      );
    }

    let lastError: unknown = null;
    const startedAt = Date.now();
    let accumulatedUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        const currentMessages: Array<Record<string, unknown>> =
          request.messages.map((m) => ({ ...m }));
        let toolCallsExecuted = 0;
        let iterations = 0;

        // Round 1: send with tools
        const body0: Record<string, unknown> = {
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          messages: currentMessages,
          tools: request.tools.map((t) => ({
            type: t.type,
            function: {
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            },
          })),
        };

        const ctrl0 = new AbortController();
        const timer0 = setTimeout(
          () => ctrl0.abort(),
          this.config.timeoutMs
        );
        let resp0: ChatCompletionResponse;
        try {
          resp0 = await this.postChatCompletions(body0, ctrl0.signal);
        } finally {
          clearTimeout(timer0);
        }

        accumulatedUsage = accumulateTokenUsage(
          accumulatedUsage,
          resp0.usage
        );

        const msg0 = resp0.choices?.[0]?.message;

        // If no tool_calls, direct JSON response
        if (!msg0?.tool_calls || msg0.tool_calls.length === 0) {
          const content0 = extractAssistantContent(resp0);
          const payload0 = parseAssistantJsonPayload(content0);
          return {
            payload: payload0,
            rawContent: content0,
            trace: {
              traceId: request.traceId,
              requestId: resp0.id ?? `req_${Date.now()}`,
              model: resp0.model ?? this.config.model,
              tokenUsage: accumulatedUsage,
              latencyMs: Date.now() - startedAt,
            },
            toolCallsExecuted: 0,
          };
        }

        // Handle tool calls
        currentMessages.push({
          role: "assistant",
          tool_calls: msg0.tool_calls,
        });

        for (const tc of msg0.tool_calls) {
          const handler = request.toolHandlers[tc.function.name];
          if (!handler) {
            throw new Error(
              `No handler for tool: ${tc.function.name}`
            );
          }

          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(
              tc.function.arguments
            ) as Record<string, unknown>;
          } catch {
            throw new Error(
              `Invalid JSON in tool_call arguments for ${tc.function.name}: ${tc.function.arguments}`
            );
          }

          const result = await handler(parsedArgs);
          currentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
          toolCallsExecuted++;
        }

        iterations++;

        // Round 2: force JSON output with response_format
        const body1: Record<string, unknown> = {
          model: this.config.model,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          messages: currentMessages,
          response_format: { type: "json_object" },
        };

        const ctrl1 = new AbortController();
        const timer1 = setTimeout(
          () => ctrl1.abort(),
          this.config.timeoutMs
        );
        let resp1: ChatCompletionResponse;
        try {
          resp1 = await this.postChatCompletions(body1, ctrl1.signal);
        } finally {
          clearTimeout(timer1);
        }

        accumulatedUsage = accumulateTokenUsage(
          accumulatedUsage,
          resp1.usage
        );

        const msg1 = resp1.choices?.[0]?.message;
        if (msg1?.tool_calls && msg1.tool_calls.length > 0) {
          throw new Error(
            `v0.2 limit: tool_calls returned at last iteration (${iterations})`
          );
        }

        const content1 = extractAssistantContent(resp1);
        const payload1 = parseAssistantJsonPayload(content1);

        return {
          payload: payload1,
          rawContent: content1,
          trace: {
            traceId: request.traceId,
            requestId: resp1.id ?? `req_${Date.now()}`,
            model: resp1.model ?? this.config.model,
            tokenUsage: accumulatedUsage,
            latencyMs: Date.now() - startedAt,
          },
          toolCallsExecuted,
        };
      } catch (error) {
        // Do not retry tool-related errors (programming errors)
        if (
          error instanceof Error &&
          (error.message.startsWith("No handler for tool") ||
            error.message.startsWith(
              "Invalid JSON in tool_call arguments"
            ) ||
            error.message.startsWith("v0.2 limit"))
        ) {
          throw error;
        }
        lastError = error;
        if (attempt === this.config.maxRetries) break;
        await sleepWithJitter(attempt);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Qwen callWithTools failed after retries");
  }
}

/** 供单测拼装假 SSE；与流式读取逻辑共用解析规则 */
export function assembleSseTextForTest(sseText: string): SseAssembledResponse {
  const acc = emptySseAssembly();
  for (const raw of sseText.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line.startsWith("data:")) continue;
    ingestSseDataLine(line.slice(5).trim(), acc);
  }
  return acc;
}

function emptySseAssembly(): SseAssembledResponse {
  return { content: "" };
}

function ingestSseDataLine(dataPayload: string, acc: SseAssembledResponse): void {
  if (dataPayload === "[DONE]") return;
  try {
    const json = JSON.parse(dataPayload) as {
      id?: string;
      model?: string;
      usage?: ChatCompletionResponse["usage"];
      choices?: Array<{ delta?: { content?: string } }>;
    };
    if (json.id) acc.id = json.id;
    if (json.model) acc.model = json.model;
    if (json.usage) acc.usage = json.usage;
    const piece = json.choices?.[0]?.delta?.content;
    if (piece) acc.content += piece;
  } catch {
    /* 忽略单行损坏 */
  }
}

async function readSseChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (acc: SseAssembledResponse) => void
): Promise<SseAssembledResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const acc = emptySseAssembly();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const i = buf.indexOf("\n");
        if (i < 0) break;
        const line = buf.slice(0, i).replace(/\r$/, "").trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        ingestSseDataLine(line.slice(5).trim(), acc);
        onDelta?.(acc);
      }
    }
    const tail = buf.replace(/\r$/, "").trim();
    if (tail.startsWith("data:")) {
      ingestSseDataLine(tail.slice(5).trim(), acc);
      onDelta?.(acc);
    }
  } finally {
    reader.releaseLock();
  }
  return acc;
}

function sseAssembledToChatResponse(a: SseAssembledResponse): ChatCompletionResponse {
  return {
    id: a.id,
    model: a.model,
    usage: a.usage,
    choices: [
      {
        finish_reason: "stop",
        message: { content: a.content },
      },
    ],
  };
}

function isLikelyFetchAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return /aborted/i.test(error.message);
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

function accumulateTokenUsage(
  acc: TokenUsage,
  usage?: ChatCompletionResponse["usage"]
): TokenUsage {
  return {
    promptTokens: acc.promptTokens + (usage?.prompt_tokens ?? 0),
    completionTokens: acc.completionTokens + (usage?.completion_tokens ?? 0),
    totalTokens: acc.totalTokens + (usage?.total_tokens ?? 0),
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
