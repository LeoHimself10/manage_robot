/**
 * WBS spot eval — 3 scenarios focused on draft granularity (v5.23.8).
 * Run: npx tsx scripts/run-wbs-spot-eval.ts
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-wbs-spot");
const INITIATOR = "eval-dd-initiator-001";

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  process.env.DINGTALK_ROLE_ROUTING_ENABLED = "0";
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

function taskCount(draft: unknown): number {
  if (!draft || typeof draft !== "object") return 0;
  const tasks = (draft as { tasks?: unknown[] }).tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

async function runScenario(
  session: ReturnType<ReturnType<typeof createPlanSessionStore>["loadOrCreate"]>,
  label: string,
  userMessage: string,
): Promise<{ ok: boolean; taskCount: number; ms: number; preview: string; err?: string }> {
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const t0 = Date.now();
  try {
    const result = await runOrchestrator(userMessage, {
      clientConfig: buildClient(),
      employeeRepo,
      toolProfile: "planner",
      promptProfile: "planner",
      maxToolIterations: 6,
      currentSession: session,
      currentSessionPlanId: session.planId,
      sessionContext: {
        conversationHistory: session.conversationHistory,
        planId: session.planId,
        latestDraft: session.latestDraft as Record<string, unknown> | undefined,
        memoryFacts: session.knownFacts,
        currentTimeIso: new Date().toISOString(),
      },
    });
    const tc = taskCount(result.draft ?? session.latestDraft);
    if (result.draft) session.latestDraft = result.draft as typeof session.latestDraft;
    session.conversationHistory = [
      ...session.conversationHistory,
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: result.messages.join("\n\n") || "(empty)" },
    ].slice(-10);
    createPlanSessionStore().save(session);
    return {
      ok: tc > 0 || label.includes("clarify"),
      taskCount: tc,
      ms: Date.now() - t0,
      preview: result.messages.join(" ").slice(0, 180),
    };
  } catch (e) {
    return {
      ok: false,
      taskCount: 0,
      ms: Date.now() - t0,
      preview: "",
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  bootstrap();
  const store = createPlanSessionStore();
  const session = store.loadOrCreate(`eval:wbs-spot`);

  const scenarios = [
    {
      id: "W1_complex_draft",
      msg:
        "OCT 客诉：A 产品（型号 A-2026B）批次 2026Q2-04 批量焊点开路，15 台设备，缺陷代号 DCT-2026-0512。" +
        "请在 2026-06-15 前完成根因分析、遏制与纠正措施草案。请按 WBS 拆到可独立承接的工作包，直接输出正式草案。",
      expectMinTasks: 5,
    },
    {
      id: "W2_redraft_wbs",
      msg: "当前草案太粗，请按 WBS 原则拆得更细，整表重出 tasks[]。",
      expectMinTasks: 8,
    },
    {
      id: "W3_rd_release",
      msg:
        "研发发版：糖代谢分析仪 2026-06-20 发布软件组合（固件 v3.5.0 + DLL 2.3.0 + APK 1.9.2），含 BLE 修复与 HL7 对齐。" +
        "依赖硬件 ECO-24018；请按 WBS 拆到需求冻结、联调、验证层级、回滚策略、文档更新等工作包，截止 2026-06-20，直接出草案。",
      expectMinTasks: 6,
    },
  ];

  console.log("=== WBS Spot Eval ===");
  console.log("prompt: orchestrator-agent-v5.23.8");
  console.log("DINGTALK_QWEN_MAX_TOKENS fallback:", process.env.DINGTALK_QWEN_MAX_TOKENS ?? 8000);
  console.log("");

  let failed = 0;
  for (const s of scenarios) {
    if (s.id === "W3_rd_release") {
      const fresh = store.loadOrCreate(`eval:wbs-spot-rd`);
      session.planId = fresh.planId;
      session.latestDraft = undefined;
      session.conversationHistory = [];
      session.knownFacts = [];
    }
    process.stdout.write(`[${s.id}] ... `);
    const r = await runScenario(session, s.id, s.msg);
    const pass = r.ok && r.taskCount >= s.expectMinTasks;
    if (!pass) failed += 1;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${r.ms}ms tasks=${r.taskCount} (min=${s.expectMinTasks})` +
        (r.err ? ` err=${r.err}` : ""),
    );
    if (r.preview) console.log(`  msg: ${r.preview.replace(/\n/g, " ")}`);
    if (r.taskCount > 0 && session.latestDraft) {
      const tasks = (session.latestDraft as { tasks: Array<{ title?: string }> }).tasks ?? [];
      console.log(`  titles: ${tasks.slice(0, 8).map((t) => t.title).join(" | ")}${tasks.length > 8 ? " …" : ""}`);
    }
  }

  console.log(failed === 0 ? "\nWBS spot eval: ALL PASS" : `\nWBS spot eval: ${failed} FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
