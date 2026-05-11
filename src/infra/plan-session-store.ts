import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { appendJsonlLine } from "./write-jsonl";

export interface PlanSessionEvent {
  planId: string;
  chatKeyHash: string;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

interface ConversationSessionStateBase {
  conversationId: string;
  updatedAt?: string;
  completedAt?: string;
}

export type ConversationSessionState =
  | (ConversationSessionStateBase & { stage: "WAITING_MODEL" })
  | (ConversationSessionStateBase & {
      stage: "WAITING_MANAGER";
      managerUserId?: string;
    })
  | (ConversationSessionStateBase & {
      stage: "WAITING_EMPLOYEE";
      employeeUserId?: string;
    })
  | (ConversationSessionStateBase & { stage: "READY_TO_APPLY" });

export interface PlanSession {
  chatKeyHash: string;
  planId: string;
  createdAt: string;
  updatedAt: string;
  lastTraceId?: string;
  knownFacts: string[];
  conversationHistory: Array<{ role: string; content: string }>;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  revisionEvents?: Array<Record<string, unknown>>;
  conversationSessions?: ConversationSessionState[];
}

export interface PlanSessionStoreOptions {
  sessionDir?: string;
  eventsPath?: string;
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

export function createPlanSessionStore(options: PlanSessionStoreOptions = {}) {
  const sessionDir = options.sessionDir?.trim() || resolvePlanSessionDir();
  const eventsPath = options.eventsPath?.trim() || resolvePlanSessionEventsPath();

  return {
    loadByChatKey(chatKey: string): PlanSession | undefined {
      const chatKeyHash = hashChatKey(chatKey);
      return loadByChatKeyHash(sessionDir, chatKeyHash);
    },

    loadOrCreate(chatKey: string): PlanSession {
      const chatKeyHash = hashChatKey(chatKey);
      const existing = loadByChatKeyHash(sessionDir, chatKeyHash);
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
      writeSession(sessionDir, created);
      return created;
    },

    save(session: PlanSession): void {
      writeSession(sessionDir, {
        ...session,
        updatedAt: new Date().toISOString(),
      });
    },

    appendEvent(event: PlanSessionEvent): void {
      appendJsonlLine(eventsPath, {
        ...event,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
      });
    },
  };
}

function sessionFile(sessionDir: string, chatKeyHash: string): string {
  return join(sessionDir, `${chatKeyHash}.json`);
}

function loadByChatKeyHash(sessionDir: string, chatKeyHash: string): PlanSession | undefined {
  try {
    const file = sessionFile(sessionDir, chatKeyHash);
    const loaded = JSON.parse(readFileSync(file, "utf8")) as PlanSession;
    const normalized: PlanSession = {
      ...loaded,
      knownFacts: Array.isArray(loaded.knownFacts) ? loaded.knownFacts : [],
      conversationHistory: Array.isArray(loaded.conversationHistory)
        ? loaded.conversationHistory
        : [],
    };
    if (Array.isArray(loaded.conversationSessions)) {
      normalized.conversationSessions = loaded.conversationSessions;
    }
    return normalized;
  } catch {
    return undefined;
  }
}

function writeSession(sessionDir: string, session: PlanSession): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(sessionFile(sessionDir, session.chatKeyHash), JSON.stringify(session, null, 2), "utf8");
}
