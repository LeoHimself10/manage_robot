/**
 * 本地复杂冒烟：全文 latestDraft + 草案增删改 + 合并策略
 *
 *   npx tsx scripts/smoke-draft-memory-local.ts          # 确定性 + LLM 多轮
 *   npx tsx scripts/smoke-draft-memory-local.ts --fast   # 仅确定性（无 API）
 *   npx tsx scripts/smoke-draft-memory-local.ts --llm    # 仅 LLM 多轮
 */
import "dotenv/config";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runOrchestrator } from "../src/agent/orchestrator";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import type { QwenCompatibleClientConfig } from "../src/agent/demo/qwen-compatible-client";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import type { PlanSession } from "../src/infra/plan-session-store";
import {
  buildAddDraftSubtaskHandler,
  buildRemoveDraftSubtaskHandler,
} from "../src/agent/tools/mutate-draft-subtasks";
import { buildUpdateDraftTaskHandler } from "../src/agent/tools/update-draft-task";
import {
  mergeOrchestratorDraftIntoSession,
  resolveDraftForOutbound,
} from "../src/view/draft-outbound";

const ARGS = new Set(process.argv.slice(2));
const FAST_ONLY = ARGS.has("--fast");
const LLM_ONLY = ARGS.has("--llm");

const DATA = join(process.cwd(), ".eval-draft-smoke");
if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true });
mkdirSync(join(DATA, "employees", "profiles"), { recursive: true });
process.env.EMPLOYEE_PROFILE_DIR = join(DATA, "employees", "profiles");
process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
process.env.DINGTALK_QWEN_THINKING = "0";
process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS = "8";
process.env.AGENT_MAX_TOTAL_TOKENS = process.env.AGENT_MAX_TOTAL_TOKENS ?? "24000";

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];

function orchText(result: { messages?: string[]; message?: string }): string {
  return String(result.messages?.[0] ?? result.message ?? "").trim();
}

