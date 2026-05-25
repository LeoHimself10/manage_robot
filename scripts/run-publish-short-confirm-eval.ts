/**
 * 短句确认发布专项 eval — 模拟用户培训话术（「确认发布」等 ≤30 字）。
 * 不改产品逻辑，只测当前链路在短句下是否假发布 / 是否真调 publish_task。
 *
 * Run: npx tsx scripts/run-publish-short-confirm-eval.ts
 * Filter: EVAL_PUBLISH_FILTER=oct_12,phrase_matrix npx tsx scripts/run-publish-short-confirm-eval.ts
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
import { isPublishConfirmUserMessage, isDraftStagedForPublish } from "../src/agent/publish-staging";
import {
  applyEvalProductionParityEnv,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-publish-short");
const INITIATOR = "eval-dd-initiator-001";
const MGR_STAFF_ID = "eval-mgr-001";
const EMP_STAFF_ID = "eval-emp-001";

const SHORT_PREPARE_MSG = "可以发布了，请做发布预览。";
const SHORT_PUBLISH_DEFAULT = "确认发布";

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
      strengths: ["现场拆解"],
      boundaries: [],
      cases: [],
      tools: [],
      availability: { capacityHint: "本周可承接" },
      source: "eval-seed",
    });
  } finally {
    store.close();
  }
}

function injectAssignment(session: PlanSession) {
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

function taskCount(draft: unknown): number {
  if (!draft || typeof draft !== "object") return 0;
  const tasks = (draft as { tasks?: unknown[] }).tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

async function runTurn(
  session: PlanSession,
  senderStaffId: string,
  userMessage: string,
): Promise<{
  tools: string[];
  hasDraftJson: boolean;
  publishOk: boolean;
  staged: boolean;
  confirmRecognized: boolean;
  message: string;
  ms: number;
}> {
  const clientConfig = buildClient();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const route = resolveDingtalkAgentRouting({
    senderStaffId,
    employeeRepo,
    roleRoutingEnabled: isDingtalkRoleRoutingEnabled(),
  });
  const t0 = Date.now();
  const result = await runOrchestrator(userMessage, {
    clientConfig,
    employeeRepo,
    maxToolIterations: Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 30),
    toolProfile: route.toolProfile,
    promptProfile: route.promptProfile,
    trustedActorUserId: route.trustedActorUserId,
    actorRole: senderStaffId === MGR_STAFF_ID ? "manager" : "employee",
    actorName: senderStaffId === MGR_STAFF_ID ? "测评经理" : "发起人",
    currentSession: session,
    currentSessionPlanId: session.planId,
    publishRecentStore: createRecentPublishStore(),
    sessionContext: {
      conversationHistory: session.conversationHistory,
      planId: session.planId,
      latestDraft: session.latestDraft as Record<string, unknown> | undefined,
      latestAssignment: session.latestAssignment,
      memoryFacts: session.knownFacts,
      currentTimeIso: new Date().toISOString(),
    },
  });

  if (result.draft) session.latestDraft = result.draft as typeof session.latestDraft;
  if (result.assignment) session.latestAssignment = result.assignment as typeof session.latestAssignment;
  session.conversationHistory = [
    ...session.conversationHistory,
    { role: "user", content: userMessage },
    { role: "assistant", content: result.messages.join("\n\n") || "(empty)" },
  ].slice(-12);
  session.updatedAt = new Date().toISOString();
  createPlanSessionStore().save(session);
  if (result.draft) {
    savePlanSnapshot(session.planId, {
      planId: session.planId,
      traceId: result.traceId,
      status: "DRAFT_READY",
      draft: result.draft,
      messagePreview: result.messages[0]?.slice(0, 200),
    });
  }

  const publishOk = (result.publishResult as { ok?: boolean } | undefined)?.ok === true;
  return {
    tools: result.toolInvocationNames ?? [],
    hasDraftJson: result.draft !== undefined,
    publishOk,
    staged: isDraftStagedForPublish(session.latestDraft),
    confirmRecognized: isPublishConfirmUserMessage(userMessage),
    message: result.messages.join(" ").slice(0, 120),
    ms: Date.now() - t0,
  };
}

interface ChainDef {
  id: string;
  buildDraft: (session: PlanSession) => Promise<{ tasks: number; ok: boolean }>;
  publishPhrase?: string;
}

async function buildOctDraft(session: PlanSession, withRedraft: boolean): Promise<{ tasks: number; ok: boolean }> {
  const w1 =
    "OCT 客诉：A 产品 A-2026B 批次 2026Q2-04 焊点开路 15 台，DCT-2026-0512，2026-06-15 前完成根因与纠正。按 WBS 直接出草案 JSON。";
  const r1 = await runTurn(session, INITIATOR, w1);
  if (!session.latestDraft || taskCount(session.latestDraft) === 0) {
    return { tasks: 0, ok: false };
  }
  if (withRedraft) {
    await runTurn(
      session,
      INITIATOR,
      "请按 WBS 整表重出 tasks[]，拆得更细。",
    );
  }
  return { tasks: taskCount(session.latestDraft), ok: true };
}

async function buildCapaDraft(session: PlanSession): Promise<{ tasks: number; ok: boolean }> {
  await runTurn(
    session,
    INITIATOR,
    "CAPA-2026-088 导管头端脱胶 2 起，生产/质量/供应链/注册协同，2026-07-01 前闭环。WBS 直接出草案 JSON。",
  );
  return { tasks: taskCount(session.latestDraft), ok: taskCount(session.latestDraft) > 0 };
}

async function buildRdDraft(session: PlanSession): Promise<{ tasks: number; ok: boolean }> {
  await runTurn(
    session,
    INITIATOR,
    "糖代谢分析仪 2026-06-20 发版（固件+DLL+APK），BLE/HL7，依赖 ECO-24018。WBS 直接出草案 JSON。",
  );
  return { tasks: taskCount(session.latestDraft), ok: taskCount(session.latestDraft) > 0 };
}

async function runPublishChain(chain: ChainDef): Promise<{
  id: string;
  pass: boolean;
  tasks: number;
  prepareTools: string[];
  publishTools: string[];
  publishOk: boolean;
  stagedBeforePublish: boolean;
  confirmRecognized: boolean;
  publishPhrase: string;
  falsePublish: boolean;
  detail: string;
  publishMsg: string;
}> {
  const store = createPlanSessionStore();
  const session = store.loadOrCreate(`eval:pub-short:${chain.id}`);
  session.conversationHistory = [];
  session.knownFacts = [];
  session.latestDraft = undefined;
  session.latestAssignment = undefined;

  const built = await chain.buildDraft(session);
  if (!built.ok) {
    return {
      id: chain.id,
      pass: false,
      tasks: 0,
      prepareTools: [],
      publishTools: [],
      publishOk: false,
      stagedBeforePublish: false,
      confirmRecognized: false,
      publishPhrase: chain.publishPhrase ?? SHORT_PUBLISH_DEFAULT,
      falsePublish: false,
      detail: "draft_build_failed",
      publishMsg: "",
    };
  }

  injectAssignment(session);
  store.save(session);

  const prep = await runTurn(session, MGR_STAFF_ID, SHORT_PREPARE_MSG);
  const phrase = chain.publishPhrase ?? SHORT_PUBLISH_DEFAULT;
  const pub = await runTurn(session, MGR_STAFF_ID, phrase);

  const calledPublish = pub.tools.includes("publish_task");
  const falsePublish =
    !pub.publishOk &&
    !calledPublish &&
    /已.*发布|发布成功|正式发布/.test(pub.message);

  const pass = pub.publishOk && calledPublish;

  return {
    id: chain.id,
    pass,
    tasks: built.tasks,
    prepareTools: prep.tools,
    publishTools: pub.tools,
    publishOk: pub.publishOk,
    stagedBeforePublish: prep.staged,
    confirmRecognized: pub.confirmRecognized,
    publishPhrase: phrase,
    falsePublish,
    detail: pass
      ? "ok"
      : falsePublish
        ? "false_publish_claim"
        : !calledPublish
          ? "no_publish_task"
          : !pub.publishOk
            ? "publish_not_ok"
            : "unknown",
    publishMsg: pub.message,
  };
}

async function main() {
  bootstrap();
  await seedDirectory();

  const chains: ChainDef[] = [
    {
      id: "oct_6_no_redraft",
      buildDraft: (s) => buildOctDraft(s, false),
      publishPhrase: "确认发布",
    },
    {
      id: "oct_12_with_redraft",
      buildDraft: (s) => buildOctDraft(s, true),
      publishPhrase: "确认发布",
    },
    {
      id: "capa_multi_dept",
      buildDraft: buildCapaDraft,
      publishPhrase: "确认发布",
    },
    {
      id: "rd_release",
      buildDraft: buildRdDraft,
      publishPhrase: "确认发布",
    },
    {
      id: "phrase_发布",
      buildDraft: (s) => buildOctDraft(s, false),
      publishPhrase: "发布",
    },
    {
      id: "phrase_发布吧",
      buildDraft: (s) => buildOctDraft(s, false),
      publishPhrase: "发布吧",
    },
    {
      id: "phrase_确认",
      buildDraft: (s) => buildOctDraft(s, false),
      publishPhrase: "确认",
    },
    {
      id: "phrase_可以了",
      buildDraft: (s) => buildOctDraft(s, false),
      publishPhrase: "可以了",
    },
    {
      id: "oct_repeat_run2",
      buildDraft: (s) => buildOctDraft(s, true),
      publishPhrase: "确认发布",
    },
  ];

  const filterRaw = process.env.EVAL_PUBLISH_FILTER?.trim();
  const filterSet = filterRaw
    ? new Set(filterRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  let selected = chains;
  if (filterSet?.size) {
    selected = chains.filter((c) => filterSet.has(c.id));
    if (selected.length === 0) {
      console.error("EVAL_PUBLISH_FILTER matched no chains");
      process.exit(1);
    }
  }

  console.log("=== Short Confirm Publish Eval ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`prepare phrase: "${SHORT_PREPARE_MSG}"`);
  console.log(`chains: ${selected.length}`);
  console.log("");

  const results = [];
  for (const chain of selected) {
    process.stdout.write(`[${chain.id}] ... `);
    const r = await runPublishChain(chain);
    results.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} tasks=${r.tasks} staged=${r.stagedBeforePublish} ` +
        `prep=${r.prepareTools.join(">") || "-"} pub=${r.publishTools.join(">") || "-"} ` +
        `phrase="${r.publishPhrase}" confirmDetect=${r.confirmRecognized} :: ${r.detail}` +
        (r.falsePublish ? " [FALSE_PUBLISH]" : ""),
    );
    if (r.publishMsg) console.log(`  msg: ${r.publishMsg}`);
  }

  const passed = results.filter((r) => r.pass).length;
  const falsePublishes = results.filter((r) => r.falsePublish).length;
  console.log("");
  console.log(`=== Summary: ${passed}/${results.length} passed, false_publish=${falsePublishes} ===`);
  if (passed < results.length) {
    console.log("Failures:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.id} (${r.publishPhrase}): ${r.detail}`);
    }
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
