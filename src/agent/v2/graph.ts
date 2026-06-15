import { randomUUID } from "node:crypto";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import type { QwenPlannerConfig } from "../demo/qwen-planner";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import { logStructured } from "../../infra/logger";
import type { PlanSession } from "../../infra/plan-session-store";
import type { PublishTaskRecentStore } from "../tools/publish-task";
import type { ToolProfile } from "../tools/registry";
import { buildV2SystemPrompt, type V2PromptOpts } from "./prompt";
import {
  buildV2ToolRegistry,
  v2ToolsToOpenAIFormat,
  v2ToolsToOpenAIFormatFiltered,
} from "./tools";
import { getV2CompiledAgentGraph } from "./graph-build";
import { V2_GRAPH_RUNTIME_CONFIG_KEY, type V2GraphRuntimeContext } from "./graph-runtime";
import { buildInterruptMessage } from "./graph-nodes";
import { decideTurnToolChoice, serializeTurnToolChoice } from "./tool-choice-gate";
import type { ExplicitGate } from "./turn-contract";
import { readV2ThinkingEnabled } from "./model";
import { getAssignmentCoverage } from "../assignment/merge-assignment";
import type { V2AgentStateType } from "./state";

export interface V2GraphRunInput {
  userMessage: string;
  session: PlanSession;
  model: ChatOpenAI;
  clientConfig: QwenPlannerConfig;
  employeeRepo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  };
  toolProfile: ToolProfile;
  promptOpts?: V2PromptOpts;
  trustedActorUserId?: string;
  actorName?: string;
  actorRole?: "admin" | "manager" | "employee";
  allowSearchWeb?: boolean;
  publishRecentStore?: PublishTaskRecentStore;
  onSessionMutated?: (session: PlanSession) => void;
  onPublishTaskResult?: (result: Record<string, unknown>) => void;
  conversationHistory?: Array<{ role: string; content: string }>;
  maxToolIterations?: number;
  traceId?: string;
  /**
   * Explicit gate for harness-authored retry invocations (Rule 2).
   * When set, `decideTurnToolChoice` is skipped and this gate is used directly.
   * Each retry kind carries its own narrow `{toolChoice, frontier}` so retries
   * are never unconstrained. See `RETRY_KIND_GATES` in `turn-contract.ts`.
   */
  explicitGate?: ExplicitGate;
}

export interface V2GraphRunResult {
  traceId: string;
  finalMessage: string;
  toolInvocationNames: string[];
  toolCallsTotal: number;
  publishResult?: Record<string, unknown>;
  observabilityFlags: string[];
  timing: {
    totalMs: number;
    llmMsTotal: number;
    toolsMsTotal: number;
    iterations: V2AgentStateType["iterationTimings"];
  };
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback;
}

function normalizeHistory(
  history: Array<{ role: string; content: string }>,
): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const row of history) {
    const content = String(row.content ?? "").trim();
    if (!content) continue;
    if (row.role === "user") out.push(new HumanMessage(content));
    else if (row.role === "assistant") out.push(new AIMessage(content));
    else out.push(new AIMessage(`[${row.role}] ${content}`));
  }
  return out;
}

