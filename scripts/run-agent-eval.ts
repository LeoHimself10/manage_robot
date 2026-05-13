/**
 * Agent eval — 三端真实场景回归（planner / manager / employee）。
 *
 * 用途：
 * - 在 Docker 容器内对 runOrchestrator 主链路做端到端回归；
 * - 度量延迟 / 任务完成度 / 数据同步（session、plan-snapshot、SQLite 工作台、knownFacts）；
 * - 与生产数据隔离（默认写到 /tmp/eval/，可 EVAL_DATA_DIR 覆盖）。
 *
 * 运行（ECS docker，与生产同一镜像，但数据落到隔离目录）：
 *   docker run --rm \
 *     --env-file /etc/manage-robot.env \
 *     -e EVAL_DATA_DIR=/tmp/eval \
 *     manage-robot:dingtalk \
 *     npx tsx scripts/run-agent-eval.ts
 */

import "dotenv/config";

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const EVAL_DATA_DIR =
  process.env.EVAL_DATA_DIR?.trim() || "/tmp/manage-robot-eval";

(function bootstrapIsolatedDataPaths() {
  if (existsSync(EVAL_DATA_DIR)) {
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

  // 角色路由必须开，否则 manager/employee profile 不会生效。
  process.env.DINGTALK_ROLE_ROUTING_ENABLED = "1";

  // 用 eval 专属白名单，避免污染生产名单。
  process.env.WORKBENCH_MANAGER_USER_IDS = "eval-mgr-001";
  process.env.WORKBENCH_ADMIN_USER_IDS = "eval-admin-001";

  // ASSIGNMENT_PHASE_ENABLED 设为 0（专注 ReAct 主链路本身）。
  process.env.ASSIGNMENT_PHASE_ENABLED =
    process.env.ASSIGNMENT_PHASE_ENABLED ?? "0";

  // eval 默认与 dingtalk-bot 线上保持一致：关闭 Qwen3 thinking 模式。
  // 思考块会让 completion token 翻几倍，撑爆 ReAct token budget，且与 prod 体感不一致。
  // 想做对照实验时显式设 `QWEN_THINKING=1 npm run eval:agent`。
  process.env.QWEN_THINKING = process.env.QWEN_THINKING ?? "0";

  // 安全保险：eval 即便从 prod env-file 继承，也强制关闭钉钉发卡片 / 待办，避免误发。
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  process.env.DINGTALK_CONTACT_SYNC_ENABLED = "0";
})();

import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { createPlanSessionStore, hashChatKey } from "../src/infra/plan-session-store";
import {
  resolveAssignmentDraftDir,
  resolveAssignmentEventsPath,
  resolveEmployeeProfileDir,
} from "../src/infra/assignment-env";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import type { PlanSession } from "../src/infra/plan-session-store";
import type { KnownFactsStore } from "../src/agent/tools/update-known-facts";
import { savePlanSnapshot } from "../src/infra/plan-store";

type Profile = "planner" | "manager" | "employee";

interface ScenarioInput {
  id: string;
  profile: Profile;
  actorUserId?: string;
  actorRole?: "manager" | "employee" | "admin";
  userMessage: string;
  /** 如果不为空，则在该 session 上叠加；否则起新 session */
  sessionId?: string;
  /** 触发 search_web 关键字（当 profile 允许时） */
  allowSearchWeb?: boolean;
  /** 仅这些字段才视为「期待出草案」 */
  expectDraft?: boolean;
  /** 期待至少调用了这些工具 */
  expectToolNames?: string[];
}

interface ScenarioResult {
  id: string;
  profile: Profile;
  ok: boolean;
  errorMessage?: string;
  orchestratorLoopMs?: number;
  llmMsTotal?: number;
  toolsMsTotal?: number;
  parseMsTotal?: number;
  iterations?: number;
  toolCallsTotal?: number;
  toolNames?: string[];
  promptTokensSeen?: number;
  completionTokensSum?: number;
  hasDraft?: boolean;
  draftFieldCoverage?: number;
  draftTaskCount?: number;
  knownFactsAfter?: string[];
  messagePreview?: string;
}

const scenarios: ScenarioInput[] = [
  // ===== Planner 端（5 条） =====
  {
    id: "P1_chitchat",
    profile: "planner",
    userMessage: "你好",
    expectDraft: false,
  },
  {
    id: "P2_oneshot_quality",
    profile: "planner",
    userMessage:
      "OCT 客诉：A 产品（型号 A-2026B）批次 2026Q2-04 出现批量焊点开路，已涉及 15 台设备到客户现场，目前已收齐现场日志与失效照片。需要在 5 月 18 日前完成初步原因拆解，给出遏制 + 临时纠正动作建议；缺陷代号 DCT-2026-0512。",
    expectDraft: true,
  },
  {
    id: "P3_followup_field_update",
    profile: "planner",
    sessionId: "P2_oneshot_quality",
    userMessage:
      "再补一条信息：现场返回的 5 台样品已寄到上海实验室，预计 5 月 14 日 10 点签收，请把这块也写进任务里。",
    expectDraft: true,
  },
  {
    id: "P4_known_facts_recall",
    profile: "planner",
    sessionId: "P2_oneshot_quality",
    userMessage: "我们之前提过的缺陷代号是什么？为什么记不住？",
    expectDraft: false,
  },
  {
    id: "P5_search_similar",
    profile: "planner",
    userMessage:
      "之前类似的 OCT 焊点客诉我们怎么拆的？给我找两个最相似的历史方案对照一下。",
    expectDraft: false,
    expectToolNames: ["search_similar_plans"],
  },

  // ===== Manager 端（3 条） =====
  {
    id: "M1_list_managed_tasks",
    profile: "manager",
    actorUserId: "eval-mgr-001",
    actorRole: "manager",
    userMessage: "我手头管哪些任务？给我个简单的清单。",
    expectDraft: false,
    expectToolNames: ["list_managed_tasks"],
  },
  {
    id: "M2_task_detail",
    profile: "manager",
    actorUserId: "eval-mgr-001",
    actorRole: "manager",
    userMessage:
      "任务编号 TASK-EVAL-001 的详情和子任务进度怎么样了？谁卡住了？",
    expectDraft: false,
    expectToolNames: ["get_task_detail"],
  },
  {
    id: "M3_search_employees",
    profile: "manager",
    actorUserId: "eval-mgr-001",
    actorRole: "manager",
    userMessage:
      "帮我看一下负责焊接 / 失效分析方向，且有 SMT 经验的人都有谁，按擅长方向给我列个简单表。",
    expectDraft: false,
    expectToolNames: ["search_employees"],
  },

  // ===== Employee 端（3 条） =====
  {
    id: "E1_list_my_tasks",
    profile: "employee",
    actorUserId: "eval-emp-001",
    actorRole: "employee",
    userMessage: "我手头有哪些任务？哪些是该我先动的？",
    expectDraft: false,
    expectToolNames: ["list_my_tasks"],
  },
  {
    id: "E2_progress_update",
    profile: "employee",
    actorUserId: "eval-emp-001",
    actorRole: "employee",
    userMessage:
      "TASK-EVAL-001 的第一个子任务我已经开始做了，先做样品取样，预计明天 12 点出现场拆解记录。",
    expectDraft: false,
    expectToolNames: ["submit_progress_update"],
  },
  {
    id: "E3_my_profile",
    profile: "employee",
    actorUserId: "eval-emp-001",
    actorRole: "employee",
    userMessage: "我现在系统里登记的画像、擅长方向、最近接的任务统计是什么？",
    expectDraft: false,
    expectToolNames: ["get_my_profile"],
  },
];

function getDraftFieldCoverage(draft: Record<string, unknown> | undefined): {
  coverage: number;
  taskCount: number;
} {
  if (!draft) return { coverage: 0, taskCount: 0 };
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  if (tasks.length === 0) return { coverage: 0, taskCount: 0 };
  // 7 个核心字段：title / objective / deliverables / completionCriteria / dueAt / feedbackFrequency / id
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

async function seedDirectory(): Promise<void> {
  const peopleStore = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    peopleStore.upsertContact({
      userId: "eval-mgr-001",
      name: "测评经理",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "质量经理",
      jobNumber: "MGR001",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: true,
      lastSyncedAt: now,
    });
    peopleStore.upsertContact({
      userId: "eval-emp-001",
      name: "测评工程师 A",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "工艺工程师",
      jobNumber: "EMP001",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      lastSyncedAt: now,
    });
    peopleStore.upsertContact({
      userId: "eval-emp-002",
      name: "测评工程师 B",
      departmentIds: ["1002"],
      departmentNames: ["研发部"],
      position: "硬件工程师",
      jobNumber: "EMP002",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
      lastSyncedAt: now,
    });
    peopleStore.upsertProfile({
      userId: "eval-emp-001",
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

function seedFormalTask(): { taskNo: string; planId: string; subtaskId: string } {
  const store = createWorkbenchFormalTaskStore();
  const planId = "plan-eval-001";
  const session: PlanSession = {
    chatKeyHash: hashChatKey("eval-seed"),
    planId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    knownFacts: [],
    conversationHistory: [
      { role: "user", content: "OCT 客诉 - 焊点开路初步拆解" },
    ],
    senderStaffId: "eval-mgr-001",
    latestDraft: {
      title: "OCT 客诉 - 焊点开路拆解",
      tasks: [
        {
          id: "task_1",
          title: "现场样品拆解与微观分析",
          objective: "确认焊点开路根因",
          deliverables: ["拆解记录", "微观图报告"],
          completionCriteria: ["不良点 ≥ 5 个完成显微观察"],
          timeNode: { dueAt: "2026-05-18" },
          feedbackFrequency: "每日同步",
        },
      ],
    },
    latestAssignment: {
      assignments: [
        {
          taskId: "task_1",
          primary: { userId: "eval-emp-001", displayName: "测评工程师 A" },
        },
      ],
    },
  };
  // hack：直接调用 publishFromSession 也行；为了产生稳定的 task_no，先 publish 再改写
  const result = store.publishFromSession({
    planId,
    session,
    managerUserId: "eval-mgr-001",
    initiatorDepartment: "质量部",
    actorUserId: "eval-mgr-001",
    actorName: "测评经理",
  });
  // 把 task_no 改成可预期的 TASK-EVAL-001，便于场景里直接说出来
  const dbPath = process.env.WORKBENCH_SQLITE_PATH!;
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE tasks SET task_no = ? WHERE task_id = ?").run(
    "TASK-EVAL-001",
    result.task.taskId,
  );
  db.close();
  return {
    taskNo: "TASK-EVAL-001",
    planId,
    subtaskId: result.subtasks[0]?.subtaskId ?? "",
  };
}

async function runOne(
  scenario: ScenarioInput,
  ctx: {
    sessions: Map<string, PlanSession>;
    knownFacts: Map<string, string[]>;
  },
): Promise<ScenarioResult> {
  const config = loadQwenPlannerConfigFromEnv();
  if (!config) {
    return {
      id: scenario.id,
      profile: scenario.profile,
      ok: false,
      errorMessage: "缺少 QWEN_API_KEY",
    };
  }

  const sessionStore = createPlanSessionStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const publishRecentStore = createRecentPublishStore();

  const sessionKey = scenario.sessionId ?? scenario.id;
  let session = ctx.sessions.get(sessionKey);
  if (!session) {
    session = sessionStore.loadOrCreate(`eval:${sessionKey}`);
    ctx.sessions.set(sessionKey, session);
    ctx.knownFacts.set(sessionKey, [...(session.knownFacts ?? [])]);
  }

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

  const trustedActor =
    scenario.profile === "planner" ? undefined : scenario.actorUserId;
  const actorRole =
    scenario.profile === "planner"
      ? "manager"
      : scenario.actorRole ?? "employee";

  const startedAt = Date.now();
  let result;
  try {
    result = await runOrchestrator(scenario.userMessage, {
      clientConfig: config,
      employeeRepo,
      maxToolIterations: 6,
      toolProfile: scenario.profile,
      promptProfile: scenario.profile,
      trustedActorUserId: trustedActor,
      allowSearchWeb: scenario.allowSearchWeb ?? false,
      knownFactsStore,
      currentSessionPlanId: session.planId,
      currentSession: session,
      publishRecentStore,
      actorName:
        scenario.profile === "manager"
          ? "测评经理"
          : scenario.profile === "employee"
            ? "测评工程师 A"
            : undefined,
      actorRole,
      sessionContext: {
        conversationHistory: session.conversationHistory,
        planId: session.planId,
        latestDraft: session.latestDraft,
        latestAssignment: session.latestAssignment,
        memorySummary: "",
        memoryFacts: mutableKnownFacts.slice(0, 8),
        currentTimeIso: new Date().toISOString(),
      },
    });
  } catch (err) {
    return {
      id: scenario.id,
      profile: scenario.profile,
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      orchestratorLoopMs: Date.now() - startedAt,
    };
  }

  // session 推进：把这一轮 user / assistant 拼回去，便于多轮场景延续。
  const newHistory = [
    ...session.conversationHistory,
    { role: "user", content: scenario.userMessage },
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
  sessionStore.save(updatedSession);
  ctx.sessions.set(sessionKey, updatedSession);

  // 与 dingtalk-bot 一致：有 draft 则同时写 plan-snapshot，验证落盘链路。
  if (result.draft) {
    savePlanSnapshot(updatedSession.planId, {
      planId: updatedSession.planId,
      traceId: result.traceId,
      status: "DRAFT_READY",
      draft: result.draft,
      messagePreview: result.messages[0]?.slice(0, 500),
    });
  }

  // 通过 audit log 不易拿到 timing，这里采集 logStructured 的字段不方便，
  // 只能拿 runOrchestrator 返回的 toolCallsTotal + 自己计时。
  // 详细 per-iter timing 记在 logStructured，外部 tail audit 可见。
  const elapsed = Date.now() - startedAt;
  const { coverage, taskCount } = getDraftFieldCoverage(result.draft);

  // 工具名暂从 orchestrator 取不到（接口未暴露），从 traceId 扫 audit 记录开销大；
  // 这里简单根据是否拿到 draft / assignment / publishResult 做事后推断（粗粒度）。
  const inferredTools: string[] = [];
  if (result.draft) inferredTools.push("(draft from final JSON)");
  if (result.assignment) inferredTools.push("(assignment from final JSON)");
  if (result.publishResult) inferredTools.push("publish_task");

  return {
    id: scenario.id,
    profile: scenario.profile,
    ok: true,
    orchestratorLoopMs: elapsed,
    iterations: undefined,
    toolCallsTotal: result.toolCallsTotal,
    toolNames: inferredTools,
    hasDraft: result.draft !== undefined,
    draftFieldCoverage: coverage,
    draftTaskCount: taskCount,
    knownFactsAfter: mutableKnownFacts.slice(-5),
    messagePreview: result.messages.join("\n\n").slice(0, 220),
  };
}

async function verifyDataSync(
  ctx: { sessions: Map<string, PlanSession>; knownFacts: Map<string, string[]> },
  seed: { taskNo: string; planId: string; subtaskId: string },
): Promise<Array<{ name: string; ok: boolean; detail?: string }>> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // 1. session 是否落盘
  const sessionStore = createPlanSessionStore();
  for (const [key, sess] of ctx.sessions) {
    const reloaded = sessionStore.loadByChatKey(`eval:${key}`);
    checks.push({
      name: `session.${key}.persisted`,
      ok: reloaded !== undefined && reloaded.planId === sess.planId,
      detail: reloaded
        ? `planId=${reloaded.planId} historyTurns=${reloaded.conversationHistory.length}`
        : "未找到落盘文件",
    });
  }

  // 2. P3 多轮：knownFacts 应该非空（DCT-2026-0512、上海实验室寄送日期等）
  const p3Key = "P2_oneshot_quality";
  const facts = ctx.knownFacts.get(p3Key) ?? [];
  checks.push({
    name: "knownFacts.persisted_after_multi_turn",
    ok: facts.length > 0,
    detail: facts.slice(0, 3).join(" | ") || "(空)",
  });

  // 3. plan-snapshot 落盘（latestDraft 写入到 plans/<planId>.json）
  const planSession = ctx.sessions.get(p3Key);
  if (planSession?.latestDraft) {
    const file = join(process.env.PLAN_STORE_DIR!, `${planSession.planId}.json`);
    checks.push({
      name: "plan-snapshot.persisted",
      ok: existsSync(file),
      detail: file,
    });
  } else {
    checks.push({
      name: "plan-snapshot.persisted",
      ok: false,
      detail: "P2/P3 未生成 latestDraft，跳过",
    });
  }

  // 4. SQLite 工作台：seed 的 TASK-EVAL-001 仍在
  const wb = createWorkbenchFormalTaskStore();
  const detail = wb.getTaskDetail(seed.taskNo);
  checks.push({
    name: "workbench.seed_task.exists",
    ok: detail !== undefined,
    detail: detail
      ? `taskId=${detail.task.taskId} status=${detail.task.status} subtasks=${detail.subtasks.length}`
      : "未找到",
  });

  // 5. E2 应让 subtask 状态变化
  if (detail) {
    const subtask = detail.subtasks[0];
    checks.push({
      name: "workbench.subtask.progress_after_E2",
      ok: subtask?.status !== "ASSIGNED",
      detail: `status=${subtask?.status} note=${subtask?.progressNote ?? "(none)"}`,
    });
  }

  return checks;
}

async function main(): Promise<void> {
  console.log("=== Agent Eval Run ===");
  console.log("EVAL_DATA_DIR =", EVAL_DATA_DIR);
  console.log("QWEN_MODEL =", process.env.QWEN_MODEL || "(default policy)");
  console.log(
    "QWEN_THINKING =",
    process.env.QWEN_THINKING,
    "(eval default=0, override with QWEN_THINKING=1)",
  );
  console.log(
    "DINGTALK_QWEN_THINKING =",
    process.env.DINGTALK_QWEN_THINKING ?? "(default=off in prod)",
  );
  console.log("AGENT_MAX_TOTAL_TOKENS =", process.env.AGENT_MAX_TOTAL_TOKENS || "(default 12000)");
  console.log(
    "[safety] WORKBENCH_DINGTALK_NOTIFY_ENABLED =",
    process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED,
    "DINGTALK_CONTACT_SYNC_ENABLED =",
    process.env.DINGTALK_CONTACT_SYNC_ENABLED,
  );
  console.log("");

  console.log("[seed] 写入 people directory + capability profile ...");
  await seedDirectory();
  console.log("[seed] 写入工作台正式任务 TASK-EVAL-001 ...");
  const seed = seedFormalTask();
  console.log("[seed] taskNo=%s planId=%s subtaskId=%s", seed.taskNo, seed.planId, seed.subtaskId);
  console.log("");

  const ctx = {
    sessions: new Map<string, PlanSession>(),
    knownFacts: new Map<string, string[]>(),
  };

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`[run] ${scenario.id} (${scenario.profile}) ... `);
    const r = await runOne(scenario, ctx);
    if (r.ok) {
      console.log(
        `OK ${r.orchestratorLoopMs}ms | draft=${r.hasDraft ? `Y(${r.draftTaskCount}t/cov=${r.draftFieldCoverage})` : "N"} | calls=${r.toolCallsTotal ?? "?"}`,
      );
    } else {
      console.log(`FAIL ${r.orchestratorLoopMs ?? "-"}ms err=${r.errorMessage}`);
    }
    results.push(r);
  }

  console.log("\n=== 数据同步校验 ===");
  const checks = await verifyDataSync(ctx, seed);
  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name} :: ${c.detail ?? ""}`);
  }

  console.log("\n=== 延迟统计 ===");
  const okMs = results.filter((r) => r.ok).map((r) => r.orchestratorLoopMs ?? 0);
  console.log(`总场景: ${results.length}, 成功: ${okMs.length}`);
  console.log(`avg = ${avg(okMs).toFixed(0)} ms`);
  console.log(`p50 = ${pct(okMs, 50)} ms`);
  console.log(`p90 = ${pct(okMs, 90)} ms`);
  console.log(`p95 = ${pct(okMs, 95)} ms`);
  console.log(`max = ${Math.max(0, ...okMs)} ms`);

  console.log("\n=== 详情（按场景） ===");
  for (const r of results) {
    console.log(
      `- ${r.id} (${r.profile}): ${r.ok ? "OK" : "FAIL"} ${r.orchestratorLoopMs ?? "-"}ms ${r.hasDraft ? `draft(cov=${r.draftFieldCoverage})` : ""}`,
    );
    if (r.messagePreview) {
      console.log(`  message: ${r.messagePreview.replace(/\n/g, " | ")}`);
    }
    if (r.knownFactsAfter && r.knownFactsAfter.length > 0) {
      console.log(`  knownFacts(tail): ${r.knownFactsAfter.join(" | ")}`);
    }
  }

  console.log("\n=== 完成 ===");
  // 不删除 EVAL_DATA_DIR，便于事后取证；下次运行会自动清理。
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exitCode = 1;
});
