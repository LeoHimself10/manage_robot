import type { BaseMessage } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { QwenPlannerConfig } from "../demo/qwen-planner";
import type { PlanSession } from "../../infra/plan-session-store";
import type { V2ToolRegistryEntry } from "./tools";
import type { V2ToolChoice } from "./tool-choice-gate";

/** Per-turn runtime deps (not persisted in graph state / PlanSession). */
export interface V2GraphRuntimeContext {
  traceId: string;
  session: PlanSession;
  systemPrompt: string;
  historyMessages: BaseMessage[];
  userMessage: string;
  model: ChatOpenAI;
  clientConfig: QwenPlannerConfig;
  /** Full tool set + `auto` (used after the first turn / when not gated). */
  modelWithToolsAuto: ReturnType<ChatOpenAI["bindTools"]>;
  /** Narrow frontier + forced/required tool_choice; only set when gated (first turn). */
  modelWithToolsForced?: ReturnType<ChatOpenAI["bindTools"]>;
  registry: Record<string, V2ToolRegistryEntry>;
  /** FR-1/FR-2 gate decision for this turn. */
  turnToolChoice: V2ToolChoice;
  turnFrontier?: string[];
  turnToolChoiceReason: string;
  maxIterations: number;
  maxToolCalls: number;
  maxTotalMs: number;
  startedAtMs: number;
}

export const V2_GRAPH_RUNTIME_CONFIG_KEY = "v2Runtime";

export function getV2GraphRuntime(config: LangGraphRunnableConfig): V2GraphRuntimeContext {
  const ctx = config.configurable?.[V2_GRAPH_RUNTIME_CONFIG_KEY] as V2GraphRuntimeContext | undefined;
  if (!ctx) {
    throw new Error("v2Runtime missing from LangGraph configurable");
  }
  return ctx;
}
