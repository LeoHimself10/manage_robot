/**
 * Natural-language multi-chain eval with high assistant message quality bar.
 * Run: npm run eval:natural-full-chains
 * Filter: EVAL_NATURAL_FILTER=chain_roster15 npm run eval:natural-full-chains
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
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
  assertAssistantMessageQuality,
  assertAssigneesFromPool,
  assertDistinctAssigneeCount,
  assertPoolFileNotesCoverage,
} from "./eval-assistant-quality";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";
import { assertReadUrlAssistantHygiene } from "./eval-read-url-assertions";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-natural-full");
const FIXTURE_ROOT = join(process.cwd(), "fixtures/eval-natural-full");
const FILTER = process.env.EVAL_NATURAL_FILTER?.trim();

interface NaturalTurn {
  id: string;
  userMessage: string;
  seedPendingRoster?: boolean;
  expectMinTasks?: number;
  expectDraftJson?: boolean;
  expectAssignmentFull?: boolean;
  expectNoFakeAssign?: boolean;
  forbidAssigneePatchLoop?: boolean;
  expectTasksIncreaseBy?: number;
  expectMinDueAtCoverage?: number;
  expectSplitDueAtFromRow?: number;
  expectOrdinalRow?: { token: string; displayIndex: number };
  expectRowPatch?: {
    displayIndex: number;
    dueAt?: string;
    assigneeUserId?: string;
    assigneeName?: string;
  };
  expectPublishStaged?: boolean;
  expectPublishOk?: boolean;
  /** 禁止 publish_task / publishOk 本 turn */
  expectPublishForbidden?: boolean;
  /** 工具名黑名单（如 publish_task） */
  forbidTools?: string[];
  expectToolsInclude?: string[];
  expectToolsExclude?: string[];
  /** 背景轮：不得产出 draft / 增行 */
  expectNoDraftJson?: boolean;
  /** 用户可见回复须匹配任一（i） */
  expectOutboundAny?: string[];
  /** 用户可见回复不得匹配任一（i） */
  forbidOutboundAny?: string[];
  expectPoolBuilt?: boolean;
  expectFileNotesMinRatio?: number;
  expectAssigneesFromPool?: boolean;
  expectDistinctAssigneesMin?: number;
  expectAssistantQuality?: boolean;
  draftAlreadyExists?: boolean;
  assistantMinLength?: number;
  allowAssignRetry?: boolean;
  allowPublishRetry?: boolean;
}

interface NaturalChain {
  id: string;
  description: string;
  rosterFixture?: string;
  managerStaffId: string;
  people: Record<string, string>;
  preSeed?: {
    candidatePool?: PlanSession["candidatePool"];
    latestDraft?: Record<string, unknown>;
    latestAssignment?: Record<string, unknown>;
  };
  turns: NaturalTurn[];
}

interface Manifest {
  id: string;
  description: string;
  chains: Array<{ file: string }>;
}

function bootstrapOnce() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  mkdirSync(process.env.PLAN_SESSION_DIR, { recursive: true });
}

/** 每条链独立 SQLite + 员工目录，避免 resolve_roster_names 串链污染 userId。 */
function bootstrapChain(chainId: string) {
  const chainDir = join(EVAL_DIR, "chains", chainId);
  mkdirSync(chainDir, { recursive: true });
  process.env.WORKBENCH_SQLITE_PATH = join(chainDir, "workbench.sqlite");
  process.env.EMPLOYEE_PROFILE_DIR = join(chainDir, "employee-profiles");
  mkdirSync(process.env.EMPLOYEE_PROFILE_DIR, { recursive: true });
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as Manifest;
}

function loadChain(file: string): NaturalChain {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, file), "utf8")) as NaturalChain;
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

function compilePatterns(list?: string[]): RegExp[] {
  return (list ?? []).map((s) => new RegExp(s, "i"));
}

