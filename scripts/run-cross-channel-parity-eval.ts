/**
 * Cross-channel parity eval: canonical session + DT/WB orchestrator + Excel revise.
 * Run: npm run eval:cross-channel
 * Filter: EVAL_CROSS_FILTER=X1_merge,CHAIN_full EVAL_CROSS_FILTER=CHAIN_full
 * Rounds: EVAL_ROUNDS=2 npm run eval:cross-channel
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import {
  createPlanSessionStore,
  hashChatKey,
} from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import {
  buildManagerQwenClientConfig,
  runManagerOrchestratorTurn,
} from "../src/agent/manager-orchestrator-turn";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import {
  canonicalMainChatKey,
  resolveCanonicalMainSession,
} from "../src/web/canonical-main-session";
import {
  draftToExcelRows,
  excelRowsToDraft,
} from "../src/web/draft-excel-grid";
import { prevalidateWorkbenchDraftRevision } from "../src/agent/workbench/draft-revise-prevalidate";
import { runWorkbenchDraftRevision } from "../src/agent/workbench/draft-revision";
import {
  applyEvalProductionParityEnv,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";
import {
  assertAssignmentCoverageMin,
  assertCanonicalHash,
  assertDraftTitle,
  assertPublishTurn,
  assertTaskDueAtById,
  countFormalTasksForManager,
} from "./eval-cross-channel-assertions";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-cross-channel");
const MGR = "eval-mgr-xchannel-001";
const DT_KEY = `conv-xchannel::1::${MGR}`;
const U_YAO = "eval-yao-xchannel-001";
const U_YANG = "eval-yang-xchannel-001";
const FILTER = process.env.EVAL_CROSS_FILTER?.trim();
const ROUNDS = Math.max(1, Number(process.env.EVAL_ROUNDS ?? "1") || 1);

const TRANSPORT_DRAFT_6: Record<string, unknown> = {
  title: "临床样机运输后开机异常分析与改进",
  description: "姚雪峰与杨贺新协作完成运输前后点检、根因分析与改进建议，一个月内闭环。",
  tasks: [
    { id: "task_1", title: "运输前现场点检与状态记录", objective: "建立运输前开机基线", deliverables: ["点检表"], completionCriteria: ["记录完整"], timeNode: { dueAt: "2026-06-10" } },
    { id: "task_2", title: "运输后首检与现象分级", objective: "区分无电/蓝屏/黑屏", deliverables: ["分级记录"], completionCriteria: ["现象归类"], timeNode: { dueAt: "2026-06-12" } },
    { id: "task_3", title: "硬件上电路径排查", objective: "排查电源与主板", deliverables: ["排查报告"], completionCriteria: ["根因假设"], timeNode: { dueAt: "2026-06-14" } },
    { id: "task_4", title: "包装固定与减震评估", objective: "评估结构/包装风险", deliverables: ["评估报告"], completionCriteria: ["改进点清单"], timeNode: { dueAt: "2026-06-18" } },
    { id: "task_5", title: "运输过程监控与交接", objective: "监控温湿度与交接", deliverables: ["监控日志"], completionCriteria: ["无异常"], timeNode: { dueAt: "2026-06-25" } },
    { id: "task_6", title: "改进建议与SOP修订", objective: "输出防再发措施", deliverables: ["SOP草案"], completionCriteria: ["主管认可"], timeNode: { dueAt: "2026-06-30" } },
  ],
};

interface ScenarioResult {
  id: string;
  round: number;
  pass: boolean;
  ms: number;
  channel?: string;
  traceIds?: string[];
  failReason?: string;
}

function applyEvalDirs() {
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
  process.env.EMPLOYEE_PROFILE_DIR = join(EVAL_DIR, "employee-profiles");
  process.env.DINGTALK_PLANID_ROTATE_ENABLED = "1";
}

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalDirs();
  mkdirSync(process.env.PLAN_SESSION_DIR!, { recursive: true });
  mkdirSync(process.env.EMPLOYEE_PROFILE_DIR!, { recursive: true });
}

/** Reset plan sessions only (keep SQLite to avoid Windows EBUSY on workbench.sqlite). */
function bootstrapSessionsOnly() {
  const sessionsDir = process.env.PLAN_SESSION_DIR ?? join(EVAL_DIR, "sessions");
  if (existsSync(sessionsDir)) rmSync(sessionsDir, { recursive: true, force: true });
  mkdirSync(sessionsDir, { recursive: true });
}