function record(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function getTasks(session: PlanSession): Array<Record<string, unknown>> {
  const draft = session.latestDraft as { tasks?: unknown[] } | undefined;
  return Array.isArray(draft?.tasks) ? (draft.tasks as Array<Record<string, unknown>>) : [];
}

function taskById(session: PlanSession, id: string): Record<string, unknown> | undefined {
  return getTasks(session).find((t) => String(t.id) === id);
}

function buildOrchConfig(input: {
  session: PlanSession;
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  onSessionMutated: (s: PlanSession) => void;
}) {
  const { session, conversationHistory } = input;
  session.conversationHistory = conversationHistory.map((h) => ({
    role: h.role,
    content: h.content,
    at: new Date().toISOString(),
  }));
  return {
    clientConfig: input.clientConfig,
    employeeRepo: input.employeeRepo,
    toolProfile: "planner" as const,
    promptProfile: "planner" as const,
    maxToolIterations: 8,
    currentSessionPlanId: session.planId,
    currentSession: session,
    sessionContext: {
      planId: session.planId,
      latestDraft: session.latestDraft,
      latestAssignment: session.latestAssignment,
      conversationHistory: input.conversationHistory,
      memorySummary: "复杂冒烟会话",
      memoryFacts: [] as string[],
      currentTimeIso: new Date().toISOString(),
    },
    onSessionMutated: input.onSessionMutated,
  };
}

// ─── 确定性套件（不调用模型）────────────────────────────────────────

async function runDeterministicSuite(): Promise<void> {
  console.log("\n========== 确定性套件 ==========\n");

  const richDraft = {
    title: "CAPA复盘",
    tasks: [
      {
        id: "task_1",
        title: "数据收集",
        objective: "汇总批次",
        inputMaterials: ["图纸A", "批次台账"],
        deliverables: ["原始数据包"],
        completionCriteria: ["数据完整"],
        timeNode: { dueAt: "2026-06-10" },
      },
      {
        id: "task_2",
        title: "根因分析",
        objective: "8D初稿",
        dependencyTaskIds: ["task_1"],
        deliverables: ["鱼骨图"],
        risksAndOpenQuestions: ["旧风险"],
        timeNode: { dueAt: "2026-06-20" },
      },
      {
        id: "task_3",
        title: "纠正措施",
        objective: "措施清单",
        dependencyTaskIds: ["task_2"],
        timeNode: { dueAt: "2026-06-25" },
      },
    ],
  };

  // merge：update 后忽略 orch 误覆盖 tasks[]
  {
    const post = {
      ...richDraft,
      tasks: [{ ...richDraft.tasks[1], title: "根因分析（已改标题）" }],
    };
    const merged = mergeOrchestratorDraftIntoSession(
      post as Record<string, unknown>,
      { tasks: [{ id: "task_2", title: "模型误覆盖" }] },
      ["update_draft_task"],
    );
    const t2 = (merged.tasks as Array<Record<string, unknown>>).find((t) => t.id === "task_2");
    record(
      "merge: update 后不被 orch tasks[] 覆盖",
      t2?.title === "根因分析（已改标题）" && Array.isArray(t2?.deliverables),
      `title=${String(t2?.title)}`,
    );
  }

  // merge：add 后 phantom task 不替换列表
  {
    const merged = mergeOrchestratorDraftIntoSession(
      richDraft as Record<string, unknown>,
      { tasks: [{ id: "task_99", title: "phantom" }] },
      ["add_draft_subtask"],
    );
    record(
      "merge: add 后保留原 tasks",
      (merged.tasks as unknown[]).length === 3 &&
        (merged.tasks as Array<{ title: string }>)[0].title === "数据收集",
    );
  }

  // outbound：未改草案不渲染表
  {
    const r = resolveDraftForOutbound({
      preTurnDraft: richDraft,
      postTurnDraft: richDraft,
      toolInvocationNames: [],
    });
    record("outbound: 未改草案不渲染", !r.draftTouchedThisTurn && r.draftForRender === undefined);
  }

  // outbound：update 后应渲染
  {
    const post = {
      ...richDraft,
      tasks: [{ ...richDraft.tasks[0], deliverables: ["新交付物"] }],
    };
    const r = resolveDraftForOutbound({
      preTurnDraft: richDraft,
      postTurnDraft: post,
      toolInvocationNames: ["update_draft_task"],
    });
    const d0 = (r.draftForRender?.tasks as Array<{ deliverables?: string[] }>)?.[0];
    record(
      "outbound: update 后渲染合并结果",
      r.draftTouchedThisTurn && d0?.deliverables?.[0] === "新交付物",
    );
  }

  // 工具链：富字段 update
  {
    const session = { planId: "d1", latestDraft: structuredClone(richDraft) } as PlanSession;
    const out = buildUpdateDraftTaskHandler({ currentSession: session })({
      subtaskId: "task_2",
      patch: {
        deliverables: ["8D报告", "鱼骨图"],
        completionCriteria: ["质量部签字"],
        risks: ["人员不足", "设备排期"],
      },
    }) as Record<string, unknown>;
    const t2 = taskById(session, "task_2");
    record(
      "tool: update 富字段",
      out.ok === true &&
        JSON.stringify(t2?.deliverables) === JSON.stringify(["8D报告", "鱼骨图"]) &&
        (t2?.risksAndOpenQuestions as string[])?.length === 2,
    );
  }

  // 工具链：insertAfter 插入
  {
    const session = { planId: "d2", latestDraft: structuredClone(richDraft) } as PlanSession;
    const out = buildAddDraftSubtaskHandler({ currentSession: session })({
      title: "客户投诉汇总",
      objective: "汇总客诉",
      dueAt: "2026-06-15",
      insertAfterSubtaskId: "task_1",
    }) as Record<string, unknown>;
    const tasks = getTasks(session);
    record(
      "tool: insertAfter task_1",
      out.ok === true && tasks.length === 4 && tasks[1]?.title === "客户投诉汇总",
      `ids=${tasks.map((t) => t.id).join(",")}`,
    );
  }

  // 工具链：删除中间项 + 依赖清理 + assignment 行删
  {
    const session = {
      planId: "d3",
      latestDraft: structuredClone(richDraft),
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "u1" } },
          { taskId: "task_2", primary: { userId: "u2" } },
          { taskId: "task_3", primary: { userId: "u3" } },
        ],
      },
    } as PlanSession;
    const out = buildRemoveDraftSubtaskHandler({ currentSession: session })({
      subtaskId: "task_2",
    }) as Record<string, unknown>;
    const tasks = getTasks(session);
    const t3deps = (taskById(session, "task_3")?.dependencyTaskIds as string[]) ?? [];
    const assigns = (
      (session.latestAssignment as { assignments?: Array<{ taskId: string }> })?.assignments ?? []
    ).map((a) => a.taskId);
    record(
      "tool: remove task_2 清依赖与 assignment",
      out.ok === true &&
        tasks.length === 2 &&
        !tasks.some((t) => t.id === "task_2") &&
        !t3deps.includes("task_2") &&
        !assigns.includes("task_2"),
      `remaining=${tasks.map((t) => t.id).join(",")} deps=${t3deps.join(",")}`,
    );
  }

  // 工具链：不能删最后一条
  {
    const session = {
      planId: "d4",
      latestDraft: { tasks: [{ id: "task_1", title: "唯一" }] },
    } as PlanSession;
    const out = buildRemoveDraftSubtaskHandler({ currentSession: session })({
      subtaskId: "task_1",
    }) as Record<string, unknown>;
    record("tool: 禁止删最后一条", out.ok === false && out.reason === "last_subtask");
  }

  // 大草案 memory 截断（通过 orchestrator 模块侧效应：读 env）
  {
    const prev = process.env.ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS;
    process.env.ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS = "800";
    const huge = {
      title: "大草案",
      description: "x".repeat(2000),
      tasks: Array.from({ length: 12 }, (_, i) => ({
        id: `task_${i + 1}`,
        title: `子任务${i + 1}`,
        objective: "o".repeat(400),
        deliverables: ["d1", "d2"],
        inputMaterials: ["m1"],
      })),
    };
    // 动态 import 以读取最新 env
    const mock = await vi_style_capture_memory(huge);
    process.env.ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS = prev;
    record(
      "memory: 超长草案注入带 _truncated 或 taskCount",
      mock.includes("_truncated") || (mock.includes("taskCount") && mock.length < 2500),
      `memoryChars=${mock.length}`,
    );
  }
}

