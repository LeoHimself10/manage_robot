import type { TaskPlanningDemoResult } from "./agent/demo/pipeline";
import {
  buildConversationStateFromResult,
  summarizePriorDemoForPrompt,
  type DemoConversationState,
} from "./infra/session-digest";

export type { DemoConversationState };

export interface AssignmentSessionState {
  stage?: "RECOMMENDING" | "AWAITING_DISPATCH_CONFIRM" | "DISPATCHED";
  lastAssignmentTraceId?: string;
  inProgressConversationIds?: string[];
}

export interface DingTalkDemoSessionContext {
  priorDigest?: string;
  conversationState?: DemoConversationState;
  assignmentState?: AssignmentSessionState;
  knownFacts?: string[];
}

export function nextSessionContextAfterDemoResult(
  demoResult: TaskPlanningDemoResult,
  prior: DingTalkDemoSessionContext | undefined,
  maxChars: number
): DingTalkDemoSessionContext {
  const conversationState = buildConversationStateFromResult(
    demoResult,
    prior?.conversationState
  );

  if (
    demoResult.status === "CONVERSATION" &&
    demoResult.responseIntent === "RESET_OR_NEW_TASK"
  ) {
    return {
      priorDigest: undefined,
      conversationState,
    };
  }

  const digest = summarizePriorDemoForPrompt(demoResult, maxChars, conversationState);
  return {
    priorDigest: digest ?? prior?.priorDigest,
    conversationState,
    knownFacts: prior?.knownFacts,
  };
}

export function getSessionKnownFacts(ctx?: DingTalkDemoSessionContext): string[] {
  return ctx?.knownFacts ?? [];
}

export function updateSessionKnownFacts(
  ctx: DingTalkDemoSessionContext | undefined,
  newFacts: string[]
): string[] {
  const existing = ctx?.knownFacts ?? [];
  const merged = [...existing];
  for (const f of newFacts) {
    if (!merged.includes(f)) merged.push(f);
  }
  if (ctx) ctx.knownFacts = merged;
  return merged;
}
