/**
 * WBS + 主管链路专项 eval（planner 拆解 → 主管发布/查询）。
 * Run: npx tsx scripts/run-wbs-manager-eval.ts
 * Filter: EVAL_WBS_FILTER=W4_coarse_redraft,W5_capa_multi npx tsx scripts/run-wbs-manager-eval.ts
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import { savePlanSnapshot } from "../src/infra/plan-store";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../src/agent/role-routing";
import { processAssignmentForTurn } from "../src/agent/assignment/process-assignment-turn";
import {
  buildAssignRetryUserMessage,
  buildTaskIndexMap,
} from "../src/agent/assignment/false-assign";
import { hasAssigneeIntentInUserMessage } from "../src/agent/orchestrator-turn-hints";
import {
  buildPublishRetryUserMessage,
} from "../src/agent/publish-staging";
import { publishResultSucceeded } from "../src/agent/publish-helpers";
import {
  assertAssignmentFullCoverage,
  assertEvalNoFakeAssign,
  assertNoMaxTurnsExceeded,
} from "./eval-assignment-assertions";
import {
  applyEvalProductionParityEnv,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-wbs-manager");
const INITIATOR = "eval-dd-initiator-001";
const MGR_STAFF_ID = "eval-mgr-001";
const EMP_STAFF_ID = "eval-emp-001";

const COARSE_DRAFT_4: Record<string, unknown> = {
  title: "OCT 客诉 DCT-2026-0512（粗粒度阶段包）",
  description: "A-2026B 批次焊点开路，需遏制、根因、纠正、闭环四阶段推进，截止 2026-06-15。",
  tasks: [
    {
      id: "task_1",
      title: "遏制与信息收集阶段",
      objective: "冻结风险批次并汇总现场信息",
      deliverables: ["遏制动作清单"],
      completionCriteria: ["在制品隔离完成"],
      timeNode: { dueAt: "2026-06-05" },
      feedbackFrequency: "每日",
    },
    {
      id: "task_2",
      title: "根因分析阶段",
      objective: "定位焊点开路机理",
      deliverables: ["根因报告"],
      completionCriteria: ["根因假设经实验验证"],
      timeNode: { dueAt: "2026-06-10" },
      feedbackFrequency: "每两日",
    },
    {
      id: "task_3",
      title: "纠正措施阶段",
      objective: "制定并验证纠正措施",
      deliverables: ["纠正措施验证记录"],
      completionCriteria: ["小批验证通过"],
      timeNode: { dueAt: "2026-06-12" },
      feedbackFrequency: "每两日",
    },
    {
      id: "task_4",
      title: "闭环与报告阶段",
      objective: "8D/CAPA 结案",
      deliverables: ["8D 报告"],
      completionCriteria: ["主管签字结案"],
      timeNode: { dueAt: "2026-06-15" },
      feedbackFrequency: "每周",
    },
  ],
};

interface ScenarioDef {
  id: string;
  sessionKey: string;
  senderStaffId: string;
  userMessage: string;
  freshSession?: boolean;
  preSeedDraft?: Record<string, unknown>;
  expectMinTasks?: number;
  /** 本轮 orchestrator 必须产出顶层 draft JSON */
  expectDraftJson?: boolean;
  /** 相对跑场景前的 tasks 数，至少增加 N */
  expectTasksIncreaseBy?: number;
  expectTools?: string[];
  expectToolAny?: string[];
  expectMinFieldCoverage?: number;
  expectPublishOk?: boolean;
  expectAssignmentFullCoverage?: boolean;
  expectNoFakeAssignMessage?: boolean;
  expectMaxToolCalls?: number;
  /** PATCH 场景：允许无新 draft JSON，但须出现指定工具 */
  patchMode?: boolean;
}

interface ScenarioRunResult {
  id: string;
  pass: boolean;
  ms: number;
  taskCount: number;
  hasDraftJson: boolean;
  fieldCoverage: number;
  tools: string[];
  publishOk?: boolean;
  assignmentCoverage?: number;
  failReason?: string;
  preview?: string;
  titles?: string[];
}

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR_STAFF_ID;
  mkdirSync(process.env.PLAN_SESSION_DIR, { recursive: true });
}

function buildClient() {
  const base = loadQwenPlannerConfigFromEnv();
  if (!base) throw new Error("missing QWEN_API_KEY");
  return {
    ...base,
    thinking: false,
    timeoutMs: 120_000,
    maxTokens: Math.min(base.maxTokens, Number(process.env.DINGTALK_QWEN_MAX_TOKENS ?? 8000)),
    stream: true,
  };
}

