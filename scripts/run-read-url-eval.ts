/**
 * read_url 全链路 eval：单元测试 + 入站抽取 + 抓取层 + 现网 parity LLM 多场景。
 *
 * Run: npm run eval:read-url
 * Filter: EVAL_READ_URL_FILTER=R3 npm run eval:read-url
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { extractDingtalkMessageText } from "../src/integrations/dingtalk/extract-message-text";
import { fetchUrlContent } from "../src/integrations/url-fetch/fetch-url-content";
import { validateUrlForFetch } from "../src/security/url-fetch-guard";
import { buildReadUrlHandler } from "../src/agent/tools/read-url";
import {
  assertExtractedBackground,
  assertReadUrlAssistantHygiene,
  assertReadUrlTurn,
  type ReadUrlTurnExpect,
} from "./eval-read-url-assertions";
import {
  assertNaturalUserMessage,
  runDingtalkLikeTurn,
} from "./dingtalk-turn-eval-harness";
import {
  applyEvalProductionParityEnv,
  buildEvalDingtalkClientConfig,
  formatEvalProductionParitySummary,
} from "./eval-production-parity-env";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-read-url");
const FIXTURE_PAYLOADS = join(process.cwd(), "fixtures/read-url-eval/dingtalk-payloads.json");
const FILTER = process.env.EVAL_READ_URL_FILTER?.trim();
const MGR = "eval-mgr-readurl-001";

interface InfraCase {
  id: string;
  run: () => Promise<string[]>;
}

interface LlmScenario extends ReadUrlTurnExpect {
  userMessage: string;
  /** If set, build userMessage from dingtalk payload extract (simulates bot inbound) */
  dingtalkPayloadKey?: string;
}

interface LlmChain {
  id: string;
  description: string;
  turns: LlmScenario[];
}

function appendTurnHistory(session: PlanSession, userMessage: string, assistantMessage: string): void {
  session.conversationHistory = [
    ...session.conversationHistory,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantMessage },
  ].slice(-10);
}

function resetSessionForScenario(session: PlanSession): void {
  session.latestDraft = undefined;
  session.latestAssignment = undefined;
  session.conversationHistory = [];
  session.knownFacts = [];
}

function runVitest(label: string, patterns: string[]) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync("npx", ["vitest", "run", ...patterns], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`${label} failed exit=${r.status}`);
  }
}

function bootstrap() {
  if (existsSync(EVAL_DIR)) rmSync(EVAL_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  applyEvalProductionParityEnv();
  process.env.PLAN_SESSION_DIR = join(EVAL_DIR, "sessions");
  process.env.WORKBENCH_SQLITE_PATH = join(EVAL_DIR, "workbench.sqlite");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  process.env.READ_URL_ENABLED = "1";
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
      unionId: "u-mgr-readurl",
      departmentNames: ["质量部"],
    });
  } finally {
    store.close();
  }
}

function buildClient() {
  applyEvalProductionParityEnv({ respectExisting: true });
  return buildEvalDingtalkClientConfig();
}

function loadPayloads(): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(FIXTURE_PAYLOADS, "utf8")) as Record<string, Record<string, unknown>>;
}