/** LangGraph StateGraph agent loop: compact → agent ↔ tools until end_turn. */
export async function runV2AgentTurn(input: V2GraphRunInput): Promise<V2GraphRunResult> {
  const traceId = input.traceId ?? randomUUID();
  const startedAt = Date.now();

  const maxIterations = input.maxToolIterations
    ?? readEnvInt("DINGTALK_ORCHESTRATOR_MAX_ITERATIONS", 30);
  const maxToolCalls = readEnvInt("AGENT_MAX_TOOL_CALLS", 16);
  const maxTotalMs = readEnvInt("AGENT_MAX_TOTAL_MS", 180000);
  const publishHolder: { result?: Record<string, unknown> } = {};

  const registry = buildV2ToolRegistry({
    employeeRepo: input.employeeRepo,
    toolProfile: input.toolProfile,
    trustedActorUserId: input.trustedActorUserId,
    allowSearchWeb: input.allowSearchWeb,
    currentSessionPlanId: input.session.planId,
    currentSession: input.session,
    publishRecentStore: input.publishRecentStore,
    actorName: input.actorName,
    actorRole: input.actorRole,
    orchestratorUserMessage: input.userMessage,
    projectPortfolioEnabled: input.promptOpts?.projectPortfolioEnabled,
    onSessionMutated: input.onSessionMutated,
    onPublishTaskResult: (result) => {
      publishHolder.result = result;
      input.onPublishTaskResult?.(result);
    },
  });

  // FR-1/FR-2: decide per-turn tool_choice + CMTF frontier before binding tools.
  // Harness-authored retry invocations carry an explicitGate (Rule 2) that bypasses
  // the LLM-based gate so synthetic messages are never misclassified.
  const gate = input.explicitGate
    ? input.explicitGate
    : await decideTurnToolChoice({
        userMessage: input.userMessage,
        session: input.session,
        toolProfile: input.toolProfile,
        trustedActorUserId: input.trustedActorUserId,
        assignCoverage: getAssignmentCoverage(
          input.session.latestDraft,
          input.session.latestAssignment,
        ),
        thinkingEnabled: readV2ThinkingEnabled(),
        classifierConfig: {
          apiKey: input.clientConfig.apiKey,
          baseUrl: input.clientConfig.baseUrl,
        },
      });

  const openAiTools = v2ToolsToOpenAIFormat(registry);
  const modelWithToolsAuto = input.model.bindTools(openAiTools);
  let modelWithToolsForced: ReturnType<ChatOpenAI["bindTools"]> | undefined;
  let modelWithToolsAutoFrontier: ReturnType<ChatOpenAI["bindTools"]> | undefined;
  if (gate.toolChoice !== "auto") {
    // FR-3/C2: forced turn exposes only the narrow frontier subset; the
    // execution registry stays full so handlers are never pruned.
    const frontierTools = gate.frontier
      ? v2ToolsToOpenAIFormatFiltered(registry, gate.frontier)
      : openAiTools;
    const toolsForForce = frontierTools.length > 0 ? frontierTools : openAiTools;
    modelWithToolsForced = input.model.bindTools(toolsForForce, {
      tool_choice: gate.toolChoice,
    });
    // For iterations 2+ of a retry turn: keep the frontier restriction but drop
    // the forced single-tool choice to prevent deadlock on a failing tool.
    if (gate.frontier && frontierTools.length > 0) {
      modelWithToolsAutoFrontier = input.model.bindTools(frontierTools);
    }
  }

  const runtimeRef: V2GraphRuntimeContext = {
    traceId,
    session: input.session,
    systemPrompt: buildV2SystemPrompt(input.promptOpts),
    historyMessages: normalizeHistory(input.conversationHistory ?? []).slice(
      -readEnvInt("AGENT_HISTORY_TURNS", 8),
    ),
    userMessage: input.userMessage,
    model: input.model,
    clientConfig: input.clientConfig,
    modelWithToolsAuto,
    modelWithToolsForced,
    modelWithToolsAutoFrontier,
    registry,
    turnToolChoice: gate.toolChoice,
    turnFrontier: gate.frontier,
    turnToolChoiceReason: gate.reason,
    maxIterations,
    maxToolCalls,
    maxTotalMs,
    startedAtMs: startedAt,
  };

  const graph = getV2CompiledAgentGraph();
  const finalState = await graph.invoke(
    {
      messages: [],
      traceId,
      sessionPlanId: input.session.planId,
      toolInvocationNames: [],
      iterationTimings: [],
      observabilityFlags: [],
      finalMessage: "",
      loopIteration: 0,
      llmMsTotal: 0,
      toolsMsTotal: 0,
      shouldStop: false,
    },
    {
      configurable: {
        [V2_GRAPH_RUNTIME_CONFIG_KEY]: runtimeRef,
      },
      recursionLimit: maxIterations * 2 + 4,
    },
  ) as V2AgentStateType;

  let observabilityFlags = [...(finalState.observabilityFlags ?? [])];
  let finalMessage = finalState.finalMessage ?? "";

  if (
    finalState.loopIteration >= maxIterations
    && !observabilityFlags.some((f) => f.includes("exceeded"))
    && !finalState.shouldStop
  ) {
    observabilityFlags = [...observabilityFlags, "orchestrator_max_turns_exceeded"];
    if (!finalMessage) {
      finalMessage = buildInterruptMessage("orchestrator_max_turns_exceeded", finalMessage);
    }
  }

  const publishResult = publishHolder.result;

  // Force was applied to the first turn but it still emitted zero tool calls
  // (should not happen with a compliant backend) — surface as a flag.
  if (
    gate.toolChoice !== "auto"
    && (finalState.iterationTimings[0]?.toolCalls ?? 0) === 0
  ) {
    observabilityFlags = [...observabilityFlags, "tool_choice_forced_but_empty"];
  }

  logStructured({
    event: "orchestrator_done",
    engine: "v2",
    traceId,
    toolCallsTotal: finalState.toolInvocationNames.length,
    llmMsTotal: finalState.llmMsTotal,
    toolsMsTotal: finalState.toolsMsTotal,
    loopIterations: finalState.iterationTimings.length,
    hasPublishResult: publishResult !== undefined,
    messageChars: finalMessage.length,
    turnToolChoice: serializeTurnToolChoice(gate.toolChoice),
    turnFrontierSize: gate.frontier?.length ?? 0,
    turnToolChoiceReason: gate.reason,
    observabilityFlags,
  });

  return {
    traceId,
    finalMessage: finalMessage || "（无回复内容）",
    toolInvocationNames: finalState.toolInvocationNames,
    toolCallsTotal: finalState.toolInvocationNames.length,
    publishResult,
    observabilityFlags,
    timing: {
      totalMs: Date.now() - startedAt,
      llmMsTotal: finalState.llmMsTotal,
      toolsMsTotal: finalState.toolsMsTotal,
      iterations: finalState.iterationTimings,
    },
  };
}
