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

/**
 * 单个任务作用域归档。每次主管/规划者切换主题（start_new_task）或回切（switch_back_task）时，
 * 当前顶层 latestDraft / latestAssignment / knownFacts 会被快照到这里。
 * 顶层字段仍是真理来源（"current scope"），taskScopes 是归档库。
 */
export interface TaskScope {
  scopeId: string;
  scopeLabel: string;
  createdAt: string;
  updatedAt: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  knownFacts?: string[];
}

export interface ScopeAuditEntry {
  at: string;
  eventType: "SCOPE_CREATED" | "SCOPE_SWITCHED" | "SCOPE_ARCHIVED" | "SCOPE_RESTORED";
  fromScopeId?: string;
  toScopeId?: string;
  scopeLabel?: string;
  reason?: string;
}

/**
 * 主管上传花名册（md/pdf/docx）后由 agent 解析+核对得到的"硬约束候选池"。
 * 一旦设置，本 plan 的所有 search_employees / 指派校验都只能命中池内 userId。
 * unresolved 用于交互式核对（"未匹配到 X，是不是 Y？"）。
 */
export interface CandidatePoolEntry {
  userId: string;
  displayName: string;
  /** 文件中针对该员工的备注 / 角色 / 期望职责，原文片段。可空。 */
  fileNotes?: string;
}

export interface CandidatePoolUnresolved {
  rawName: string;
  hint?: string;
}

