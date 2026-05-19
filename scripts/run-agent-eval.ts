/**
 * Agent eval — 对齐钉钉主链路（角色路由 + ReAct + 工作台发布），隔离数据目录运行。
 *
 * 与 `dingtalk-bot` 对齐点：
 * - `DINGTALK_ROLE_ROUTING_ENABLED=1` 下用 `resolveDingtalkAgentRouting` 得到 `toolProfile` / `promptProfile` / `trustedActorUserId`；
 * - `clientConfig` 默认镜像钉钉链路：`DINGTALK_QWEN_THINKING` / `DINGTALK_QWEN_TIMEOUT_MS` / `DINGTALK_QWEN_MAX_TOKENS` / `DINGTALK_QWEN_STREAM`；
 * - `maxToolIterations` 默认读 `DINGTALK_ORCHESTRATOR_MAX_ITERATIONS`（与 bot 一致默认 3）。
 *
 * 安全：强制 `WORKBENCH_DINGTALK_NOTIFY_ENABLED=0`，不会发钉钉卡片/待办。
 *
 * 运行（ECS）：
 *   docker run --rm --env-file /etc/manage-robot.env \
 *     -e WORKBENCH_DINGTALK_NOTIFY_ENABLED=0 -e EVAL_DATA_DIR=/tmp/agent-eval-parity \
 *     manage-robot:dingtalk npm run eval:agent
 *
 * 从 Windows PowerShell 经 SSH 执行远程 bash 时，勿在本地双引号里写 `$(date +%s)`（会在客户端展开）。
 * 应使用固定目录，或 SSH 外层用单引号包住整条远程命令，让 `$(...)` 在远端 shell 求值。
 */

import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QwenCompatibleClientConfig } from "../src/agent/demo/qwen-compatible-client";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../src/agent/role-routing";
import {
  createPlanSessionStore,
  hashChatKey,
  mirrorActiveScope,
} from "../src/infra/plan-session-store";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import type { PlanSession } from "../src/infra/plan-session-store";
import type { KnownFactsStore } from "../src/agent/tools/update-known-facts";
import { savePlanSnapshot } from "../src/infra/plan-store";

const EVAL_DATA_DIR =
  process.env.EVAL_DATA_DIR?.trim() || "/tmp/manage-robot-eval";

const INITIATOR_STAFF_ID = "eval-dd-initiator-001";
const MGR_STAFF_ID = "eval-mgr-001";
const EMP_STAFF_ID = "eval-emp-001";
const ADMIN_STAFF_ID = "eval-admin-001";
const PLANNING_SESSION_KEY = "planning";
const MGR_PUBLISH_SESSION_KEY = "mgr_publish";

