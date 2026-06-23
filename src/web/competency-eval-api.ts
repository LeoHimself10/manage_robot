import type { IncomingMessage, ServerResponse } from "node:http";

import { isCompetencyEvalUser } from "../agent/competency-eval/competency-eval-access";
import { isCompetencyEvalEnabled } from "../agent/competency-eval/competency-eval-flag";
import {
  deleteRubric,
  listRubrics,
  saveUploadedRubric,
} from "../agent/competency-eval/rubric-store";
import {
  createCompEvalSession,
  deleteCompEvalSession,
  getCompEvalSession,
  listCompEvalSessions,
  parseCompEvalSessionIdFromPath,
  saveCompEvalSession,
  setActiveCompEvalSession,
  type CompEvalChatMessage,
} from "../agent/competency-eval/competency-eval-session-store";
import type { WorkbenchSession } from "./assignment-workbench-session-types";

export function isCompetencyEvalPageEnabled(): boolean {
  return isCompetencyEvalEnabled();
}

export type CompetencyEvalChatTurn = { role: "user" | "assistant"; content: string };

const COMP_EVAL_CHAT_HISTORY_MAX_TURNS = 20;
const COMP_EVAL_CHAT_TURN_MAX_CHARS = 4000;

/** 解析能力评估 POST /chat 的 conversationHistory（仅 user/assistant，截断长度与轮数）。 */
export function parseCompetencyEvalConversationHistory(raw: unknown): CompetencyEvalChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: CompetencyEvalChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const role = r.role === "user" ? "user" : r.role === "assistant" ? "assistant" : null;
    const content = String(r.content ?? "").trim();
    if (!role || !content) continue;
    out.push({ role, content: content.slice(0, COMP_EVAL_CHAT_TURN_MAX_CHARS) });
  }
  return out.slice(-COMP_EVAL_CHAT_HISTORY_MAX_TURNS);
}

function writeCompetencyEvalForbidden(res: ServerResponse, error: string): void {
  if (res.headersSent) return;
  res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error }));
}

/**
 * 能力评估门禁：实例开关 + 白名单。须先由调用方解析 workbench session 并传入。
 */
export function requireCompetencyEvalSession(
  req: IncomingMessage,
  res: ServerResponse,
  session?: WorkbenchSession,
): WorkbenchSession | undefined {
  void req;
  if (!isCompetencyEvalPageEnabled()) {
    writeCompetencyEvalForbidden(res, "competency eval disabled");
    return undefined;
  }
  if (!session) return undefined;
  if (!isCompetencyEvalUser(session.userId)) {
    writeCompetencyEvalForbidden(res, "competency eval forbidden");
    return undefined;
  }
  return session;
}

export function buildCompetencyEvalRubricsPayload(userId: string): Record<string, unknown> {
  return { ok: true, rubrics: listRubrics(userId) };
}

export async function handleCompetencyEvalRubricUpload(input: {
  userId: string;
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<Record<string, unknown>> {
  const result = await saveUploadedRubric(input);
  if (!result.ok) {
    return { ok: false, error: result.reason, message: result.message };
  }
  return {
    ok: true,
    rubric: result.rubric,
    activeRubricId: result.rubric.rubricId,
  };
}

export function handleCompetencyEvalRubricDelete(
  userId: string,
  rubricId: string,
): Record<string, unknown> {
  const id = String(rubricId ?? "").trim();
  if (!id) return { ok: false, error: "rubricId is required" };
  const deleted = deleteRubric(userId, id);
  if (!deleted) return { ok: false, error: "not_found" };
  return { ok: true };
}

export function parseCompetencyEvalRubricIdFromPath(pathname: string): string | null {
  const prefix = "/api/workbench/competency-eval/rubrics/";
  if (!pathname.startsWith(prefix)) return null;
  const rubricId = pathname.slice(prefix.length).trim();
  if (!rubricId || rubricId.includes("/")) return null;
  return rubricId;
}

export function buildCompetencyEvalSessionsPayload(userId: string): Record<string, unknown> {
  let data = listCompEvalSessions(userId);
  if (!data.sessions.length) {
    const created = createCompEvalSession(userId);
    if (created) data = listCompEvalSessions(userId);
  }
  return { ok: true, ...data };
}

export function handleCompetencyEvalSessionCreate(userId: string): Record<string, unknown> {
  const session = createCompEvalSession(userId);
  if (!session) return { ok: false, error: "create_failed" };
  return { ok: true, session, activeSessionId: session.sessionId };
}

export function handleCompetencyEvalSessionGet(
  userId: string,
  sessionId: string,
): Record<string, unknown> {
  const session = getCompEvalSession(userId, sessionId);
  if (!session) return { ok: false, error: "not_found" };
  return { ok: true, session };
}

export function handleCompetencyEvalSessionSave(
  userId: string,
  sessionId: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages = parseCompetencyEvalConversationHistory(body.messages);
  const patch: {
    messages?: CompEvalChatMessage[];
    title?: string;
    activeRubricId?: string;
    rubricTitle?: string;
    rubricDimCount?: number;
  } = {};
  if (body.messages !== undefined) patch.messages = messages;
  if (body.title !== undefined) patch.title = String(body.title ?? "");
  if (body.activeRubricId !== undefined) patch.activeRubricId = String(body.activeRubricId ?? "");
  if (body.rubricTitle !== undefined) patch.rubricTitle = String(body.rubricTitle ?? "");
  if (body.rubricDimCount !== undefined) {
    const n = Number(body.rubricDimCount);
    if (Number.isFinite(n)) patch.rubricDimCount = n;
  }
  const session = saveCompEvalSession(userId, sessionId, patch);
  if (!session) return { ok: false, error: "not_found" };
  return { ok: true, session };
}

export function handleCompetencyEvalSessionDelete(
  userId: string,
  sessionId: string,
): Record<string, unknown> {
  const deleted = deleteCompEvalSession(userId, sessionId);
  if (!deleted) return { ok: false, error: "not_found" };
  const data = listCompEvalSessions(userId);
  if (!data.sessions.length) {
    const created = createCompEvalSession(userId);
    if (created) return { ok: true, ...listCompEvalSessions(userId) };
  }
  return { ok: true, ...data };
}

export function handleCompetencyEvalSessionActivate(
  userId: string,
  sessionId: string,
): Record<string, unknown> {
  const ok = setActiveCompEvalSession(userId, sessionId);
  if (!ok) return { ok: false, error: "not_found" };
  return { ok: true, activeSessionId: sessionId };
}

export function parseCompetencyEvalSessionActivatePath(pathname: string): string | null {
  const m = /^\/api\/workbench\/competency-eval\/sessions\/([^/]+)\/activate$/.exec(pathname);
  if (!m) return null;
  const id = m[1]?.trim();
  return id || null;
}
