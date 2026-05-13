import { PlanDomain } from "../harness/types";
import type { LlmCorrectionContext } from "./llm-types";
import { LlmPlanPayload, InferenceTrace, TokenUsage } from "./llm-types";
import { logStructured } from "../../infra/logger";
import {
  buildLegacyDemoPlannerSystemPrompt,
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
  /** Qwen3 thinking mode（开启后在请求体中注入 extra_body.enable_thinking） */
  thinking?: boolean;
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
  maxTotalMs?: number;
  maxToolCalls?: number;
  maxTotalTokens?: number;
}

export interface CallWithToolsResult {
  payload: unknown;
  rawContent: string;
  trace: InferenceTrace;
  toolCallsExecuted: number;
  timing?: {
    totalMs: number;
    llmMsTotal: number;
    toolsMsTotal: number;
    parseMsTotal: number;
    iterations: Array<{
      iteration: number;
      llmMs: number;
      parseMs: number;
      toolsMs: number;
      toolCalls: number;
      totalMs: number;
      tools: Array<{
        toolName: string;
        elapsedMs: number;
      }>;
      afterHeadersMs?: number;
      firstBodyChunkMs?: number;
      firstSseDataLineMs?: number;
      firstAssistantTokenMs?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    }>;
  };
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
      /** Qwen3 thinking 模式下的思考过程；content 为空时可用作兜底 */
      reasoning_content?: string;
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

/** 相对同一次 LLM 调用的 `llmWallClockStart`（ms）的传输层观测，用于区分排队/TTFB vs 生成耗时 */
export interface LlmTransportTiming {
  /** 从 `llmWallClockStart` 到收到 HTTP Response headers 完毕 */
  afterHeadersMs: number;
  /** 从 `llmWallClockStart` 到 body 流上第一次 `reader.read()` 返回非空 chunk（近似 TTFB） */
  firstBodyChunkMs?: number;
  /** 从 `llmWallClockStart` 到解析到首条 `data:` SSE 行（不含 `[DONE]`） */
  firstSseDataLineMs?: number;
  /** 从 `llmWallClockStart` 到首条对 assistant 可见的 delta（content / reasoning / tool_calls 片段） */
  firstAssistantTokenMs?: number;
}

interface SseAssembledResponse {
  content: string;
  reasoningContent?: string;
  id?: string;
  model?: string;
  usage?: ChatCompletionResponse["usage"];
  /**
   * tool_calls 在 SSE 增量协议下按 index 累加：
   *   delta.tool_calls = [{ index, id?, function?: { name?, arguments? } }]
   * 同一 index 的多个 delta 需要拼接 function.arguments 字符串。
   */
  toolCalls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function: { name: string; arguments: string };
  }>;
  finishReason?: string;
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
          content: buildLegacyDemoPlannerSystemPrompt(),
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
    signal?: AbortSignal,
    llmWallClockStart?: number,
  ): Promise<{
    response: ChatCompletionResponse;
    transportTiming?: LlmTransportTiming;
  }> {
    const t0 = llmWallClockStart ?? Date.now();
    // Inject Qwen3 thinking if enabled
    if (this.config.thinking) {
      (body as Record<string, unknown>).extra_body = {
        ...((body as Record<string, unknown>).extra_body as Record<string, unknown> ?? {}),
        enable_thinking: true,
      };
    }
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

    const afterHeadersMs = Date.now() - t0;

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
        const { assembled, transportTail } = await readSseChatCompletionStream(
          response.body,
          onDelta ? (acc) => onDelta(acc.content) : undefined,
          t0,
        );
        return {
          response: sseAssembledToChatResponse(assembled),
          transportTiming: {
            afterHeadersMs,
            ...transportTail,
          },
        };
      }

      const json = (await response.json()) as ChatCompletionResponse;
      return {
        response: json,
        transportTiming: { afterHeadersMs },
      };
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
      const llmStart = Date.now();
      const { response } = await this.postChatCompletions(
        this.buildChatCompletionPayload(request),
        controller.signal,
        llmStart,
      );
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async callWithTools(
    request: CallWithToolsRequest
  ): Promise<CallWithToolsResult> {
    const maxIterations = request.maxIterations ?? 6;
    const maxTotalMs = request.maxTotalMs ?? Number(process.env.AGENT_MAX_TOTAL_MS ?? "120000");
    const maxToolCalls = request.maxToolCalls ?? Number(process.env.AGENT_MAX_TOOL_CALLS ?? "12");
    const maxTotalTokens =
      request.maxTotalTokens ?? Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "12000");

    let lastError: unknown = null;
    const startedAt = Date.now();
    let accumulatedUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let maxPromptTokensSeen = 0;
    let accumulatedCompletionTokens = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        const currentMessages: Array<Record<string, unknown>> =
          request.messages.map((m) => ({ ...m }));
        let toolCallsExecuted = 0;
        let iterations = 0;
        type IterationRow = NonNullable<CallWithToolsResult["timing"]>["iterations"][number];
        const iterationTimings: IterationRow[] = [];

        while (iterations < maxIterations) {
          if (Date.now() - startedAt > maxTotalMs) {
            throw new Error(`ReAct loop exceeded total time budget (${maxTotalMs}ms)`);
          }
          const iterationNo = iterations + 1;
          const iterationStartedAt = Date.now();
          const body: Record<string, unknown> = {
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
          if (this.config.stream) {
            body.stream = true;
            body.stream_options = { include_usage: true };
          }

          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
          const llmStartedAt = Date.now();
          let resp: ChatCompletionResponse;
          let transportTiming: LlmTransportTiming | undefined;
          try {
            const post = await this.postChatCompletions(body, ctrl.signal, llmStartedAt);
            resp = post.response;
            transportTiming = post.transportTiming;
          } finally {
            clearTimeout(timer);
          }
          const llmMs = Date.now() - llmStartedAt;

          const usage = resp.usage;
          const usageFields = {
            promptTokens: usage?.prompt_tokens,
            completionTokens: usage?.completion_tokens,
            totalTokens: usage?.total_tokens,
          };

          accumulatedUsage = accumulateTokenUsage(
            accumulatedUsage,
            resp.usage
          );
          maxPromptTokensSeen = Math.max(maxPromptTokensSeen, usage?.prompt_tokens ?? 0);
          accumulatedCompletionTokens += usage?.completion_tokens ?? 0;
          if (maxPromptTokensSeen + accumulatedCompletionTokens > maxTotalTokens) {
            throw new Error(`ReAct loop exceeded token budget (${maxTotalTokens})`);
          }

          const msg = resp.choices?.[0]?.message;
          const parseStartedAt = Date.now();
          let parseMs = 0;
          let toolsMs = 0;
          let toolCallsThisIteration = 0;
          const tools: Array<{ toolName: string; elapsedMs: number }> = [];

          // No tool_calls: return parsed JSON
          if (!msg?.tool_calls || msg.tool_calls.length === 0) {
            const content = extractAssistantContent(resp);
            const payload = parseAssistantJsonPayload(content);
            parseMs = Date.now() - parseStartedAt;
            const totalMs = Date.now() - iterationStartedAt;
            const row: IterationRow = {
              iteration: iterationNo,
              llmMs,
              parseMs,
              toolsMs,
              toolCalls: toolCallsThisIteration,
              totalMs,
              tools,
              afterHeadersMs: transportTiming?.afterHeadersMs,
              firstBodyChunkMs: transportTiming?.firstBodyChunkMs,
              firstSseDataLineMs: transportTiming?.firstSseDataLineMs,
              firstAssistantTokenMs: transportTiming?.firstAssistantTokenMs,
              ...usageFields,
            };
            iterationTimings.push(row);
            logStructured({
              event: "orchestrator_iteration_timing",
              traceId: request.traceId,
              stream: this.config.stream === true,
              ...row,
            });
            const llmMsTotal = iterationTimings.reduce((s, x) => s + x.llmMs, 0);
            const toolsMsTotal = iterationTimings.reduce((s, x) => s + x.toolsMs, 0);
            const parseMsTotal = iterationTimings.reduce((s, x) => s + x.parseMs, 0);
            return {
              payload,
              rawContent: content,
              trace: {
                traceId: request.traceId,
                requestId: resp.id ?? `req_${Date.now()}`,
                model: resp.model ?? this.config.model,
                tokenUsage: accumulatedUsage,
                latencyMs: Date.now() - startedAt,
              },
              toolCallsExecuted,
              timing: {
                totalMs: Date.now() - startedAt,
                llmMsTotal,
                toolsMsTotal,
                parseMsTotal,
                iterations: iterationTimings,
              },
            };
          }

          // Process tool_calls: push assistant msg + execute handlers + push tool results
          currentMessages.push({
            role: "assistant",
            tool_calls: msg.tool_calls,
            content: null,
          });

          const preparedCalls = msg.tool_calls.map((tc) => {
            const handler = request.toolHandlers[tc.function.name];
            if (!handler) {
              throw new Error(`No handler for tool: ${tc.function.name}`);
            }
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
            } catch {
              throw new Error(
                `Invalid JSON in tool_call arguments for ${tc.function.name}: ${tc.function.arguments}`
              );
            }
            return { tc, handler, parsedArgs };
          });
          parseMs = Date.now() - parseStartedAt;

          if (toolCallsExecuted + preparedCalls.length > maxToolCalls) {
            throw new Error(`ReAct loop exceeded tool call budget (${maxToolCalls})`);
          }

          const parallelCalls = preparedCalls.filter((call) =>
            isParallelSafeTool(call.tc.function.name),
          );
          const sequentialCalls = preparedCalls.filter(
            (call) => !isParallelSafeTool(call.tc.function.name),
          );

          const runToolCall = async (call: typeof preparedCalls[number]) => {
            const toolStartedAt = Date.now();
            const result = await call.handler(call.parsedArgs);
            const toolElapsedMs = Date.now() - toolStartedAt;
            return {
              toolCallId: call.tc.id,
              toolName: call.tc.function.name,
              result,
              elapsedMs: toolElapsedMs,
            };
          };

          const parallelResults = await Promise.all(parallelCalls.map((call) => runToolCall(call)));
          const sequentialResults: Array<{
            toolCallId: string;
            toolName: string;
            result: unknown;
            elapsedMs: number;
          }> = [];
          for (const call of sequentialCalls) {
            sequentialResults.push(await runToolCall(call));
          }

          const resultsById = new Map(
            [...parallelResults, ...sequentialResults].map((item) => [item.toolCallId, item]),
          );
          for (const call of preparedCalls) {
            const toolResult = resultsById.get(call.tc.id);
            if (!toolResult) continue;
            tools.push({ toolName: toolResult.toolName, elapsedMs: toolResult.elapsedMs });
            toolsMs += toolResult.elapsedMs;
            toolCallsThisIteration += 1;
            toolCallsExecuted += 1;
            currentMessages.push({
              role: "tool",
              tool_call_id: call.tc.id,
              content: JSON.stringify(toolResult.result),
            });
          }

          const totalMs = Date.now() - iterationStartedAt;
          const row: IterationRow = {
            iteration: iterationNo,
            llmMs,
            parseMs,
            toolsMs,
            toolCalls: toolCallsThisIteration,
            totalMs,
            tools,
            afterHeadersMs: transportTiming?.afterHeadersMs,
            firstBodyChunkMs: transportTiming?.firstBodyChunkMs,
            firstSseDataLineMs: transportTiming?.firstSseDataLineMs,
            firstAssistantTokenMs: transportTiming?.firstAssistantTokenMs,
            ...usageFields,
          };
          iterationTimings.push(row);
          logStructured({
            event: "orchestrator_iteration_timing",
            traceId: request.traceId,
            stream: this.config.stream === true,
            ...row,
          });
          iterations++;
        }

        logStructured({
          event: "orchestrator_timing_breakdown_on_exceeded",
          traceId: request.traceId,
          maxIterations,
          totalMs: Date.now() - startedAt,
          llmMsTotal: iterationTimings.reduce((s, x) => s + x.llmMs, 0),
          toolsMsTotal: iterationTimings.reduce((s, x) => s + x.toolsMs, 0),
          parseMsTotal: iterationTimings.reduce((s, x) => s + x.parseMs, 0),
          iterations: iterationTimings,
        });

        throw new Error(
          `ReAct loop exceeded max iterations (${maxIterations})`
        );
      } catch (error) {
        // Do not retry tool-related errors (programming errors)
        if (
          error instanceof Error &&
          (error.message.startsWith("No handler for tool") ||
            error.message.startsWith(
              "Invalid JSON in tool_call arguments"
            ) ||
            error.message.startsWith("ReAct loop exceeded"))
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
      choices?: Array<{
        finish_reason?: string | null;
        delta?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: "function";
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    if (json.id) acc.id = json.id;
    if (json.model) acc.model = json.model;
    if (json.usage) acc.usage = json.usage;
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    if (choice?.finish_reason) acc.finishReason = choice.finish_reason;
    const piece = delta?.content;
    if (piece) acc.content += piece;
    const reasonPiece = delta?.reasoning_content;
    if (reasonPiece) acc.reasoningContent = (acc.reasoningContent ?? "") + reasonPiece;
    const toolDeltas = delta?.tool_calls;
    if (Array.isArray(toolDeltas) && toolDeltas.length > 0) {
      if (!acc.toolCalls) acc.toolCalls = [];
      for (const td of toolDeltas) {
        const idx = typeof td.index === "number" ? td.index : acc.toolCalls.length;
        let row = acc.toolCalls.find((r) => r.index === idx);
        if (!row) {
          row = {
            index: idx,
            id: td.id,
            type: td.type ?? "function",
            function: { name: "", arguments: "" },
          };
          acc.toolCalls.push(row);
        } else if (!row.id && td.id) {
          row.id = td.id;
        }
        if (td.function?.name) row.function.name += td.function.name;
        if (td.function?.arguments) row.function.arguments += td.function.arguments;
      }
    }
  } catch {
    /* 忽略单行损坏 */
  }
}

function sseAssistantSignalSig(acc: SseAssembledResponse): string {
  const parts = (acc.toolCalls ?? []).map(
    (t) => `${t.index}:${t.function.name}:${t.function.arguments}`,
  );
  return `${acc.content}\n${acc.reasoningContent ?? ""}\n${parts.join(";;")}`;
}

async function readSseChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((acc: SseAssembledResponse) => void) | undefined,
  llmWallClockStart: number,
): Promise<{
  assembled: SseAssembledResponse;
  transportTail: Pick<
    LlmTransportTiming,
    "firstBodyChunkMs" | "firstSseDataLineMs" | "firstAssistantTokenMs"
  >;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const acc = emptySseAssembly();
  let firstBodyChunkMs: number | undefined;
  let firstSseDataLineMs: number | undefined;
  let firstAssistantTokenMs: number | undefined;
  const markFirstAssistantIfNeeded = (beforeSig: string) => {
    if (firstAssistantTokenMs !== undefined) return;
    if (sseAssistantSignalSig(acc) !== beforeSig) {
      firstAssistantTokenMs = Date.now() - llmWallClockStart;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0 && firstBodyChunkMs === undefined) {
        firstBodyChunkMs = Date.now() - llmWallClockStart;
      }
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const i = buf.indexOf("\n");
        if (i < 0) break;
        const line = buf.slice(0, i).replace(/\r$/, "").trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        if (firstSseDataLineMs === undefined) {
          firstSseDataLineMs = Date.now() - llmWallClockStart;
        }
        const beforeSig = sseAssistantSignalSig(acc);
        ingestSseDataLine(payload, acc);
        markFirstAssistantIfNeeded(beforeSig);
        onDelta?.(acc);
      }
    }
    const tail = buf.replace(/\r$/, "").trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      if (payload !== "[DONE]") {
        if (firstSseDataLineMs === undefined) {
          firstSseDataLineMs = Date.now() - llmWallClockStart;
        }
        const beforeSig = sseAssistantSignalSig(acc);
        ingestSseDataLine(payload, acc);
        markFirstAssistantIfNeeded(beforeSig);
        onDelta?.(acc);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const transportTail: Pick<
    LlmTransportTiming,
    "firstBodyChunkMs" | "firstSseDataLineMs" | "firstAssistantTokenMs"
  > = {};
  if (firstBodyChunkMs !== undefined) transportTail.firstBodyChunkMs = firstBodyChunkMs;
  if (firstSseDataLineMs !== undefined) transportTail.firstSseDataLineMs = firstSseDataLineMs;
  if (firstAssistantTokenMs !== undefined) {
    transportTail.firstAssistantTokenMs = firstAssistantTokenMs;
  }
  return { assembled: acc, transportTail };
}

