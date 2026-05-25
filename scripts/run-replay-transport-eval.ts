/**
 * Replay eval: multi-turn clinical transport demo with natural user messages.
 * Run: npm run eval:replay-transport
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-replay-transport");
const FIXTURE_PATH = process.env.REPLAY_FIXTURE?.trim() || join(process.cwd(), "fixtures/replay-transport-demo.json");

interface ReplayTurn {
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
  expectRowPatch?: { displayIndex: number; dueAt?: string; assigneeUserId?: string; assigneeName?: string };
  expectPublishStaged?: boolean;
  expectPublishOk?: boolean;
  allowAssignRetry?: boolean;
  allowPublishRetry?: boolean;
}

interface ReplayFixture {
  id: string;
  description: string;
  rosterFixture: string;
  managerStaffId: string;
  people: Record<string, string>;
  turns: ReplayTurn[];
}

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  mkdirSync(process.env.PLAN_SESSION_DIR, { recursive: true });
}

async function seedPeople(fixture: ReplayFixture) {
  const store = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    store.upsertContact({
      ...base,
      userId: fixture.managerStaffId,
      name: "测评主管",
      unionId: "u-mgr-replay",
      departmentNames: ["质量部"],
    });
    process.env.WORKBENCH_MANAGER_USER_IDS = fixture.managerStaffId;
    for (const [name, userId] of Object.entries(fixture.people)) {
      store.upsertContact({
        ...base,
        userId,
        name,
        unionId: `u-${userId.slice(-6)}`,
        departmentNames: ["研发部"],
      });
      store.upsertProfile({
        userId,
        skillTags: ["运输", "失效分析", "SMT", "结构"],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: { capacityHint: "ok", emergencyOk: true },
        source: "eval-replay",
      });
    }
  } finally {
    store.close();
  }
}

function loadFixture(): ReplayFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as ReplayFixture;
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

function snapshotDraft(draft: PlanSession["latestDraft"]): Record<string, unknown> | undefined {
  return draft ? (structuredClone(draft) as Record<string, unknown>) : undefined;
}

async function runTurn(session: PlanSession, turn: ReplayTurn, fixture: ReplayFixture, clientConfig: ReturnType<typeof buildClient>) {
  const reasons = assertNaturalUserMessage(turn.userMessage);
  const draftBefore = snapshotDraft(session.latestDraft);
  const tasksBefore = Array.isArray((draftBefore as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((draftBefore as { tasks: unknown[] }).tasks.length)
    : 0;

  if (turn.seedPendingRoster) {
    const rosterPath = join(process.cwd(), fixture.rosterFixture);
    session.pendingRosterText = readFileSync(rosterPath, "utf8");
    session.pendingRosterSource = "uploaded:roster";
  }

  const result = await runDingtalkLikeTurn(session, turn.userMessage, {
    clientConfig,
    senderStaffId: fixture.managerStaffId,
    actorName: "测评主管",
    allowAssignRetry: turn.allowAssignRetry,
    allowPublishRetry: turn.allowPublishRetry,
  });

  const coverage = assertAssignmentFullCoverage(
    session.latestDraft as Record<string, unknown> | undefined,
    session.latestAssignment as Record<string, unknown> | undefined,
  );
  const taskCount = Array.isArray((session.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((session.latestDraft as { tasks: unknown[] }).tasks.length)
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
  if (turn.expectNoFakeAssign && !assertEvalNoFakeAssign({
    userMessage: turn.userMessage,
    draft: session.latestDraft as Record<string, unknown> | undefined,
    assignment: session.latestAssignment as Record<string, unknown> | undefined,
    message: result.outboundMessage,
    extractOk: result.assignState.extractOk,
  })) {
    reasons.push("false assign message");
  }
  if (turn.forbidAssigneePatchLoop) {
    const patches = result.tools.filter((t) => t === "update_draft_task").length;
    if (patches > 4) reasons.push(`too many single-row patches=${patches}`);
  }
  if (turn.expectTasksIncreaseBy !== undefined) {
    reasons.push(...assertTasksIncreasedBy(draftBefore, session.latestDraft as Record<string, unknown>, turn.expectTasksIncreaseBy));
  }
  if (turn.expectMinDueAtCoverage !== undefined) {
    reasons.push(...assertMinDueAtCoverage(session.latestDraft as Record<string, unknown>, turn.expectMinDueAtCoverage));
  }
  if (turn.expectSplitDueAtFromRow !== undefined) {
    reasons.push(...assertSplitRowsInheritDueAt(draftBefore, session.latestDraft as Record<string, unknown>, turn.expectSplitDueAtFromRow));
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
    if (p.dueAt) reasons.push(...assertRowAtDisplayIndex(session.latestDraft as Record<string, unknown>, p.displayIndex, { dueAt: p.dueAt }));
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
  reasons.push(...assertNoDuplicateTaskIds(session.latestDraft as Record<string, unknown>));
  if (!assertNoMaxTurnsExceeded({ stopReason: result.stopReason, toolInvocationNames: result.tools })) {
    reasons.push("max_turns_exceeded");
  }

  createPlanSessionStore().save(session);
  return {
    id: turn.id,
    pass: reasons.filter(Boolean).length === 0,
    ms: result.ms,
    traceId: result.traceId,
    taskCount,
    assignmentCoverage: coverage.ratio,
    publishOk: result.publishOk,
    tools: result.tools,
    failReason: reasons.filter(Boolean).join("; ") || undefined,
    preview: result.outboundMessage.slice(0, 120),
  };
}

async function main() {
  const fixture = loadFixture();
  bootstrap();
  await seedPeople(fixture);
  const clientConfig = buildClient();
  const store = createPlanSessionStore();
  const session = store.loadOrCreate(`eval:replay:${fixture.id}`);
  store.save(session);

  const results = [];
  let failed = 0;

  console.log("=== Transport Replay Eval ===");
  console.log(`fixture: ${fixture.id}`);
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`turns: ${fixture.turns.length}`);
  console.log("");

  for (const turn of fixture.turns) {
    process.stdout.write(`[${turn.id}] ... `);
    const r = await runTurn(session, turn, fixture, clientConfig);
    results.push(r);
    if (!r.pass) failed += 1;
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.ms}ms tasks=${r.taskCount} cov=${r.assignmentCoverage.toFixed(2)}` +
        (r.failReason ? ` :: ${r.failReason}` : ""),
    );
  }

  writeFileSync(
    join(EVAL_DIR, "eval-summary.json"),
    JSON.stringify({ fixture: fixture.id, prompt: QWEN_PLANNER_PROMPT_VERSION, results }, null, 2),
  );
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
