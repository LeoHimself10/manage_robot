import type { PlanSession } from "../infra/plan-session-store";
import { buildAssistantDisplayMarkdown } from "./conversation-display-markdown";

export interface ConversationHistoryMessage {
  role: string;
  content: string;
  displayContent?: string;
  at?: string;
}

function isAssistantRole(role: string): boolean {
  return String(role || "").toLowerCase() === "assistant";
}

function lastAssistantIndex(messages: ConversationHistoryMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAssistantRole(messages[i]!.role)) return i;
  }
  return -1;
}

/** Resolve user-visible markdown for a history row (legacy rows may lack displayContent). */
export function resolveMessageDisplayContent(
  msg: ConversationHistoryMessage,
  session: PlanSession,
  index: number,
  allMessages: ConversationHistoryMessage[],
): string {
  if (typeof msg.displayContent === "string" && msg.displayContent.trim()) {
    return msg.displayContent;
  }
  const content = String(msg.content ?? "");
  if (!isAssistantRole(msg.role)) return content;

  const lastAssistant = lastAssistantIndex(allMessages);
  const isLastAssistant = index === lastAssistant;
  if (!isLastAssistant || !session.latestDraft) {
    return content;
  }

  return buildAssistantDisplayMarkdown({
    modelMessage: content,
    currentDraft: session.latestDraft,
    latestAssignment: session.latestAssignment,
    shouldRenderRichSection: true,
  });
}