function assertTurnToolExpectations(
  tools: string[],
  outbound: string,
  turn: NaturalTurn,
): string[] {
  const reasons: string[] = [];
  for (const t of turn.expectToolsInclude ?? []) {
    if (!tools.includes(t)) reasons.push(`missing tool: ${t}`);
  }
  for (const t of turn.expectToolsExclude ?? []) {
    if (tools.includes(t)) reasons.push(`forbidden tool: ${t}`);
  }
  for (const t of turn.forbidTools ?? []) {
    if (tools.includes(t)) reasons.push(`forbidden tool: ${t}`);
  }
  for (const re of compilePatterns(turn.expectOutboundAny)) {
    if (!re.test(outbound)) reasons.push(`outbound missing: ${re.source}`);
  }
  for (const re of compilePatterns(turn.forbidOutboundAny)) {
    if (re.test(outbound)) reasons.push(`outbound forbidden: ${re.source}`);
  }
  if (turn.expectToolsInclude?.includes("read_url") || turn.expectToolsExclude?.includes("search_web")) {
    reasons.push(...assertReadUrlAssistantHygiene(outbound));
  }
  return reasons;
}

async function seedChain(chain: NaturalChain) {
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
    process.env.WORKBENCH_MANAGER_USER_IDS = chain.managerStaffId;
    for (const [name, userId] of Object.entries(chain.people)) {
      store.upsertContact({
        ...base,
        userId,
        name,
        unionId: `u-${userId.slice(-8)}`,
        departmentNames: ["研发部"],
      });
      // 空 selfProfile — 模拟现网；分派应依赖 fileNotes
      store.upsertProfile({
        userId,
        skillTags: [],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: { capacityHint: "ok", emergencyOk: true },
        source: "eval-natural-full",
      });
    }
  } finally {
    store.close();
  }
}

function snapshotDraft(draft: PlanSession["latestDraft"]): Record<string, unknown> | undefined {
  return draft ? (structuredClone(draft) as Record<string, unknown>) : undefined;
}

function poolUserIds(chain: NaturalChain): Set<string> {
  return new Set(Object.values(chain.people));
}

