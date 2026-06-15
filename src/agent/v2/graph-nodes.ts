import { AIMessage, SystemMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { logStructured } from "../../infra/logger";
import { maybeCompactHistory } from "./compaction";
import { buildV2ContextBlock, buildV2SessionContextFromPlanSession } from "./context";
import { getV2GraphRuntime } from "./graph-runtime";
import { isV2ParallelSafeTool } from "./tools";
import type { V2AgentStateType } from "./state";
import type { V2IterationTiming } from "./state";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

function extractTextContent(message: AIMessage): string {
  let raw: string;
  if (typeof message.content === "string") {
    raw = message.content.trim();
  } else if (Array.isArray(message.content)) {
    raw = message.content
      .map((p) => (typeof p === "string" ? p : "text" in p ? String(p.text ?? "") : ""))
      .join("")
      .trim();
  } else {
    raw = String(message.content ?? "").trim();
  }

  // Model may output legacy JSON format despite v2 prompt instructing natural language.
  // Gracefully extract the `message` field if the response is a JSON object.
  if (raw.startsWith("{") || raw.startsWith("```")) {
    try {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
      const parsed = JSON.parse((fenced ?? raw).trim()) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).message === "string"
      ) {
        const msg = ((parsed as Record<string, unknown>).message as string).trim();
        if (msg) return msg;
      }
    } catch {
      // not JSON — return raw text as-is
    }
  }

  return raw;
}

export function buildInterruptMessage(flag: string, partialMessage: string): string {
  if (partialMessage) return partialMessage;
  if (flag === "orchestrator_token_budget_exceeded") {
    return "**说明**：本轮 token 预算已用尽。请发「继续」或简述需求，我会在同一会话里接着处理。";
  }
  return "**说明**：本轮已达到工具调用预算上限。请发「继续」或简述需求。";
}

// TODO(harness-conformance C4/C5): C5 token budget is not implemented this
// round — `orchestrator_token_budget_exceeded` branch in buildInterruptMessage
// is currently unreachable (only tool-call/time budgets fire). Leave dead code
// + misleading copy in place per 2026-06-12 scope; wire real token accounting
// or remove next round.
function budgetExceeded(
  state: V2AgentStateType,
  runtime: ReturnType<typeof getV2GraphRuntime>,
): { stop: boolean; flag?: string } {
  if (Date.now() - runtime.startedAtMs > runtime.maxTotalMs) {
    return { stop: true, flag: "orchestrator_max_time_exceeded" };
  }
  if (state.toolInvocationNames.length >= runtime.maxToolCalls) {
    return { stop: true, flag: "orchestrator_max_tool_calls_exceeded" };
  }
  return { stop: false };
}

