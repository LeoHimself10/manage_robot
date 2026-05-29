/**
 * Portfolio spot eval: role B regression + role A portfolio scenarios (single-turn).
 * Run: npm run eval:portfolio-spot
 * Filter: EVAL_PORTFOLIO_FILTER=P4_switch npm run eval:portfolio-spot
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { publishResultSucceeded } from "../src/agent/publish-helpers";
import {
  assertNaturalUserMessage,
  runDingtalkLikeTurn,
} from "./dingtalk-turn-eval-harness";
import {
  assertEvalNoFakeAssign,
  assertNoMaxTurnsExceeded,
} from "./eval-assignment-assertions";
import { assertAssistantMessageQuality } from "./eval-assistant-quality";
import {
  assertActiveProjectMatchesName,
  assertDraftTaskCountUnchanged,
  assertForbiddenTool,
  assertNoProjectClarifyInMessage,
  assertNoProjectTools,
  assertPortfolioAssistantHygiene,
  assertProjectBindingWritten,
  assertSomeProjectTool,
  assertTaskProjectId,
  resolveProjectIdByName,
} from "./eval-portfolio-assertions";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-portfolio-full");
const FILTER = process.env.EVAL_PORTFOLIO_FILTER?.trim();
const PORTFOLIO_MGR = "eval-mgr-portfolio";
const BASELINE_MGR = "eval-mgr-baseline";
const EMP = "eval-emp-portfolio-001";

interface Scenario {
  id: string;
  role: "baseline" | "portfolio";
  userMessage: string;
  expectProjectTool?: boolean;
  forbidProjectTools?: boolean;
  expectProjectBinding?: boolean;
  expectActiveProjectName?: string;
  verifyPublishProject?: string | null;
  expectMinTasks?: number;
  preSeed?: (session: PlanSession, projects: Array<{ projectId: string; name: string }>) => void;
  forbidTools?: string[];
  expectDraftTaskCountUnchanged?: boolean;
  allowPublishRetry?: boolean;
}

function setupScenarioEnv(scenarioId: string, role: "baseline" | "portfolio") {
  const dir = join(EVAL_DIR, "spot", scenarioId);
  mkdirSync(join(dir, "sessions"), { recursive: true });
  mkdirSync(join(dir, "employee-profiles"), { recursive: true });
  process.env.WORKBENCH_SQLITE_PATH = join(dir, "workbench.sqlite");
  process.env.PLAN_SESSION_DIR = join(dir, "sessions");
  process.env.EMPLOYEE_PROFILE_DIR = join(dir, "employee-profiles");
  process.env.WORKBENCH_MANAGER_USER_IDS = `${BASELINE_MGR},${PORTFOLIO_MGR}`;
  process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = PORTFOLIO_MGR;
  void role;
}

function seedPeople() {
  const people = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    for (const uid of [BASELINE_MGR, PORTFOLIO_MGR]) {
      people.upsertContact({
        ...base,
        userId: uid,
        name: "测评主管",
        unionId: `u-${uid.slice(-6)}`,
        departmentNames: ["质量部"],
      });
    }
    people.upsertContact({
      ...base,
      userId: EMP,
      name: "张测评",
      unionId: "u-emp001",
      departmentNames: ["质量部"],
      position: "工程师",
    });
  } finally {
    people.close();
  }
}

function seedProjects(): Array<{ projectId: string; name: string }> {
  const taskStore = createWorkbenchFormalTaskStore();
  taskStore.createProject({
    ownerUserId: PORTFOLIO_MGR,
    name: "OCT 客诉专项",
    description: "OCT 上市客诉与遏制",
    aliases: ["OCT", "客诉"],
  });
  taskStore.createProject({
    ownerUserId: PORTFOLIO_MGR,
    name: "2026 注册申报",
    description: "药监局资料准备",
    aliases: ["注册", "申报"],
  });
  return taskStore.listProjectsForOwner(PORTFOLIO_MGR);
}

const SCENARIOS: Scenario[] = [
  {
    id: "B1_wbs_draft",
    role: "baseline",
    userMessage:
      "A产品型号A-2026B，批次2026Q2-04出现OCT焊点开路客诉，请拆遏制与根因分析 3 条子任务，2026-06-30 前完成，不要发放。",
    forbidProjectTools: true,
    expectMinTasks: 3,
  },
  {
    id: "B2_publish_no_project",
    role: "baseline",
    userMessage: "草案和负责人都已确认好了，请直接完成发放。",
    forbidProjectTools: true,
    verifyPublishProject: null,
    allowPublishRetry: true,
    preSeed(session) {
      session.latestDraft = {
        title: "基线发布测试",
        description: "验证非 portfolio 主管发布不写 project_id",
        tasks: [
          { id: "t1", title: "子任务 A", completionCriteria: ["完成"] },
          { id: "t2", title: "子任务 B", completionCriteria: ["完成"] },
        ],
      };
      session.latestAssignment = {
        assignments: [
          { taskId: "t1", primary: { userId: EMP } },
          { taskId: "t2", primary: { userId: EMP } },
        ],
      };
      session.stagedForPublish = true;
    },
  },
  {
    id: "B3_project_keyword_no_tools",
    role: "baseline",
    userMessage:
      "型号 X-100 内审整改两项：文件更新和现场抽查，2026-06-30 前完成，不要发放。",
    forbidProjectTools: true,
    expectMinTasks: 2,
  },
  {
    id: "P1_suggest_oct",
    role: "portfolio",
    userMessage:
      "这批工作属于 OCT 客诉专项，A-2026B 批次焊点开路，拆遏制、信息收集、根因分析 3 条子任务，2026-06-30 前完成，先不要发放。",
    expectProjectTool: true,
    expectProjectBinding: true,
    expectActiveProjectName: "OCT",
    expectMinTasks: 3,
  },
  {
    id: "P1d_alias",
    role: "portfolio",
    userMessage:
      "属于 OCT 客诉专项（客诉线），A-2026B 批次，拆遏制和根因分析 2 条子任务，2026-06-15 前完成，不要发放。",
    expectProjectTool: true,
    expectProjectBinding: true,
    expectActiveProjectName: "OCT",
    expectMinTasks: 2,
  },
  {
    id: "P2_create",
    role: "portfolio",
    userMessage: "新建项目：2026 注册申报，描述是药监局资料准备",
    expectProjectTool: true,
  },
  {
    id: "P3_publish_bind",
    role: "portfolio",
    userMessage: "草案和负责人都已确认好了，请直接完成发放，不要搜人、不要改派、不要拆表。",
    verifyPublishProject: "OCT",
    allowPublishRetry: true,
    preSeed(session, projects) {
      const oct = resolveProjectIdByName(projects, "OCT");
      session.latestDraft = {
        title: "OCT 绑定发布测试",
        description: "验证 portfolio 项目归属发布落库",
        projectId: oct,
        tasks: [
          { id: "t1", title: "子任务 A", completionCriteria: ["完成"] },
          { id: "t2", title: "子任务 B", completionCriteria: ["完成"] },
          { id: "t3", title: "子任务 C", completionCriteria: ["完成"] },
        ],
      };
      session.latestAssignment = {
        assignments: [
          { taskId: "t1", primary: { userId: EMP } },
          { taskId: "t2", primary: { userId: EMP } },
          { taskId: "t3", primary: { userId: EMP } },
        ],
      };
      session.stagedForPublish = true;
      session.activeProjectId = oct;
    },
  },
  {
    id: "P4_switch_hint",
    role: "portfolio",
    userMessage: "其实是注册申报那个，不是 OCT",
    expectProjectTool: true,
    expectActiveProjectName: "注册",
    forbidTools: ["start_new_task"],
    preSeed(session, projects) {
      session.latestDraft = {
        title: "临时草案",
        tasks: [{ id: "t1", title: "单条", completionCriteria: ["ok"] }],
      };
      session.activeProjectId = resolveProjectIdByName(projects, "OCT");
    },
  },
  {
    id: "P4b_switch_preserve_draft",
    role: "portfolio",
    userMessage: "应该归到注册申报，任务表不要动。",
    expectProjectTool: true,
    expectActiveProjectName: "注册",
    expectDraftTaskCountUnchanged: true,
    forbidTools: ["start_new_task"],
    preSeed(session, projects) {
      session.latestDraft = {
        title: "三任务草案",
        tasks: [
          { id: "t1", title: "A", completionCriteria: ["ok"] },
          { id: "t2", title: "B", completionCriteria: ["ok"] },
          { id: "t3", title: "C", completionCriteria: ["ok"] },
        ],
      };
      session.activeProjectId = resolveProjectIdByName(projects, "OCT");
    },
  },
  {
    id: "P5_bind_existing_draft",
    role: "portfolio",
    userMessage: "这批归入 OCT 客诉专项。",
    expectProjectTool: true,
    expectProjectBinding: true,
    expectActiveProjectName: "OCT",
    expectDraftTaskCountUnchanged: true,
    preSeed(session) {
      session.latestDraft = {
        title: "无归属草案",
        tasks: [
          { id: "t1", title: "整改 A", completionCriteria: ["完成"] },
          { id: "t2", title: "整改 B", completionCriteria: ["完成"] },
        ],
      };
    },
  },
];

async function runScenario(
  store: ReturnType<typeof createPlanSessionStore>,
  scenario: Scenario,
  clientConfig: ReturnType<typeof buildEvalDingtalkClientConfig>,
): Promise<{ ok: boolean; error?: string; tools?: string[] }> {
  setupScenarioEnv(scenario.id, scenario.role);
  seedPeople();
  const roleProjects = scenario.role === "portfolio" ? seedProjects() : [];
  const mgr = scenario.role === "portfolio" ? PORTFOLIO_MGR : BASELINE_MGR;
  const session = store.loadOrCreate(`eval-portfolio-spot:${scenario.id}`);
  session.senderStaffId = mgr;
  scenario.preSeed?.(session, roleProjects);
  const tasksBefore = Array.isArray((session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? (session.latestDraft as { tasks: unknown[] }).tasks.length
    : 0;
  store.save(session);

  const reasons = assertNaturalUserMessage(scenario.userMessage);
  const result = await runDingtalkLikeTurn(session, scenario.userMessage, {
    clientConfig,
    senderStaffId: mgr,
    actorName: "测评主管",
    allowPublishRetry: scenario.allowPublishRetry,
  });
  const tools = result.tools;
  const outbound = result.outboundMessage;
  const tasksAfter = Array.isArray((session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? (session.latestDraft as { tasks: unknown[] }).tasks.length
    : 0;

  if (!assertNoMaxTurnsExceeded({ stopReason: result.stopReason, toolInvocationNames: tools })) {
    reasons.push("max_turns_exceeded");
  }
  if (
    scenario.role === "baseline"
    && !assertEvalNoFakeAssign({
      userMessage: scenario.userMessage,
      draft: session.latestDraft as Record<string, unknown> | undefined,
      assignment: session.latestAssignment as Record<string, unknown> | undefined,
      message: outbound,
    })
  ) {
    reasons.push("fake_assign");
  }
  try {
    if (scenario.forbidProjectTools) {
      assertNoProjectTools(tools);
      assertNoProjectClarifyInMessage(outbound);
    }
    if (scenario.expectProjectTool) assertSomeProjectTool(tools);
    if (scenario.expectProjectBinding) assertProjectBindingWritten(session);
    if (scenario.expectActiveProjectName) {
      assertActiveProjectMatchesName(session, roleProjects, scenario.expectActiveProjectName);
    }
    if (scenario.expectMinTasks !== undefined && tasksAfter < scenario.expectMinTasks) {
      reasons.push(`tasks=${tasksAfter}<min${scenario.expectMinTasks}`);
    }
    if (scenario.expectDraftTaskCountUnchanged) {
      assertDraftTaskCountUnchanged(tasksBefore, tasksAfter);
    }
    for (const t of scenario.forbidTools ?? []) {
      assertForbiddenTool(tools, t);
    }
    if (scenario.verifyPublishProject !== undefined) {
      if (!publishResultSucceeded(result.publishResult)) {
        reasons.push(`publish not ok: ${JSON.stringify(result.publishResult)}`);
      } else {
        const pid =
          scenario.verifyPublishProject === null
            ? null
            : resolveProjectIdByName(roleProjects, scenario.verifyPublishProject);
        assertTaskProjectId(process.env.WORKBENCH_SQLITE_PATH ?? "", session.planId, pid ?? null);
      }
    }
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }
  reasons.push(
    ...assertAssistantMessageQuality(outbound, { draftAlreadyExists: tasksBefore > 0 }),
  );
  if (scenario.role === "portfolio") {
    reasons.push(...assertPortfolioAssistantHygiene(outbound));
  }

  store.save(session);
  mkdirSync(join(EVAL_DIR, "spot"), { recursive: true });
  writeFileSync(
    join(EVAL_DIR, "spot", `${scenario.id}.json`),
    JSON.stringify({ scenario, tools, result, session: { activeProjectId: session.activeProjectId, latestDraft: session.latestDraft } }, null, 2),
  );
  return reasons.length === 0
    ? { ok: true, tools }
    : { ok: false, error: reasons.join("; "), tools };
}

async function main(): Promise<void> {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY required for eval:portfolio-spot");
    process.exit(1);
  }

  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(join(EVAL_DIR, "spot"), { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  mkdirSync(process.env.PLAN_SESSION_DIR, { recursive: true });

  console.log("=== Portfolio Spot Eval ===");
  console.log(formatEvalProductionParitySummary());
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`filter: ${FILTER || "(all)"}`);
  console.log("");

  const clientConfig = buildEvalDingtalkClientConfig();
  const store = createPlanSessionStore();
  const list = FILTER
    ? SCENARIOS.filter((s) => s.id === FILTER || s.id.includes(FILTER))
    : SCENARIOS;
  let passed = 0;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const s of list) {
    process.stdout.write(`[${s.id}] ... `);
    const r = await runScenario(store, s, clientConfig);
    results.push({ id: s.id, ok: r.ok, error: r.error });
    if (r.ok) {
      passed++;
      console.log("PASS");
    } else {
      console.log(`FAIL :: ${r.error}`);
    }
  }

  writeFileSync(
    join(EVAL_DIR, "eval-summary-spot.json"),
    JSON.stringify({ passed, total: list.length, results }, null, 2),
  );
  console.log(`\neval:portfolio-spot ${passed}/${list.length} PASS`);
  process.exit(passed === list.length ? 0 : 1);
}

void main();