export interface CandidatePool {
  /** 池来源标签（例如 "uploaded:roster.md"）；纯展示与审计用。 */
  source: string;
  entries: CandidatePoolEntry[];
  unresolved?: CandidatePoolUnresolved[];
  updatedAt: string;
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
  /** 当前激活的 taskScope id。loadOrCreate 时会自动生成 default scope。 */
  currentTaskScopeId?: string;
  /** scopeId → 归档的 scope 快照（含未激活的）。激活的 scope 也会持续镜像到这里。 */
  taskScopes?: Record<string, TaskScope>;
  /** 主题切换审计轨迹。 */
  scopeAuditTrail?: ScopeAuditEntry[];
  /** 主管上传名单 → 解析+核对后的硬约束候选池。 */
  candidatePool?: CandidatePool;
  /** 主管刚上传、尚未被 agent 处理的 roster 原文（md/pdf/docx 提取出的纯文本）。 */
  pendingRosterText?: string;
  /** pendingRosterText 的来源标签（如 "uploaded:roster.md" / "dingtalk_file:abc.pdf"）。 */
  pendingRosterSource?: string;
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

function generateScopeId(): string {
  return `scope:${randomUUID().slice(0, 8)}`;
}

/**
 * 把当前顶层活跃字段（latestDraft / latestAssignment / knownFacts）镜像到
 * `taskScopes[currentTaskScopeId]`，确保归档与"current"始终一致。
 * 不会 mutate 顶层；返回更新后的 session。原 session 输入也会被 in-place 修改。
 */
export function mirrorActiveScope(session: PlanSession): PlanSession {
  const scopeId = session.currentTaskScopeId;
  if (!scopeId) return session;
  if (!session.taskScopes) session.taskScopes = {};
  const now = new Date().toISOString();
  const existing = session.taskScopes[scopeId];
  session.taskScopes[scopeId] = {
    scopeId,
    scopeLabel: existing?.scopeLabel ?? "默认任务",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    latestDraft: session.latestDraft,
    latestAssignment: session.latestAssignment,
    knownFacts: [...(session.knownFacts ?? [])],
  };
  return session;
}

/**
 * 归档当前 scope 并创建一个全新的 active scope。把顶层 latestDraft/
 * latestAssignment/knownFacts 清空。返回新 scopeId。
 */
export function startNewTaskScope(
  session: PlanSession,
  input: { scopeLabel: string; reason?: string },
): { fromScopeId?: string; fromScopeLabel?: string; toScopeId: string; toScopeLabel: string } {
  const fromScopeId = session.currentTaskScopeId;
  const fromScopeLabel = fromScopeId ? session.taskScopes?.[fromScopeId]?.scopeLabel : undefined;
  if (fromScopeId) mirrorActiveScope(session);

  const now = new Date().toISOString();
  const toScopeId = generateScopeId();
  const toScopeLabel = input.scopeLabel.trim() || "新任务";
  if (!session.taskScopes) session.taskScopes = {};
  session.taskScopes[toScopeId] = {
    scopeId: toScopeId,
    scopeLabel: toScopeLabel,
    createdAt: now,
    updatedAt: now,
    latestDraft: undefined,
    latestAssignment: undefined,
    knownFacts: [],
  };
  session.currentTaskScopeId = toScopeId;
  session.latestDraft = undefined;
  session.latestAssignment = undefined;
  session.knownFacts = [];
  appendScopeAudit(session, {
    at: now,
    eventType: "SCOPE_CREATED",
    fromScopeId,
    toScopeId,
    scopeLabel: toScopeLabel,
    reason: input.reason,
  });
  return { fromScopeId, fromScopeLabel, toScopeId, toScopeLabel };
}

/**
 * 把当前 scope 归档后切回目标 scope（按 scopeId 精确匹配或 scopeLabel 关键词匹配）。
 * 找不到时返回 candidates 列表供模型/调用方提示用户。
 */
export function restoreTaskScope(
  session: PlanSession,
  input: { scopeId?: string; scopeLabelKeyword?: string; reason?: string },
):
  | { ok: true; fromScopeId?: string; toScopeId: string; toScopeLabel: string; hasDraft: boolean }
  | { ok: false; reason: "scope_not_found" | "no_archived_scopes" | "missing_query"; candidates: Array<{ scopeId: string; scopeLabel: string; hasDraft: boolean }> } {
  const archives = session.taskScopes ?? {};
  const allScopes = Object.values(archives);
  const candidates = allScopes
    .filter((s) => s.scopeId !== session.currentTaskScopeId)
    .map((s) => ({
      scopeId: s.scopeId,
      scopeLabel: s.scopeLabel,
      hasDraft: Boolean(s.latestDraft),
    }));

  if (allScopes.length <= 1) {
    return { ok: false, reason: "no_archived_scopes", candidates };
  }
  const targetId = input.scopeId?.trim();
  const targetKeyword = input.scopeLabelKeyword?.trim();
  if (!targetId && !targetKeyword) {
    return { ok: false, reason: "missing_query", candidates };
  }

  let target: TaskScope | undefined;
  if (targetId) target = archives[targetId];
  if (!target && targetKeyword) {
    const lower = targetKeyword.toLowerCase();
    target = allScopes.find(
      (s) => s.scopeId !== session.currentTaskScopeId
        && s.scopeLabel.toLowerCase().includes(lower),
    );
  }
  if (!target) {
    return { ok: false, reason: "scope_not_found", candidates };
  }
  if (target.scopeId === session.currentTaskScopeId) {
    return { ok: false, reason: "scope_not_found", candidates };
  }

  const fromScopeId = session.currentTaskScopeId;
  if (fromScopeId) mirrorActiveScope(session);

  session.currentTaskScopeId = target.scopeId;
  session.latestDraft = target.latestDraft;
  session.latestAssignment = target.latestAssignment;
  session.knownFacts = [...(target.knownFacts ?? [])];

  const now = new Date().toISOString();
  appendScopeAudit(session, {
    at: now,
    eventType: "SCOPE_RESTORED",
    fromScopeId,
    toScopeId: target.scopeId,
    scopeLabel: target.scopeLabel,
    reason: input.reason,
  });
  return {
    ok: true,
    fromScopeId,
    toScopeId: target.scopeId,
    toScopeLabel: target.scopeLabel,
    hasDraft: Boolean(target.latestDraft),
  };
}

function appendScopeAudit(session: PlanSession, entry: ScopeAuditEntry): void {
  if (!session.scopeAuditTrail) session.scopeAuditTrail = [];
  session.scopeAuditTrail.push(entry);
  if (session.scopeAuditTrail.length > 50) {
    session.scopeAuditTrail.splice(0, session.scopeAuditTrail.length - 50);
  }
}

/**
 * 兼容老 session：没有 currentTaskScopeId 的旧文件被读出时，
 * 自动建一个 default scope 把现有 latestDraft / latestAssignment / knownFacts 收进去。
 */
function ensureDefaultScope(session: PlanSession): void {
  if (session.currentTaskScopeId && session.taskScopes?.[session.currentTaskScopeId]) {
    return;
  }
  const now = session.updatedAt || new Date().toISOString();
  const scopeId = generateScopeId();
  if (!session.taskScopes) session.taskScopes = {};
  session.taskScopes[scopeId] = {
    scopeId,
    scopeLabel: "默认任务",
    createdAt: session.createdAt || now,
    updatedAt: now,
    latestDraft: session.latestDraft,
    latestAssignment: session.latestAssignment,
    knownFacts: [...(session.knownFacts ?? [])],
  };
  session.currentTaskScopeId = scopeId;
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
      ensureDefaultScope(created);
      writeSession(created);
      return created;
    },

    save(session: PlanSession): void {
      const next: PlanSession = {
        ...session,
        updatedAt: new Date().toISOString(),
      };
      ensureDefaultScope(next);
      mirrorActiveScope(next);
      writeSession(next);
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
    const session: PlanSession = {
      ...loaded,
      knownFacts: Array.isArray(loaded.knownFacts) ? loaded.knownFacts : [],
      conversationHistory: Array.isArray(loaded.conversationHistory)
        ? loaded.conversationHistory
        : [],
    };
    ensureDefaultScope(session);
    return session;
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