export async function v2CompactNode(
  _state: V2AgentStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<V2AgentStateType>> {
  const runtime = getV2GraphRuntime(config);
  const compacted = await maybeCompactHistory({
    messages: runtime.historyMessages,
    model: runtime.model,
    config: runtime.clientConfig,
  });
  const contextBlock = buildV2ContextBlock({
    ...buildV2SessionContextFromPlanSession(runtime.session, compacted.summary),
    session: runtime.session,
    userMessage: runtime.userMessage,
  });

  const messages = [
    new SystemMessage(runtime.systemPrompt),
    ...(contextBlock ? [new SystemMessage(contextBlock)] : []),
    ...compacted.messages,
    new HumanMessage(runtime.userMessage),
  ];

  return {
    messages,
    compactedSummary: compacted.summary,
    loopIteration: 0,
    llmMsTotal: 0,
    toolsMsTotal: 0,
    shouldStop: false,
  };
}

export async function v2AgentNode(
  state: V2AgentStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<V2AgentStateType>> {
  const runtime = getV2GraphRuntime(config);

  if (state.shouldStop) {
    return {};
  }

  if (state.loopIteration >= runtime.maxIterations) {
    return {
      shouldStop: true,
      observabilityFlags: ["orchestrator_max_turns_exceeded"],
      finalMessage: state.finalMessage
        || buildInterruptMessage("orchestrator_max_turns_exceeded", state.finalMessage ?? ""),
    };
  }

  const budget = budgetExceeded(state, runtime);
  if (budget.stop && budget.flag) {
    return {
      shouldStop: true,
      observabilityFlags: [budget.flag],
      finalMessage: buildInterruptMessage(budget.flag, state.finalMessage ?? ""),
    };
  }

  const iteration = state.loopIteration + 1;
  const llmStart = Date.now();
  // FR-2: force tool_choice only on the first turn (loopIteration === 0); once
  // inside the tool loop, revert to the full-set + `auto` model (anti-deadlock).
  const useForced =
    state.loopIteration === 0
    && runtime.turnToolChoice !== "auto"
    && runtime.modelWithToolsForced !== undefined;
  const boundModel = useForced
    ? runtime.modelWithToolsForced!
    : runtime.modelWithToolsAuto;
  let response: AIMessage;
  try {
    response = (await boundModel.invoke(state.messages)) as AIMessage;
  } catch (err) {
    return {
      shouldStop: true,
      loopIteration: iteration,
      observabilityFlags: ["orchestrator_llm_error"],
      finalMessage: `**说明**：模型调用失败（${err instanceof Error ? err.message : String(err)}）。请稍后重试。`,
    };
  }
  const llmMs = Date.now() - llmStart;
  const llmMsTotal = state.llmMsTotal + llmMs;

  const text = extractTextContent(response);
  const finalMessage = text || state.finalMessage;
  const toolCalls = response.tool_calls ?? [];

  if (toolCalls.length === 0) {
    const timing: V2IterationTiming = {
      iteration,
      llmMs,
      toolsMs: 0,
      toolCalls: 0,
      tools: [],
    };
    return {
      loopIteration: iteration,
      llmMsTotal,
      finalMessage,
      messages: [response],
      iterationTimings: [timing],
      shouldStop: true,
    };
  }

  if (state.toolInvocationNames.length + toolCalls.length > runtime.maxToolCalls) {
    return {
      shouldStop: true,
      loopIteration: iteration,
      llmMsTotal,
      finalMessage: buildInterruptMessage("orchestrator_max_tool_calls_exceeded", finalMessage ?? ""),
      observabilityFlags: ["orchestrator_max_tool_calls_exceeded"],
    };
  }

  return {
    loopIteration: iteration,
    llmMsTotal,
    finalMessage,
    messages: [response],
    pendingAgentLlmMs: llmMs,
  };
}

export async function v2ToolsNode(
  state: V2AgentStateType,
  config: LangGraphRunnableConfig,
): Promise<Partial<V2AgentStateType>> {
  const runtime = getV2GraphRuntime(config);

  if (state.shouldStop) {
    return {};
  }

  const budget = budgetExceeded(state, runtime);
  if (budget.stop && budget.flag) {
    return {
      shouldStop: true,
      observabilityFlags: [budget.flag],
      finalMessage: buildInterruptMessage(budget.flag, state.finalMessage ?? ""),
    };
  }

  const last = state.messages.at(-1);
  if (!last || !AIMessage.isInstance(last)) {
    return { shouldStop: true };
  }

  const toolCalls = last.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return { shouldStop: true };
  }

  const toolsStart = Date.now();
  const toolsThisIter: Array<{ toolName: string; elapsedMs: number }> = [];
  const newToolNames: string[] = [];

  const parallel = toolCalls.filter((tc) => isV2ParallelSafeTool(tc.name));
  const sequential = toolCalls.filter((tc) => !isV2ParallelSafeTool(tc.name));

  const runOne = async (tc: (typeof toolCalls)[number]) => {
    const entry = runtime.registry[tc.name];
    const toolStart = Date.now();
    if (!entry) {
      return new ToolMessage({
        tool_call_id: tc.id ?? tc.name,
        content: JSON.stringify({ ok: false, error: "unknown_tool", toolName: tc.name }),
      });
    }
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs =
        typeof tc.args === "object" && tc.args !== null
          ? (tc.args as Record<string, unknown>)
          : JSON.parse(String(tc.args ?? "{}"));
    } catch {
      return new ToolMessage({
        tool_call_id: tc.id ?? tc.name,
        content: JSON.stringify({ ok: false, error: "invalid_tool_args" }),
      });
    }
    // FR-4/C1: a single tool throwing must not reject the whole turn; feed a
    // structured error back to the model and keep timing/name bookkeeping.
    let result: unknown;
    try {
      result = await entry.handler(parsedArgs);
    } catch (err) {
      newToolNames.push(tc.name);
      toolsThisIter.push({ toolName: tc.name, elapsedMs: Date.now() - toolStart });
      return new ToolMessage({
        tool_call_id: tc.id ?? tc.name,
        content: JSON.stringify({
          ok: false,
          error: "tool_execution_failed",
          toolName: tc.name,
          detail: String(err),
        }),
      });
    }
    newToolNames.push(tc.name);
    toolsThisIter.push({ toolName: tc.name, elapsedMs: Date.now() - toolStart });
    return new ToolMessage({
      tool_call_id: tc.id ?? tc.name,
      content: JSON.stringify(result),
    });
  };

  const toolResults: ToolMessage[] = [];
  toolResults.push(...(await Promise.all(parallel.map((tc) => runOne(tc)))));
  for (const tc of sequential) {
    toolResults.push(await runOne(tc));
  }

  const toolsMs = Date.now() - toolsStart;
  const toolsMsTotal = state.toolsMsTotal + toolsMs;
  const llmMs = state.pendingAgentLlmMs ?? 0;
  const timing: V2IterationTiming = {
    iteration: state.loopIteration,
    llmMs,
    toolsMs,
    toolCalls: toolCalls.length,
    tools: toolsThisIter,
  };

  logStructured({
    event: "orchestrator_iteration_timing",
    engine: "v2",
    traceId: runtime.traceId,
    iteration: state.loopIteration,
    llmMs,
    toolsMs,
    toolCalls: toolCalls.length,
    tools: toolsThisIter,
  });

  return {
    messages: toolResults,
    toolInvocationNames: newToolNames,
    toolsMsTotal,
    iterationTimings: [timing],
    pendingAgentLlmMs: undefined,
  };
}

export function routeAfterAgent(
  state: V2AgentStateType,
): "tools" | typeof END {
  if (state.shouldStop) return END;
  const last = state.messages.at(-1);
  if (last && AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0) {
    return "tools";
  }
  return END;
}

export function routeAfterTools(
  state: V2AgentStateType,
): "agent" | typeof END {
  if (state.shouldStop) return END;
  return "agent";
}
