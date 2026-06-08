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
  /** 该 scope 对应的规划 id；与顶层 `session.planId` 在激活时保持一致。 */
  planId: string;
  createdAt: string;
  updatedAt: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  knownFacts?: string[];
  /** 若本 scope 已成功发布正式任务，记录业务编号便于回查。 */
  publishedTaskNo?: string;
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
  /** Workbench thread model: dingtalk canonical main vs workbench-only side session. */
  threadKind?: "main" | "side";
  /** `main` for primary thread; uuid for side threads. */
  threadId?: string;
  /** Default side-thread label before first user message (e.g. 新规划会话 · MM-DD HH:mm). */
  threadLabel?: string;
  lastAgentProfile?: "planner" | "manager" | "employee";
  conversationId?: string;
  conversationType?: string;
  senderStaffId?: string;
  /** Canonical manager id for main-thread dedup (workbench + DingTalk). */
  canonicalUserId?: string;
  sessionWebhookLastSeen?: string;
  lastTraceId?: string;
  knownFacts: string[];
  conversationHistory: Array<{
    role: string;
    content: string;
    /** Full user-visible markdown (tables, assignment section); orchestrator uses `content` only. */
    displayContent?: string;
    at?: string;
  }>;
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
  /** search_employees 命中缓存；ASSIGN 阶段 update_draft_task 校验 assignee 来源。plan rotate 时清空。 */
  lastEmployeeSearchHits?: Array<{
    userId: string;
    displayName: string;
    department?: string;
    hitAt: string;
  }>;
  /** 大项目可选层：当前规划默认归属（portfolio 主管） */
  activeProjectId?: string;
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

/** 钉钉单聊内发布成功后是否自动轮转 `planId`（默认开启）。设为 `0` 关闭。 */
export function readDingtalkPlanIdRotateEnabled(): boolean {
  return String(process.env.DINGTALK_PLANID_ROTATE_ENABLED ?? "1").trim() !== "0";
}

function generateScopeId(): string {
  return `scope:${randomUUID().slice(0, 8)}`;
}

/**
 * 旧会话文件里 taskScopes 可能没有 planId；补全并与顶层对齐。
 */
export function migrateTaskScopePlanIds(session: PlanSession): void {
  if (!session.taskScopes) return;
  for (const s of Object.values(session.taskScopes)) {
    if (!String(s.planId ?? "").trim()) {
      s.planId = session.planId;
    }
  }
  const curId = session.currentTaskScopeId;
  if (curId && session.taskScopes[curId]?.planId) {
    session.planId = session.taskScopes[curId].planId;
  }
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
    planId: session.planId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    publishedTaskNo: existing?.publishedTaskNo,
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
): {
  fromScopeId?: string;
  fromScopeLabel?: string;
  fromPlanId: string;
  toScopeId: string;
  toScopeLabel: string;
  toPlanId: string;
  clearedHistoryEntries: number;
} {
  const fromPlanId = session.planId;
  const fromScopeId = session.currentTaskScopeId;
  const fromScopeLabel = fromScopeId ? session.taskScopes?.[fromScopeId]?.scopeLabel : undefined;
  if (fromScopeId) mirrorActiveScope(session);

  const now = new Date().toISOString();
  const toScopeId = generateScopeId();
  const toPlanId = randomUUID();
  const toScopeLabel = input.scopeLabel.trim() || "新任务";
  if (!session.taskScopes) session.taskScopes = {};
  session.taskScopes[toScopeId] = {
    scopeId: toScopeId,
    scopeLabel: toScopeLabel,
    planId: toPlanId,
    createdAt: now,
    updatedAt: now,
    latestDraft: undefined,
    latestAssignment: undefined,
    knownFacts: [],
  };
  session.currentTaskScopeId = toScopeId;
  session.planId = toPlanId;
  session.latestDraft = undefined;
  session.latestAssignment = undefined;
  session.knownFacts = [];
  // 候选池与 pendingRoster 都按 plan 维度生效（"本 plan 指派只能在池内"），
  // 开新 scope = 开新 plan，必须一并清，否则下一条新任务会被旧名单"粘"上。
  session.candidatePool = undefined;
  session.pendingRosterText = undefined;
  session.pendingRosterSource = undefined;
  session.lastEmployeeSearchHits = [];
  // portfolio 项目归属按当前规划上下文生效，新 scope 须清，避免无关任务继承旧项目。
  session.activeProjectId = undefined;
  // 清空对话历史，防止模型将上一条任务的人名/编号/上下文带入新任务。
  // 保留单条 [system_note] 作为 scope 边界锚点，让模型知道自己已切换到新任务。
  const history = session.conversationHistory ?? [];
  const clearedHistoryEntries = history.length;
  session.conversationHistory = [
    {
      role: "assistant",
      content: `[system_note] 已切到任务「${toScopeLabel}」。旧任务的人员名单 / task_x 编号 / 姓名不应被引用。当前 planId=${toPlanId}。`,
      at: now,
    },
  ];
  appendScopeAudit(session, {
    at: now,
    eventType: "SCOPE_CREATED",
    fromScopeId,
    toScopeId,
    scopeLabel: toScopeLabel,
    reason: input.reason,
  });
  return { fromScopeId, fromScopeLabel, fromPlanId, toScopeId, toScopeLabel, toPlanId, clearedHistoryEntries };
}

