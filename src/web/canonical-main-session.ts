import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createPlanSessionStore,
  hashChatKey,
  resolvePlanSessionDir,
  type PlanSession,
} from "../infra/plan-session-store";

export type PlanSessionRow = PlanSession & { chatKeyHash: string };

export function loadAllPlanSessions(): PlanSessionRow[] {
  try {
    const dir = resolvePlanSessionDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const out: PlanSessionRow[] = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(join(dir, file), "utf8"),
        ) as PlanSession;
        const chatKeyHash =
          typeof raw.chatKeyHash === "string"
            ? raw.chatKeyHash
            : file.replace(/\.json$/, "");
        out.push({ ...raw, chatKeyHash });
      } catch {
        // skip malformed session files
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function isMainThreadSession(session: PlanSession): boolean {
  if (session.threadKind === "side") return false;
  if (session.threadKind === "main") return true;
  if (String(session.conversationId ?? "").trim()) return true;
  return false;
}

const planSessionStore = createPlanSessionStore();

export const MAIN_SESSION_MERGE_EVENT = "MAIN_SESSION_MERGE";

export function canonicalMainChatKey(userId: string): string {
  return `workbench:main:${userId.trim()}`;
}

export function sessionBelongsToManager(session: PlanSession, userId: string): boolean {
  const uid = userId.trim();
  if (!uid) return false;
  if (session.senderStaffId === uid) return true;
  if (session.canonicalUserId === uid) return true;
  return false;
}

export function listMainThreadCandidates(
  userId: string,
  dingtalkChatKey?: string,
): PlanSessionRow[] {
  const uid = userId.trim();
  const byHash = new Map<string, PlanSessionRow>();

  for (const row of loadAllPlanSessions()) {
    if (!isMainThreadSession(row)) continue;
    if (!sessionBelongsToManager(row, uid)) continue;
    byHash.set(row.chatKeyHash, row);
  }

  if (dingtalkChatKey?.trim()) {
    const dt = planSessionStore.loadByChatKey(dingtalkChatKey.trim());
    if (dt && isMainThreadSession(dt)) {
      const hash = hashChatKey(dingtalkChatKey.trim());
      byHash.set(hash, { ...dt, chatKeyHash: hash });
    }
  }

  return [...byHash.values()];
}

function sessionHasDraft(session: PlanSession): boolean {
  const tasks = (session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

function isDingtalkMainSession(session: PlanSession): boolean {
  return Boolean(String(session.conversationId ?? "").trim());
}

function sortHistory(
  history: PlanSession["conversationHistory"] | undefined,
  limit: number,
): PlanSession["conversationHistory"] {
  const rows = [...(history ?? [])];
  rows.sort(
    (a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0),
  );
  return rows.slice(-limit);
}

function mergeKnownFacts(a: string[] = [], b: string[] = []): string[] {
  return Array.from(
    new Set([...a, ...b].map((f) => String(f).trim()).filter(Boolean)),
  ).slice(-50);
}

export function pickPrimaryMainSession(candidates: PlanSessionRow[]): PlanSessionRow {
  const sorted = [...candidates].sort((a, b) => {
    const aDt = isDingtalkMainSession(a) ? 1 : 0;
    const bDt = isDingtalkMainSession(b) ? 1 : 0;
    if (aDt !== bDt) return bDt - aDt;
    const aDraft = sessionHasDraft(a) ? 1 : 0;
    const bDraft = sessionHasDraft(b) ? 1 : 0;
    if (aDraft !== bDraft) return bDraft - aDraft;
    return (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0);
  });
  return sorted[0];
}

export function mergeMainSessions(
  primary: PlanSessionRow,
  secondaries: PlanSessionRow[],
): PlanSessionRow {
  let merged: PlanSessionRow = { ...primary };
  for (const sec of secondaries) {
    if (!sessionHasDraft(merged) && sessionHasDraft(sec)) {
      merged.latestDraft = sec.latestDraft;
      merged.latestAssignment = sec.latestAssignment;
      merged.planId = sec.planId || merged.planId;
    }
    merged.conversationHistory = sortHistory(
      [...(merged.conversationHistory ?? []), ...(sec.conversationHistory ?? [])],
      20,
    );
    merged.knownFacts = mergeKnownFacts(merged.knownFacts, sec.knownFacts);
    if (!merged.conversationId && sec.conversationId) {
      merged.conversationId = sec.conversationId;
      merged.conversationType = sec.conversationType;
      merged.sessionWebhookLastSeen = sec.sessionWebhookLastSeen;
    }
    if (!merged.candidatePool && sec.candidatePool) {
      merged.candidatePool = sec.candidatePool;
    }
    if (!merged.pendingRosterText && sec.pendingRosterText) {
      merged.pendingRosterText = sec.pendingRosterText;
      merged.pendingRosterSource = sec.pendingRosterSource;
    }
    if (sec.taskScopes && Object.keys(sec.taskScopes).length > 0) {
      merged.taskScopes = { ...(merged.taskScopes ?? {}), ...sec.taskScopes };
    }
    if (sec.revisionEvents?.length) {
      merged.revisionEvents = [
        ...(merged.revisionEvents ?? []),
        ...sec.revisionEvents,
      ].slice(-60);
    }
  }
  return merged;
}

function persistCanonicalRow(
  row: PlanSessionRow,
  userId: string,
  deleteHashes: string[],
): PlanSessionRow {
  const canonicalHash = hashChatKey(canonicalMainChatKey(userId));
  const canonical: PlanSessionRow = {
    ...row,
    chatKeyHash: canonicalHash,
    senderStaffId: userId,
    canonicalUserId: userId,
    threadKind: "main",
    threadId: "main",
    updatedAt: new Date().toISOString(),
  };
  planSessionStore.save(canonical);
  for (const h of deleteHashes) {
    if (h && h !== canonicalHash) {
      planSessionStore.deleteByChatKeyHash(h);
    }
  }
  return canonical;
}

export interface ResolveCanonicalMainSessionOpts {
  dingtalkChatKey?: string;
}

export function resolveCanonicalMainSession(
  userId: string,
  opts: ResolveCanonicalMainSessionOpts = {},
): PlanSessionRow {
  const uid = userId.trim();
  const canonicalHash = hashChatKey(canonicalMainChatKey(uid));
  let candidates = listMainThreadCandidates(uid, opts.dingtalkChatKey);

  if (candidates.length === 0) {
    const created = planSessionStore.loadOrCreate(canonicalMainChatKey(uid));
    const row: PlanSessionRow = {
      ...created,
      chatKeyHash: canonicalHash,
      senderStaffId: uid,
      canonicalUserId: uid,
      threadKind: "main",
      threadId: "main",
    };
    planSessionStore.save(row);
    return row;
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    if (only.chatKeyHash === canonicalHash) {
      const patched: PlanSessionRow = {
        ...only,
        senderStaffId: uid,
        canonicalUserId: uid,
        threadKind: "main",
        threadId: "main",
      };
      planSessionStore.save(patched);
      return patched;
    }
    return persistCanonicalRow(only, uid, [only.chatKeyHash]);
  }

  const primary = pickPrimaryMainSession(candidates);
  const secondaries = candidates.filter((c) => c.chatKeyHash !== primary.chatKeyHash);
  const merged = mergeMainSessions(primary, secondaries);
  const deleteHashes = candidates.map((c) => c.chatKeyHash);

  planSessionStore.appendEvent({
    planId: merged.planId,
    chatKeyHash: canonicalHash,
    eventType: MAIN_SESSION_MERGE_EVENT,
    payload: {
      mergedFrom: deleteHashes.filter((h) => h !== canonicalHash),
      primaryWas: primary.chatKeyHash,
    },
  });

  return persistCanonicalRow(merged, uid, deleteHashes);
}