async function seedDirectory() {
  const store = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    store.upsertContact({ ...base, userId: MGR, name: "跨端测评主管", unionId: "u-mgr-x", departmentNames: ["质量部"] });
    store.upsertContact({ ...base, userId: U_YAO, name: "姚雪峰", unionId: "u-yao", departmentNames: ["研发部"], position: "硬件测试工程师" });
    store.upsertContact({ ...base, userId: U_YANG, name: "杨贺新", unionId: "u-yang", departmentNames: ["研发部"], position: "结构工程师" });
    for (const uid of [U_YAO, U_YANG]) {
      store.upsertProfile({
        userId: uid,
        skillTags: ["运输", "失效分析"],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: { capacityHint: "ok", emergencyOk: true },
        source: "eval",
      });
    }
  } finally {
    store.close();
  }
}

function seedDualSessionFiles(dingtalkTitle: string) {
  const store = createPlanSessionStore();
  const now = new Date().toISOString();
  const wbKey = canonicalMainChatKey(MGR);
  const wbHash = hashChatKey(wbKey);
  const dtHash = hashChatKey(DT_KEY);

  writeFileSync(
    join(process.env.PLAN_SESSION_DIR!, `${wbHash}.json`),
    JSON.stringify({
      chatKeyHash: wbHash,
      planId: "plan-wb-placeholder",
      createdAt: now,
      updatedAt: now,
      senderStaffId: MGR,
      threadKind: "main",
      threadId: "main",
      conversationHistory: [],
      knownFacts: [],
    }),
    "utf8",
  );

  writeFileSync(
    join(process.env.PLAN_SESSION_DIR!, `${dtHash}.json`),
    JSON.stringify({
      chatKeyHash: dtHash,
      planId: "plan-dt-main",
      createdAt: now,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      senderStaffId: MGR,
      conversationId: "conv-xchannel",
      conversationType: "1",
      latestDraft: {
        ...TRANSPORT_DRAFT_6,
        title: dingtalkTitle,
      },
      conversationHistory: [],
      knownFacts: [],
    }),
    "utf8",
  );
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  const base = loadQwenPlannerConfigFromEnv();
  if (!base) throw new Error("missing QWEN_API_KEY");
  return buildManagerQwenClientConfig(base);
}

function loadCanonicalSession(): PlanSession {
  return resolveCanonicalMainSession(MGR, { dingtalkChatKey: DT_KEY });
}

function saveCanonical(session: PlanSession) {
  createPlanSessionStore().save({
    ...session,
    senderStaffId: MGR,
    canonicalUserId: MGR,
    threadKind: "main",
    threadId: "main",
  });
}

function simulateExcelSaveDueAt(
  session: PlanSession,
  taskId: string,
  dueAt: string,
): PlanSession {
  const draft = session.latestDraft as Record<string, unknown> | undefined;
  if (!draft || !Array.isArray(draft.tasks)) {
    throw new Error("simulateExcelSaveDueAt: session missing latestDraft.tasks");
  }
  const assignment = session.latestAssignment as Record<string, unknown> | undefined;
  const rows = draftToExcelRows({ draft, assignment });
  const row = rows.find((r) => r.taskId === taskId);
  if (!row) throw new Error(`excel row missing ${taskId}`);
  row.dueAt = dueAt;
  const converted = excelRowsToDraft({ rows, previousDraft: draft, previousAssignment: assignment });
  const pre = prevalidateWorkbenchDraftRevision({
    draft: converted.draft,
    assignment: converted.assignment,
    previousDraft: draft,
    previousAssignment: assignment,
  });
  if (!pre.ok) throw new Error(`prevalidate: ${pre.errors.join(";")}`);
  return {
    ...session,
    latestDraft: pre.draft as PlanSession["latestDraft"],
    latestAssignment: pre.assignment as PlanSession["latestAssignment"],
  };
}

