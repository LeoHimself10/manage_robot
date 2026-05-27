/**
 * LLM eval: scope switch must not leak latestAssignment across tasks.
 * Mirrors 朱锐 / 姚凯珩 production cases via runManagerOrchestratorTurn.
 *
 * Run: npm run eval:assignment-scope-switch
 * Filter: EVAL_SCOPE_FILTER=S1 npm run eval:assignment-scope-switch
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { runManagerOrchestratorTurn } from "../src/agent/manager-orchestrator-turn";
import { NEUTRAL_START_NEW_TASK_SCOPE_LABEL } from "../src/agent/tools/start-new-task";
import { buildWorkbenchTurnDisplay } from "../src/agent/workbench/conversation-turn-display";
import { buildAssistantDisplayMarkdown } from "../src/view/conversation-display-markdown";
import { assertNaturalUserMessage } from "./dingtalk-turn-eval-harness";
import {
  assertAssignmentFullCoverage,
  assertAssignmentPlanMatchesSession,
  assertNoMaxTurnsExceeded,
  assertNoStaleAssigneeNamesInMarkdown,
  assertScopeSwitchClearedAssignment,
} from "./eval-assignment-assertions";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR =
  process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-assignment-scope-switch");
const FILTER = process.env.EVAL_SCOPE_FILTER?.trim();

const MGR = "eval-mgr-scope-001";
const U_YAOXUE = "eval-yaoxuefeng-001";
const U_YANG = "eval-yanghexin-001";
const U_YAO = "eval-yaokaiheng-001";
const U_JIA = "eval-jiasanxiang-001";
const U_ZHURUI = "eval-zhurui-001";

const STALE_ZHURUI_NAMES = ["贾三祥", "姚雪峰", "朱锐"] as const;

const DRY_EYE_DRAFT: Record<string, unknown> = {
  title: "干眼光敷仪项目",
  description: "干眼治疗仪研发与供应商评估。",
  tasks: [
    { id: "task_1", title: "供应商评估", objective: "评估供应商能力", timeNode: { dueAt: "2026-06-10" } },
    { id: "task_2", title: "样机验证", objective: "完成样机测试", timeNode: { dueAt: "2026-06-15" } },
    { id: "task_3", title: "临床反馈汇总", objective: "汇总临床意见", timeNode: { dueAt: "2026-06-20" } },
  ],
};

const OCT_DRAFT: Record<string, unknown> = {
  title: "A100 OCT导管通过性差及折断客诉专项分析与改进",
  description:
    "针对 A100 导管在迂曲狭窄病变处通过受阻及折断的 10 起客诉，一周内完成根因与改进方案。",
  tasks: [
    {
      id: "task_1",
      title: "客诉信息归集与不良样品回收",
      objective: "梳理 10 起投诉并回收样品",
      timeNode: { dueAt: "2026-05-27" },
    },
    {
      id: "task_2",
      title: "导管通过性及折断根因分析",
      objective: "实验室模拟与失效分析",
      timeNode: { dueAt: "2026-05-30" },
    },
    {
      id: "task_3",
      title: "改进方案制定与可行性评估",
      objective: "输出操作指引与产品改进建议",
      timeNode: { dueAt: "2026-06-02" },
    },
  ],
};

interface TurnDef {
  id: string;
  userMessage: string;
  expectStartNewTask?: boolean;
  expectAssignmentClearedAfter?: boolean;
  expectNeutralScopeLabel?: boolean;
  expectDraft?: boolean;
  forbidStaleNames?: readonly string[];
  expectAssignmentFull?: boolean;
  expectToolsInclude?: string[];
  forbidTools?: string[];
  expectRestoredAssigneeName?: string;
}

interface ChainDef {
  id: string;
  description: string;
  preSeed?: {
    latestDraft?: Record<string, unknown>;
    latestAssignment?: Record<string, unknown>;
  };
  turns: TurnDef[];
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
    store.upsertContact({
      ...base,
      userId: MGR,
      name: "测评主管",
      unionId: "u-mgr",
      departmentNames: ["质量部"],
    });
    store.upsertContact({
      ...base,
      userId: U_YAOXUE,
      name: "姚雪峰",
      unionId: "u-yx",
      departmentNames: ["研发部"],
    });
    store.upsertContact({
      ...base,
      userId: U_YANG,
      name: "杨贺新",
      unionId: "u-yh",
      departmentNames: ["研发部"],
    });
    store.upsertContact({
      ...base,
      userId: U_YAO,
      name: "姚凯珩",
      unionId: "u-ykh",
      departmentNames: ["Agent工程组"],
    });
    store.upsertContact({
      ...base,
      userId: U_JIA,
      name: "贾三祥",
      unionId: "u-jx",
      departmentNames: ["研发部"],
    });
    store.upsertContact({
      ...base,
      userId: U_ZHURUI,
      name: "朱锐",
      unionId: "u-zr",
      departmentNames: ["研发部"],
    });
  } finally {
    store.close();
  }
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

function makeSession(preSeed?: ChainDef["preSeed"]): PlanSession {
  const now = new Date().toISOString();
  const store = createPlanSessionStore();
  const scopeId = "scope:seed";
  const session: PlanSession = {
    chatKeyHash: `hash-${MGR}`,
    planId: "plan-seed",
    createdAt: now,
    updatedAt: now,
    conversationHistory: [],
    knownFacts: [],
    senderStaffId: MGR,
    currentTaskScopeId: scopeId,
    taskScopes: {
      [scopeId]: {
        scopeId,
        scopeLabel: "干眼光敷仪",
        planId: "plan-seed",
        createdAt: now,
        updatedAt: now,
        latestDraft: preSeed?.latestDraft as PlanSession["latestDraft"],
        latestAssignment: preSeed?.latestAssignment as PlanSession["latestAssignment"],
      },
    },
  };
  if (preSeed?.latestDraft) {
    session.latestDraft = structuredClone(preSeed.latestDraft) as PlanSession["latestDraft"];
  }
  if (preSeed?.latestAssignment) {
    session.latestAssignment = structuredClone(preSeed.latestAssignment) as PlanSession["latestAssignment"];
  }
  store.save(session);
  return session;
}

function buildChains(): ChainDef[] {
  return [
    {
      id: "S1_zhurui_assign_switch_draft",
      description: "朱锐：干眼指派 → 开启新任务 → 新主题草案，不得串旧负责人",
      preSeed: {
        latestDraft: DRY_EYE_DRAFT,
        latestAssignment: {
          planId: "plan-seed",
          assignments: [
            { taskId: "task_1", primary: { userId: U_JIA, displayName: "贾三祥" } },
            { taskId: "task_2", primary: { userId: U_YAOXUE, displayName: "姚雪峰" } },
            { taskId: "task_3", primary: { userId: U_ZHURUI, displayName: "朱锐" } },
          ],
        },
      },
      turns: [
        {
          id: "start_new",
          userMessage: "开启新任务",
          expectStartNewTask: true,
          expectAssignmentClearedAfter: true,
          expectNeutralScopeLabel: true,
        },
        {
          id: "bci_draft",
          userMessage:
            "脑机接口项目，运动康复方向，2026-06-10 前完成。拆成需求梳理、原型验证、临床预研三条，每条要有交付物和验收标准。",
          expectDraft: true,
          forbidStaleNames: STALE_ZHURUI_NAMES,
        },
      ],
    },
    {
      id: "S2_yao_oct_assign_switch",
      description: "姚凯珩：OCT 点将+预览 → 开启新任务 → 新主题草案不带旧指派",
      preSeed: {
        latestDraft: OCT_DRAFT,
      },
      turns: [
        {
          id: "assign_prepare",
          userMessage: "请把当前草案全部子任务点让给姚凯珩，并做发布预览，不要发布。",
          expectAssignmentFull: true,
          expectToolsInclude: ["bulk_assign_tasks", "prepare_publish_task"],
        },
        {
          id: "start_new",
          userMessage: "开启新任务",
          expectStartNewTask: true,
          expectAssignmentClearedAfter: true,
          expectNeutralScopeLabel: true,
        },
        {
          id: "new_topic_draft",
          userMessage:
            "请在当前这个新任务里帮我拆解：竞品对比、渠道访谈、定价建议 3 条子任务，2026-05-31 前完成，每条写交付物和验收标准。",
          expectDraft: true,
          forbidStaleNames: ["姚凯珩"],
          forbidTools: ["start_new_task"],
        },
      ],
    },
    {
      id: "S3_switch_back_restore",
      description: "指派后开新任务再切回，应恢复旧 scope 负责人",
      preSeed: {
        latestDraft: DRY_EYE_DRAFT,
        latestAssignment: {
          assignments: [
            { taskId: "task_1", primary: { userId: U_JIA, displayName: "贾三祥" } },
            { taskId: "task_2", primary: { userId: U_YAOXUE, displayName: "姚雪峰" } },
            { taskId: "task_3", primary: { userId: U_ZHURUI, displayName: "朱锐" } },
          ],
        },
      },
      turns: [
        {
          id: "start_new",
          userMessage: "开启新任务",
          expectAssignmentClearedAfter: true,
        },
        {
          id: "switch_back",
          userMessage: "切回干眼光敷仪那个任务",
          expectToolsInclude: ["switch_back_task"],
          expectRestoredAssigneeName: "贾三祥",
        },
      ],
    },
    {
      id: "S4_same_turn_bulk_prepare",
      description: "同 plan 内 bulk+prepare 回归：负责人列仍应显示姓名",
      preSeed: {
        latestDraft: DRY_EYE_DRAFT,
      },
      turns: [
        {
          id: "roster_assign_prepare",
          userMessage:
            "花名册里贾三祥和杨贺新：前两条给贾三祥，第三条给杨贺新。整张表负责人补齐并做发布预览，先不要发布。",
          expectAssignmentFull: true,
          expectToolsInclude: ["bulk_assign_tasks", "prepare_publish_task"],
        },
      ],
    },
  ];
}

function buildDisplay(
  turn: Awaited<ReturnType<typeof runManagerOrchestratorTurn>>,
  employees: Array<{ userId: string; displayName: string }>,
  modelName: string,
) {
  const wb = buildWorkbenchTurnDisplay({
    orchResult: turn.orchResult,
    session: turn.session,
    preTurnDraft: turn.preTurnDraft,
    preTurnAssignment: turn.preTurnAssignment,
    preTurnPlanId: turn.preRotatePlanId,
    postTurnDraft: turn.session.latestDraft,
    modelName,
    employees,
  });
  const dt = buildAssistantDisplayMarkdown({
    modelMessage: turn.orchResult.messages.join("\n\n"),
    currentDraft: turn.draftForRender ?? turn.persistedDraft,
    latestAssignment: turn.latestAssignment,
    shouldRenderRichSection: Boolean(turn.draftForRender ?? turn.persistedDraft),
    assignmentSection: turn.assignmentSection,
  });
  return { workbench: wb.displayContent, dingtalk: dt };
}

async function runChain(
  chain: ChainDef,
  clientConfig: ReturnType<typeof buildClient>,
) {
  const reasons: string[] = [];
  let session = makeSession(chain.preSeed);
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const employees = employeeRepo.list().map((e) => ({
    userId: e.userId,
    displayName: e.displayName,
  }));

  for (const turnDef of chain.turns) {
    reasons.push(...assertNaturalUserMessage(turnDef.userMessage));
    const preTurnPlanId = session.planId;

    const turn = await runManagerOrchestratorTurn({
      userMessage: turnDef.userMessage,
      session: { ...session },
      employeeRepo,
      clientConfig,
      senderStaffId: MGR,
      workbenchRole: "manager",
      actorName: "测评主管",
    });

    session = turn.session;
    const tools = turn.orchResult.toolInvocationNames ?? [];
    const display = buildDisplay(turn, employees, clientConfig.model);

    if (!assertNoMaxTurnsExceeded({ toolInvocationNames: tools })) {
      reasons.push(`${turnDef.id}: max_turns_exceeded`);
    }
    reasons.push(...assertAssignmentPlanMatchesSession(session).map((r) => `${turnDef.id}: ${r}`));

    if (turnDef.expectStartNewTask && !tools.includes("start_new_task")) {
      reasons.push(`${turnDef.id}: expected start_new_task in tools=[${tools.join(",")}]`);
    }
    if (turnDef.expectAssignmentClearedAfter) {
      reasons.push(
        ...assertScopeSwitchClearedAssignment(tools, preTurnPlanId, session).map(
          (r) => `${turnDef.id}: ${r}`,
        ),
      );
    }
    if (turnDef.expectNeutralScopeLabel) {
      const scopeId = session.currentTaskScopeId;
      const label = scopeId ? session.taskScopes?.[scopeId]?.scopeLabel : undefined;
      if (label !== NEUTRAL_START_NEW_TASK_SCOPE_LABEL) {
        reasons.push(
          `${turnDef.id}: expected scopeLabel=${NEUTRAL_START_NEW_TASK_SCOPE_LABEL}, got=${String(label ?? "")}`,
        );
      }
    }
    if (turnDef.expectDraft && !session.latestDraft) {
      reasons.push(`${turnDef.id}: expected latestDraft after turn`);
    }
    if (turnDef.forbidStaleNames?.length) {
      for (const markdown of [display.workbench, display.dingtalk]) {
        reasons.push(
          ...assertNoStaleAssigneeNamesInMarkdown(markdown, turnDef.forbidStaleNames).map(
            (r) => `${turnDef.id}: ${r}`,
          ),
        );
      }
      if (session.latestAssignment) {
        const names = (
          (session.latestAssignment as { assignments?: Array<{ primary?: { displayName?: string } }> })
            .assignments ?? []
        ).map((a) => String(a.primary?.displayName ?? ""));
        for (const stale of turnDef.forbidStaleNames) {
          if (names.some((n) => n.includes(stale)) && !turnDef.userMessage.includes(stale)) {
            reasons.push(`${turnDef.id}: stale name ${stale} in session.latestAssignment`);
          }
        }
      }
    }
    if (turnDef.expectAssignmentFull) {
      const cov = assertAssignmentFullCoverage(
        session.latestDraft as Record<string, unknown>,
        session.latestAssignment as Record<string, unknown>,
      );
      if (cov.ratio < 1) {
        reasons.push(
          `${turnDef.id}: assignment coverage ${cov.covered}/${cov.total} missing=${cov.missingTaskIds.join(",")}`,
        );
      }
    }
    if (turnDef.expectToolsInclude) {
      for (const tool of turnDef.expectToolsInclude) {
        if (!tools.includes(tool)) {
          reasons.push(`${turnDef.id}: missing tool ${tool} in [${tools.join(",")}]`);
        }
      }
    }
    if (turnDef.forbidTools) {
      for (const tool of turnDef.forbidTools) {
        if (tools.includes(tool)) {
          reasons.push(`${turnDef.id}: forbidden tool ${tool} in [${tools.join(",")}]`);
        }
      }
    }
    if (turnDef.expectRestoredAssigneeName) {
      const cov = assertAssignmentFullCoverage(
        session.latestDraft as Record<string, unknown>,
        session.latestAssignment as Record<string, unknown>,
      );
      if (cov.covered === 0) {
        reasons.push(`${turnDef.id}: expected restored assignment`);
      }
      const markdown = `${display.workbench}\n${display.dingtalk}`;
      if (!markdown.includes(turnDef.expectRestoredAssigneeName)) {
        reasons.push(
          `${turnDef.id}: expected restored assignee ${turnDef.expectRestoredAssigneeName} in display`,
        );
      }
    }
  }

  return reasons;
}

async function main() {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY is required for eval:assignment-scope-switch");
    process.exit(1);
  }

  bootstrap();
  await seedDirectory();
  const clientConfig = buildClient();
  const chains = buildChains().filter((c) => !FILTER || c.id.includes(FILTER));

  console.log("=== Assignment Scope Switch Eval (LLM) ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`chains: ${chains.length}${FILTER ? ` (filter=${FILTER})` : ""}\n`);

  const results: Array<{ id: string; ok: boolean; ms: number; reasons: string[] }> = [];
  for (const chain of chains) {
    const t0 = Date.now();
    process.stdout.write(`[${chain.id}] ... `);
    try {
      const reasons = await runChain(chain, clientConfig);
      const ms = Date.now() - t0;
      const ok = reasons.length === 0;
      results.push({ id: chain.id, ok, ms, reasons });
      console.log(ok ? `PASS ${ms}ms` : `FAIL ${ms}ms :: ${reasons.slice(0, 3).join("; ")}`);
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: chain.id, ok: false, ms, reasons: [msg] });
      console.log(`ERROR ${ms}ms :: ${msg}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    `${JSON.stringify({ passed, total: results.length, results }, null, 2)}\n`,
  );
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