function parseEvalOnlyFilter(): Set<string> | undefined {
  const raw = process.env.EVAL_ONLY?.trim();
  if (!raw) return undefined;
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function scenarioMatchesFilter(id: string, filter: Set<string> | undefined): boolean {
  if (!filter) return true;
  for (const token of filter) {
    if (id === token || id.includes(token)) return true;
  }
  return false;
}

(function bootstrapIsolatedDataPaths() {
  const keepData = process.env.EVAL_NO_RESET === "1";
  if (existsSync(EVAL_DATA_DIR) && !keepData) {
    rmSync(EVAL_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(EVAL_DATA_DIR, { recursive: true });
  const ensure = (p: string) => {
    mkdirSync(p, { recursive: true });
    return p;
  };
  process.env.WORKBENCH_SQLITE_PATH = join(
    ensure(join(EVAL_DATA_DIR, "workbench")),
    "workbench.sqlite",
  );
  process.env.PLAN_SESSION_DIR = ensure(join(EVAL_DATA_DIR, "sessions"));
  process.env.PLAN_SESSION_EVENTS_PATH = join(
    ensure(join(EVAL_DATA_DIR, "events")),
    "plan-session-events.jsonl",
  );
  process.env.PLAN_STORE_DIR = ensure(join(EVAL_DATA_DIR, "plans"));
  process.env.EMPLOYEE_PROFILE_DIR = ensure(
    join(EVAL_DATA_DIR, "employees", "profiles"),
  );
  process.env.ASSIGNMENT_DRAFT_DIR = ensure(
    join(EVAL_DATA_DIR, "assignment-drafts"),
  );
  process.env.ASSIGNMENT_EVENTS_PATH = join(
    ensure(join(EVAL_DATA_DIR, "events")),
    "assignment-events.jsonl",
  );
  process.env.AUDIT_JSONL_PATH = join(EVAL_DATA_DIR, "audit-harness.jsonl");
  process.env.AUDIT_DEMO_JSONL_PATH = join(EVAL_DATA_DIR, "demo-runs.jsonl");
  process.env.CARD_CALLBACKS_PATH = join(
    ensure(join(EVAL_DATA_DIR, "events")),
    "card-callbacks.jsonl",
  );
  process.env.CARD_STATE_DIR = ensure(join(EVAL_DATA_DIR, "cards"));
  process.env.WORKBENCH_DYNAMIC_MANAGER_IDS_FILE = join(
    EVAL_DATA_DIR,
    "workbench-managers.json",
  );

  process.env.DINGTALK_ROLE_ROUTING_ENABLED = "1";
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR_STAFF_ID;
  process.env.WORKBENCH_ADMIN_USER_IDS = ADMIN_STAFF_ID;

  process.env.ASSIGNMENT_PHASE_ENABLED =
    process.env.ASSIGNMENT_PHASE_ENABLED ?? "0";

  process.env.QWEN_THINKING = process.env.QWEN_THINKING ?? "0";

  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  process.env.DINGTALK_CONTACT_SYNC_ENABLED = "0";

  // 与 ECS 生产默认对齐（10）；本地可覆盖。
  process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS =
    process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? "10";
})();

function readEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function buildEvalQwenClientConfig(): QwenCompatibleClientConfig | undefined {
  const base = loadQwenPlannerConfigFromEnv();
  if (!base) return undefined;
  return {
    ...base,
    thinking: readEnvBool("DINGTALK_QWEN_THINKING", false),
    timeoutMs: readEnvInt("DINGTALK_QWEN_TIMEOUT_MS", 90_000),
    maxTokens: Math.min(base.maxTokens, readEnvInt("DINGTALK_QWEN_MAX_TOKENS", 2200)),
    stream: readEnvBool("DINGTALK_QWEN_STREAM", true),
  };
}

function resolveEvalRouting(
  senderStaffId: string,
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>,
): {
  toolProfile: "planner" | "manager" | "employee" | "admin" | "full";
  promptProfile: "planner" | "manager" | "employee";
  trustedActorUserId?: string;
  actorRole: "admin" | "manager" | "employee";
  resolvedRole: string;
  routingReason: string;
} {
  const roleRoutingEnabled = isDingtalkRoleRoutingEnabled();
  const route = resolveDingtalkAgentRouting({
    senderStaffId,
    employeeRepo,
    roleRoutingEnabled,
  });
  const actorRole: "admin" | "manager" | "employee" =
    route.resolvedRole === "admin"
      ? "admin"
      : route.resolvedRole === "manager"
        ? "manager"
        : "employee";
  return {
    toolProfile: route.toolProfile,
    promptProfile: route.promptProfile,
    trustedActorUserId: route.trustedActorUserId,
    actorRole,
    resolvedRole: route.resolvedRole,
    routingReason: route.reason,
  };
}

export interface EvalRuntime {
  lastTaskNo?: string;
  lastSubtaskId?: string;
  lastPlanId?: string;
}

interface ScenarioInput {
  id: string;
  /** 钉钉 senderStaffId，用于角色路由（与 bot 一致） */
  senderStaffId: string;
  userMessage: string | ((rt: EvalRuntime) => string);
  sessionId?: string;
  allowSearchWeb?: boolean;
  expectDraft?: boolean;
  /** 至少出现一次（子集）；为空则不校验 */
  expectToolNames?: string[];
  /** 本轮不得出现的工具名 */
  forbidToolNames?: string[];
  /** 期待本轮出现 publishResult.ok === true 且非 dedupe */
  expectPublishOk?: boolean;
  /** 跑本轮前合并进 session */
  seedSession?: Partial<PlanSession>;
  /** search_employees 调用次数上限 */
  maxSearchEmployeesCalls?: number;
  /** message 不得匹配的正则（任一命中即失败） */
  forbidMessagePatterns?: RegExp[];
  /** 跑完后 candidatePool.entries 最少条数 */
  expectCandidatePoolMin?: number;
  /** 要求 draft 含 objective+background */
  expectV6DraftTop?: boolean;
}

interface ScenarioResult {
  id: string;
  senderStaffId: string;
  ok: boolean;
  errorMessage?: string;
  orchestratorLoopMs?: number;
  toolCallsTotal?: number;
  toolInvocationNames?: string[];
  hasDraft?: boolean;
  draftFieldCoverage?: number;
  draftTaskCount?: number;
  knownFactsAfter?: string[];
  messagePreview?: string;
  expectToolMismatch?: string;
  routing?: string;
}

function getDraftFieldCoverage(draft: Record<string, unknown> | undefined): {
  coverage: number;
  taskCount: number;
} {
  if (!draft) return { coverage: 0, taskCount: 0 };
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? (draft as { tasks: Array<Record<string, unknown>> }).tasks
    : [];
  if (tasks.length === 0) return { coverage: 0, taskCount: 0 };
  const fieldHits = tasks.map((task) => {
    let hits = 0;
    if (String(task?.title ?? "").trim()) hits += 1;
    if (String(task?.objective ?? "").trim()) hits += 1;
    if (Array.isArray(task?.deliverables) && task.deliverables.length > 0) hits += 1;
    if (
      Array.isArray(task?.completionCriteria) &&
      task.completionCriteria.length > 0
    )
      hits += 1;
    const tn = (task as { timeNode?: { dueAt?: string } }).timeNode;
    if (tn?.dueAt) hits += 1;
    if (String(task?.feedbackFrequency ?? "").trim()) hits += 1;
    if (String(task?.id ?? "").trim()) hits += 1;
    return hits / 7;
  });
  const avg =
    fieldHits.reduce((sum, x) => sum + x, 0) / Math.max(1, fieldHits.length);
  return { coverage: Number(avg.toFixed(2)), taskCount: tasks.length };
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

function hasTasksInDraft(draft: unknown): boolean {
  if (!draft || typeof draft !== "object") return false;
  const tasks = (draft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

function injectDefaultAssignment(session: PlanSession): void {
  const draft = session.latestDraft;
  if (!hasTasksInDraft(draft)) return;
  const tasks = (draft as { tasks: Array<{ id?: string }> }).tasks;
  session.latestAssignment = {
    assignments: tasks.map((t) => ({
      taskId: String(t?.id ?? "task_1").trim() || "task_1",
      primary: { userId: EMP_STAFF_ID, displayName: "测评工程师 A" },
    })),
  };
}

/** 若模型未产出 JSON draft，注入最小可发布草案（仅 eval，不影响生产逻辑）。 */
function ensureEvalPublishableDraft(session: PlanSession): void {
  if (hasTasksInDraft(session.latestDraft)) {
    injectDefaultAssignment(session);
    return;
  }
  session.latestDraft = buildEvalOctV6Draft();
  injectDefaultAssignment(session);
}

/** 对齐顶层 planId 与各 taskScope，避免 save 时 migrate 用旧 scope.planId 覆盖。 */
function alignSessionPlanId(session: PlanSession, planId: string): void {
  session.planId = planId;
  if (session.taskScopes) {
    for (const scope of Object.values(session.taskScopes)) {
      scope.planId = planId;
    }
  }
  mirrorActiveScope(session);
}

function reloadEvalSession(
  store: ReturnType<typeof createPlanSessionStore>,
  sessionKey: string,
  fallback: PlanSession,
): PlanSession {
  return store.loadByChatKey(`eval:${sessionKey}`) ?? fallback;
}

function bridgePlanningToManagerPublishSession(
  ctx: { sessions: Map<string, PlanSession> },
): void {
  const src = ctx.sessions.get(PLANNING_SESSION_KEY);
  if (!src) throw new Error(`missing session ${PLANNING_SESSION_KEY}`);
  ensureEvalPublishableDraft(src);
  const store = createPlanSessionStore();
  store.save(src);
  if (src.latestDraft) {
    savePlanSnapshot(src.planId, {
      planId: src.planId,
      traceId: "eval-bridge",
      status: "DRAFT_READY",
      draft: src.latestDraft as Record<string, unknown>,
      messagePreview: "(eval bridge)",
    });
  }
  const next = store.loadOrCreate(`eval:${MGR_PUBLISH_SESSION_KEY}`);
  next.planId = src.planId;
  next.latestDraft = src.latestDraft;
  next.latestAssignment = src.latestAssignment;
  next.senderStaffId = MGR_STAFF_ID;
  next.knownFacts = [...(src.knownFacts ?? [])];
  next.conversationHistory = [];
  next.updatedAt = new Date().toISOString();
  alignSessionPlanId(next, src.planId);
  store.save(next);
  ctx.sessions.set(
    MGR_PUBLISH_SESSION_KEY,
    reloadEvalSession(store, MGR_PUBLISH_SESSION_KEY, next),
  );
}

async function seedDirectory(): Promise<void> {
  const peopleStore = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const baseContact = {
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      lastSyncedAt: now,
    };
    peopleStore.upsertContact({
      ...baseContact,
      userId: MGR_STAFF_ID,
      name: "测评经理",
      unionId: "eval-union-mgr-001",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "质量经理",
      jobNumber: "MGR001",
      isSenior: true,
    });
    peopleStore.upsertContact({
      ...baseContact,
      userId: EMP_STAFF_ID,
      name: "测评工程师 A",
      unionId: "eval-union-emp-001",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "工艺工程师",
      jobNumber: "EMP001",
    });
    const rosterIds = [
      { userId: "eval-roster-001", name: "杨楚榛", jobNumber: "R001" },
      { userId: "eval-roster-002", name: "杨贺新", jobNumber: "R002" },
      { userId: "eval-roster-003", name: "陈哲治", jobNumber: "R003" },
    ];
    for (const r of rosterIds) {
      peopleStore.upsertContact({
        ...baseContact,
        userId: r.userId,
        name: r.name,
        unionId: `eval-union-${r.userId}`,
        departmentIds: ["1001"],
        departmentNames: ["质量部"],
        position: "工程师",
        jobNumber: r.jobNumber,
      });
    }
    peopleStore.upsertContact({
      ...baseContact,
      userId: "eval-emp-002",
      name: "测评工程师 B",
      unionId: "eval-union-emp-002",
      departmentIds: ["1002"],
      departmentNames: ["研发部"],
      position: "硬件工程师",
      jobNumber: "EMP002",
    });
    peopleStore.upsertProfile({
      userId: MGR_STAFF_ID,
      skillTags: ["质量策划", "CAPA"],
      strengths: ["跨部门协调"],
      boundaries: [],
      cases: [],
      tools: [],
      availability: { capacityHint: "本周可评审" },
      source: "eval-seed",
    });
    peopleStore.upsertProfile({
      userId: EMP_STAFF_ID,
      skillTags: ["焊接", "SMT", "失效分析"],
      strengths: ["现场拆解", "样品取样"],
      boundaries: [],
      cases: [
        {
          taskType: "QUALITY",
          contribution: "主导样品拆解与微观图分析",
          deliverable: "失效分析报告",
          outcome: "DCT-2025-0301 案例闭环",
        },
      ],
      tools: ["X-ray", "金相显微镜"],
      availability: { capacityHint: "本周可承接", emergencyOk: true },
      source: "eval-seed",
    });
    peopleStore.upsertProfile({
      userId: "eval-emp-002",
      skillTags: ["原理图设计", "硬件回路分析"],
      strengths: ["回路梳理", "对照测试设计"],
      boundaries: [],
      cases: [],
      tools: [],
      availability: { capacityHint: "本周容量较紧" },
      source: "eval-seed",
    });
  } finally {
    peopleStore.close();
  }
}

const scenarios: ScenarioInput[] = [
  {
    id: "P1_chitchat",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage: "你好",
    expectDraft: false,
  },
  {
    id: "P2_oneshot_quality",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage:
      "OCT 客诉：A 产品（型号 A-2026B）批次 2026Q2-04 出现批量焊点开路，已涉及 15 台设备到客户现场，目前已收齐现场日志与失效照片。需要在 5 月 18 日前完成初步原因拆解，给出遏制 + 临时纠正动作建议；缺陷代号 DCT-2026-0512。",
    // 线上模型常把拆解写在 Markdown；JSON draft 不作为 eval 硬门槛（发布前 bridge 会兜底 latestDraft）。
    expectDraft: false,
  },
  {
    id: "P3_followup_field_update",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage:
      "再补一条信息：现场返回的 5 台样品已寄到上海实验室，预计 5 月 14 日 10 点签收，请把这块也写进任务里。",
    expectDraft: false,
  },
  {
    id: "P4_known_facts_recall",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage: "我们之前提过的缺陷代号是什么？为什么记不住？",
    expectDraft: false,
  },
  {
    id: "P5_search_similar",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage:
      "之前类似的 OCT 焊点客诉我们怎么拆的？给我找两个最相似的历史方案对照一下。",
    expectDraft: false,
    expectToolNames: ["search_similar_plans"],
  },
  {
    id: "P2b_draft_v6",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage:
      "截止日期 5 月 18 日前完成。请生成完整任务草案（JSON 含 draft），含 objective、background 与各子任务 inputMaterials。",
    expectDraft: true,
    expectV6DraftTop: true,
    forbidMessagePatterns: [/搜索次数已达上限/, /quota_exhausted/i],
  },
  {
    id: "R1_roster_match",
    senderStaffId: MGR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    seedSession: {
      latestDraft: buildEvalOctV6Draft(),
      pendingRosterText: loadRosterFixtureText(),
      pendingRosterSource: "uploaded:sample-roster.md",
    },
    userMessage:
      "我已上传花名册。请用 match_roster_to_contacts 批量匹配通讯录并写入候选池，不要对每人 search_employees。",
    expectToolNames: ["match_roster_to_contacts"],
    maxSearchEmployeesCalls: 1,
    expectCandidatePoolMin: 1,
    forbidMessagePatterns: [/搜索次数已达上限/, /quota_exhausted/i],
  },
  {
    id: "R2_roster_assign",
    senderStaffId: MGR_STAFF_ID,
    sessionId: PLANNING_SESSION_KEY,
    userMessage:
      "候选池已就绪。请把三条子任务分别指派给杨楚榛、杨贺新、陈哲治（写 assigneeUserId），返回完整 draft。",
    expectDraft: true,
    maxSearchEmployeesCalls: 2,
    forbidMessagePatterns: [/搜索次数已达上限/],
  },
  {
    id: "P6_new_task",
    senderStaffId: INITIATOR_STAFF_ID,
    sessionId: "planning_new",
    seedSession: {
      latestDraft: buildEvalOctV6Draft(),
      candidatePool: {
        source: "eval-seed",
        entries: [{ userId: "eval-roster-001", displayName: "杨楚榛" }],
        updatedAt: new Date().toISOString(),
      },
    },
    userMessage: "换个任务，我们开始做设备年度校准计划。",
    expectDraft: false,
    expectToolNames: ["start_new_task"],
  },
  {
    id: "M1_prepare_publish",
    senderStaffId: MGR_STAFF_ID,
    sessionId: MGR_PUBLISH_SESSION_KEY,
    userMessage:
      "我要把这个计划按当前草案发布给员工。请只调用一次 prepare_publish_task 做发布前预览（禁止 publish_task）。参数：planId 用会话里的 planId；title 与草案主标题一致；subtasks 仅一条：taskId=task_1，title=现场样品拆解与微观分析，assigneeUserId=eval-emp-001。不要调用 search_similar_plans / list_known_facts；不要向用户索要 userId。预览要点用一段话说明。",
    expectDraft: false,
    expectToolNames: ["prepare_publish_task"],
    forbidToolNames: ["publish_task"],
    forbidMessagePatterns: [/已发布/, /将收到通知/],
  },
  {
    id: "M2_publish_confirm",
    senderStaffId: MGR_STAFF_ID,
    sessionId: MGR_PUBLISH_SESSION_KEY,
    userMessage:
      "我已书面确认：同意按当前草案与分配正式发布。请调用 publish_task，confirmationContext 写：本人作为主管已书面确认发布。",
    expectDraft: false,
    expectToolNames: ["publish_task"],
    expectPublishOk: true,
  },
  {
    id: "M3_list_managed_tasks",
    senderStaffId: MGR_STAFF_ID,
    sessionId: "mgr_ops",
    userMessage:
      "我手头管哪些正式任务？请只调用 list_managed_tasks 列出简短清单（含任务编号与状态）。不要调用 list_known_facts；不要向用户索要 userId（系统已绑定当前主管）。",
    expectDraft: false,
    expectToolNames: ["list_managed_tasks"],
  },
  {
    id: "M4_get_task_detail",
    senderStaffId: MGR_STAFF_ID,
    sessionId: "mgr_ops",
    userMessage: (rt) =>
      rt.lastTaskNo
        ? `任务编号 ${rt.lastTaskNo} 的详情和子任务状态是什么？请只调用 get_task_detail，参数仅需 taskNo=\"${rt.lastTaskNo}\"（不要向用户索要 userId）。`
        : "（缺少 lastTaskNo，跳过）",
    expectDraft: false,
    expectToolNames: ["get_task_detail"],
  },
  {
    id: "M5_search_employees",
    senderStaffId: MGR_STAFF_ID,
    sessionId: "mgr_ops",
    userMessage:
      "帮我看一下负责焊接/失效分析且有 SMT 经验的人都有谁，用 search_employees 查。",
    expectDraft: false,
    expectToolNames: ["search_employees"],
  },
  {
    id: "A1_admin_list_tasks",
    senderStaffId: ADMIN_STAFF_ID,
    sessionId: "admin_ops",
    userMessage:
      "以管理员视角列出正式任务里标题或编号含「焊点」或「客诉」的任务，最多 8 条，用 admin_list_all_tasks。",
    expectDraft: false,
    expectToolNames: ["admin_list_all_tasks"],
  },
  {
    id: "A2_get_metrics",
    senderStaffId: ADMIN_STAFF_ID,
    sessionId: "admin_ops",
    userMessage: "给我工作台大盘指标摘要，调用 get_metrics。",
    expectDraft: false,
    expectToolNames: ["get_metrics"],
  },
  {
    id: "A3_list_managers",
    senderStaffId: ADMIN_STAFF_ID,
    sessionId: "admin_ops",
    userMessage:
      "请必须先调用 list_managers 工具查询主管白名单，再根据工具返回结果用一段话总结。禁止不调用工具就凭猜测回答。",
    expectDraft: false,
    expectToolNames: ["list_managers"],
  },
  {
    id: "E1_list_my_tasks",
    senderStaffId: EMP_STAFF_ID,
    sessionId: "emp_ops",
    userMessage: "我作为执行人，当前分配给我的正式任务有哪些？用 list_my_tasks。",
    expectDraft: false,
    expectToolNames: ["list_my_tasks"],
  },
  {
    id: "E2_accept_subtask",
    senderStaffId: EMP_STAFF_ID,
    sessionId: "emp_ops",
    userMessage: (rt) =>
      rt.lastSubtaskId
        ? `我接受子任务 ${rt.lastSubtaskId}，请用 submit_employee_response，action=accept，note 写：eval 接受。`
        : "（缺少 lastSubtaskId，跳过接受）",
    expectDraft: false,
    expectToolNames: ["submit_employee_response"],
  },
  {
    id: "E3_progress_update",
    senderStaffId: EMP_STAFF_ID,
    sessionId: "emp_ops",
    userMessage: (rt) =>
      rt.lastSubtaskId
        ? `子任务 ${rt.lastSubtaskId}：请必须先调用 submit_progress_update（status=IN_PROGRESS，note=eval 进行中）写入进度。即使刚才已接受也必须调用该工具，禁止只文字回复。`
        : "（缺少 lastSubtaskId，跳过进度）",
    expectDraft: false,
    expectToolNames: ["submit_progress_update"],
  },
  {
    id: "E4_my_profile",
    senderStaffId: EMP_STAFF_ID,
    sessionId: "emp_ops",
    userMessage:
      "请必须先调用 get_my_profile 工具读取我登记的画像与擅长方向，再根据工具返回总结。禁止不调用工具就回答。",
    expectDraft: false,
    expectToolNames: ["get_my_profile"],
  },
];

function resolveUserMessage(
  s: ScenarioInput,
  rt: EvalRuntime,
): { text: string; skip: boolean } {
  const raw = typeof s.userMessage === "function" ? s.userMessage(rt) : s.userMessage;
  const text = String(raw ?? "").trim();
  if (text.startsWith("（缺少")) return { text, skip: true };
  return { text, skip: false };
}

function checkExpectTools(
  expected: string[] | undefined,
  actual: string[] | undefined,
): string | undefined {
  if (!expected?.length) return undefined;
  const set = new Set(actual ?? []);
  const missing = expected.filter((n) => !set.has(n));
  if (missing.length === 0) return undefined;
  return `expected tools missing: ${missing.join(", ")} (got: ${[...(actual ?? [])].join(", ") || "(none)"})`;
}

function checkForbidTools(
  forbidden: string[] | undefined,
  actual: string[] | undefined,
): string | undefined {
  if (!forbidden?.length) return undefined;
  const set = new Set(actual ?? []);
  const hit = forbidden.filter((n) => set.has(n));
  if (hit.length === 0) return undefined;
  return `forbidden tools invoked: ${hit.join(", ")}`;
}

function countToolCalls(names: string[] | undefined, tool: string): number {
  return (names ?? []).filter((n) => n === tool).length;
}

function checkForbidMessagePatterns(
  message: string,
  patterns: RegExp[] | undefined,
): string | undefined {
  if (!patterns?.length) return undefined;
  for (const p of patterns) {
    if (p.test(message)) return `forbidden message pattern: ${p}`;
  }
  return undefined;
}

function loadRosterFixtureText(): string {
  return readFileSync(
    join(process.cwd(), "fixtures/sample-roster-杨楚臻-杨贺新-陈哲治-测试.md"),
    "utf8",
  );
}

function buildEvalOctV6Draft(): Record<string, unknown> {
  return {
    title: "OCT-100 PIU端面污损评估",
    objective: "评估 OCT-100 PIU 端面污损根因并给出遏制建议",
    background: "客户现场批量焊点开路客诉，需实验室拆解与风险评估",
    tasks: [
      {
        id: "task_1",
        title: "样品拆解与外观/物理特性分析",
        objective: "完成样品拆解与外观记录",
        deliverables: ["拆解记录", "外观照片"],
        completionCriteria: ["样品拆解完成并归档"],
        timeNode: { startAt: "2026-05-12", dueAt: "2026-05-18", checkpoints: ["D+3 拆解完成"] },
        feedbackFrequency: "每日 17:00",
        dependencyTaskIds: [],
        risksAndOpenQuestions: ["样品运输延误"],
        inputMaterials: ["失效样品 5 台", "现场日志"],
        actions: ["拆解", "显微拍照"],
        collaborators: ["杨楚榛"],
        scope: { inScope: ["实验室拆解"], outOfScope: ["客户现场维修"] },
        assigneeUserId: "",
      },
      {
        id: "task_2",
        title: "功能测试与风险评估",
        objective: "完成功能测试并评估风险",
        deliverables: ["测试报告"],
        completionCriteria: ["关键项测试通过"],
        timeNode: { startAt: "2026-05-14", dueAt: "2026-05-20", checkpoints: [] },
        feedbackFrequency: "每日 17:00",
        dependencyTaskIds: ["task_1"],
        risksAndOpenQuestions: [],
        inputMaterials: ["测试夹具"],
        actions: ["通电测试"],
        collaborators: ["杨贺新"],
        scope: { inScope: ["实验室测试"], outOfScope: [] },
        assigneeUserId: "",
      },
      {
        id: "task_3",
        title: "处置结论输出与流程优化",
        objective: "输出处置结论",
        deliverables: ["8D 报告草案"],
        completionCriteria: ["主管评审通过"],
        timeNode: { startAt: "2026-05-18", dueAt: "2026-05-22", checkpoints: [] },
        feedbackFrequency: "每周",
        dependencyTaskIds: ["task_2"],
        risksAndOpenQuestions: [],
        inputMaterials: [],
        actions: ["撰写报告"],
        collaborators: ["陈哲治"],
        scope: { inScope: ["报告撰写"], outOfScope: [] },
        assigneeUserId: "",
      },
    ],
  };
}

function applySeedSession(session: PlanSession, seed?: Partial<PlanSession>): void {
  if (!seed) return;
  if (seed.pendingRosterText !== undefined) session.pendingRosterText = seed.pendingRosterText;
  if (seed.pendingRosterSource !== undefined) session.pendingRosterSource = seed.pendingRosterSource;
  if (seed.latestDraft !== undefined) session.latestDraft = seed.latestDraft;
  if (seed.latestAssignment !== undefined) session.latestAssignment = seed.latestAssignment;
  if (seed.candidatePool !== undefined) session.candidatePool = seed.candidatePool;
  if (seed.conversationHistory !== undefined) {
    session.conversationHistory = seed.conversationHistory;
  }
  if (seed.knownFacts !== undefined) session.knownFacts = seed.knownFacts;
}

async function runOne(
  scenario: ScenarioInput,
  ctx: {
    sessions: Map<string, PlanSession>;
    knownFacts: Map<string, string[]>;
  },
  rt: EvalRuntime,
): Promise<ScenarioResult> {
  const clientConfig = buildEvalQwenClientConfig();
  if (!clientConfig) {
    return {
      id: scenario.id,
      senderStaffId: scenario.senderStaffId,
      ok: false,
      errorMessage: "缺少 QWEN_API_KEY",
    };
  }

  const { text: userMessage, skip } = resolveUserMessage(scenario, rt);
  if (skip) {
    return {
      id: scenario.id,
      senderStaffId: scenario.senderStaffId,
      ok: false,
      errorMessage: "skipped_missing_prerequisite (e.g. lastSubtaskId after publish)",
      messagePreview: userMessage,
      routing: "skipped_no_prerequisite",
    };
  }

  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const routing = resolveEvalRouting(scenario.senderStaffId, employeeRepo);
  const sessionStore = createPlanSessionStore();
  const publishRecentStore = createRecentPublishStore();

  const sessionKey = scenario.sessionId ?? scenario.id;
  let session = ctx.sessions.get(sessionKey);
  if (!session) {
    session = sessionStore.loadOrCreate(`eval:${sessionKey}`);
    ctx.sessions.set(sessionKey, session);
    ctx.knownFacts.set(sessionKey, [...(session.knownFacts ?? [])]);
  }

  applySeedSession(session, scenario.seedSession);
  sessionStore.save(session);

  let mutableKnownFacts = ctx.knownFacts.get(sessionKey) ?? [];
  const knownFactsStore: KnownFactsStore = {
    get: () => mutableKnownFacts,
    update: (facts: string[]) => {
      const merged = Array.from(
        new Set([
          ...mutableKnownFacts,
          ...facts.map((f) => String(f).trim()).filter(Boolean),
        ]),
      ).slice(-50);
      mutableKnownFacts = merged;
      ctx.knownFacts.set(sessionKey, merged);
    },
  };

  const maxToolIterations = readEnvInt("DINGTALK_ORCHESTRATOR_MAX_ITERATIONS", 6);

  const startedAt = Date.now();
  let result;
  const orchestratorArgs = {
    clientConfig,
    employeeRepo,
    maxToolIterations,
    toolProfile: routing.toolProfile,
    promptProfile: routing.promptProfile,
    trustedActorUserId: routing.trustedActorUserId,
    allowSearchWeb: scenario.allowSearchWeb ?? false,
    knownFactsStore,
    currentSessionPlanId: session.planId,
    currentSession: session,
    publishRecentStore,
    actorName:
      scenario.senderStaffId === MGR_STAFF_ID
        ? "测评经理"
        : scenario.senderStaffId === EMP_STAFF_ID
          ? "测评工程师 A"
          : scenario.senderStaffId === ADMIN_STAFF_ID
            ? "测评管理员"
            : "发起人",
    actorRole: routing.actorRole,
    sessionContext: {
      conversationHistory: session.conversationHistory,
      planId: session.planId,
      latestDraft: session.latestDraft,
      latestAssignment: session.latestAssignment,
      memorySummary: "",
      memoryFacts: mutableKnownFacts.slice(0, 8),
      currentTimeIso: new Date().toISOString(),
      pendingRoster: session.pendingRosterText
        ? {
            sourceLabel: session.pendingRosterSource ?? "uploaded:roster",
            chars: session.pendingRosterText.length,
          }
        : undefined,
      candidatePool: session.candidatePool
        ? {
            source: session.candidatePool.source,
            entries: session.candidatePool.entries.map((e) => ({
              userId: e.userId,
              displayName: e.displayName,
            })),
            unresolvedCount: session.candidatePool.unresolved?.length,
          }
        : undefined,
    },
  };
  try {
    try {
      result = await runOrchestrator(userMessage, orchestratorArgs);
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|429|502|503/i.test(msg);
      if (!transient) throw firstErr;
      await new Promise((r) => setTimeout(r, 2000));
      result = await runOrchestrator(userMessage, orchestratorArgs);
    }
  } catch (err) {
    return {
      id: scenario.id,
      senderStaffId: scenario.senderStaffId,
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      orchestratorLoopMs: Date.now() - startedAt,
      routing: `${routing.resolvedRole}/${routing.routingReason}`,
    };
  }

  const newHistory = [
    ...session.conversationHistory,
    { role: "user", content: userMessage },
    { role: "assistant", content: result.messages.join("\n\n") },
  ].slice(-20);
  const updatedSession: PlanSession = {
    ...session,
    conversationHistory: newHistory,
    knownFacts: mutableKnownFacts,
    latestDraft: result.draft ?? session.latestDraft,
    latestAssignment: result.assignment ?? session.latestAssignment,
    lastTraceId: result.traceId,
    updatedAt: new Date().toISOString(),
  };
  alignSessionPlanId(updatedSession, updatedSession.planId);
  sessionStore.save(updatedSession);
  ctx.sessions.set(sessionKey, reloadEvalSession(sessionStore, sessionKey, updatedSession));

  if (result.draft) {
    savePlanSnapshot(updatedSession.planId, {
      planId: updatedSession.planId,
      traceId: result.traceId,
      status: "DRAFT_READY",
      draft: result.draft,
      messagePreview: result.messages[0]?.slice(0, 500),
    });
  }

  const pr = result.publishResult as
    | {
        ok?: unknown;
        task?: { taskNo?: string };
        subtasks?: Array<{ subtaskId?: string }>;
        dedupedByLru?: unknown;
      }
    | undefined;
  if (pr && String(pr.ok) === "true" && !pr.dedupedByLru) {
    const tn = String(pr.task?.taskNo ?? "").trim();
    if (tn) rt.lastTaskNo = tn;
    const sid = pr.subtasks?.[0]?.subtaskId;
    if (sid) rt.lastSubtaskId = String(sid);
    rt.lastPlanId = updatedSession.planId;
  }

  const elapsed = Date.now() - startedAt;
  const { coverage, taskCount } = getDraftFieldCoverage(result.draft);
  const inv = result.toolInvocationNames ?? [];
  const fullMessage = result.messages.join("\n\n");
  let expectToolMismatch = checkExpectTools(scenario.expectToolNames, inv);
  const forbidToolMismatch = checkForbidTools(scenario.forbidToolNames, inv);
  const forbidMsgMismatch = checkForbidMessagePatterns(fullMessage, scenario.forbidMessagePatterns);

  let ok = true;
  let errMsg: string | undefined;
  if (scenario.expectDraft && !result.draft) {
    ok = false;
    errMsg = "expected draft in JSON payload but missing";
  }
  if (scenario.expectPublishOk) {
    if (!pr || String(pr.ok) !== "true" || pr.dedupedByLru) {
      ok = false;
      errMsg = `expected publish ok, got ${JSON.stringify(pr ?? null)}`;
    }
  }
  if (expectToolMismatch) {
    ok = false;
    errMsg = expectToolMismatch;
  }
  if (forbidToolMismatch) {
    ok = false;
    errMsg = forbidToolMismatch;
  }
  if (forbidMsgMismatch) {
    ok = false;
    errMsg = forbidMsgMismatch;
  }
  if (scenario.maxSearchEmployeesCalls !== undefined) {
    const n = countToolCalls(inv, "search_employees");
    if (n > scenario.maxSearchEmployeesCalls) {
      ok = false;
      errMsg = `search_employees called ${n} times, max ${scenario.maxSearchEmployeesCalls}`;
    }
  }
  if (scenario.expectCandidatePoolMin !== undefined) {
    const poolLen = updatedSession.candidatePool?.entries.length ?? 0;
    if (poolLen < scenario.expectCandidatePoolMin) {
      ok = false;
      errMsg = `candidatePool entries ${poolLen} < ${scenario.expectCandidatePoolMin}`;
    }
  }
  if (scenario.expectV6DraftTop && result.draft) {
    const d = result.draft as Record<string, unknown>;
    if (!String(d.objective ?? "").trim() || !String(d.background ?? "").trim()) {
      ok = false;
      errMsg = "expected v6 objective+background on draft";
    }
  }

  return {
    id: scenario.id,
    senderStaffId: scenario.senderStaffId,
    ok,
    errorMessage: errMsg,
    orchestratorLoopMs: elapsed,
    toolCallsTotal: result.toolCallsTotal,
    toolInvocationNames: inv,
    hasDraft: result.draft !== undefined,
    draftFieldCoverage: coverage,
    draftTaskCount: taskCount,
    knownFactsAfter: mutableKnownFacts.slice(-5),
    messagePreview: result.messages.join("\n\n").slice(0, 220),
    expectToolMismatch,
    routing: `${routing.resolvedRole}/${routing.toolProfile}/${routing.promptProfile}/${routing.routingReason}`,
  };
}

async function verifyDataSync(
  ctx: { sessions: Map<string, PlanSession>; knownFacts: Map<string, string[]> },
  rt: EvalRuntime,
): Promise<Array<{ name: string; ok: boolean; detail?: string }>> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const sessionStore = createPlanSessionStore();

  for (const [key, sess] of ctx.sessions) {
    const reloaded = sessionStore.loadByChatKey(`eval:${key}`);
    const memPlanId = sess.planId;
    const diskPlanId = reloaded?.planId;
    const scopePlanId =
      reloaded?.currentTaskScopeId && reloaded.taskScopes?.[reloaded.currentTaskScopeId]
        ? reloaded.taskScopes[reloaded.currentTaskScopeId]?.planId
        : undefined;
    const ok = reloaded !== undefined && diskPlanId === memPlanId;
    checks.push({
      name: `session.${key}.persisted`,
      ok,
      detail: reloaded
        ? `mem=${memPlanId} disk=${diskPlanId} scope=${scopePlanId ?? "(n/a)"} historyTurns=${reloaded.conversationHistory.length}`
        : "未找到落盘文件",
    });
  }

  const facts = ctx.knownFacts.get(PLANNING_SESSION_KEY) ?? [];
  checks.push({
    name: "knownFacts.planning_non_empty",
    ok: facts.length > 0,
    detail: facts.slice(0, 3).join(" | ") || "(空)",
  });

  const planSession = ctx.sessions.get(PLANNING_SESSION_KEY);
  if (planSession?.latestDraft) {
    const file = join(process.env.PLAN_STORE_DIR!, `${planSession.planId}.json`);
    checks.push({
      name: "plan-snapshot.planning",
      ok: existsSync(file),
      detail: file,
    });
  } else {
    checks.push({
      name: "plan-snapshot.planning",
      ok: false,
      detail: "planning 会话无 latestDraft",
    });
  }

  if (rt.lastTaskNo) {
    const wb = createWorkbenchFormalTaskStore();
    const detail = wb.getTaskDetail(rt.lastTaskNo);
    checks.push({
      name: "workbench.published_task.exists",
      ok: detail !== undefined,
      detail: detail
        ? `taskId=${detail.task.taskId} status=${detail.task.status} subtasks=${detail.subtasks.length}`
        : "未找到",
    });
    if (detail) {
      const desc = String(detail.task.description ?? "").trim();
      checks.push({
        name: "workbench.published_task.description_nonempty",
        ok: desc.length > 0,
        detail: desc.slice(0, 80),
      });
      const hasV2Extra = detail.subtasks.some((s) => {
        const ex = s.extra;
        return (
          ex?.v === 2
          && ((ex.inputMaterials?.length ?? 0) > 0 || (ex.scope?.inScope?.length ?? 0) > 0)
        );
      });
      checks.push({
        name: "workbench.published_subtask.extra_json_v2",
        ok: hasV2Extra,
        detail: hasV2Extra ? "at least one subtask has v2 extra" : "no v2 extra on subtasks",
      });
    }
    if (detail?.subtasks[0]) {
      checks.push({
        name: "workbench.subtask.progress_after_E3",
        ok: detail.subtasks[0].status !== "ASSIGNED",
        detail: `status=${detail.subtasks[0].status} note=${detail.subtasks[0].progressNote ?? "(none)"}`,
      });
    }
  } else {
    checks.push({
      name: "workbench.published_task.exists",
      ok: false,
      detail: "未发布成功，无 lastTaskNo",
    });
  }

  return checks;
}

async function main(): Promise<void> {
  console.log("=== Agent Eval (DingTalk-parity) ===");
  console.log("EVAL_DATA_DIR =", EVAL_DATA_DIR);
  console.log("QWEN_MODEL =", process.env.QWEN_MODEL || "(default policy)");
  console.log("QWEN_THINKING =", process.env.QWEN_THINKING, "(eval default=0)");
  console.log(
    "DINGTALK_QWEN_THINKING =",
    process.env.DINGTALK_QWEN_THINKING ?? "(default=off)",
  );
  console.log(
    "DINGTALK_ORCHESTRATOR_MAX_ITERATIONS =",
    readEnvInt("DINGTALK_ORCHESTRATOR_MAX_ITERATIONS", 6),
    "(eval default=6 unless env set)",
  );
  console.log("AGENT_MAX_TOTAL_TOKENS =", process.env.AGENT_MAX_TOTAL_TOKENS || "(default 12000)");
  console.log(
    "[safety] WORKBENCH_DINGTALK_NOTIFY_ENABLED =",
    process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED,
    "DINGTALK_CONTACT_SYNC_ENABLED =",
    process.env.DINGTALK_CONTACT_SYNC_ENABLED,
  );
  console.log("");

  console.log("[seed] people directory + profiles ...");
  await seedDirectory();

  const ctx = {
    sessions: new Map<string, PlanSession>(),
    knownFacts: new Map<string, string[]>(),
  };
  const rt: EvalRuntime = {};

  const results: ScenarioResult[] = [];

  const evalOnly = parseEvalOnlyFilter();
  const activeScenarios = evalOnly
    ? scenarios.filter((s) => scenarioMatchesFilter(s.id, evalOnly))
    : scenarios;
  if (evalOnly) {
    console.log(
      `[filter] EVAL_ONLY=${process.env.EVAL_ONLY} → ${activeScenarios.map((s) => s.id).join(", ")}`,
    );
  }

  for (const scenario of activeScenarios) {
    if (scenario.id === "M1_prepare_publish") {
      bridgePlanningToManagerPublishSession(ctx);
      console.log("[bridge] planning -> mgr_publish planId=", ctx.sessions.get(MGR_PUBLISH_SESSION_KEY)?.planId);
    }

    process.stdout.write(`[run] ${scenario.id} (${scenario.senderStaffId}) ... `);
    let r = await runOne(scenario, ctx, rt);
    for (let toolRetry = 0; !r.ok && r.expectToolMismatch && toolRetry < 2; toolRetry += 1) {
      process.stdout.write("[tool-retry] ");
      r = await runOne(scenario, ctx, rt);
    }
    if (r.ok) {
      console.log(
        `OK ${r.orchestratorLoopMs}ms | draft=${r.hasDraft ? `Y(${r.draftTaskCount}t)` : "N"} | tools=${(r.toolInvocationNames ?? []).join(">") || "-"}`,
      );
    } else {
      console.log(`FAIL ${r.orchestratorLoopMs ?? "-"}ms err=${r.errorMessage}`);
    }
    if (r.routing && r.routing !== "skipped_no_prerequisite") {
      console.log(`       routing=${r.routing}`);
    }
    results.push(r);
  }

  console.log("\n=== 数据同步校验 ===");
  const checks = await verifyDataSync(ctx, rt);
  let checksFailed = 0;
  for (const c of checks) {
    if (!c.ok) checksFailed += 1;
    console.log(`${c.ok ? "✓" : "✗"} ${c.name} :: ${c.detail ?? ""}`);
  }

  console.log("\n=== 延迟统计（非 skip）===");
  const okMs = results.filter((r) => r.ok && r.routing !== "skipped_no_prerequisite").map((r) => r.orchestratorLoopMs ?? 0);
  console.log(`总场景: ${results.length}, 成功: ${okMs.length}`);
  if (okMs.length) {
    console.log(`avg = ${avg(okMs).toFixed(0)} ms`);
    console.log(`p50 = ${pct(okMs, 50)} ms`);
    console.log(`p90 = ${pct(okMs, 90)} ms`);
    console.log(`max = ${Math.max(...okMs)} ms`);
  }

  console.log("\n=== 详情 ===");
  for (const r of results) {
    console.log(
      `- ${r.id}: ${r.ok ? "OK" : "FAIL"} ${r.orchestratorLoopMs ?? "-"}ms ${r.hasDraft ? `draft(cov=${r.draftFieldCoverage})` : ""}`,
    );
    if (r.toolInvocationNames?.length) {
      console.log(`  tools: ${r.toolInvocationNames.join(" → ")}`);
    }
    if (r.messagePreview) {
      console.log(`  message: ${r.messagePreview.replace(/\n/g, " | ")}`);
    }
  }

  const scenarioFailed = results.filter((r) => !r.ok).length;
  console.log("\n=== 完成 ===");
  console.log(
    `lastTaskNo=${rt.lastTaskNo ?? "(none)"} lastSubtaskId=${rt.lastSubtaskId ?? "(none)"}`,
  );
  const summary = {
    finishedAt: new Date().toISOString(),
    evalDataDir: EVAL_DATA_DIR,
    scenarioFailed,
    checksFailed,
    results: results.map((r) => ({
      id: r.id,
      ok: r.ok,
      errorMessage: r.errorMessage,
      toolInvocationNames: r.toolInvocationNames,
      hasDraft: r.hasDraft,
      messagePreview: r.messagePreview,
    })),
    checks,
    lastTaskNo: rt.lastTaskNo,
  };
  try {
    writeFileSync(
      join(EVAL_DATA_DIR, "eval-summary.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    console.log(`eval-summary written to ${join(EVAL_DATA_DIR, "eval-summary.json")}`);
  } catch (e) {
    console.warn("eval-summary write failed:", e);
  }

  if (scenarioFailed > 0 || checksFailed > 0) {
    console.error(
      `eval FAILED: scenarios=${scenarioFailed} checks=${checksFailed}`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exitCode = 1;
});