async function runX1Merge(): Promise<string[]> {
  const reasons: string[] = [];
  seedDualSessionFiles("钉钉合并后标题");
  const main = resolveCanonicalMainSession(MGR, { dingtalkChatKey: DT_KEY });
  reasons.push(...assertCanonicalHash(main, MGR));
  reasons.push(...assertDraftTitle(main.latestDraft as Record<string, unknown>, "钉钉合并后标题"));
  const store = createPlanSessionStore();
  if (store.loadByChatKey(DT_KEY)) reasons.push("dingtalk file still exists after merge");
  if (!store.loadByChatKey(canonicalMainChatKey(MGR))) reasons.push("canonical file missing");
  if (main.conversationId !== "conv-xchannel") reasons.push("conversationId not preserved");
  return reasons;
}

async function runE4PrevalidateFail(): Promise<string[]> {
  const reasons: string[] = [];
  const session = loadCanonicalSession();
  session.latestDraft = structuredClone(TRANSPORT_DRAFT_6) as PlanSession["latestDraft"];
  const bad = structuredClone(TRANSPORT_DRAFT_6) as Record<string, unknown>;
  const tasks = [...(bad.tasks as Array<Record<string, unknown>>)];
  tasks.push({ ...tasks[0], id: tasks[0]!.id });
  bad.tasks = tasks;
  const pre = prevalidateWorkbenchDraftRevision({
    draft: bad,
    previousDraft: session.latestDraft as Record<string, unknown>,
  });
  if (pre.ok) reasons.push("expected prevalidate failure for duplicate taskId");
  return reasons;
}

async function runE5ExcelRoundtrip(): Promise<string[]> {
  const reasons: string[] = [];
  const session = loadCanonicalSession();
  session.latestDraft = structuredClone(TRANSPORT_DRAFT_6) as PlanSession["latestDraft"];
  session.latestAssignment = {
    assignments: [
      { taskId: "task_1", primary: { userId: U_YAO, displayName: "姚雪峰" } },
      { taskId: "task_2", primary: { userId: U_YANG, displayName: "杨贺新" } },
    ],
  } as PlanSession["latestAssignment"];
  const rows = draftToExcelRows({
    draft: session.latestDraft as Record<string, unknown>,
    assignment: session.latestAssignment as Record<string, unknown>,
  });
  const t3 = rows.find((r) => r.taskId === "task_3");
  if (!t3) return ["missing task_3 row"];
  t3.risks = "运输震动；静电";
  const converted = excelRowsToDraft({
    rows,
    previousDraft: session.latestDraft as Record<string, unknown>,
    previousAssignment: session.latestAssignment as Record<string, unknown>,
  });
  const pre = prevalidateWorkbenchDraftRevision({
    draft: converted.draft,
    assignment: converted.assignment,
    previousDraft: session.latestDraft as Record<string, unknown>,
    previousAssignment: session.latestAssignment as Record<string, unknown>,
  });
  if (!pre.ok) return pre.errors;
  const risks = (
    (pre.draft.tasks as Array<Record<string, unknown>>).find((t) => t.id === "task_3")
      ?.risksAndOpenQuestions as string[] | undefined
  ) ?? [];
  if (!risks.some((r) => r.includes("运输震动"))) {
    reasons.push(`risks roundtrip lost: ${JSON.stringify(risks)}`);
  }
  return reasons;
}

