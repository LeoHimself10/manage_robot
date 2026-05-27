/**
 * Role B regression: portfolio feature on globally, but eval-mgr-baseline NOT in portfolio list.
 * Run: npm run eval:portfolio-regression
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import type { PlanSession } from "../src/infra/plan-session-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import {
  assertNoMaxTurnsExceeded,
  assertEvalNoFakeAssign,
} from "./eval-assignment-assertions";
import {
  assertNoProjectClarifyInMessage,
  assertNoProjectTools,
} from "./eval-project-assertions";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-portfolio-regression");
const BASELINE_MGR = "eval-mgr-baseline";
const PORTFOLIO_MGR = "eval-mgr-portfolio";

applyEvalProductionParityEnv();
process.env.WORKBENCH_MANAGER_USER_IDS = `${BASELINE_MGR},${PORTFOLIO_MGR}`;
process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = PORTFOLIO_MGR;
process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");

if (!process.env.QWEN_API_KEY?.trim()) {
  console.error("QWEN_API_KEY required for eval:portfolio-regression");
  process.exit(1);
}

if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
mkdirSync(join(EVAL_DIR, "sessions"), { recursive: true });

interface Scenario {
  id: string;
  userMessage: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "B1_wbs_draft",
    userMessage:
      "帮我拆一下 OCT 客诉遏制与根因分析，先出 3 条子任务，下月底完成，不要发放。",
  },
];

async function runScenario(
  session: PlanSession,
  scenario: Scenario,
): Promise<{ ok: boolean; error?: string }> {
  const clientConfig = buildEvalDingtalkClientConfig(loadQwenPlannerConfigFromEnv());
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const people = createPeopleDirectoryStore();
  const publishRecentStore = createRecentPublishStore();
  const result = await runOrchestrator(scenario.userMessage, {
    clientConfig,
    employeeRepo,
    maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
    toolProfile: "manager",
    promptProfile: "planner",
    trustedActorUserId: BASELINE_MGR,
    actorRole: "manager",
    projectPortfolioEnabled: false,
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
  if (
    !assertEvalNoFakeAssign({
      userMessage: scenario.userMessage,
      draft: result.draft,
      assignment: result.assignment,
      message: result.messages.join("\n"),
    })
  ) {
    reasons.push("fake_assign");
  }
  try {
    assertNoProjectTools(tools);
    assertNoProjectClarifyInMessage(result.messages.join("\n"));
  } catch (err) {
    reasons.push(err instanceof Error ? err.message : String(err));
  }
  writeFileSync(
    join(EVAL_DIR, "sessions", `${scenario.id}.json`),
    JSON.stringify({ scenario, tools, result }, null, 2),
  );
  people.close();
  return reasons.length === 0 ? { ok: true } : { ok: false, error: reasons.join("; ") };
}

async function main(): Promise<void> {
  console.log(formatEvalProductionParitySummary());
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`baseline manager: ${BASELINE_MGR} (NOT in portfolio list)`);
  const store = createPlanSessionStore();
  let passed = 0;
  for (const s of SCENARIOS) {
    const session = store.loadOrCreate(`eval-portfolio-b:${s.id}`);
    session.senderStaffId = BASELINE_MGR;
    store.save(session);
    const r = await runScenario(session, s);
    if (r.ok) {
      passed++;
      console.log(`PASS ${s.id}`);
    } else {
      console.error(`FAIL ${s.id}: ${r.error}`);
    }
  }
  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    JSON.stringify({ passed, total: SCENARIOS.length }, null, 2),
  );
  if (passed !== SCENARIOS.length) process.exit(1);
  console.log(`eval:portfolio-regression ${passed}/${SCENARIOS.length} PASS`);
}

void main();