/**
 * 发布成功后：给当前 scope 打上 `publishedTaskNo`，归档并新开 scope + 新 `planId`。
 */
export function markPublishedAndRotatePlanSession(
  session: PlanSession,
  input: { taskNo: string; scopeLabel?: string; reason?: string },
):
  | { fromPlanId: string; toPlanId: string; fromScopeId?: string; toScopeId: string }
  | { skipped: true; reason: string } {
  if (!session.currentTaskScopeId) {
    ensureDefaultScope(session);
  }
  if (!session.currentTaskScopeId) {
    return { skipped: true, reason: "no_current_scope" };
  }
  if (!session.taskScopes) session.taskScopes = {};
  const curId = session.currentTaskScopeId;
  const scope = session.taskScopes[curId];
  if (scope) {
    const tn = input.taskNo.trim();
    if (tn) scope.publishedTaskNo = tn;
    if (!String(scope.planId ?? "").trim()) {
      scope.planId = session.planId;
    }
  }
  const rot = startNewTaskScope(session, {
    scopeLabel: input.scopeLabel ?? "（发布后新规划）",
    reason: input.reason ?? "auto_rotate_after_publish",
  });
  return {
    fromPlanId: rot.fromPlanId,
    toPlanId: session.planId,
    fromScopeId: rot.fromScopeId,
    toScopeId: rot.toScopeId,
  };
}

/**
 * 把当前 scope 归档后切回目标 scope（按 scopeId 精确匹配或 scopeLabel 关键词匹配）。
 * 找不到时返回 candidates 列表供模型/调用方提示用户。
 */
export function restoreTaskScope(
  session: PlanSession,
  input: { scopeId?: string; scopeLabelKeyword?: string; reason?: string },
):
  | {
      ok: true;
      fromScopeId?: string;
      toScopeId: string;
      toScopeLabel: string;
      toPlanId: string;
      hasDraft: boolean;
      clearedHistoryEntries: number;
    }
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
  const toPlanId = String(target.planId ?? "").trim() || session.planId;
  session.planId = toPlanId;
  session.latestDraft = target.latestDraft;
  session.latestAssignment = target.latestAssignment;
  session.knownFacts = [...(target.knownFacts ?? [])];
  // candidatePool / pendingRoster 当前只在顶层、按 plan 维度生效，scope 归档没存。
  // 切回旧 scope 时必须清掉，否则上一份名单会泄漏到回切后的 plan 里。
  // 用户若需要继续用旧名单，可以重新上传或主管手动重选。
  session.candidatePool = undefined;
  session.pendingRosterText = undefined;
  session.pendingRosterSource = undefined;
  session.activeProjectId = undefined;

  const now = new Date().toISOString();
  // 清空对话历史，防止跨 scope 污染。
  const restoreHistory = session.conversationHistory ?? [];
  const clearedHistoryEntries = restoreHistory.length;
  session.conversationHistory = [
    {
      role: "assistant",
      content: `[system_note] 已切回任务「${target.scopeLabel}」。当前 planId=${toPlanId}。${Boolean(target.latestDraft) ? "原草案已恢复，可继续讨论或发布。" : "该 scope 之前无草案，需重新拆解。"}旧任务的人员名单 / task_x 编号 / 姓名不应被引用。`,
      at: now,
    },
  ];
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
    toPlanId,
    hasDraft: Boolean(target.latestDraft),
    clearedHistoryEntries,
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
    planId: session.planId,
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
      migrateTaskScopePlanIds(next);
      mirrorActiveScope(next);
      writeSession(next);
    },

    deleteByChatKey(chatKey: string): void {
      const chatKeyHash = hashChatKey(chatKey);
      deleteByChatKeyHash(chatKeyHash);
    },

    deleteByChatKeyHash(chatKeyHash: string): void {
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
    migrateTaskScopePlanIds(session);
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