async function runChainFull(clientConfig: ReturnType<typeof buildClient>): Promise<string[]> {
  const reasons: string[] = [];
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const store = createPlanSessionStore();

  let session = loadCanonicalSession();
  session.latestDraft = structuredClone(TRANSPORT_DRAFT_6) as PlanSession["latestDraft"];
  session.latestAssignment = undefined;
  session.candidatePool = {
    source: "eval-roster",
    entries: [
      { userId: U_YAO, displayName: "姚雪峰" },
      { userId: U_YANG, displayName: "杨贺新" },
    ],
    unresolved: [],
    updatedAt: new Date().toISOString(),
  };
  saveCanonical(session);

  const assignMsg =
    "花名册里就姚雪峰和杨贺新两个人：前面几条硬件排查、上电和日志相关的给姚雪峰，包装、运输监控和签收归档相关的给杨贺新。请把整张表所有子任务的负责人都定下来。先不要发布、不要预览，只做点将。";

  const tAssign = await runManagerOrchestratorTurn({
    userMessage: assignMsg,
    session,
    employeeRepo,
    clientConfig,
    senderStaffId: MGR,
    actorName: "测评主管",
  });
  saveCanonical(tAssign.session);
  session = resolveCanonicalMainSession(MGR, { dingtalkChatKey: DT_KEY });
  if (!session.latestDraft) {
    return ["assign turn left session without latestDraft after canonical reload"];
  }
  reasons.push(
    ...assertAssignmentCoverageMin(
      session.latestDraft as Record<string, unknown>,
      session.latestAssignment as Record<string, unknown>,
      1,
    ),
  );
  if (!(tAssign.orchResult.toolInvocationNames ?? []).includes("bulk_assign_tasks")) {
    reasons.push("assign turn missing bulk_assign_tasks");
  }

  session = simulateExcelSaveDueAt(session, "task_2", "2026-05-28");
  saveCanonical(session);

  const dtReload = resolveCanonicalMainSession(MGR, { dingtalkChatKey: DT_KEY });
  reasons.push(...assertCanonicalHash(dtReload, MGR));
  reasons.push(...assertTaskDueAtById(dtReload.latestDraft as Record<string, unknown>, "task_2", "2026-05-28"));

  const wbReload = resolveCanonicalMainSession(MGR);
  reasons.push(...assertTaskDueAtById(wbReload.latestDraft as Record<string, unknown>, "task_2", "2026-05-28"));

  session = wbReload;

  let prep = await runManagerOrchestratorTurn({
    userMessage:
      "请仅对当前会话里这份未发布草案调用 prepare_publish_task 做发布预览，不要 start_new_task，不要换任务。",
    session,
    employeeRepo,
    clientConfig,
    senderStaffId: MGR,
    workbenchRole: "manager",
    actorName: "测评主管",
  });
  if ((prep.orchResult.toolInvocationNames ?? []).includes("start_new_task")) {
    prep = await runManagerOrchestratorTurn({
      userMessage: "切回上一条任务，然后做发布预览。",
      session: prep.session,
      employeeRepo,
      clientConfig,
      senderStaffId: MGR,
      workbenchRole: "manager",
      actorName: "测评主管",
    });
  }
  session = prep.session;
  saveCanonical(session);
  if (!session.latestDraft) {
    reasons.push("prepare turn lost latestDraft");
  }
  if (!(prep.orchResult.toolInvocationNames ?? []).includes("prepare_publish_task")) {
    reasons.push("prepare_publish_task not called");
  }

  const tasksBeforePublish = countFormalTasksForManager(
    createWorkbenchFormalTaskStore().listManagerTasks(MGR),
    MGR,
  );

  const pub = await runManagerOrchestratorTurn({
    userMessage: "确认发布",
    session,
    employeeRepo,
    clientConfig,
    senderStaffId: MGR,
    workbenchRole: "manager",
    actorName: "测评主管",
  });
  session = pub.session;
  saveCanonical(session);
  reasons.push(
    ...assertPublishTurn({
      publishResult: pub.publishResult,
      tools: pub.orchResult.toolInvocationNames ?? [],
    }),
  );

  const tasksAfter = countFormalTasksForManager(
    createWorkbenchFormalTaskStore().listManagerTasks(MGR),
    MGR,
  );
  if (tasksAfter <= tasksBeforePublish) {
    reasons.push(`sqlite tasks not increased ${tasksBeforePublish}->${tasksAfter}`);
  }

  return reasons;
}

