import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export interface JobReqMeta {
  jobReqId: string;
  filename: string;
  uploadedAt: string;
}

function resolveJobReqDataDir(): string {
  const raw = String(process.env.COMPETENCY_EVAL_DATA_DIR ?? "").trim();
  return raw || "data/competency-eval";
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

function userJobReqsRoot(userId: string): string | null {
  const id = sanitizeId(userId);
  if (!id) return null;
  return join(resolveJobReqDataDir(), "users", id, "job-reqs");
}

function jobReqDir(userId: string, jobReqId: string): string | null {
  const root = userJobReqsRoot(userId);
  const rid = sanitizeId(jobReqId);
  if (!root || !rid) return null;
  return join(root, rid);
}

export function listJobReqs(userId: string): JobReqMeta[] {
  const root = userJobReqsRoot(userId);
  if (!root || !existsSync(root)) return [];
  const items: JobReqMeta[] = [];
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const metaPath = join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as JobReqMeta;
        if (!meta?.jobReqId || !meta?.filename) continue;
        items.push(meta);
      } catch { /* ignore corrupt */ }
    }
  } catch { return []; }
  return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function getJobReq(userId: string, jobReqId: string): { ok: true; content: string; meta: JobReqMeta } | { ok: false; reason: string } {
  const dir = jobReqDir(userId, jobReqId);
  if (!dir || !existsSync(dir)) return { ok: false, reason: "not_found" };
  const sourcePath = join(dir, "source.md");
  const metaPath = join(dir, "meta.json");
  if (!existsSync(sourcePath) || !existsSync(metaPath)) return { ok: false, reason: "not_found" };
  try {
    const content = readFileSync(sourcePath, "utf8");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as JobReqMeta;
    return { ok: true, content, meta };
  } catch { return { ok: false, reason: "corrupt" }; }
}

export async function saveJobReq(input: {
  userId: string;
  filename: string;
  buffer: Buffer;
}): Promise<{ ok: true; meta: JobReqMeta } | { ok: false; reason: string; message: string }> {
  const root = userJobReqsRoot(input.userId);
  if (!root) return { ok: false, reason: "invalid_user", message: "无效的用户标识。" };
  const jobReqId = randomUUID();
  const uploadedAt = new Date().toISOString();
  const filename = input.filename.trim() || "upload.md";
  const dir = join(root, jobReqId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: "io_error", message: String(e) };
  }
  const meta: JobReqMeta = { jobReqId, filename, uploadedAt };
  const pid = process.pid;
  const tmpSource = join(dir, `source.md.tmp-${pid}`);
  const tmpMeta = join(dir, `meta.json.tmp-${pid}`);
  try {
    writeFileSync(tmpSource, input.buffer.toString("utf8"), "utf8");
    writeFileSync(tmpMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    renameSync(tmpSource, join(dir, "source.md"));
    renameSync(tmpMeta, join(dir, "meta.json"));
  } catch (e) {
    // Clean up temp files on failure
    try { rmSync(tmpSource, { force: true }); } catch { /* ignore */ }
    try { rmSync(tmpMeta, { force: true }); } catch { /* ignore */ }
    return { ok: false, reason: "io_error", message: String(e) };
  }
  return { ok: true, meta };
}

export function deleteJobReq(userId: string, jobReqId: string): boolean {
  const dir = jobReqDir(userId, jobReqId);
  if (!dir) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { return false; }
  return true;
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

export function buildJobReqsPayload(userId: string): Record<string, unknown> {
  return { ok: true, jobReqs: listJobReqs(userId) };
}

export async function handleJobReqUpload(input: {
  userId: string;
  filename: string;
  buffer: Buffer;
}): Promise<Record<string, unknown>> {
  const result = await saveJobReq(input);
  if (!result.ok) return { ok: false, error: result.reason, message: result.message };
  return { ok: true, jobReq: result.meta };
}

export function handleJobReqDelete(userId: string, jobReqId: string): Record<string, unknown> {
  const id = String(jobReqId ?? "").trim();
  if (!id) return { ok: false, error: "jobReqId is required" };
  const deleted = deleteJobReq(userId, id);
  if (!deleted) return { ok: false, error: "not_found" };
  return { ok: true };
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