function buildInfraCases(): InfraCase[] {
  const payloads = loadPayloads();
  return [
    {
      id: "I1_ssrf_localhost",
      run: async () => {
        const r = await validateUrlForFetch("http://127.0.0.1:8080/spec");
        return r.ok ? ["expected blocked localhost"] : [];
      },
    },
    {
      id: "I2_ssrf_private_ip",
      run: async () => {
        const r = await validateUrlForFetch("http://192.168.0.10/doc");
        return r.ok ? ["expected blocked private ip"] : [];
      },
    },
    {
      id: "I3_extract_text_url",
      run: async () =>
        assertExtractedBackground(extractDingtalkMessageText(payloads.plain_text_with_url), {
          mustContain: ["https://example.com/spec", "请按这个链接规划"],
          mustNotContain: ["oapi.dingtalk.com"],
        }),
    },
    {
      id: "I4_extract_richtext_href",
      run: async () =>
        assertExtractedBackground(extractDingtalkMessageText(payloads.rich_text_href_only), {
          mustContain: ["[links]", "https://example.com/requirements"],
        }),
    },
    {
      id: "I5_extract_picture_empty",
      run: async () =>
        assertExtractedBackground(extractDingtalkMessageText(payloads.picture_only), {
          minLength: 0,
        }).concat(
          extractDingtalkMessageText(payloads.picture_only).trim().length === 0
            ? []
            : ["picture-only payload should yield empty background"],
        ),
    },
    {
      id: "I6_fetch_example_com",
      run: async () => {
        const r = await fetchUrlContent({ url: "https://example.com/" });
        if (!r.ok) return [`fetch example.com failed: ${r.reason} ${r.hint}`];
        if (!/example domain/i.test(r.text)) return ["example.com body missing 'Example Domain'"];
        return [];
      },
    },
    {
      id: "I7_read_url_mock_html",
      run: async () => {
        const html =
          "<html><head><title>Eval Spec</title></head><body><h1>OCT升级需求</h1><p>需在两周内完成培训与验证。</p></body></html>";
        const fetchImpl = async () =>
          new Response(html, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        const orig = globalThis.fetch;
        globalThis.fetch = fetchImpl as typeof fetch;
        try {
          const handler = buildReadUrlHandler();
          const out = await handler({ url: "https://example.com/eval-spec" });
          if (!out.ok) return [`mock read_url failed: ${(out as { reason?: string }).reason}`];
          const text = String((out as { text?: string }).text ?? "");
          if (!text.includes("OCT升级需求")) return ["mock read_url missing page content"];
          return [];
        } finally {
          globalThis.fetch = orig;
        }
      },
    },
    {
      id: "I8_dingtalk_doc_login_wall_mock",
      run: async () => {
        const fetchImpl = async () =>
          new Response("<html><body>请登录钉钉文档</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        const r = await fetchUrlContent({
          url: "https://alidocs.dingtalk.com/i/docs/eval",
          fetchImpl: fetchImpl as typeof fetch,
        });
        return r.ok ? ["expected login_wall_or_empty"] : r.reason === "login_wall_or_empty" ? [] : [`got ${r.reason}`];
      },
    },
    {
      id: "I9_read_url_quota",
      run: async () => {
        const prev = process.env.READ_URL_PER_ORCHESTRATOR_MAX;
        process.env.READ_URL_PER_ORCHESTRATOR_MAX = "1";
        let n = 0;
        const handler = buildReadUrlHandler({
          getCallCount: () => n,
          incrementCallCount: () => {
            n += 1;
          },
        });
        const okFetch = async () =>
          new Response("<html><body><p>ok</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        const orig = globalThis.fetch;
        globalThis.fetch = okFetch as typeof fetch;
        try {
          await handler({ url: "https://example.com/a" });
          const third = await handler({ url: "https://example.com/b" });
          return third.ok === false && third.reason === "read_url_quota_exhausted" ? [] : ["quota not enforced"];
        } finally {
          globalThis.fetch = orig;
          if (prev === undefined) delete process.env.READ_URL_PER_ORCHESTRATOR_MAX;
          else process.env.READ_URL_PER_ORCHESTRATOR_MAX = prev;
        }
      },
    },
    {
      id: "I10_background_text_plus_url_extract",
      run: async () =>
        assertExtractedBackground(
          extractDingtalkMessageText({
            msgtype: "text",
            text: {
              content:
                "项目代号 Phoenix，背景见 https://example.com/doc ，先别拆任务",
            },
          }),
          {
            mustContain: ["Phoenix", "https://example.com/doc", "先别拆任务"],
          },
        ),
    },
  ];
}

function buildLlmScenarios(): LlmScenario[] {
  const payloads = loadPayloads();
  const richBackground = extractDingtalkMessageText(payloads.rich_text_href_only);

  return [
    {
      id: "R1_public_link_plan",
      userMessage:
        "外部需求说明在这里：https://example.com/ 请根据页面里的 Example Domain 说明，帮我拆一条「域名合规培训」任务，两周内完成。",
      expectToolsInclude: ["read_url"],
      expectToolsExclude: ["search_web"],
      expectOutboundAny: [/Example Domain|example\.com|域名|培训/i],
      forbidOutboundAny: [/read_url|search_web/i],
      minOutboundLength: 20,
    },
    {
      id: "R2_richtext_inbound_sim",
      userMessage: `${richBackground}\n请按链接内容规划一条简单任务。`,
      expectToolsInclude: ["read_url"],
      expectToolsExclude: ["search_web"],
      minOutboundLength: 16,
    },
    {
      id: "R3_dingtalk_doc_guidance",
      userMessage:
        "需求在这份钉钉文档里：https://alidocs.dingtalk.com/i/docs/eval-read-url-test ，请帮我拆解成可执行子任务。",
      expectToolsInclude: ["read_url"],
      expectOutboundAny: [/复制|粘贴|导出|登录|无法|读不到|钉钉文档|正文/i],
      forbidOutboundAny: [
        /已完成.{0,6}拆解/i,
        /task_\d+/i,
        /子任务.{0,8}共\s*\d+\s*条/i,
      ],
      minOutboundLength: 20,
    },
    {
      id: "R4_internal_url_no_hallucinate",
      userMessage: "内网规范在这：http://127.0.0.1:8080/internal-spec ，请按链接规划质量改进任务。",
      expectToolsInclude: ["read_url"],
      expectOutboundAny: [/内网|无法|读|粘贴|复制|127\.0\.0\.1|localhost/i],
      forbidOutboundAny: [/已完成发布|task_\d+/i],
      minOutboundLength: 16,
    },
    {
      id: "R5_plain_text_no_read_url",
      userMessage: extractDingtalkMessageText(payloads.text_no_url),
      expectToolsExclude: ["read_url"],
      expectOutboundAny: [/OCT|升级|规划|补充|请/i],
      minOutboundLength: 12,
    },
    {
      id: "R6_ietf_plain_text_link",
      userMessage:
        "标准说明见 https://www.ietf.org/rfc/rfc2606.txt ，请根据 reserved domain names 相关描述，规划一条内部 DNS 规范宣贯任务，6/30 前完成。",
      expectToolsInclude: ["read_url"],
      expectToolsExclude: ["search_web"],
      expectOutboundAny: [/DNS|域名|reserved|RFC|2606|宣贯|规范/i],
      minOutboundLength: 20,
    },
    {
      id: "R7_background_only_no_draft",
      userMessage:
        "客户投诉背景说明在这里：https://example.com/ 对接人暂定质量部小李，项目代号 Falcon。这轮回合**先不要拆任务**，等我补充完现场信息再说。",
      expectToolsInclude: ["read_url"],
      expectToolsExclude: ["search_web"],
      expectDraftJson: false,
      expectOutboundAny: [/Example|背景|Falcon|小李|补充|先不|收到|已读/i],
      forbidOutboundAny: [/read_url|search_web/i],
      minOutboundLength: 24,
    },
    {
      id: "R8_background_text_combined_plan",
      userMessage:
        "项目代号 Phoenix，现场在东莞；补充背景见 https://example.com/ 。另外截止下周五。请结合链接内容和上述约束，拆一条「Example Domain 合规宣贯」任务。",
      expectToolsInclude: ["read_url"],
      expectToolsExclude: ["search_web"],
      expectOutboundAny: [/Phoenix|东莞|Example|合规|宣贯|下周五/i],
      minOutboundLength: 20,
    },
  ];
}

function buildLlmChains(): LlmChain[] {
  return [
    {
      id: "C1_background_then_plan",
      description: "第一轮仅提供链接+文字背景，第二轮再要求规划（模拟真实多轮对话）",
      turns: [
        {
          id: "C1_t1_background",
          userMessage:
            "先把资料备查：域名说明见 https://example.com/ ，项目简称 DNS-宣贯，对接人小王。**这周先消化资料，不用出任务表。**",
          expectToolsInclude: ["read_url"],
          expectDraftJson: false,
          expectOutboundAny: [/Example|背景|DNS|宣贯|小王|收到|已读|消化|先不/i],
          minOutboundLength: 20,
        },
        {
          id: "C1_t2_plan",
          userMessage:
            "前面背景你已经看过了。现在请按 Example Domain 那条说明，规划一条内部 Reserved TLD 宣贯任务，6/30 前完成。",
          expectOutboundAny: [/Example|Reserved|宣贯|域名|6\/30|6月30/i],
          minOutboundLength: 20,
        },
      ],
    },
  ];
}

async function runInfraPhase(): Promise<Array<{ id: string; pass: boolean; failReason?: string }>> {
  const results = [];
  for (const c of buildInfraCases()) {
    if (FILTER && !c.id.startsWith(FILTER) && c.id !== FILTER) continue;
    process.stdout.write(`[${c.id}] ... `);
    try {
      const reasons = await c.run();
      const pass = reasons.length === 0;
      results.push({ id: c.id, pass, failReason: reasons.join("; ") || undefined });
      console.log(pass ? "PASS" : `FAIL :: ${reasons.join("; ")}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: c.id, pass: false, failReason: msg });
      console.log(`FAIL :: ${msg}`);
    }
  }
  return results;
}

async function runOneLlmTurn(
  session: PlanSession,
  def: LlmScenario,
  clientConfig: ReturnType<typeof buildClient>,
  label: string,
): Promise<{ pass: boolean; ms: number; tools: string[]; failReason?: string; traceId?: string; turn: Awaited<ReturnType<typeof runDingtalkLikeTurn>> }> {
  const naturalHits = assertNaturalUserMessage(def.userMessage);
  if (naturalHits.length) {
    console.log(`[${label}] FAIL :: ${naturalHits.join("; ")}`);
    return {
      pass: false,
      ms: 0,
      tools: [],
      failReason: naturalHits.join("; "),
      turn: {
        traceId: "",
        tools: [],
        messages: [],
        outboundMessage: "",
        ms: 0,
        hasDraftJson: false,
        assignState: { ok: true, state: "none" },
        publishOk: false,
      },
    };
  }

  process.stdout.write(`[${label}] ... `);
  const turn = await runDingtalkLikeTurn(session, def.userMessage, {
    clientConfig,
    senderStaffId: MGR,
    actorName: "测评主管",
    enableDingtalkPreRetries: true,
  });
  const reasons = [
    ...assertReadUrlTurn(turn, def),
    ...assertReadUrlAssistantHygiene(turn.outboundMessage),
  ];
  const pass = reasons.length === 0;
  appendTurnHistory(session, def.userMessage, turn.outboundMessage);
  console.log(
    `${pass ? "PASS" : "FAIL"} ${turn.ms}ms tools=[${turn.tools.join(",")}]` +
      (reasons.length ? ` :: ${reasons.join("; ")}` : ""),
  );
  return {
    pass,
    ms: turn.ms,
    tools: turn.tools,
    traceId: turn.traceId,
    failReason: reasons.join("; ") || undefined,
    turn,
  };
}

async function runLlmPhase(
  clientConfig: ReturnType<typeof buildClient>,
): Promise<Array<{ id: string; pass: boolean; ms: number; tools: string[]; failReason?: string; traceId?: string }>> {
  const store = createPlanSessionStore();
  const session = store.loadOrCreate("eval:read-url");
  const results = [];

  for (const def of buildLlmScenarios()) {
    if (FILTER && !def.id.startsWith(FILTER) && def.id !== FILTER) continue;

    resetSessionForScenario(session);
    const r = await runOneLlmTurn(session, def, clientConfig, def.id);
    store.save(session);
    results.push({
      id: def.id,
      pass: r.pass,
      ms: r.ms,
      tools: r.tools,
      traceId: r.traceId,
      failReason: r.failReason,
    });
  }
  return results;
}

async function runLlmChainsPhase(
  clientConfig: ReturnType<typeof buildClient>,
): Promise<Array<{ id: string; pass: boolean; turns: Array<{ id: string; pass: boolean; ms: number; tools: string[]; failReason?: string }> }>> {
  const store = createPlanSessionStore();
  const chainResults = [];

  for (const chain of buildLlmChains()) {
    if (FILTER && !chain.id.startsWith(FILTER) && chain.id !== FILTER) continue;

    console.log(`\n--- chain ${chain.id}: ${chain.description} ---`);
    const session = store.loadOrCreate(`eval:read-url:${chain.id}`);
    resetSessionForScenario(session);
    const turnResults = [];
    let chainPass = true;

    for (const turnDef of chain.turns) {
      if (FILTER && !turnDef.id.startsWith(FILTER) && turnDef.id !== FILTER && chain.id !== FILTER) {
        continue;
      }
      const r = await runOneLlmTurn(session, turnDef, clientConfig, turnDef.id);
      turnResults.push({
        id: turnDef.id,
        pass: r.pass,
        ms: r.ms,
        tools: r.tools,
        failReason: r.failReason,
      });
      if (!r.pass) chainPass = false;
    }

    store.save(session);
    chainResults.push({ id: chain.id, pass: chainPass, turns: turnResults });
    console.log(`--- chain ${chain.id}: ${chainPass ? "PASS" : "FAIL"} ---\n`);
  }

  return chainResults;
}

async function main() {
  bootstrap();

  console.log("=== read_url Full Eval (production-parity) ===");
  console.log(`prompt: ${QWEN_PLANNER_PROMPT_VERSION}`);
  console.log(`parity: ${formatEvalProductionParitySummary()}`);
  console.log(`READ_URL_ENABLED=${process.env.READ_URL_ENABLED}`);
  if (FILTER) console.log(`filter: ${FILTER}`);
  console.log("");

  runVitest("read_url unit tests", [
    "tests/security/url-fetch-guard.test.ts",
    "tests/integrations/url-fetch/fetch-url-content.test.ts",
    "tests/agent/tools/read-url.test.ts",
    "tests/integrations/dingtalk/extract-message-text.test.ts",
  ]);

  const infraResults = await runInfraPhase();
  const infraFailed = infraResults.filter((r) => !r.pass).length;

  let llmResults: Awaited<ReturnType<typeof runLlmPhase>> = [];
  let llmChainResults: Awaited<ReturnType<typeof runLlmChainsPhase>> = [];
  let llmSkipped = false;
  let llmFailed = 0;
  let chainFailed = 0;

  if (!process.env.QWEN_API_KEY?.trim()) {
    console.log("\n[LLM phase] SKIPPED — missing QWEN_API_KEY");
    llmSkipped = true;
  } else {
    await seedDirectory();
    const clientConfig = buildClient();
    console.log("\n========== LLM scenarios (dingtalk-like turn) ==========\n");
    llmResults = await runLlmPhase(clientConfig);
    llmFailed = llmResults.filter((r) => !r.pass).length;

    console.log("\n========== LLM multi-turn chains (background → plan) ==========\n");
    llmChainResults = await runLlmChainsPhase(clientConfig);
    chainFailed = llmChainResults.filter((c) => !c.pass).length;
  }

  const summary = {
    prompt: QWEN_PLANNER_PROMPT_VERSION,
    mode: "read_url_full_eval",
    parity: formatEvalProductionParitySummary(),
    infra: infraResults,
    llm: llmResults,
    llmChains: llmChainResults,
    llmSkipped,
    pass: infraFailed === 0 && (llmSkipped || (llmFailed === 0 && chainFailed === 0)),
  };
  writeFileSync(join(EVAL_DIR, "eval-summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== read_url Eval Summary ===");
  console.log(`infra: ${infraResults.length - infraFailed}/${infraResults.length} passed`);
  if (!llmSkipped) {
    console.log(`llm:   ${llmResults.length - llmFailed}/${llmResults.length} passed`);
    console.log(`chains: ${llmChainResults.length - chainFailed}/${llmChainResults.length} passed`);
  }
  console.log(`report: ${join(EVAL_DIR, "eval-summary.json")}`);

  if (infraFailed > 0 || llmFailed > 0 || chainFailed > 0) {
    process.exit(1);
  }
  console.log("\n=== read_url Eval: ALL PASSED ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
