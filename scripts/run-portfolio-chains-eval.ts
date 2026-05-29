/**
 * Portfolio manager multi-chain eval.
 * Run: npm run eval:portfolio-chains
 * Filter: EVAL_PORTFOLIO_FILTER=chain_pf_switch_publish npm run eval:portfolio-chains
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { isDraftStagedForPublish } from "../src/agent/publish-staging";
import {
  assertNaturalUserMessage,
  runDingtalkLikeTurn,
} from "./dingtalk-turn-eval-harness";
import {
  assertAssignmentFullCoverage,
  assertEvalNoFakeAssign,
  assertNoDuplicateTaskIds,
  assertNoMaxTurnsExceeded,
} from "./eval-assignment-assertions";
import { assertAssistantMessageQuality } from "./eval-assistant-quality";
import {
  assertActiveProjectMatchesName,
  assertDraftProjectMatchesName,
  assertDraftTaskCountUnchanged,
  assertForbiddenTool,
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
const FIXTURE_ROOT = join(process.cwd(), "fixtures/eval-portfolio-full");
const FILTER = process.env.EVAL_PORTFOLIO_FILTER?.trim();
const PORTFOLIO_MGR = "eval-mgr-portfolio";

interface PortfolioTurn {
  id: string;
  userMessage: string;
  expectMinTasks?: number;
  expectDraftJson?: boolean;
  expectAssignmentFull?: boolean;
  expectNoFakeAssign?: boolean;
  expectPublishStaged?: boolean;
  expectPublishOk?: boolean;
  expectPublishForbidden?: boolean;
  forbidTools?: string[];
  expectToolsInclude?: string[];
  expectProjectTool?: boolean;
  expectProjectBinding?: boolean;
  expectActiveProjectName?: string;
  expectDraftProjectName?: string;
  expectTaskProjectName?: string;
  expectTaskProjectFromActive?: boolean;
  expectTaskProjectNull?: boolean;
  expectDraftTaskCountUnchanged?: boolean;
  expectAssistantQuality?: boolean;
  draftAlreadyExists?: boolean;
  assistantMinLength?: number;
  allowPublishRetry?: boolean;
  allowAssignRetry?: boolean;
  allowSplitRetry?: boolean;
}

interface PortfolioChain {
  id: string;
  description: string;
  managerStaffId: string;
  people: Record<string, string>;
  turns: PortfolioTurn[];
}

interface Manifest {
  id: string;
  description: string;
  chains: Array<{ file: string }>;
}

function bootstrapOnce() {
  mkdirSync(EVAL_DIR, { recursive: true });
  mkdirSync(join(EVAL_DIR, "sessions"), { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_MANAGER_USER_IDS = PORTFOLIO_MGR;
  process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = PORTFOLIO_MGR;
}

function bootstrapChain(chainId: string) {
  const chainDir = join(EVAL_DIR, "chains", chainId);
  mkdirSync(chainDir, { recursive: true });
  process.env.WORKBENCH_SQLITE_PATH = join(chainDir, "workbench.sqlite");
  process.env.EMPLOYEE_PROFILE_DIR = join(chainDir, "employee-profiles");
  mkdirSync(process.env.EMPLOYEE_PROFILE_DIR, { recursive: true });
}

function seedProjects() {
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
  taskStore.createProject({
    ownerUserId: PORTFOLIO_MGR,
    name: "Q2 渠道复盘",
    description: "渠道销售复盘",
    aliases: ["渠道", "Q2"],
  });
  return taskStore.listProjectsForOwner(PORTFOLIO_MGR);
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as Manifest;
}

function loadChain(file: string): PortfolioChain {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, file), "utf8")) as PortfolioChain;
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

async function seedChain(chain: PortfolioChain) {
  const store = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    store.upsertContact({
      ...base,
      userId: chain.managerStaffId,
      name: "测评主管",
      unionId: `u-${chain.managerStaffId.slice(-8)}`,
      departmentNames: ["质量部"],
    });
    for (const [name, userId] of Object.entries(chain.people)) {
      store.upsertContact({
        ...base,
        userId,
        name,
        unionId: `u-${userId.slice(-8)}`,
        departmentNames: ["研发部"],
      });
      store.upsertProfile({
        userId,
        skillTags: [],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: { capacityHint: "ok", emergencyOk: true },
        source: "eval-portfolio-full",
      });
    }
  } finally {
    store.close();
  }
}

function taskCount(draft: PlanSession["latestDraft"]): number {
  return Array.isArray((draft as { tasks?: unknown[] } | undefined)?.tasks)
    ? (draft as { tasks: unknown[] }).tasks.length
    : 0;
}

async function runTurn(
  session: PlanSession,
  turn: PortfolioTurn,
  chain: PortfolioChain,
  clientConfig: ReturnType<typeof buildClient>,
  projects: Array<{ projectId: string; name: string }>,
) {
  const reasons = assertNaturalUserMessage(turn.userMessage);
  const tasksBefore = taskCount(session.latestDraft);
  const hadDraftBefore = tasksBefore > 0;
  const sqlitePath = process.env.WORKBENCH_SQLITE_PATH ?? "";

  const result = await runDingtalkLikeTurn(session, turn.userMessage, {
    clientConfig,
    senderStaffId: chain.managerStaffId,
    actorName: "测评主管",
    allowAssignRetry: turn.allowAssignRetry,
    allowPublishRetry: turn.allowPublishRetry,
    allowSplitRetry: turn.allowSplitRetry,
  });

  const coverage = assertAssignmentFullCoverage(
    session.latestDraft as Record<string, unknown> | undefined,
    session.latestAssignment as Record<string, unknown> | undefined,
  );
  const tasksAfter = taskCount(session.latestDraft);

  if (turn.expectMinTasks !== undefined && tasksAfter < turn.expectMinTasks) {
    reasons.push(`tasks=${tasksAfter}<min${turn.expectMinTasks}`);
  }
  if (turn.expectDraftJson && !result.hasDraftJson && tasksAfter <= tasksBefore) {
    reasons.push("expected draft JSON or task growth this turn");
  }
  if (turn.expectAssignmentFull && coverage.ratio < 1) {
    reasons.push(`assignment ${coverage.covered}/${coverage.total}`);
  }
  if (
    turn.expectNoFakeAssign
    && !assertEvalNoFakeAssign({
      userMessage: turn.userMessage,
      draft: session.latestDraft as Record<string, unknown> | undefined,
      assignment: session.latestAssignment as Record<string, unknown> | undefined,
      message: result.outboundMessage,
      extractOk: result.assignState.extractOk,
    })
  ) {
    reasons.push("false assign message");
  }
  if (turn.expectPublishStaged && !isDraftStagedForPublish(session.latestDraft)) {
    reasons.push("draft not staged for publish after preview turn");
  }
  if (turn.expectPublishOk && !result.publishOk) {
    reasons.push("publish did not succeed");
  }
  if (turn.expectPublishForbidden && (result.publishOk || result.tools.includes("publish_task"))) {
    reasons.push("forbidden publish this turn");
  }
  for (const t of turn.forbidTools ?? []) {
    try {
      assertForbiddenTool(result.tools, t);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  for (const t of turn.expectToolsInclude ?? []) {
    if (!result.tools.includes(t)) reasons.push(`missing tool: ${t}`);
  }
  if (turn.expectProjectTool) {
    try {
      assertSomeProjectTool(result.tools);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectProjectBinding) {
    try {
      assertProjectBindingWritten(session);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectActiveProjectName) {
    try {
      assertActiveProjectMatchesName(session, projects, turn.expectActiveProjectName);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectDraftProjectName) {
    try {
      assertDraftProjectMatchesName(session, projects, turn.expectDraftProjectName);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectDraftTaskCountUnchanged) {
    try {
      assertDraftTaskCountUnchanged(tasksBefore, tasksAfter);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectTaskProjectName) {
    const pid = resolveProjectIdByName(projects, turn.expectTaskProjectName);
    if (!pid) {
      reasons.push(`fixture missing project ${turn.expectTaskProjectName}`);
    } else {
      try {
        assertTaskProjectId(sqlitePath, session.planId, pid);
      } catch (err) {
        reasons.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (turn.expectTaskProjectFromActive) {
    const pid = String(session.activeProjectId ?? "").trim() || null;
    if (!pid) reasons.push("expected activeProjectId before publish");
    else {
      try {
        assertTaskProjectId(sqlitePath, session.planId, pid);
      } catch (err) {
        reasons.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (turn.expectTaskProjectNull) {
    try {
      assertTaskProjectId(sqlitePath, session.planId, null);
    } catch (err) {
      reasons.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (turn.expectAssistantQuality !== false) {
    reasons.push(
      ...assertAssistantMessageQuality(result.outboundMessage, {
        draftAlreadyExists: turn.draftAlreadyExists ?? hadDraftBefore,
        minLength: turn.assistantMinLength,
      }),
    );
    reasons.push(...assertPortfolioAssistantHygiene(result.outboundMessage));
  }
  reasons.push(...assertNoDuplicateTaskIds(session.latestDraft as Record<string, unknown>));
  if (!assertNoMaxTurnsExceeded({ stopReason: result.stopReason, toolInvocationNames: result.tools })) {
    reasons.push("max_turns_exceeded");
  }

  createPlanSessionStore().save(session);
  return {
    chainId: chain.id,
    id: turn.id,
    pass: reasons.filter(Boolean).length === 0,
    ms: result.ms,
    taskCount: tasksAfter,
    assignmentCoverage: coverage.ratio,
    publishOk: result.publishOk,
    tools: result.tools,
    failReason: reasons.filter(Boolean).join("; ") || undefined,
  };
}

async function main(): Promise<void> {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY required for eval:portfolio-chains");
    process.exit(1);
  }

  const manifest = loadManifest();
  bootstrapOnce();
  const clientConfig = buildClient();
  const store = createPlanSessionStore();
  const allResults: Array<Awaited<ReturnType<typeof runTurn>>> = [];
  let failed = 0;

  console.log("=== Portfolio Chains Eval ===");
  console.log(`manifest: ${manifest.id}`);
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`filter: ${FILTER || "(all)"}`);
  console.log("");

  for (const ref of manifest.chains) {
    const chain = loadChain(ref.file);
    if (FILTER && chain.id !== FILTER && !FILTER.includes(chain.id)) continue;

    bootstrapChain(chain.id);
    const projects = seedProjects();
    await seedChain(chain);
    let session = store.loadOrCreate(`eval:portfolio:${chain.id}`);
    session.senderStaffId = chain.managerStaffId;
    store.save(session);

    console.log(`--- ${chain.id}: ${chain.description} ---`);
    for (const turn of chain.turns) {
      process.stdout.write(`  [${turn.id}] ... `);
      session = store.loadOrCreate(`eval:portfolio:${chain.id}`);
      const r = await runTurn(session, turn, chain, clientConfig, projects);
      allResults.push(r);
      if (!r.pass) failed += 1;
      console.log(
        `${r.pass ? "PASS" : "FAIL"} ${r.ms}ms tasks=${r.taskCount} cov=${r.assignmentCoverage.toFixed(2)}` +
          (r.failReason ? ` :: ${r.failReason}` : ""),
      );
    }
    console.log("");
  }

  writeFileSync(
    join(EVAL_DIR, "eval-summary-chains.json"),
    JSON.stringify(
      {
        manifest: manifest.id,
        prompt: QWEN_PLANNER_PROMPT_VERSION,
        filter: FILTER || null,
        results: allResults,
        passed: allResults.length - failed,
        total: allResults.length,
      },
      null,
      2,
    ),
  );
  console.log(`${allResults.length - failed}/${allResults.length} turn(s) passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