async function runTurn(
  session: PlanSession,
  turn: NaturalTurn,
  chain: NaturalChain,
  clientConfig: ReturnType<typeof buildClient>,
) {
  const reasons = assertNaturalUserMessage(turn.userMessage);
  const draftBefore = snapshotDraft(session.latestDraft);
  const tasksBefore = Array.isArray((draftBefore as { tasks?: unknown[] } | undefined)?.tasks)
    ? (draftBefore as { tasks: unknown[] }).tasks.length
    : 0;
  const hadDraftBefore = tasksBefore > 0;

  if (turn.seedPendingRoster && chain.rosterFixture) {
    const rosterPath = join(process.cwd(), chain.rosterFixture);
    session.pendingRosterText = readFileSync(rosterPath, "utf8");
    session.pendingRosterSource = "uploaded:roster";
  }

  const result = await runDingtalkLikeTurn(session, turn.userMessage, {
    clientConfig,
    senderStaffId: chain.managerStaffId,
    actorName: "测评主管",
    allowAssignRetry: turn.allowAssignRetry,
    allowPublishRetry: turn.allowPublishRetry,
  });

  const coverage = assertAssignmentFullCoverage(
    session.latestDraft as Record<string, unknown> | undefined,
    session.latestAssignment as Record<string, unknown> | undefined,
  );
  const taskCount = Array.isArray((session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? (session.latestDraft as { tasks: unknown[] }).tasks.length
    : 0;

  if (turn.expectMinTasks !== undefined && taskCount < turn.expectMinTasks) {
    reasons.push(`tasks=${taskCount}<min${turn.expectMinTasks}`);
  }
  if (turn.expectDraftJson && !result.hasDraftJson && taskCount <= tasksBefore) {
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
  if (turn.forbidAssigneePatchLoop) {
    const patches = result.tools.filter((t) => t === "update_draft_task").length;
    if (patches > 4) reasons.push(`too many single-row patches=${patches}`);
  }
  if (turn.expectTasksIncreaseBy !== undefined) {
    reasons.push(
      ...assertTasksIncreasedBy(
        draftBefore,
        session.latestDraft as Record<string, unknown>,
        turn.expectTasksIncreaseBy,
      ),
    );
  }
  if (turn.expectMinDueAtCoverage !== undefined) {
    reasons.push(
      ...assertMinDueAtCoverage(session.latestDraft as Record<string, unknown>, turn.expectMinDueAtCoverage),
    );
  }
  if (turn.expectSplitDueAtFromRow !== undefined) {
    reasons.push(
      ...assertSplitRowsInheritDueAt(
        draftBefore,
        session.latestDraft as Record<string, unknown>,
        turn.expectSplitDueAtFromRow,
      ),
    );
  }
  if (turn.expectOrdinalRow) {
    reasons.push(
      ...assertOrdinalResolvesToDisplayIndex(
        session.latestDraft as Record<string, unknown>,
        turn.expectOrdinalRow.token,
        turn.expectOrdinalRow.displayIndex,
      ),
    );
  }
  if (turn.expectRowPatch) {
    const p = turn.expectRowPatch;
    if (p.dueAt) {
      reasons.push(
        ...assertRowAtDisplayIndex(session.latestDraft as Record<string, unknown>, p.displayIndex, {
          dueAt: p.dueAt,
        }),
      );
    }
    if (p.assigneeUserId || p.assigneeName) {
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
  if (turn.expectPublishStaged && !isDraftStagedForPublish(session.latestDraft)) {
    reasons.push("draft not staged for publish after preview turn");
  }
  if (turn.expectPublishOk && !result.publishOk) {
    reasons.push("publish did not succeed");
  }
  if (turn.expectPublishForbidden && (result.publishOk || result.tools.includes("publish_task"))) {
    reasons.push("forbidden publish this turn");
  }
  if (turn.expectNoDraftJson) {
    if (result.hasDraftJson) reasons.push("expected no draft JSON this turn");
    if (taskCount > tasksBefore) reasons.push(`expected no task growth (was ${tasksBefore}, now ${taskCount})`);
  }
  reasons.push(...assertTurnToolExpectations(result.tools, result.outboundMessage, turn));
  if (turn.expectPoolBuilt && !session.candidatePool?.entries?.length) {
    reasons.push("candidatePool not built");
  }
  if (turn.expectFileNotesMinRatio !== undefined) {
    reasons.push(...assertPoolFileNotesCoverage(session, turn.expectFileNotesMinRatio));
  }
  if (turn.expectAssigneesFromPool) {
    reasons.push(...assertAssigneesFromPool(session, poolUserIds(chain)));
  }
  if (turn.expectDistinctAssigneesMin !== undefined) {
    reasons.push(...assertDistinctAssigneeCount(session, turn.expectDistinctAssigneesMin));
  }
  if (turn.expectAssistantQuality !== false) {
    reasons.push(
      ...assertAssistantMessageQuality(result.outboundMessage, {
        draftAlreadyExists: turn.draftAlreadyExists ?? hadDraftBefore,
        minLength: turn.assistantMinLength,
      }),
    );
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
    traceId: result.traceId,
    taskCount,
    assignmentCoverage: coverage.ratio,
    publishOk: result.publishOk,
    tools: result.tools,
    failReason: reasons.filter(Boolean).join("; ") || undefined,
    preview: result.outboundMessage.slice(0, 160),
  };
}

function applyPreSeed(session: PlanSession, chain: NaturalChain) {
  const pre = chain.preSeed;
  if (!pre) return;
  if (pre.candidatePool) session.candidatePool = structuredClone(pre.candidatePool);
  if (pre.latestDraft) session.latestDraft = structuredClone(pre.latestDraft);
  if (pre.latestAssignment) session.latestAssignment = structuredClone(pre.latestAssignment);
}

async function main() {
  const manifest = loadManifest();
  bootstrapOnce();
  const clientConfig = buildClient();
  const store = createPlanSessionStore();
  const allResults: Array<Awaited<ReturnType<typeof runTurn>>> = [];
  let failed = 0;

  console.log("=== Natural Full Chains Eval ===");
  console.log(`manifest: ${manifest.id}`);
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`filter: ${FILTER || "(all)"}`);
  console.log("");

  for (const ref of manifest.chains) {
    const chain = loadChain(ref.file);
    if (FILTER && chain.id !== FILTER && !FILTER.includes(chain.id)) continue;

    bootstrapChain(chain.id);
    await seedChain(chain);
    let session = store.loadOrCreate(`eval:natural:${chain.id}`);
    applyPreSeed(session, chain);
    store.save(session);

    console.log(`--- ${chain.id}: ${chain.description} ---`);
    for (const turn of chain.turns) {
      process.stdout.write(`  [${turn.id}] ... `);
      session = store.loadOrCreate(`eval:natural:${chain.id}`);
      const r = await runTurn(session, turn, chain, clientConfig);
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
    join(EVAL_DIR, "eval-summary.json"),
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