function taskCount(draft: unknown): number {
  if (!draft || typeof draft !== "object") return 0;
  const tasks = (draft as { tasks?: unknown[] }).tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

function draftFieldCoverage(draft: unknown): number {
  if (!draft || typeof draft !== "object") return 0;
  const tasks = (draft as { tasks?: Array<Record<string, unknown>> }).tasks ?? [];
  if (tasks.length === 0) return 0;
  const scores = tasks.map((task) => {
    let hits = 0;
    if (String(task.title ?? "").trim()) hits++;
    if (String(task.objective ?? "").trim()) hits++;
    if (Array.isArray(task.deliverables) && task.deliverables.length > 0) hits++;
    if (Array.isArray(task.completionCriteria) && task.completionCriteria.length > 0) hits++;
    const due = (task.timeNode as { dueAt?: string } | undefined)?.dueAt;
    if (due) hits++;
    if (String(task.feedbackFrequency ?? "").trim()) hits++;
    if (String(task.id ?? "").trim()) hits++;
    return hits / 7;
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function taskTitles(draft: unknown): string[] {
  if (!draft || typeof draft !== "object") return [];
  const tasks = (draft as { tasks?: Array<{ title?: string }> }).tasks ?? [];
  return tasks.map((t) => String(t.title ?? "").trim()).filter(Boolean);
}

async function seedDirectory() {
  const store = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    store.upsertContact({
      ...base,
      userId: MGR_STAFF_ID,
      name: "测评经理",
      unionId: "eval-union-mgr-001",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "质量经理",
      jobNumber: "MGR001",
      isSenior: true,
    });
    store.upsertContact({
      ...base,
      userId: EMP_STAFF_ID,
      name: "测评工程师 A",
      unionId: "eval-union-emp-001",
      departmentIds: ["1001"],
      departmentNames: ["质量部"],
      position: "工艺工程师",
      jobNumber: "EMP001",
    });
    store.upsertProfile({
      userId: EMP_STAFF_ID,
      skillTags: ["焊接", "SMT", "失效分析"],
      strengths: ["现场拆解", "样品取样"],
      boundaries: [],
      cases: [],
      tools: ["X-ray", "金相显微镜"],
      availability: { capacityHint: "本周可承接", emergencyOk: true },
      source: "eval-seed",
    });
  } finally {
    store.close();
  }
}

function injectAssignmentAllTasks(session: PlanSession): void {
  // Deprecated: eval no longer fakes assignment before M1; kept for manual debugging only.
  const draft = session.latestDraft;
  if (!draft || typeof draft !== "object") return;
  const tasks = (draft as { tasks?: Array<{ id?: string }> }).tasks ?? [];
  if (tasks.length === 0) return;
  session.latestAssignment = {
    assignments: tasks.map((t) => ({
      taskId: String(t.id ?? "task_1").trim() || "task_1",
      primary: { userId: EMP_STAFF_ID, displayName: "测评工程师 A" },
    })),
  };
}

function resolveRouting(senderStaffId: string) {
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const route = resolveDingtalkAgentRouting({
    senderStaffId,
    employeeRepo,
    roleRoutingEnabled: isDingtalkRoleRoutingEnabled(),
  });
  return { employeeRepo, route };
}

async function runScenario(
  session: PlanSession,
  def: ScenarioDef,
  priorTaskCount: number,
): Promise<ScenarioRunResult> {
  const clientConfig = buildClient();
  const { employeeRepo, route } = resolveRouting(def.senderStaffId);
  const publishRecentStore = createRecentPublishStore();
  const t0 = Date.now();
  const preTurnDraft = session.latestDraft as Record<string, unknown> | undefined;

  try {
    let result = await runOrchestrator(def.userMessage, {
      clientConfig,
      employeeRepo,
      maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
      toolProfile: route.toolProfile,
      promptProfile: route.promptProfile,
      trustedActorUserId: route.trustedActorUserId,
      actorRole: def.senderStaffId === MGR_STAFF_ID ? "manager" : "employee",
      actorName: def.senderStaffId === MGR_STAFF_ID ? "测评经理" : "发起人",
      currentSession: session,
      currentSessionPlanId: session.planId,
      publishRecentStore,
      sessionContext: {
        conversationHistory: session.conversationHistory,
        planId: session.planId,
        latestDraft: session.latestDraft as Record<string, unknown> | undefined,
        latestAssignment: session.latestAssignment,
        memoryFacts: session.knownFacts,
        currentTimeIso: new Date().toISOString(),
      },
    });

    let tools = result.toolInvocationNames ?? [];
    const hasPublishOk = publishResultSucceeded(result.publishResult as Record<string, unknown> | undefined);

    const needsPublishRetry =
      def.expectPublishOk
      && !hasPublishOk
      && !tools.includes("publish_task");

    if (needsPublishRetry) {
      const retryMsg = buildPublishRetryUserMessage(def.userMessage, session.planId);
      const retryResult = await runOrchestrator(retryMsg, {
        clientConfig,
        employeeRepo,
        maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
        toolProfile: route.toolProfile,
        promptProfile: route.promptProfile,
        trustedActorUserId: route.trustedActorUserId,
        actorRole: def.senderStaffId === MGR_STAFF_ID ? "manager" : "employee",
        actorName: def.senderStaffId === MGR_STAFF_ID ? "测评经理" : "发起人",
        currentSession: session,
        currentSessionPlanId: session.planId,
        publishRecentStore,
        sessionContext: {
          conversationHistory: session.conversationHistory,
          planId: session.planId,
          latestDraft: session.latestDraft as Record<string, unknown> | undefined,
          latestAssignment: session.latestAssignment,
          memoryFacts: session.knownFacts,
          currentTimeIso: new Date().toISOString(),
        },
      });
      result = retryResult;
      tools = [...tools, ...(retryResult.toolInvocationNames ?? [])];
    }

    const hasDraftJson = result.draft !== undefined;
    if (result.draft) session.latestDraft = result.draft as typeof session.latestDraft;

    const taskIds = Array.isArray((session.latestDraft as { tasks?: Array<{ id?: string }> } | undefined)?.tasks)
      ? ((session.latestDraft as { tasks: Array<{ id?: string }> }).tasks)
          .map((t) => String(t.id ?? "").trim())
          .filter(Boolean)
      : [];

    let assignState = processAssignmentForTurn({
      preTurnDraft,
      persistedDraft: session.latestDraft as Record<string, unknown> | undefined,
      sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
      orchAssignment: result.assignment,
      draftTouchedThisTurn: hasDraftJson || tools.some((t) =>
        ["update_draft_task", "add_draft_subtask", "remove_draft_subtask", "save_draft"].includes(t),
      ),
      planId: session.planId,
      traceId: result.traceId,
      modelName: clientConfig.model,
      taskIds,
      employees: employeeRepo.list().map((e) => ({ userId: e.userId, displayName: e.displayName })),
      requireFullCoverage: true,
    });

    const needsAssignRetry =
      def.expectAssignmentFullCoverage
      && hasAssigneeIntentInUserMessage(def.userMessage)
      && assignState.coverage.total > 0
      && assignState.coverage.covered < assignState.coverage.total;

    if (needsAssignRetry) {
      const retryBackground = buildAssignRetryUserMessage({
        originalUserMessage: def.userMessage,
        missingTaskIds: assignState.missingTaskIds,
        taskIndexMap: buildTaskIndexMap(session.latestDraft as Record<string, unknown> | undefined),
      });
      const retryResult = await runOrchestrator(retryBackground, {
        clientConfig,
        employeeRepo,
        maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
        toolProfile: route.toolProfile,
        promptProfile: route.promptProfile,
        trustedActorUserId: route.trustedActorUserId,
        actorRole: def.senderStaffId === MGR_STAFF_ID ? "manager" : "employee",
        actorName: def.senderStaffId === MGR_STAFF_ID ? "测评经理" : "发起人",
        currentSession: session,
        currentSessionPlanId: session.planId,
        publishRecentStore,
        sessionContext: {
          conversationHistory: session.conversationHistory,
          planId: session.planId,
          latestDraft: session.latestDraft as Record<string, unknown> | undefined,
          latestAssignment: session.latestAssignment,
          memoryFacts: session.knownFacts,
          currentTimeIso: new Date().toISOString(),
        },
      });
      result = retryResult;
      tools = [...tools, ...(retryResult.toolInvocationNames ?? [])];
      if (retryResult.draft) session.latestDraft = retryResult.draft as typeof session.latestDraft;
      assignState = processAssignmentForTurn({
        preTurnDraft,
        persistedDraft: session.latestDraft as Record<string, unknown> | undefined,
        sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
        orchAssignment: retryResult.assignment,
        draftTouchedThisTurn: true,
        planId: session.planId,
        traceId: retryResult.traceId,
        modelName: clientConfig.model,
        taskIds: Array.isArray((session.latestDraft as { tasks?: Array<{ id?: string }> } | undefined)?.tasks)
          ? ((session.latestDraft as { tasks: Array<{ id?: string }> }).tasks)
              .map((t) => String(t.id ?? "").trim())
              .filter(Boolean)
          : [],
        employees: employeeRepo.list().map((e) => ({ userId: e.userId, displayName: e.displayName })),
        requireFullCoverage: true,
      });
    }

    if (assignState.latestAssignment) {
      session.latestAssignment = assignState.latestAssignment as typeof session.latestAssignment;
    }

    const outboundMessage = result.messages.join("\n\n");

    const coverage = assertAssignmentFullCoverage(
      session.latestDraft as Record<string, unknown> | undefined,
      session.latestAssignment as Record<string, unknown> | undefined,
    );

    session.conversationHistory = [
      ...session.conversationHistory,
      { role: "user" as const, content: def.userMessage },
      { role: "assistant" as const, content: outboundMessage || "(empty)" },
    ].slice(-12);
    session.updatedAt = new Date().toISOString();
    createPlanSessionStore().save(session);

    if (result.draft) {
      savePlanSnapshot(session.planId, {
        planId: session.planId,
        traceId: result.traceId,
        status: "DRAFT_READY",
        draft: result.draft,
        messagePreview: result.messages[0]?.slice(0, 300),
      });
    }

    const tc = taskCount(session.latestDraft);
    const fc = draftFieldCoverage(session.latestDraft);
    const titles = taskTitles(session.latestDraft);
    const preview = result.messages.join(" ").slice(0, 160);

    const reasons: string[] = [];
    if (def.expectMinTasks !== undefined && tc < def.expectMinTasks) {
      reasons.push(`tasks=${tc}<min${def.expectMinTasks}`);
    }
    if (def.expectDraftJson && !hasDraftJson) {
      reasons.push("missing draft JSON this turn");
    }
    if (def.expectTasksIncreaseBy !== undefined && tc < priorTaskCount + def.expectTasksIncreaseBy) {
      reasons.push(`tasks did not increase by ${def.expectTasksIncreaseBy} (was ${priorTaskCount}, now ${tc})`);
    }
    if (def.expectMinFieldCoverage !== undefined && fc < def.expectMinFieldCoverage) {
      reasons.push(`fieldCoverage=${fc.toFixed(2)}<${def.expectMinFieldCoverage}`);
    }
    if (def.expectTools?.length) {
      const missing = def.expectTools.filter((t) => !tools.includes(t));
      if (missing.length) reasons.push(`missing tools: ${missing.join(",")}`);
    }
    if (def.expectToolAny?.length && !def.expectToolAny.some((t) => tools.includes(t))) {
      reasons.push(`need any of: ${def.expectToolAny.join(",")}`);
    }
    if (def.patchMode && def.expectTools?.length) {
      if (hasDraftJson && tc !== priorTaskCount && priorTaskCount > 0) {
        reasons.push("patch should not change task count via full redraft");
      }
    }
    if (def.expectPublishOk) {
      const ok = publishResultSucceeded(result.publishResult as Record<string, unknown> | undefined);
      if (!ok) reasons.push("publishResult.ok !== true");
    }
    if (def.expectAssignmentFullCoverage && coverage.ratio < 1) {
      reasons.push(`assignment ${coverage.covered}/${coverage.total} missing=${coverage.missingTaskIds.join(",")}`);
    }
    if (def.expectNoFakeAssignMessage && !assertEvalNoFakeAssign({
      userMessage: def.userMessage,
      draft: session.latestDraft as Record<string, unknown> | undefined,
      assignment: session.latestAssignment as Record<string, unknown> | undefined,
      message: outboundMessage,
      extractOk: assignState.extractOk,
    })) {
      reasons.push("false assign message with incomplete session assignment");
    }
    if (def.expectMaxToolCalls !== undefined && tools.length > def.expectMaxToolCalls) {
      reasons.push(`toolCalls=${tools.length}>max${def.expectMaxToolCalls}`);
    }
    if (!assertNoMaxTurnsExceeded(result)) {
      reasons.push("max_turns_exceeded");
    }

    return {
      id: def.id,
      pass: reasons.length === 0,
      ms: Date.now() - t0,
      taskCount: tc,
      hasDraftJson,
      fieldCoverage: fc,
      tools,
      publishOk: (result.publishResult as { ok?: boolean } | undefined)?.ok,
      assignmentCoverage: coverage.ratio,
      failReason: reasons.join("; ") || undefined,
      preview,
      titles,
    };
  } catch (e) {
    return {
      id: def.id,
      pass: false,
      ms: Date.now() - t0,
      taskCount: taskCount(session.latestDraft),
      hasDraftJson: false,
      fieldCoverage: 0,
      tools: [],
      failReason: e instanceof Error ? e.message : String(e),
    };
  }
}

function loadSession(store: ReturnType<typeof createPlanSessionStore>, key: string, def: ScenarioDef): PlanSession {
  if (def.freshSession) {
    const s = store.loadOrCreate(`eval:wbs-mgr:${key}:${def.id}`);
    s.conversationHistory = [];
    s.knownFacts = [];
    if (def.preSeedDraft) {
      s.latestDraft = def.preSeedDraft as typeof s.latestDraft;
    } else {
      s.latestDraft = undefined;
    }
    s.latestAssignment = undefined;
    store.save(s);
    return s;
  }
  return store.loadOrCreate(`eval:wbs-mgr:${key}`);
}

function buildScenarios(): ScenarioDef[] {
  return [
    {
      id: "W1_oct_complex_draft",
      sessionKey: "oct_chain",
      senderStaffId: INITIATOR,
      userMessage:
        "OCT 客诉：A 产品（型号 A-2026B）批次 2026Q2-04 批量焊点开路，15 台设备，缺陷代号 DCT-2026-0512。" +
        "2026-06-15 前完成根因、遏制与纠正措施。按 WBS 拆到可独立承接的工作包，直接输出正式草案 JSON。",
      expectMinTasks: 5,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.85,
    },
    {
      id: "W2_redraft_strict_json",
      sessionKey: "oct_chain",
      senderStaffId: INITIATOR,
      userMessage:
        "当前草案粒度仍偏粗。请按 WBS 整表重出 tasks[]，拆到至少 10 条可验收工作包；本回合必须输出完整 draft JSON。",
      expectMinTasks: 10,
      expectDraftJson: true,
      expectTasksIncreaseBy: 2,
      expectMinFieldCoverage: 0.85,
    },
    {
      id: "W8_patch_task_due",
      sessionKey: "oct_chain",
      senderStaffId: INITIATOR,
      userMessage: "只改 task_3：截止日期改到 2026-06-18，不要整表重拆。",
      patchMode: true,
      expectTools: ["update_draft_task"],
    },
    {
      id: "W3_rd_release",
      sessionKey: "rd",
      senderStaffId: INITIATOR,
      freshSession: true,
      userMessage:
        "研发发版：糖代谢分析仪 2026-06-20 发布（固件 v3.5.0 + DLL 2.3.0 + APK 1.9.2），含 BLE 修复与 HL7 对齐，依赖 ECO-24018。" +
        "按 WBS 拆需求冻结、联调、验证、回滚、文档等工作包，直接出草案 JSON。",
      expectMinTasks: 5,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.85,
    },
    {
      id: "W4_coarse_redraft",
      sessionKey: "coarse",
      senderStaffId: INITIATOR,
      freshSession: true,
      preSeedDraft: COARSE_DRAFT_4,
      userMessage:
        "memory 里这份只有 4 个阶段大包，太粗。请按 WBS 整表重出 tasks[]，至少 10 条单一交付物工作包；必须输出完整 draft JSON。",
      expectMinTasks: 10,
      expectDraftJson: true,
      expectTasksIncreaseBy: 6,
      expectMinFieldCoverage: 0.85,
    },
    {
      id: "W5_capa_multi_dept",
      sessionKey: "capa",
      senderStaffId: INITIATOR,
      freshSession: true,
      userMessage:
        "CAPA-2026-088：导管头端脱胶导致临床取样失败 2 起，涉及生产、质量、供应链、注册四部门协同。" +
        "2026-07-01 前完成根因、纠正、验证与注册沟通；按 WBS 拆到各部门可独立验收的工作包，直接出草案 JSON。",
      expectMinTasks: 8,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.8,
    },
    {
      id: "W6_eco_hardware",
      sessionKey: "eco",
      senderStaffId: INITIATOR,
      freshSession: true,
      userMessage:
        "硬件 ECO-24022：OCT 探头 PCB 换料（电容 C12→C15），影响 EMC 与可靠性。" +
        "2026-06-25 前完成影响分析、样机验证、回归测试、生产切换与文档更新；WBS 拆解，直接出草案 JSON。",
      expectMinTasks: 5,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.8,
    },
    {
      id: "W7_supplier_iqc",
      sessionKey: "supplier",
      senderStaffId: INITIATOR,
      freshSession: true,
      userMessage:
        "供应商来料异常：批次 LENS-2026Q2-07 透镜面划痕超标，IQC 抽检 5/80 不合格。" +
        "2026-06-12 前完成隔离、8D、PPAP 补充与复产批准；按 WBS 拆解，直接出草案 JSON。",
      expectMinTasks: 4,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.8,
    },
    {
      id: "W9_line_changeover",
      sessionKey: "mfg",
      senderStaffId: INITIATOR,
      freshSession: true,
      userMessage:
        "产线换型：SMT 线体 A 从 A-2026B 切换到 A-2026C，涉及钢网、炉温曲线、首件检验、OEE 验证。" +
        "2026-06-08 08:00 前完成换型与首批放行；WBS 拆到可并行的工作包，直接出草案 JSON。",
      expectMinTasks: 6,
      expectDraftJson: true,
      expectMinFieldCoverage: 0.8,
    },
    {
      id: "W10_manager_assign",
      sessionKey: "oct_chain",
      senderStaffId: MGR_STAFF_ID,
      userMessage:
        "这份客诉草案请你帮忙点将：失效分析和焊接相关的尽量找质量部有SMT经验的同事，其余按能力合理分工，每个子任务都要有明确负责人。",
      expectAssignmentFullCoverage: true,
      expectNoFakeAssignMessage: true,
      expectMaxToolCalls: 14,
    },
    {
      id: "M1_prepare_publish",
      sessionKey: "oct_chain",
      senderStaffId: MGR_STAFF_ID,
      userMessage: "我先看一下发布前的预览，确认没问题再正式发布。",
      expectTools: ["prepare_publish_task"],
    },
    {
      id: "M2_publish_confirm",
      sessionKey: "oct_chain",
      senderStaffId: MGR_STAFF_ID,
      userMessage: "确认发布",
      expectPublishOk: true,
    },
    {
      id: "M3_list_published",
      sessionKey: "oct_chain",
      senderStaffId: MGR_STAFF_ID,
      userMessage: "我名下已发布的正式任务有哪些？请用 list_managed_tasks 列出编号与状态。",
      expectTools: ["list_managed_tasks"],
    },
  ];
}

async function main() {
  bootstrap();
  await seedDirectory();
  const store = createPlanSessionStore();
  const filterRaw = process.env.EVAL_WBS_FILTER?.trim();
  const filterSet = filterRaw
    ? new Set(filterRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  let scenarios = buildScenarios();
  if (filterSet?.size) {
    scenarios = scenarios.filter((s) => filterSet.has(s.id));
    if (scenarios.length === 0) {
      console.error("EVAL_WBS_FILTER matched no scenarios");
      process.exit(1);
    }
  }

  console.log("=== WBS Manager Eval ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`scenarios: ${scenarios.length}`);
  console.log("");

  const sessionCache = new Map<string, PlanSession>();
  let failed = 0;
  const results: ScenarioRunResult[] = [];

  for (const def of scenarios) {
    let session = sessionCache.get(def.sessionKey);
    if (!session || def.freshSession) {
      session = loadSession(store, def.sessionKey, def);
      if (!def.freshSession) sessionCache.set(def.sessionKey, session);
    }

    const priorTaskCount = taskCount(session.latestDraft);

    process.stdout.write(`[${def.id}] ... `);
    const r = await runScenario(session, def, priorTaskCount);
    results.push(r);
    if (!def.freshSession) sessionCache.set(def.sessionKey, session);

    if (!r.pass) failed += 1;
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.ms}ms tasks=${r.taskCount} draftJson=${r.hasDraftJson ? "Y" : "N"}` +
        (r.fieldCoverage > 0 ? ` cov=${r.fieldCoverage.toFixed(2)}` : "") +
        (r.tools.length ? ` tools=${r.tools.join(">")}` : "") +
        (r.failReason ? ` :: ${r.failReason}` : ""),
    );
    if (r.preview) console.log(`  msg: ${r.preview.replace(/\n/g, " ")}`);
    if (r.titles?.length) {
      console.log(
        `  titles: ${r.titles.slice(0, 10).join(" | ")}${r.titles.length > 10 ? " …" : ""}`,
      );
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log("");
  console.log(`=== Summary: ${passed}/${results.length} passed ===`);
  if (failed > 0) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.id}: ${r.failReason ?? "unknown"}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
