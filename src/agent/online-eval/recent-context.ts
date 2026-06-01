import { redactCommonPii } from "../../infra/content-filter";

export interface RedactedTurnContext {
  role: "user" | "assistant";
  content: string;
}

const CONTEXT_TURN_MAX = 3;
const CONTEXT_MSG_MAX = 800;

export function buildRecentContextFromHistory(
  history: Array<{ role: string; content: string }> | undefined,
): RedactedTurnContext[] {
  const rows = (history ?? [])
    .filter((h) => h.role === "user" || h.role === "assistant")
    .slice(-CONTEXT_TURN_MAX * 2)
    .map((h) => ({
      role: h.role as "user" | "assistant",
      content: redactCommonPii(String(h.content ?? "")).slice(0, CONTEXT_MSG_MAX),
    }))
    .filter((h) => h.content.trim().length > 0);
  return rows.slice(-CONTEXT_TURN_MAX * 2);
}

export function redactTurnText(text: string, maxLen: number): string {
  return redactCommonPii(String(text ?? "")).slice(0, maxLen);
}