async function runChainExcelLlm(clientConfig: ReturnType<typeof buildClient>): Promise<string[]> {
  const reasons: string[] = [];
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  let session = loadCanonicalSession();
  session.latestDraft = structuredClone(TRANSPORT_DRAFT_6) as PlanSession["latestDraft"];
  session.latestAssignment = {
    assignments: (TRANSPORT_DRAFT_6.tasks as Array<{ id: string }>).map((t, i) => ({
      taskId: t.id,
      primary: {
        userId: i % 2 === 0 ? U_YAO : U_YANG,
        displayName: i % 2 === 0 ? "姚雪峰" : "杨贺新",
      },
    })),
  } as PlanSession["latestAssignment"];
  saveCanonical(session);

  const rows = draftToExcelRows({
    draft: session.latestDraft as Record<string, unknown>,
    assignment: session.latestAssignment as Record<string, unknown>,
  });
  const row = rows.find((r) => r.taskId === "task_2");
  if (row) row.dueAt = "2026-05-29";
  const converted = excelRowsToDraft({
    rows,
    previousDraft: session.latestDraft as Record<string, unknown>,
    previousAssignment: session.latestAssignment as Record<string, unknown>,
  });

  const revised = await runWorkbenchDraftRevision({
    session,
    draft: converted.draft,
    assignment: converted.assignment,
    orchestratorConfig: {
      clientConfig,
      employeeRepo,
      toolProfile: "manager",
      promptProfile: "planner",
      managerFollowup: true,
      currentSessionPlanId: session.planId,
      currentSession: session,
      actorRole: "manager",
    },
  });
  if (!revised.ok) return [revised.error];
  const taskCount = (revised.prevalidatedDraft.tasks as unknown[])?.length ?? 0;
  if (taskCount !== 6) reasons.push(`LLM excel changed task count ${taskCount}`);
  session = {
    ...session,
    latestDraft: revised.prevalidatedDraft as PlanSession["latestDraft"],
    latestAssignment: revised.prevalidatedAssignment as PlanSession["latestAssignment"],
  };
  saveCanonical(session);
  const reload = resolveCanonicalMainSession(MGR, { dingtalkChatKey: DT_KEY });
  reasons.push(...assertTaskDueAtById(reload.latestDraft as Record<string, unknown>, "task_2", "2026-05-29"));
  return reasons;
}

type ScenarioFn = (client?: ReturnType<typeof buildClient>) => Promise<string[]>;

const SCENARIOS: Array<{ id: string; needsLlm: boolean; run: ScenarioFn }> = [
  { id: "X1_merge", needsLlm: false, run: runX1Merge },
  { id: "E4_prevalidate_dup_id", needsLlm: false, run: runE4PrevalidateFail },
  { id: "E5_excel_risks_roundtrip", needsLlm: false, run: runE5ExcelRoundtrip },
  { id: "CHAIN_dt_excel_wb_publish", needsLlm: true, run: runChainFull },
  { id: "CHAIN_excel_llm_revise", needsLlm: true, run: runChainExcelLlm },
];

function shouldRun(id: string): boolean {
  if (!FILTER) return true;
  const parts = FILTER.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.some((p) => id === p || id.startsWith(p));
}

async function main() {
  bootstrap();
  await seedDirectory();

  let client: ReturnType<typeof buildClient> | undefined;
  const needsAnyLlm = SCENARIOS.some((s) => s.needsLlm && shouldRun(s.id));
  if (needsAnyLlm) {
    try {
      client = buildClient();
    } catch (e) {
      console.error("LLM scenarios require QWEN_API_KEY:", e);
      process.exit(1);
    }
  }

  const results: ScenarioResult[] = [];
  let failed = 0;

  console.log("=== Cross-Channel Parity Eval ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`rounds: ${ROUNDS}`);
  if (FILTER) console.log(`filter: ${FILTER}`);
  console.log("");

  for (let round = 1; round <= ROUNDS; round += 1) {
    if (ROUNDS > 1) console.log(`--- round ${round}/${ROUNDS} ---`);
    for (const def of SCENARIOS) {
      if (!shouldRun(def.id)) continue;
      if (def.needsLlm && !client) continue;
      bootstrapSessionsOnly();
      await seedDirectory();
      const t0 = Date.now();
      process.stdout.write(`[${def.id}] r${round} ... `);
      try {
        const reasons = await def.run(client);
        const pass = reasons.length === 0;
        if (!pass) failed += 1;
        const row: ScenarioResult = {
          id: def.id,
          round,
          pass,
          ms: Date.now() - t0,
          failReason: reasons.join("; ") || undefined,
        };
        results.push(row);
        console.log(`${pass ? "PASS" : "FAIL"} ${row.ms}ms${row.failReason ? ` :: ${row.failReason}` : ""}`);
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ id: def.id, round, pass: false, ms: Date.now() - t0, failReason: msg });
        console.log(`FAIL ${Date.now() - t0}ms :: ${msg}`);
      }
    }
  }

  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    JSON.stringify(
      {
        prompt: QWEN_PLANNER_PROMPT_VERSION,
        rounds: ROUNDS,
        filter: FILTER ?? null,
        parity: formatEvalProductionParitySummary(),
        results,
      },
      null,
      2,
    ),
  );

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${total} passed (${ROUNDS} round(s))`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
