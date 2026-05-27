/**
 * Role A portfolio agent eval.
 * Run: npm run eval:project-portfolio
 * Filter: EVAL_PROJECT_FILTER=P2_create npm run eval:project-portfolio
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import type { PlanSession } from "../src/infra/plan-session-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import { publishResultSucceeded } from "../src/agent/publish-helpers";
import { assertNoMaxTurnsExceeded } from "./eval-assignment-assertions";
import { assertSomeProjectTool } from "./eval-project-assertions";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-project-portfolio");
const MGR = "eval-mgr-portfolio";
const EMP = "eval-emp-portfolio-001";
const SQLITE = join(EVAL_DIR, "workbench.sqlite");

applyEvalProductionParityEnv();
process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = MGR;
process.env.WORKBENCH_SQLITE_PATH = SQLITE;
process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");

if (!process.env.QWEN_API_KEY?.trim()) {
  console.error("QWEN_API_KEY required for eval:project-portfolio");
  process.exit(1);
}

if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
mkdirSync(join(EVAL_DIR, "sessions"), { recursive: true });

const taskStore = createWorkbenchFormalTaskStore();
taskStore.createProject({
  ownerUserId: MGR,
  name: "OCT 客诉专项",
  description: "OCT 上市客诉与遏制",
  aliases: ["OCT", "客诉"],
});
taskStore.createProject({
  ownerUserId: MGR,
  name: "2026 注册申报",
  description: "药监局资料准备",
  aliases: ["注册", "申报"],
});

const people = createPeopleDirectoryStore();
people.upsertContact({
  userId: EMP,
  name: "测试员工",
  departmentIds: ["d1"],
  departmentNames: ["质量部"],
  position: "工程师",
  active: true,
  isAdmin: false,
  isBoss: false,
  isSenior: false,
});

const FILTER = process.env.EVAL_PROJECT_FILTER?.trim();

interface Scenario {
  id: string;
  userMessage: string;
  expectProjectTool?: boolean;
  verifyPublishProject?: boolean;
  preSeed?: (session: PlanSession) => void;
}

const SCENARIOS: Scenario[] = [
  {
    id: "P1_suggest",
    userMessage: "这批工作属于 OCT 客诉专项，帮我拆成 3 条子任务，下月底完成，先不要发放。",
    expectProjectTool: true,
  },
  {
    id: "P2_create",
    userMessage: "新建项目：2026 注册申报，描述是药监局资料准备",
    expectProjectTool: true,
  },
  {
    id: "P3_publish_bind",
    userMessage:
      "草案和负责人都已确认好了，请直接完成发放，不要搜人、不要改派、不要拆表。",
    verifyPublishProject: true,
    preSeed(session) {
      const oct = taskStore.listProjectsForOwner(MGR).find((p) => p.name.includes("OCT"));
      session.latestDraft = {
        title: "OCT 绑定发布测试",
        description: "用于验证 portfolio 项目归属发布落库的预置草案，负责人已完整覆盖。",
        projectId: oct?.projectId,
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
      session.activeProjectId = oct?.projectId;
    },
  },
  {
    id: "P4_switch_hint",
    userMessage: "其实是注册申报那个，不是 OCT",
    expectProjectTool: true,
    preSeed(session) {
      session.latestDraft = {
        title: "临时草案",
        tasks: [{ id: "t1", title: "单条", completionCriteria: ["ok"] }],
      };
      const oct = taskStore.listProjectsForOwner(MGR).find((p) => p.name.includes("OCT"));
      session.activeProjectId = oct?.projectId;
    },
  },
];

async function runScenario(
  store: ReturnType<typeof createPlanSessionStore>,
  scenario: Scenario,
): Promise<{ ok: boolean; error?: string }> {
  const session = store.loadOrCreate(`eval-portfolio-a:${scenario.id}`);
  session.senderStaffId = MGR;
  scenario.preSeed?.(session);
  store.save(session);
  const clientConfig = buildEvalDingtalkClientConfig(loadQwenPlannerConfigFromEnv());
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const publishRecentStore = createRecentPublishStore();
  const maxToolCalls =
    scenario.id === "P3_publish_bind"
      ? Number(process.env.EVAL_P3_MAX_TOOL_CALLS ?? 24)
      : Number(process.env.AGENT_MAX_TOOL_CALLS ?? 16);
  process.env.AGENT_MAX_TOOL_CALLS = String(maxToolCalls);

  const result = await runOrchestrator(scenario.userMessage, {
    clientConfig,
    employeeRepo,
    maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
    toolProfile: "manager",
    promptProfile: "planner",
    trustedActorUserId: MGR,
    actorRole: "manager",
    managerFollowup: true,
    projectPortfolioEnabled: true,
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
  const tools = result.toolInvocationNames ?? [];
  const reasons: string[] = [];
  if (!assertNoMaxTurnsExceeded(result)) reasons.push("max_turns_exceeded");
  try {
    if (scenario.expectProjectTool) {
      assertSomeProjectTool(tools);
    }
    if (scenario.verifyPublishProject) {
      if (!publishResultSucceeded(result.publishResult)) {
        throw new Error(`publish not ok: ${JSON.stringify(result.publishResult)}`);
      }
      const oct = taskStore.listProjectsForOwner(MGR).find((p) => p.name.includes("OCT"));
      const db = new DatabaseSync(SQLITE);
      const row = db
        .prepare("SELECT project_id FROM tasks WHERE plan_id = ?")
        .get(session.planId) as { project_id: string | null } | undefined;
      db.close();
      if (!row?.project_id || row.project_id !== oct?.projectId) {
        throw new Error(`expected project_id ${oct?.projectId}, got ${row?.project_id}`);
      }
    }
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }
  writeFileSync(
    join(EVAL_DIR, "sessions", `${scenario.id}.json`),
    JSON.stringify({ scenario, tools, result }, null, 2),
  );
  return reasons.length === 0 ? { ok: true } : { ok: false, error: reasons.join("; ") };
}

async function main(): Promise<void> {
  console.log(formatEvalProductionParitySummary());
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  const store = createPlanSessionStore();
  const list = FILTER ? SCENARIOS.filter((s) => s.id === FILTER || s.id.includes(FILTER)) : SCENARIOS;
  let passed = 0;
  for (const s of list) {
    const r = await runScenario(store, s);
    if (r.ok) {
      passed++;
      console.log(`PASS ${s.id}`);
    } else {
      console.error(`FAIL ${s.id}: ${r.error}`);
    }
  }
  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    JSON.stringify({ passed, total: list.length }, null, 2),
  );
  people.close();
  if (passed !== list.length) process.exit(1);
  console.log(`eval:project-portfolio ${passed}/${list.length} PASS`);
}

void main();
