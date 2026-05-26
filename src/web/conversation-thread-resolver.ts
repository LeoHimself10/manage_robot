import { randomUUID } from "node:crypto";

import { formatSideThreadDefaultTitle } from "../infra/conversation-present";
import {
  createPlanSessionStore,
  hashChatKey,
  type PlanSession,
} from "../infra/plan-session-store";
import {
  loadAllPlanSessions,
  resolveCanonicalMainSession,
  sessionBelongsToManager,
  type PlanSessionRow,
} from "./canonical-main-session";

export type { PlanSessionRow } from "./canonical-main-session";
export { isMainThreadSession, loadAllPlanSessions } from "./canonical-main-session";

const planSessionStore = createPlanSessionStore();

export function isSideThreadSession(session: PlanSession): boolean {
  if (session.threadKind === "side") return true;
  if (session.threadKind === "main") return false;
  return false;
}

export function sessionsForManager(userId: string): PlanSessionRow[] {
  const uid = userId.trim();
  return loadAllPlanSessions().filter((s) => sessionBelongsToManager(s, uid));
}

function sortByUpdatedDesc(sessions: PlanSessionRow[]): PlanSessionRow[] {
  return [...sessions].sort((a, b) => {
    const ta = Date.parse(a.updatedAt ?? "") || 0;
    const tb = Date.parse(b.updatedAt ?? "") || 0;
    return tb - ta;
  });
}

export function findMainThreadSession(userId: string): PlanSessionRow {
  return resolveCanonicalMainSession(userId);
}

export function createSideThreadSession(userId: string): PlanSessionRow {
  const threadId = randomUUID();
  const chatKey = `workbench:side:${userId}:${threadId}`;
  const now = new Date().toISOString();
  const threadLabel = formatSideThreadDefaultTitle(new Date(now));
  const created: PlanSessionRow = {
    chatKeyHash: hashChatKey(chatKey),
    planId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    senderStaffId: userId,
    threadKind: "side",
    threadId,
    threadLabel,
    knownFacts: [],
    conversationHistory: [],
  };
  planSessionStore.save(created);
  return created;
}

export interface ResolveConversationThreadQuery {
  threadId?: string;
  threadKind?: "main" | "side";
  planId?: string;
}

export function resolveConversationThread(
  userId: string,
  query: ResolveConversationThreadQuery = {},
): PlanSessionRow | undefined {
  const threadId = String(query.threadId ?? "").trim();
  const threadKind = query.threadKind;
  const planId = String(query.planId ?? "").trim();

  if (threadKind === "main" || threadId === "main") {
    return findMainThreadSession(userId);
  }

  if (threadKind === "side" && threadId) {
    const side = sessionsForManager(userId).find(
      (s) => s.threadKind === "side" && s.threadId === threadId,
    );
    return side;
  }

  if (threadId && threadId !== "main") {
    const byId = sessionsForManager(userId).find(
      (s) => s.threadId === threadId || s.planId === threadId,
    );
    if (byId) return byId;
  }

  if (planId) {
    const matches = sortByUpdatedDesc(
      sessionsForManager(userId).filter((s) => s.planId === planId),
    );
    return matches[0];
  }

  return findMainThreadSession(userId);
}

export function listManagerConversationSessions(userId: string): PlanSessionRow[] {
  const main = findMainThreadSession(userId);
  const side = sortByUpdatedDesc(
    sessionsForManager(userId).filter(
      (s) => isSideThreadSession(s) && s.chatKeyHash !== main.chatKeyHash,
    ),
  );
  return [main, ...side];
}

/** When dingtalk creates/updates a session, mark it as the canonical main thread. */
export function markSessionAsMainThread(session: PlanSession): PlanSession {
  return {
    ...session,
    threadKind: "main",
    threadId: "main",
  };
}

export { planSessionStore as conversationPlanSessionStore };