function sseAssembledToChatResponse(a: SseAssembledResponse): ChatCompletionResponse {
  const toolCalls = a.toolCalls
    ?.slice()
    .sort((x, y) => x.index - y.index)
    .map((row, idx) => ({
      id: row.id ?? `tool_${idx}`,
      type: "function" as const,
      function: {
        name: row.function.name,
        arguments: row.function.arguments,
      },
    }))
    .filter((row) => row.function.name.length > 0);
  return {
    id: a.id,
    model: a.model,
    usage: a.usage,
    choices: [
      {
        finish_reason: a.finishReason ?? "stop",
        message: {
          content: a.content,
          reasoning_content: a.reasoningContent,
          tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        },
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
  try {
    return JSON.parse(normalized);
  } catch {
    // Qwen3 thinking 模式或 prompt v3.0 下模型可能直接返回自然语言；
    // 封装为 { message, stopReason: end_turn }，不阻断用户回复
    if (normalized.length > 0) {
      return { message: normalized, stopReason: "end_turn" };
    }
    throw new Error("Qwen API returned non-JSON content and empty fallback");
  }
}

function extractAssistantContent(response: ChatCompletionResponse): string {
  const msg = response.choices?.[0]?.message;
  const content = msg?.content;
  if (content?.trim()) return content;

  // Qwen3 thinking 模式下 content 可能为空，用 reasoning_content 兜底
  const reasoning = msg?.reasoning_content;
  if (reasoning?.trim()) return reasoning;

  // 有 tool_calls 但无内容 → 返回空字符串（由上游 tool_calls 分支处理）
  if (msg?.tool_calls?.length) return "";

  throw new Error("Qwen API returned empty assistant content (no content, reasoning, or tool_calls)");
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

function isParallelSafeTool(toolName: string): boolean {
  return toolName !== "update_known_facts" && toolName !== "save_draft";
}