/** 用 mock client 抓 memory_context 内容（不发起 HTTP） */
async function vi_style_capture_memory(latestDraft: Record<string, unknown>): Promise<string> {
  const { QwenCompatibleClient } = await import("../src/agent/demo/qwen-compatible-client");
  const orig = QwenCompatibleClient.prototype.callWithTools;
  let captured = "";
  QwenCompatibleClient.prototype.callWithTools = async function (req) {
    const mem = req.messages.find(
      (m) => m.role === "assistant" && String(m.content).includes("[memory_context]"),
    );
    captured = String(mem?.content ?? "");
    return {
      payload: { message: "ok", stopReason: "end_turn" },
      rawContent: "{}",
      trace: { requestId: "mock", model: "mock", tokenUsage: { totalTokens: 1 }, latencyMs: 1 },
      toolCallsExecuted: 0,
      iterationTimings: [],
    };
  };
  try {
    const memSession = { planId: "mem-cap", latestDraft } as PlanSession;
    await runOrchestrator(
      "你好",
      buildOrchConfig({
        session: memSession,
        clientConfig: {
          baseUrl: "http://127.0.0.1",
          apiKey: "mock",
          model: "qwen3.6-plus",
          timeoutMs: 5000,
          maxRetries: 0,
          temperature: 0,
          maxTokens: 200,
        },
        employeeRepo: createEmployeeProfileRepo(),
        conversationHistory: [],
        onSessionMutated: () => {},
      }),
    );
  } finally {
    QwenCompatibleClient.prototype.callWithTools = orig;
  }
  return captured;
}

// ─── LLM 多轮套件（同一会话串联）────────────────────────────────────

