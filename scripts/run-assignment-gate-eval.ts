/**
 * Assignment / 点将专项 eval（L2 门禁）— 自然话术，不提示工具名。
 * Run: npm run eval:assignment-gate
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { isDraftStagedForPublish } from "../src/agent/publish-staging";
import {
  assertNaturalUserMessage,
  runDingtalkLikeTurn,
} from "./dingtalk-turn-eval-harness";
import {
  assertAssignmentFullCoverage,
  assertAssigneeAtDisplayIndex,
  assertEvalNoFakeAssign,
  assertMinDueAtCoverage,
  assertNoDuplicateTaskIds,
  assertNoMaxTurnsExceeded,
  assertOrdinalResolvesToDisplayIndex,
  assertRowAtDisplayIndex,
  assertSplitRowsInheritDueAt,
  assertTasksIncreasedBy,
} from "./eval-assignment-assertions";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-assignment-gate");
const MGR = "eval-mgr-assign-001";
const U_YAO = "eval-yaoxuefeng-001";
const U_YANG = "eval-yanghexin-001";

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

interface ScenarioDef {
  id: string;
  userMessage: string;
  preSeedDraft?: Record<string, unknown>;
  expectAssignmentFull?: boolean;
  expectNoFakeAssign?: boolean;
  forbidAssigneePatchLoop?: boolean;
  expectTasksIncreaseBy?: number;
  expectMinDueAtCoverage?: number;
  expectSplitDueAtFromRow?: number;
  expectOrdinalRow?: { token: string; displayIndex: number };
  expectRowPatch?: { displayIndex: number; dueAt?: string; assigneeUserId?: string; assigneeName?: string };
  allowAssignRetry?: boolean;
}

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
  mkdirSync(process.env.PLAN_SESSION_DIR, { recursive: true });
}

async function seedDirectory() {
  const store = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    store.upsertContact({ ...base, userId: MGR, name: "测评主管", unionId: "u-mgr", departmentNames: ["质量部"] });
    store.upsertContact({ ...base, userId: U_YAO, name: "姚雪峰", unionId: "u-yao", departmentNames: ["研发部"], position: "硬件测试工程师" });
    store.upsertContact({ ...base, userId: U_YANG, name: "杨贺新", unionId: "u-yang", departmentNames: ["研发部"], position: "结构工程师" });
    for (const uid of [U_YAO, U_YANG]) {
      store.upsertProfile({ userId: uid, skillTags: ["运输", "失效分析", "SMT"], strengths: [], boundaries: [], cases: [], tools: [], availability: { capacityHint: "ok", emergencyOk: true }, source: "eval" });
    }
  } finally {
    store.close();
  }
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

function buildScenarios(): ScenarioDef[] {
  return [
    {
      id: "A1_roster_assign_all",
      preSeedDraft: TRANSPORT_DRAFT_6,
      userMessage:
        "花名册里就姚雪峰和杨贺新两个人：前面几条硬件排查、上电和日志相关的给姚雪峰，包装、运输监控和签收归档相关的给杨贺新。请把整张表所有子任务的负责人都定下来。",
      expectAssignmentFull: true,
      expectNoFakeAssign: true,
      forbidAssigneePatchLoop: true,
      expectMinDueAtCoverage: 1,
      allowAssignRetry: false,
    },
    {
      id: "A2_reassign_same_split",
      userMessage: "刚才的分工不变，请重新整理一版完整的负责人安排，确保每个子任务都有人。",
      expectAssignmentFull: true,
      forbidAssigneePatchLoop: true,
      expectMinDueAtCoverage: 1,
    },
    {
      id: "A4a_split_first_task",
      userMessage: "第一条「运输前现场点检」太粗了，帮我拆成两条可以并行推进的工作包，其他行先不动。",
      expectTasksIncreaseBy: 1,
      expectMinDueAtCoverage: 0.85,
      expectSplitDueAtFromRow: 1,
      allowAssignRetry: false,
    },
    {
      id: "A4_prod_split_task2",
      preSeedDraft: TRANSPORT_DRAFT_6,
      userMessage: "把任务2拆成2个小任务",
      expectTasksIncreaseBy: 1,
      expectSplitDueAtFromRow: 2,
      allowAssignRetry: false,
    },
    {
      id: "A4b_assign_after_split",
      userMessage:
        "拆分后还是姚雪峰负责前面硬件排查相关的，杨贺新负责包装运输和签收相关的，请把现在所有子任务的负责人都补齐。",
      expectAssignmentFull: true,
      expectNoFakeAssign: true,
      forbidAssigneePatchLoop: true,
      expectMinDueAtCoverage: 0.85,
    },
    {
      id: "A5_ordinal_patch_task2",
      userMessage: "任务2改成2026-05-28前完成，负责人换成杨贺新，只改这一行。",
      expectOrdinalRow: { token: "任务2", displayIndex: 2 },
      expectRowPatch: { displayIndex: 2, dueAt: "2026-05-28", assigneeUserId: U_YANG, assigneeName: "杨贺新" },
      allowAssignRetry: false,
    },
    {
      id: "A6_assign_from_scratch",
      preSeedDraft: TRANSPORT_DRAFT_6,
      userMessage:
        "请帮忙点将：失效分析和焊接相关的尽量找质量部有SMT经验的同事，其余按能力合理分工，每个子任务都要有明确负责人。",
      expectAssignmentFull: true,
      expectNoFakeAssign: true,
    },
  ];
}

function snapshotDraft(draft: PlanSession["latestDraft"]): Record<string, unknown> | undefined {
  return draft ? (structuredClone(draft) as Record<string, unknown>) : undefined;
}

async function runOne(session: PlanSession, def: ScenarioDef, clientConfig: ReturnType<typeof buildClient>) {
  const reasons = assertNaturalUserMessage(def.userMessage);
  const draftBefore = snapshotDraft(session.latestDraft);

  const turn = await runDingtalkLikeTurn(session, def.userMessage, {
    clientConfig,
    senderStaffId: MGR,
    actorName: "测评主管",
    allowAssignRetry: def.allowAssignRetry,
    enableDingtalkPreRetries: false,
  });

  const coverage = assertAssignmentFullCoverage(
    session.latestDraft as Record<string, unknown> | undefined,
    session.latestAssignment as Record<string, unknown> | undefined,
  );

  if (def.expectAssignmentFull && coverage.ratio < 1) {
    reasons.push(`assignment ${coverage.covered}/${coverage.total} missing=${coverage.missingTaskIds.join(",")}`);
  }
  if (def.expectNoFakeAssign && !assertEvalNoFakeAssign({
    userMessage: def.userMessage,
    draft: session.latestDraft as Record<string, unknown> | undefined,
    assignment: session.latestAssignment as Record<string, unknown> | undefined,
    message: turn.outboundMessage,
    extractOk: turn.assignState.extractOk,
  })) {
    reasons.push("false assign message");
  }
  if (def.forbidAssigneePatchLoop) {
    const patches = turn.tools.filter((t) => t === "update_draft_task").length;
    if (patches > 4) reasons.push(`too many single-row assignee patches=${patches}`);
  }
  if (def.expectTasksIncreaseBy !== undefined) {
    reasons.push(...assertTasksIncreasedBy(draftBefore, session.latestDraft as Record<string, unknown>, def.expectTasksIncreaseBy));
  }
  if (def.expectMinDueAtCoverage !== undefined) {
    reasons.push(...assertMinDueAtCoverage(session.latestDraft as Record<string, unknown>, def.expectMinDueAtCoverage));
  }
  if (def.expectSplitDueAtFromRow !== undefined) {
    reasons.push(...assertSplitRowsInheritDueAt(draftBefore, session.latestDraft as Record<string, unknown>, def.expectSplitDueAtFromRow));
  }
  reasons.push(...assertNoDuplicateTaskIds(session.latestDraft as Record<string, unknown>));
  if (def.expectOrdinalRow) {
    reasons.push(
      ...assertOrdinalResolvesToDisplayIndex(
        session.latestDraft as Record<string, unknown>,
        def.expectOrdinalRow.token,
        def.expectOrdinalRow.displayIndex,
      ),
    );
  }
  if (def.expectRowPatch) {
    const p = def.expectRowPatch;
    if (p.dueAt !== undefined) {
      reasons.push(...assertRowAtDisplayIndex(session.latestDraft as Record<string, unknown>, p.displayIndex, { dueAt: p.dueAt }));
    }
    if (p.assigneeUserId !== undefined || p.assigneeName !== undefined) {
      reasons.push(
        ...assertAssigneeAtDisplayIndex(
          session.latestDraft as Record<string, unknown>,
          session.latestAssignment as Record<string, unknown>,
          p.displayIndex,
          { userId: p.assigneeUserId, displayNameContains: p.assigneeName },
        ),
      );
    }
  }
  if (!assertNoMaxTurnsExceeded({ stopReason: turn.stopReason, toolInvocationNames: turn.tools })) {
    reasons.push("max_turns_exceeded");
  }

  createPlanSessionStore().save(session);
  const taskCount = Array.isArray((session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((session.latestDraft as { tasks: unknown[] }).tasks.length)
    : 0;

  return {
    id: def.id,
    pass: reasons.length === 0,
    ms: turn.ms,
    traceId: turn.traceId,
    tools: turn.tools,
    assignmentCoverage: coverage.ratio,
    taskCount,
    failReason: reasons.filter(Boolean).join("; ") || undefined,
  };
}

async function main() {
  bootstrap();
  await seedDirectory();
  const clientConfig = buildClient();
  const store = createPlanSessionStore();
  const session = store.loadOrCreate("eval:assignment-gate");
  session.candidatePool = {
    source: "eval-roster",
    entries: [
      { userId: U_YAO, displayName: "姚雪峰" },
      { userId: U_YANG, displayName: "杨贺新" },
    ],
    unresolved: [],
  };
  store.save(session);

  const scenarios = buildScenarios();
  const results = [];
  let failed = 0;

  console.log("=== Assignment Gate Eval (natural language) ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`maxIterations: ${process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS}`);
  console.log("");

  for (const def of scenarios) {
    if (def.preSeedDraft) {
      session.latestDraft = structuredClone(def.preSeedDraft) as typeof session.latestDraft;
      session.latestAssignment = undefined;
    }
    process.stdout.write(`[${def.id}] ... `);
    const r = await runOne(session, def, clientConfig);
    results.push(r);
    if (!r.pass) failed += 1;
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.ms}ms cov=${r.assignmentCoverage.toFixed(2)} tasks=${r.taskCount}` +
        (r.failReason ? ` :: ${r.failReason}` : ""),
    );
  }

  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    JSON.stringify({ prompt: QWEN_PLANNER_PROMPT_VERSION, mode: "natural_language", results }, null, 2),
  );
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
