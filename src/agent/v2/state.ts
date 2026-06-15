import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { PlanSession } from "../../infra/plan-session-store";

export interface V2BudgetState {
  toolCalls: number;
  maxToolCalls: number;
  maxTotalTokens: number;
  maxTotalMs: number;
  startedAtMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface V2IterationTiming {
  iteration: number;
  llmMs: number;
  toolsMs: number;
  toolCalls: number;
  tools: Array<{ toolName: string; elapsedMs: number }>;
  promptTokens?: number;
  completionTokens?: number;
}

export const V2AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  traceId: Annotation<string>(),
  sessionPlanId: Annotation<string>(),
  loopIteration: Annotation<number>({
    reducer: (_left, right) => right ?? 0,
    default: () => 0,
  }),
  llmMsTotal: Annotation<number>({
    reducer: (_left, right) => right ?? 0,
    default: () => 0,
  }),
  toolsMsTotal: Annotation<number>({
    reducer: (_left, right) => right ?? 0,
    default: () => 0,
  }),
  shouldStop: Annotation<boolean>({
    reducer: (_left, right) => right ?? false,
    default: () => false,
  }),
  pendingAgentLlmMs: Annotation<number | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  toolInvocationNames: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  budgets: Annotation<V2BudgetState>(),
  iterationTimings: Annotation<V2IterationTiming[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  publishResult: Annotation<Record<string, unknown> | undefined>(),
  finalMessage: Annotation<string | undefined>(),
  observabilityFlags: Annotation<string[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  compactedSummary: Annotation<string | undefined>(),
});

export const V2_GRAPH_NODE_NAMES = ["compact", "agent", "tools"] as const;
export type V2GraphNodeName = (typeof V2_GRAPH_NODE_NAMES)[number];

export type V2AgentStateType = typeof V2AgentState.State;

export interface V2RunContext {
  session: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
}