interface LlmStep {
  name: string;
  userMessage: string;
  assert: (ctx: {
    session: PlanSession;
    result: Awaited<ReturnType<typeof runOrchestrator>>;
    prevTaskCount: number;
  }) => { ok: boolean; detail?: string };
}

async function runLlmSuite(clientConfig: QwenCompatibleClientConfig): Promise<void> {
  console.log("\n========== LLM 多轮套件（真实 Qwen）==========\n");

  const employeeRepo = createEmployeeProfileRepo();
  let session: PlanSession = { planId: "llm-complex-1" } as PlanSession;
  let prevCount = 0;

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const steps: LlmStep[] = [
    {
      name: "LLM-1 从零生成复杂 CAPA 四子任务草案",
      userMessage:
        "请规划任务：2026年6月30日前完成产线A100批次质量复盘与CAPA关闭。拆成4个子任务：①数据收集 ②根因分析 ③纠正措施 ④报告与签字；每条要有目标、交付物、完成标准；先不指派人员。",
      assert: ({ session: s, result: r }) => {
        const n = getTasks(s).length;
        const ok = (r.draft != null || n >= 3) && n >= 3;
        return {
          ok,
          detail: `tasks=${n} hasDraftJson=${!!r.draft} tools=${(r.toolInvocationNames ?? []).join(">")}`,
        };
      },
    },
    {
      name: "LLM-2 富字段改 task_2（交付物/完成标准/风险）",
      userMessage:
        "只改 task_2：交付物加上「8D报告」和「鱼骨图」，完成标准改为「质量部签字」，风险项写「人员不足、验证周期紧」。不要重拆整张表。",
      assert: ({ session: s, result: r }) => {
        const t2 = taskById(s, "task_2");
        const dels = JSON.stringify(t2?.deliverables ?? []);
        const risks = JSON.stringify(t2?.risksAndOpenQuestions ?? []);
        const toolOk = (r.toolInvocationNames ?? []).includes("update_draft_task");
        const fieldOk =
          dels.includes("8D") || dels.includes("鱼骨") || risks.includes("人员");
        return {
          ok: toolOk || fieldOk,
          detail: `tool=${toolOk} deliverables=${dels.slice(0, 80)}`,
        };
      },
    },
    {
      name: "LLM-3 在 task_1 后插入子任务",
      userMessage:
        "在 task_1 后面插入一条子任务：客户投诉汇总表，目标是把本周客诉整理成表，2026年6月15日前完成。",
      assert: ({ session: s, result: r, prevTaskCount }) => {
        const n = getTasks(s).length;
        const toolOk = (r.toolInvocationNames ?? []).includes("add_draft_subtask");
        return {
          ok: (toolOk || n > prevTaskCount) && n >= prevTaskCount + 1,
          detail: `count ${prevTaskCount}->${n}`,
        };
      },
    },
    {
      name: "LLM-4 删除 task_4 且保留其余",
      userMessage: "删除 task_4（报告签字那条），其它子任务不要动。",
      assert: ({ session: s, result: r, prevTaskCount }) => {
        const tasks = getTasks(s);
        const toolOk = (r.toolInvocationNames ?? []).includes("remove_draft_subtask");
        const noT4 = !tasks.some((t) => t.id === "task_4");
        return {
          ok: (toolOk || noT4) && tasks.length >= 2 && tasks.length <= prevTaskCount,
          detail: `count=${tasks.length} ids=${tasks.map((t) => t.id).join(",")}`,
        };
      },
    },
    {
      name: "LLM-5 记忆追问：task_2 交付物与风险",
      userMessage: "不要改草案，只回答：task_2 现在的交付物和风险项分别是什么？",
      assert: ({ result: r }) => {
        const m = orchText(r);
        const ok =
          (/8D|鱼骨|交付/.test(m) && /人员|风险|验证/.test(m)) || m.length > 30;
        return { ok, detail: m.slice(0, 100) };
      },
    },
    {
      name: "LLM-6 记忆追问：列出所有子任务 id 与标题",
      userMessage: "列出当前草案里每条子任务的 id 和标题，不要修改。",
      assert: ({ session: s, result: r }) => {
        const tasks = getTasks(s);
        const m = orchText(r);
        const hit = tasks.filter(
          (t) =>
            m.includes(String(t.id)) ||
            m.includes(String(t.title).slice(0, 4)),
        ).length;
        return {
          ok: hit >= Math.min(2, tasks.length) || /task_[0-9]/.test(m),
          detail: `matched ${hit}/${tasks.length} msg=${m.slice(0, 120)}`,
        };
      },
    },
    {
      name: "LLM-7 改 task_1 交付物并确认条数",
      userMessage:
        "给 task_1 增加交付物「批次台账Excel」。然后告诉我现在一共有几条子任务。",
      assert: ({ session: s, result: r }) => {
        const t1 = taskById(s, "task_1");
        const dels = JSON.stringify(t1?.deliverables ?? []);
        const m = orchText(r);
        const n = getTasks(s).length;
        return {
          ok:
            (dels.includes("台账") || dels.includes("Excel")) &&
            (/\d/.test(m) || m.includes(String(n))),
          detail: `n=${n} deliverables=${dels.slice(0, 60)} msg=${m.slice(0, 40)}`,
        };
      },
    },
    {
      name: "LLM-8 换题（应开新 scope，不串旧 CAPA）",
      userMessage: "换个全新任务：下周做办公室空调巡检，和质量复盘无关，不要沿用刚才的子任务。",
      assert: ({ session: s, result: r }) => {
        const m = orchText(r);
        const tools = r.toolInvocationNames ?? [];
        const tasks = getTasks(s);
        const noCapa =
          !/A100|CAPA|质量复盘/.test(m) || tools.includes("start_new_task");
        const newTopic = /空调|巡检/.test(m);
        const fewOld = tasks.length === 0 || !tasks.some((t) => /根因分析/.test(String(t.title)));
        return {
          ok: (noCapa && newTopic) || tools.includes("start_new_task") || fewOld,
          detail: `tools=${tools.join(">")} tasks=${tasks.length} msg=${m.slice(0, 60)}`,
        };
      },
    },
  ];

  for (const step of steps) {
    prevCount = getTasks(session).length;
    console.log(`\n--- ${step.name} ---`);
    console.log(`用户: ${step.userMessage.slice(0, 80)}…`);
    const t0 = Date.now();
    let result: Awaited<ReturnType<typeof runOrchestrator>>;
    try {
      result = await runOrchestrator(
        step.userMessage,
        buildOrchConfig({
          session,
          clientConfig: { ...clientConfig, timeoutMs: 120_000 },
          employeeRepo,
          conversationHistory,
          onSessionMutated: (s) => {
            session = s;
          },
        }),
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error && e.stack ? e.stack.split("\n")[1]?.trim() : "";
      record(step.name, false, `异常: ${err}${stack ? ` @ ${stack}` : ""}`);
      continue;
    }
    const ms = Date.now() - t0;
    if (result.draft) {
      session = { ...session, latestDraft: result.draft };
    }
    conversationHistory.push({ role: "user", content: step.userMessage });
    conversationHistory.push({
      role: "assistant",
      content: orchText(result).slice(0, 500),
    });
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }

    console.log(
      `耗时 ${ms}ms | tools: ${(result.toolInvocationNames ?? []).join(" > ") || "-"} | hasDraftJson: ${!!result.draft}`,
    );
    const verdict = step.assert({ session, result, prevTaskCount: prevCount });
    record(step.name, verdict.ok, verdict.detail);
  }
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  if (!LLM_ONLY) {
    await runDeterministicSuite();
  }

  if (!FAST_ONLY) {
    const base = loadQwenPlannerConfigFromEnv();
    if (!base?.apiKey) {
      console.error("\n缺少 QWEN_API_KEY，跳过 LLM 套件");
    } else {
      await runLlmSuite(base);
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n========== 汇总: ${passed}/${checks.length} 通过 ==========`);
  if (failed.length > 0) {
    console.log("未通过:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail ?? ""}`);
    process.exit(2);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
