import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { appendJsonlLine } from "./write-jsonl";

export interface PlanSessionEvent {
  planId: string;
  chatKeyHash: string;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

export interface PlanSession {
  chatKeyHash: string;
  planId: string;
  createdAt: string;
  updatedAt: string;
  lastAgentProfile?: "planner" | "manager" | "employee";
  conversationId?: string;
  conversationType?: string;
  senderStaffId?: string;
  sessionWebhookLastSeen?: string;
  lastTraceId?: string;
  knownFacts: string[];
  conversationHistory: Array<{ role: string; content: string }>;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  revisionEvents?: Array<Record<string, unknown>>;
}

export function resolvePlanSessionDir(): string {
  return process.env.PLAN_SESSION_DIR?.trim() || "./data/sessions";
}

export function resolvePlanSessionEventsPath(): string {
  return process.env.PLAN_SESSION_EVENTS_PATH?.trim() || "./data/events/plan-session-events.jsonl";
}

export function hashChatKey(chatKey: string): string {
  return createHash("sha256").update(chatKey).digest("hex");
}

export function createPlanSessionStore() {
  return {
    loadByChatKey(chatKey: string): PlanSession | undefined {
      const chatKeyHash = hashChatKey(chatKey);
      return loadByChatKeyHash(chatKeyHash);
    },

    loadByChatKeyHash(chatKeyHash: string): PlanSession | undefined {
      return loadByChatKeyHash(chatKeyHash);
    },

    loadOrCreate(chatKey: string): PlanSession {
      const chatKeyHash = hashChatKey(chatKey);
      const existing = loadByChatKeyHash(chatKeyHash);
      if (existing) return existing;
      const now = new Date().toISOString();
      const created: PlanSession = {
        chatKeyHash,
        planId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        knownFacts: [],
        conversationHistory: [],
      };
      writeSession(created);
      return created;
    },

    save(session: PlanSession): void {
      writeSession({
        ...session,
        updatedAt: new Date().toISOString(),
      });
    },

    deleteByChatKey(chatKey: string): void {
      const chatKeyHash = hashChatKey(chatKey);
      deleteByChatKeyHash(chatKeyHash);
    },

    appendEvent(event: PlanSessionEvent): void {
      appendJsonlLine(resolvePlanSessionEventsPath(), {
        ...event,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
      });
    },
  };
}

function sessionFile(chatKeyHash: string): string {
  return join(resolvePlanSessionDir(), `${chatKeyHash}.json`);
}

function loadByChatKeyHash(chatKeyHash: string): PlanSession | undefined {
  try {
    const file = sessionFile(chatKeyHash);
    const loaded = JSON.parse(readFileSync(file, "utf8")) as PlanSession;
    return {
      ...loaded,
      knownFacts: Array.isArray(loaded.knownFacts) ? loaded.knownFacts : [],
      conversationHistory: Array.isArray(loaded.conversationHistory)
        ? loaded.conversationHistory
        : [],
    };
  } catch {
    return undefined;
  }
}

function writeSession(session: PlanSession): void {
  const dir = resolvePlanSessionDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(sessionFile(session.chatKeyHash), JSON.stringify(session, null, 2), "utf8");
}

function deleteByChatKeyHash(chatKeyHash: string): void {
  try {
    const file = sessionFile(chatKeyHash);
    if (existsSync(file)) unlinkSync(file);
  } catch {
    // ignore delete failures
  }
}
