import type { PlanSession } from "./plan-session-store";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

/** Single-line preview for sidebars / thread lists. */
export function truncateConversationPreview(text: string, max = 72): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (!single) return "";
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/**
 * Human-readable session title: first user turn, else draft title, else short id.
 * Mirrors publish-side intent in workbench-formal-task-store.inferTitleFromSession.
 */
export function inferConversationTitleFromSession(session: PlanSession): string {
  const first = session.conversationHistory?.find((m) => m.role === "user")?.content ?? "";
  const trimmed = first.trim();
  if (trimmed) return truncateConversationPreview(trimmed, 56);
  const draft = asRecord(session.latestDraft);
  const title = typeof draft?.title === "string" ? draft.title.trim() : "";
  if (title) return truncateConversationPreview(title, 56);
  return `新会话 · ${session.planId.slice(0, 8)}`;
}
