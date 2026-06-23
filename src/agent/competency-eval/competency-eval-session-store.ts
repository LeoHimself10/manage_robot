import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";

import { resolveCompetencyEvalDataDir } from "./rubric-store";

export interface CompEvalChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompEvalSessionListItem {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeRubricId?: string;
  rubricTitle?: string;
  rubricDimCount?: number;
}

export interface CompEvalSession {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CompEvalChatMessage[];
  activeRubricId?: string;
  rubricTitle?: string;
  rubricDimCount?: number;
}

interface SessionIndex {
  activeSessionId?: string;
  sessions: CompEvalSessionListItem[];
}

const DEFAULT_MAX_SESSIONS = 40;
const DEFAULT_MAX_MESSAGES = 20;

function sanitizeId(id: string): string | null {
  const trimmed = String(id ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

function userSessionsRoot(userId: string): string | null {
  const id = sanitizeId(userId);
  if (!id) return null;
  return join(resolveCompetencyEvalDataDir(), "users", id, "sessions");
}

function sessionFilePath(userId: string, sessionId: string): string | null {
  const root = userSessionsRoot(userId);
  const sid = sanitizeId(sessionId);
  if (!root || !sid) return null;
  return join(root, `${sid}.json`);
}

function indexPath(userId: string): string | null {
  const root = userSessionsRoot(userId);
  if (!root) return null;
  return join(root, "index.json");
}

function resolveMaxSessions(): number {
  const raw = String(process.env.COMPETENCY_EVAL_MAX_SESSIONS ?? "").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SESSIONS;
}

function resolveMaxMessages(): number {
  const raw = String(process.env.COMPETENCY_EVAL_SESSION_MAX_MESSAGES ?? "").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_MESSAGES;
}

function writeJsonAtomic(path: string, obj: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
}

function readIndex(userId: string): SessionIndex {
  const path = indexPath(userId);
  if (!path || !fs.existsSync(path)) return { sessions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as SessionIndex;
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return {
      activeSessionId: String(parsed.activeSessionId ?? "").trim() || undefined,
      sessions: parsed.sessions,
    };
  } catch {
    return { sessions: [] };
  }
}

function writeIndex(userId: string, index: SessionIndex): void {
  const path = indexPath(userId);
  const root = userSessionsRoot(userId);
  if (!path || !root) return;
  fs.mkdirSync(root, { recursive: true });
  writeJsonAtomic(path, index);
}

function deriveTitle(messages: CompEvalChatMessage[]): string {
  for (const m of messages) {
    if (m.role === "user" && m.content.trim()) {
      const t = m.content.trim().replace(/\s+/g, " ");
      return t.length > 42 ? `${t.slice(0, 42)}…` : t;
    }
  }
  return "新评估";
}

function toListItem(session: CompEvalSession): CompEvalSessionListItem {
  return {
    sessionId: session.sessionId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    activeRubricId: session.activeRubricId,
    rubricTitle: session.rubricTitle,
    rubricDimCount: session.rubricDimCount,
  };
}

function readSessionFile(userId: string, sessionId: string): CompEvalSession | null {
  const path = sessionFilePath(userId, sessionId);
  if (!path || !fs.existsSync(path)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as CompEvalSession;
    if (!parsed?.sessionId) return null;
    return normalizeSession(parsed);
  } catch {
    return null;
  }
}

function normalizeSession(raw: CompEvalSession): CompEvalSession {
  const messages: CompEvalChatMessage[] = [];
  const maxMsg = resolveMaxMessages();
  for (const row of raw.messages ?? []) {
    if (!row || typeof row !== "object") continue;
    const role = row.role === "user" ? "user" : row.role === "assistant" ? "assistant" : null;
    const content = String(row.content ?? "").trim();
    if (!role || !content) continue;
    messages.push({ role, content: content.slice(0, 4000) });
  }
  const trimmed = messages.slice(-maxMsg);
  const title = String(raw.title ?? "").trim() || deriveTitle(trimmed);
  return {
    sessionId: String(raw.sessionId),
    title,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    messages: trimmed,
    activeRubricId: String(raw.activeRubricId ?? "").trim() || undefined,
    rubricTitle: String(raw.rubricTitle ?? "").trim() || undefined,
    rubricDimCount: raw.rubricDimCount ? Number(raw.rubricDimCount) : undefined,
  };
}

function writeSession(userId: string, session: CompEvalSession): void {
  const path = sessionFilePath(userId, session.sessionId);
  const root = userSessionsRoot(userId);
  if (!path || !root) return;
  fs.mkdirSync(root, { recursive: true });
  writeJsonAtomic(path, session);
}

function upsertIndexItem(userId: string, session: CompEvalSession, active?: boolean): SessionIndex {
  const index = readIndex(userId);
  const item = toListItem(session);
  const rest = index.sessions.filter((s) => s.sessionId !== item.sessionId);
  index.sessions = [item, ...rest].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const max = resolveMaxSessions();
  if (index.sessions.length > max) {
    const drop = index.sessions.slice(max);
    index.sessions = index.sessions.slice(0, max);
    for (const d of drop) {
      const p = sessionFilePath(userId, d.sessionId);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  if (active || !index.activeSessionId) index.activeSessionId = session.sessionId;
  writeIndex(userId, index);
  return index;
}

export function listCompEvalSessions(userId: string): {
  sessions: CompEvalSessionListItem[];
  activeSessionId?: string;
} {
  const index = readIndex(userId);
  return {
    sessions: index.sessions,
    activeSessionId: index.activeSessionId,
  };
}

export function getCompEvalSession(userId: string, sessionId: string): CompEvalSession | null {
  return readSessionFile(userId, sessionId);
}

export function createCompEvalSession(userId: string): CompEvalSession | null {
  const root = userSessionsRoot(userId);
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  const now = new Date().toISOString();
  const session: CompEvalSession = {
    sessionId: randomUUID(),
    title: "新评估",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  writeSession(userId, session);
  upsertIndexItem(userId, session, true);
  return session;
}

export function saveCompEvalSession(
  userId: string,
  sessionId: string,
  patch: {
    messages?: CompEvalChatMessage[];
    title?: string;
    activeRubricId?: string;
    rubricTitle?: string;
    rubricDimCount?: number;
  },
): CompEvalSession | null {
  const existing = readSessionFile(userId, sessionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  let messages = existing.messages;
  if (patch.messages) {
    messages = patch.messages
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content ?? "").trim().slice(0, 4000),
      }))
      .filter((m) => m.content) as CompEvalChatMessage[];
    messages = messages.slice(-resolveMaxMessages());
  }
  const session: CompEvalSession = {
    ...existing,
    messages,
    title: String(patch.title ?? "").trim() || deriveTitle(messages) || existing.title,
    updatedAt: now,
    activeRubricId: patch.activeRubricId !== undefined
      ? String(patch.activeRubricId ?? "").trim() || undefined
      : existing.activeRubricId,
    rubricTitle: patch.rubricTitle !== undefined
      ? String(patch.rubricTitle ?? "").trim() || undefined
      : existing.rubricTitle,
    rubricDimCount: patch.rubricDimCount !== undefined ? patch.rubricDimCount : existing.rubricDimCount,
  };
  writeSession(userId, session);
  upsertIndexItem(userId, session);
  return session;
}

export function deleteCompEvalSession(userId: string, sessionId: string): boolean {
  const path = sessionFilePath(userId, sessionId);
  if (!path || !fs.existsSync(path)) return false;
  fs.unlinkSync(path);
  const index = readIndex(userId);
  index.sessions = index.sessions.filter((s) => s.sessionId !== sessionId);
  if (index.activeSessionId === sessionId) {
    index.activeSessionId = index.sessions[0]?.sessionId;
  }
  writeIndex(userId, index);
  return true;
}

export function setActiveCompEvalSession(userId: string, sessionId: string): boolean {
  const session = readSessionFile(userId, sessionId);
  if (!session) return false;
  const index = readIndex(userId);
  index.activeSessionId = sessionId;
  writeIndex(userId, index);
  return true;
}

export function parseCompEvalSessionIdFromPath(pathname: string): string | null {
  const prefix = "/api/workbench/competency-eval/sessions/";
  if (!pathname.startsWith(prefix)) return null;
  const sessionId = pathname.slice(prefix.length).trim();
  if (!sessionId || sessionId.includes("/")) return null;
  return sessionId;
}
