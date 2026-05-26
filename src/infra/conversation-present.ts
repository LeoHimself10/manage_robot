import type { PlanSession } from "./plan-session-store";

export const MAIN_THREAD_TITLE = "钉钉规划助手";
export const MAIN_THREAD_PREVIEW_EMPTY = "与钉钉机器人同步";
export const SIDE_THREAD_PREVIEW_EMPTY = "暂无消息";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function isSideThreadSession(session: PlanSession): boolean {
  if (session.threadKind === "side") return true;
  if (session.threadKind === "main") return false;
  return false;
}

function isMainThreadSession(session: PlanSession): boolean {
  if (session.threadKind === "main") return true;
  if (session.threadKind === "side") return false;
  if (String(session.conversationId ?? "").trim()) return true;
  return false;
}

function firstUserMessageContent(session: PlanSession): string {
  const first = session.conversationHistory?.find((m) => m.role === "user")?.content ?? "";
  const trimmed = first.trim();
  if (!trimmed || trimmed.startsWith("[uploaded_file]")) return "";
  return trimmed;
}

function lastMessagePreview(session: PlanSession): string {
  const history = session.conversationHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    const raw =
      typeof row?.displayContent === "string" && row.displayContent.trim()
        ? row.displayContent
        : String(row?.content ?? "");
    const preview = truncateConversationPreview(raw, 72);
    if (preview) return preview;
  }
  return "";
}

/** Beijing time label for new side thread default title. */
export function formatSideThreadDefaultTitle(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `新规划会话 · ${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

export function inferSideThreadTitle(session: PlanSession): string {
  const firstUser = firstUserMessageContent(session);
  if (firstUser) return truncateConversationPreview(firstUser, 56);
  const label = String(session.threadLabel ?? "").trim();
  if (label) return label;
  const createdAt = session.createdAt ? Date.parse(session.createdAt) : NaN;
  if (Number.isFinite(createdAt)) {
    return formatSideThreadDefaultTitle(new Date(createdAt));
  }
  return formatSideThreadDefaultTitle();
}

export interface ThreadListItem {
  threadId: string;
  kind: "main" | "side";
  pinned: boolean;
  title: string;
  preview: string;
  badge: string;
  planId: string;
  updatedAt?: string;
  turns: number;
  knownFacts: number;
}

export function buildThreadListItem(session: PlanSession): ThreadListItem {
  const kind: "main" | "side" = isSideThreadSession(session)
    ? "side"
    : isMainThreadSession(session)
      ? "main"
      : "side";
  const threadId =
    kind === "main"
      ? "main"
      : String(session.threadId ?? session.planId).trim() || session.planId;
  const turns = Array.isArray(session.conversationHistory)
    ? session.conversationHistory.length
    : 0;
  const knownFacts = Array.isArray(session.knownFacts) ? session.knownFacts.length : 0;
  const previewRaw = lastMessagePreview(session);

  if (kind === "main") {
    return {
      threadId: "main",
      kind: "main",
      pinned: true,
      title: MAIN_THREAD_TITLE,
      preview: previewRaw || MAIN_THREAD_PREVIEW_EMPTY,
      badge: "主线程",
      planId: session.planId,
      updatedAt: session.updatedAt,
      turns,
      knownFacts,
    };
  }

  return {
    threadId,
    kind: "side",
    pinned: false,
    title: inferSideThreadTitle(session),
    preview: previewRaw || SIDE_THREAD_PREVIEW_EMPTY,
    badge: "侧会话",
    planId: session.planId,
    updatedAt: session.updatedAt,
    turns,
    knownFacts,
  };
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
