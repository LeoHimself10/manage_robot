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

export function sideThreadChatKey(userId: string, threadId: string): string {
  return `workbench:side:${userId.trim()}:${threadId.trim()}`;
}

/** Restore side metadata when a session file was wrongly promoted to main (e.g. after send). */
export function healSideThreadSession(
  session: PlanSessionRow,
  userId: string,
  threadId: string,
): PlanSessionRow {
  const uid = userId.trim();
  const tid = threadId.trim();
  if (!uid || !tid || tid === "main") return session;
  const expectedHash = hashChatKey(sideThreadChatKey(uid, tid));
  if (session.chatKeyHash !== expectedHash) return session;
  if (session.threadKind === "side" && session.threadId === tid) return session;
  const healed: PlanSessionRow = {
    ...session,
    threadKind: "side",
    threadId: tid,
    senderStaffId: session.senderStaffId ?? uid,
    threadLabel:
      String(session.threadLabel ?? "").trim() ||
      formatSideThreadDefaultTitle(
        session.createdAt ? new Date(session.createdAt) : new Date(),
      ),
  };
  planSessionStore.save(healed);
  return healed;
}

export function preserveThreadIdentityOnSave(session: PlanSession): PlanSession {
  const uid = String(session.senderStaffId ?? session.canonicalUserId ?? "").trim();
  const tid = String(session.threadId ?? "").trim();
  if (uid && tid && tid !== "main") {
    const expectedHash = hashChatKey(sideThreadChatKey(uid, tid));
    if (session.chatKeyHash === expectedHash) {
      return { ...session, threadKind: "side", threadId: tid };
    }
  }
  if (isSideThreadSession(session)) {
    return {
      ...session,
      threadKind: "side",
      threadId: tid || session.threadId,
    };
  }
  return markSessionAsMainThread(session);
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

export function renameSideThreadSession(
  userId: string,
  threadId: string,
  threadLabel: string,
): PlanSessionRow | undefined {
  const label = threadLabel.trim();
  if (!label || label.length > 40) {
    throw new Error("threadLabel must be 1-40 characters");
  }
  const target = resolveConversationThread(userId, { threadKind: "side", threadId });
  if (!target || !isSideThreadSession(target)) return undefined;
  const updated: PlanSessionRow = {
    ...target,
    threadLabel: label,
    updatedAt: new Date().toISOString(),
  };
  planSessionStore.save(updated);
  return updated;
}

export function deleteSideThreadSession(userId: string, threadId: string): boolean {
  const tid = threadId.trim();
  if (!tid || tid === "main") return false;
  const target = resolveConversationThread(userId, { threadKind: "side", threadId: tid });
  if (!target || !isSideThreadSession(target)) return false;
  planSessionStore.deleteByChatKeyHash(target.chatKeyHash);
  return true;
}

export function createSideThreadSession(userId: string): PlanSessionRow {
  const threadId = randomUUID();
  const chatKey = sideThreadChatKey(userId, threadId);
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
    const byHash = sessionsForManager(userId).find(
      (s) => s.chatKeyHash === hashChatKey(sideThreadChatKey(userId, threadId)),
    );
    if (byHash) return healSideThreadSession(byHash, userId, threadId);
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
