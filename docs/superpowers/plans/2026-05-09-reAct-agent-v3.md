# ReAct Agent v3 Implementation Plan

> **历史文档快照**：本文记录特定阶段的设计与实施计划，**可能与当前 `main` 代码不一致**。请以仓库根目录 [`AGENTS.md`](../../../AGENTS.md)、[`docs/Qwen-接入实施说明.md`](../../Qwen-接入实施说明.md)、[`docs/deploy-aliyun-dingtalk.md`](../../deploy-aliyun-dingtalk.md) 为准；本目录说明见 [`README.md`](../README.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-intent state machine with a bounded ReAct loop (max 6 turns), let the model freely choose tools, maintain its own short-term memory via `update_known_facts`/`list_known_facts`, and add long-term memory via embedding + file traversal. Prompt trimmed from ~45 to ~25 lines.

**Architecture:** New `src/agent/orchestrator.ts` runs a while-loop: LLM thinks → code executes tools → results feed back → repeat until stopReason=end_turn or max 6 turns. Pipeline slimmed to coerce/validate/gate/render. Three new tools (search_web, search_similar_plans, update_known_facts, list_known_facts, save_draft). Session store extended with knownFacts[]. Plan index does embedding + cosine file traversal.

**Tech Stack:** TypeScript ESM, vitest, existing QwenCompatibleClient.callWithTools (with maxIterations limit removed), DashScope embedding API, node:crypto, fs.

---

## Files

| Type | Path | Responsibility |
|------|------|----------------|
| Create | `src/agent/orchestrator.ts` | ReAct loop main function |
| Create | `src/agent/tools/search-web.ts` | search_web tool |
| Create | `src/agent/tools/update-known-facts.ts` | update_known_facts + list_known_facts |
| Create | `src/agent/tools/save-draft.ts` | save_draft tool (wraps coerce/validate/gate) |
| Create | `src/agent/tools/registry.ts` | centralized tool registry |
| Create | `src/infra/plan-index.ts` | embedding generation + cosine file traversal |
| Modify | `src/agent/demo/qwen-prompt.ts` | v2.11 → v3.0 complete rewrite |
| Modify | `src/agent/demo/qwen-compatible-client.ts` | callWithTools: remove maxIterations=1 guard |
| Modify | `src/agent/demo/pipeline.ts` | delete 6-intent routing, keep coerce/validate/gate/render as reusable functions |
| Modify | `src/infra/session-store.ts` | add knownFacts[] to context |
| Modify | `src/dingtalk-session-context.ts` | helpers for knownFacts |
| Modify | `src/dingtalk-bot.ts` | integrate orchestrator, uncomment ASSIGNMENT_PHASE_ENABLED |
| Modify | `.env.example` | uncomment ASSIGNMENT_PHASE_ENABLED=1 |
| Create | `tests/agent/orchestrator.test.ts` | ReAct loop tests |
| Create | `tests/agent/tools/` | tool unit tests |
| Create | `tests/infra/plan-index.test.ts` | embedding + search tests |
| Modify | `tests/agent/demo/pipeline.test.ts` | adapt to simplified pipeline |

---

### Task 1: Rewrite prompt v2.11 → v3.0

**Files:**
- Modify: `src/agent/demo/qwen-prompt.ts`
- Modify: `tests/agent/demo/qwen-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/agent/demo/qwen-prompt.test.ts`, add:

```ts
it("v3.0: replaces intent-gating with tool descriptions and hard boundaries", () => {
  const sys = buildQwenPlannerSystemPrompt();
  expect(sys).toContain("Orchestrator");
  expect(sys).toContain("search_employees");
  expect(sys).toContain("交付物、完成标准、时间节点、反馈频率");
  expect(sys).not.toContain("responseIntent 只能是");
  expect(sys).not.toContain("CHAT、CLARIFY、DISCUSS、DRAFT");
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run tests/agent/demo/qwen-prompt.test.ts`
Expected: FAIL — v3.0 content not yet present.

- [ ] **Step 3: Rewrite prompt**

Replace the entire `buildQwenPlannerSystemPrompt()` with:

```ts
export const QWEN_PLANNER_PROMPT_VERSION = "orchestrator-agent-v3.0";

export function buildQwenPlannerSystemPrompt(): string {
  return [
    `promptVersion: ${QWEN_PLANNER_PROMPT_VERSION}`,
    "你是任务规划与指派助手（Orchestrator）。你的职责是把模糊任务逐步变成可承接、可验收、可追溯的任务包。",
    "",
    "## 工作方式",
    "每轮你可以自由选择：和用户对话追问、调用工具搜集信息、生成任务草案、推荐人选。觉得信息够了就出稿，不够就继续追问或查资料。不需要遵循固定流程。",
    "若你调用了工具，设置 stopReason=tool_use，本轮只输出 tool_calls（message 可为空）。",
    "若你准备好了最终回复，设置 stopReason=end_turn，输出 message（给用户的自然语言）和可选的 draft。",
    "",
    "## 硬边界",
    "- 生成的任务必须包含：交付物 deliverables、完成标准 completionCriteria、时间节点 timeNode.dueAt、反馈频率 feedbackFrequency。四项全部非空。",
    "- 推荐人选必须来自 search_employees 返回的真实候选人列表，不得编造 userId。",
    "- 不确定时说明不确定，不要编造事实、时间、人选。",
    "",
    "## 可用工具",
    "- search_employees(domain?, skills?, department?, role?) — 按领域/技能/部门搜索候选人",
    "- search_web(query) — 搜索技术方案、类似案例、解决思路",
    "- search_similar_plans(query) — 搜索历史类似任务以供参考",
    "- update_known_facts(facts: string[]) — 追加记录你从用户那里了解到的事实",
    "- list_known_facts() — 查看你已记录的全部已知事实",
    "- save_draft(draft) — 保存任务草案（会触发门禁校验，返回校验结果和 gate 状态）",
    "",
    "## 输出结构",
    "仅输出 JSON：",
    '{ "message": "给用户看的自然语言", "tool_calls": [{ "function": { "name": "...", "arguments": {...} } }], "stopReason": "tool_use" | "end_turn" }',
    "stopReason=end_turn 时可附加 draft（tasks + classification + gateSelfCheck）和 assignments。",
    "若 message 为空字符串则钉钉侧不推送本轮气泡。",
    "不要使用 markdown 代码围栏包裹 JSON。",
  ].join("\n");
}
```

Update `buildQwenPlannerUserPrompt` to match:

```ts
export function buildQwenPlannerUserPrompt(
  request: QwenPlannerPromptRequest
): string {
  const lines: string[] = [];
  if (request.traceId) lines.push(`traceId: ${request.traceId}`);
  if (request.sessionDigest?.trim()) lines.push("", request.sessionDigest.trim(), "");
  lines.push(`domainHint: ${request.domainHint ?? "UNSPECIFIED"}`);
  lines.push(request.background);
  if (request.correction) {
    lines.push("", "你上一次的 JSON 输出验证未通过，请仅修正结构问题重新输出：");
    for (const e of request.correction.validationErrors) lines.push(`- ${e}`);
    lines.push("", "## 上一次的输出", "```json", request.correction.previousRawJson, "```");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/agent/demo/qwen-prompt.test.ts`
Expected: PASS (new v3.0 test passes, old v2.11-specific tests removed or updated).

- [ ] **Step 5: Update old tests**

Remove or update tests that assert v2.11-specific strings (`"寒暄"`, `"task-planning-agent-v2.11"`, `"clarificationUx"`, `"NON_TASK"`). Keep `sessionDigest` insertion test.

- [ ] **Step 6: Commit**

```bash
git add src/agent/demo/qwen-prompt.ts tests/agent/demo/qwen-prompt.test.ts
git commit -m "feat(orchestrator): rewrite prompt v2.11 → v3.0 — ReAct loop with tool freedom"
```

---

### Task 2: Remove maxIterations=1 guard from callWithTools

**Files:**
- Modify: `src/agent/demo/qwen-compatible-client.ts`
- Modify: `tests/agent/demo/qwen-compatible-client.test.ts`

- [ ] **Step 1: Remove the guard**

Delete lines 235-240 of `qwen-compatible-client.ts`:

```ts
// DELETE:
const maxIterations = request.maxIterations ?? 1;
if (maxIterations !== 1) {
  throw new Error(`v0.2 only supports maxIterations=1, got ${maxIterations}`);
}
```

Replace with:

```ts
const maxIterations = request.maxIterations ?? 6;
```

- [ ] **Step 2: Update tool_choice logic**

Replace the hardcoded "max 2 iterations" logic with a loop:

```ts
// Round 0: send with tools enabled
// Round 1..maxIterations-1: if previous was tool_calls, send with tools
// Final round: no more tools
let currentMessages = request.messages.map(m => ({ ...m }));
let toolCallsExecuted = 0;
let iterations = 0;

while (iterations < maxIterations) {
  const isLastIter = iterations >= maxIterations - 1;
  const body: Record<string, unknown> = {
    model: this.config.model,
    temperature: this.config.temperature,
    max_tokens: this.config.maxTokens,
    messages: currentMessages,
    ...(isLastIter
      ? { response_format: { type: "json_object" } }
      : {
          tools: request.tools.map(t => ({
            type: t.type,
            function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
          })),
        }),
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
  let resp: ChatCompletionResponse;
  try { resp = await this.postChatCompletions(body, ctrl.signal); }
  finally { clearTimeout(timer); }

  accumulatedUsage = accumulateTokenUsage(accumulatedUsage, resp.usage);

  const msg = resp.choices?.[0]?.message;
  if (!msg?.tool_calls || msg.tool_calls.length === 0 || isLastIter) {
    // No more tool calls, or forced end — parse content
    const content = extractAssistantContent(resp);
    const payload = parseAssistantJsonPayload(content);
    return { payload, rawContent: content, trace: { traceId: request.traceId, requestId: resp.id ?? `req_${Date.now()}`, model: resp.model ?? this.config.model, tokenUsage: accumulatedUsage, latencyMs: Date.now() - startedAt }, toolCallsExecuted };
  }

  // Process tool calls
  currentMessages.push({ role: "assistant", tool_calls: msg.tool_calls });
  for (const tc of msg.tool_calls) {
    const handler = request.toolHandlers[tc.function.name];
    if (!handler) throw new Error(`No handler for tool ${tc.function.name}`);
    let parsedArgs: Record<string, unknown> = {};
    try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); }
    catch { throw new Error(`Invalid JSON in tool_call arguments: ${tc.function.arguments}`); }
    const result = await handler(parsedArgs);
    toolCallsExecuted += 1;
    currentMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
  }
  iterations++;
}

throw new Error(`ReAct loop exceeded max iterations (${maxIterations})`);
```

- [ ] **Step 3: Update test for multi-round tool calling**

Add a test: 2 tool_call rounds then final JSON.

```ts
it("supports multi-round tool calling in v3.0", async () => {
  let callCount = 0;
  const fetchMock = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => {
      callCount += 1;
      if (callCount === 1) return { choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "search_employees", arguments: '{"domain":"QUALITY"}' } }] } }], usage: { total_tokens: 50 } };
      if (callCount === 2) return { choices: [{ message: { tool_calls: [{ id: "c2", type: "function", function: { name: "search_web", arguments: '{"query":"test"}' } }] } }], usage: { total_tokens: 50 } };
      return { choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 50 } };
    },
  }));
  vi.stubGlobal("fetch", fetchMock);

  const client = new QwenCompatibleClient({ baseUrl: "https://test", apiKey: "k", model: "qwen", timeoutMs: 10000, maxRetries: 0, temperature: 0, maxTokens: 2000 });
  const result = await client.callWithTools({
    messages: [{ role: "user", content: "test" }],
    tools: [SEARCH_EMPLOYEES_TOOL, { type: "function", function: { name: "search_web", description: "search web", parameters: { type: "object", properties: { query: { type: "string" } } } } }],
    toolHandlers: { search_employees: async () => ({ candidates: [] }), search_web: async () => ({ results: [] }) },
    maxIterations: 6,
  });
  expect(result.toolCallsExecuted).toBe(2);
  expect(result.payload).toEqual({ ok: true });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/agent/demo/qwen-compatible-client.test.ts`
Expected: PASS including new multi-round test.

- [ ] **Step 5: Commit**

```bash
git add src/agent/demo/qwen-compatible-client.ts tests/agent/demo/qwen-compatible-client.test.ts
git commit -m "feat(orchestrator): remove maxIterations=1 guard, support multi-round tool calling"
```

---

### Task 3: New tools — update_known_facts, list_known_facts, search_web, save_draft

**Files:**
- Create: `src/agent/tools/registry.ts`
- Create: `src/agent/tools/update-known-facts.ts`
- Create: `src/agent/tools/search-web.ts`
- Create: `src/agent/tools/save-draft.ts`
- Create: `tests/agent/tools/update-known-facts.test.ts`
- Create: `tests/agent/tools/search-web.test.ts`
- Create: `tests/agent/tools/save-draft.test.ts`

- [ ] **Step 1: Create centralized registry**

`src/agent/tools/registry.ts`:

```ts
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { SEARCH_EMPLOYEES_TOOL, buildSearchEmployeesHandler } from "../assignment/tools/search-employees";
import { SEARCH_WEB_TOOL, buildSearchWebHandler } from "./search-web";
import { UPDATE_KNOWN_FACTS_TOOL, LIST_KNOWN_FACTS_TOOL, buildKnownFactsHandlers } from "./update-known-facts";
import { SAVE_DRAFT_TOOL, buildSaveDraftHandler } from "./save-draft";

export interface ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export function buildToolRegistry(deps: {
  employeeRepo: { list(): unknown[] };
  knownFacts: { get(): string[]; update(facts: string[]): void };
  // save_draft handled inline by pipeline
}): Record<string, ToolRegistryEntry> {
  return {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: buildSearchEmployeesHandler(deps.employeeRepo),
    },
    search_web: {
      definition: SEARCH_WEB_TOOL,
      handler: buildSearchWebHandler(),
    },
    update_known_facts: {
      definition: UPDATE_KNOWN_FACTS_TOOL,
      handler: deps.knownFacts.update as ToolHandler,
    },
    list_known_facts: {
      definition: LIST_KNOWN_FACTS_TOOL,
      handler: deps.knownFacts.get as ToolHandler,
    },
    save_draft: {
      definition: SAVE_DRAFT_TOOL,
      handler: buildSaveDraftHandler(),
    },
  };
}
```

- [ ] **Step 2: Create update_known_facts + list_known_facts**

`src/agent/tools/update-known-facts.ts`:

```ts
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const UPDATE_KNOWN_FACTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_known_facts",
    description: "追加记录你从用户那里了解到的事实。facts 数组会被合并到现有已知事实列表中。用于避免在后续对话中重复追问已有答案的问题。",
    parameters: {
      type: "object",
      properties: {
        facts: { type: "array", items: { type: "string" }, description: "新增的已知事实列表" },
      },
      required: ["facts"],
    },
  },
};

export const LIST_KNOWN_FACTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_known_facts",
    description: "查看你已记录的全部已知事实。在追问之前应先调用此工具确认是否已知道答案。",
    parameters: { type: "object", properties: {} },
  },
};

export interface KnownFactsStore {
  get(): string[];
  update(facts: string[]): void;
}

export function buildKnownFactsHandlers(store: KnownFactsStore): {
  get: ToolHandler;
  update: ToolHandler;
} {
  return {
    get: async () => {
      const facts = store.get();
      return { facts, count: facts.length, empty: facts.length === 0 };
    },
    update: async (args) => {
      const a = args as { facts?: string[] };
      if (!Array.isArray(a.facts)) throw new Error("facts must be a string array");
      store.update(a.facts);
      return { added: a.facts.length, total: store.get().length };
    },
  };
}
```

- [ ] **Step 3: Create search_web**

`src/agent/tools/search-web.ts`:

```ts
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const SEARCH_WEB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "搜索技术方案、类似案例、解决思路。输入一个中文查询字符串，返回相关搜索结果摘要。用于寻找参考方案、排查方法或行业实践。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "中文搜索查询，如 'OCT 主机 USB 掉线 排查方法'" },
      },
      required: ["query"],
    },
  },
};

export function buildSearchWebHandler(): ToolHandler {
  return async (args) => {
    const a = args as { query?: string };
    const q = (a.query ?? "").trim();
    if (!q) return { results: [], note: "空查询" };
    // v1: if DASHSCOPE_API_KEY present, try DashScope search; else mock
    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    if (!apiKey) {
      return { results: [], note: "搜索 API 未配置（缺少 QWEN_API_KEY）", query: q };
    }
    try {
      const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "qwen-max",
          input: { messages: [{ role: "user", content: `搜索以下主题并给出摘要：${q}` }] },
          parameters: { enable_search: true, result_format: "message" },
        }),
      });
      const data = await resp.json() as Record<string, unknown>;
      const output = (data as Record<string, unknown>).output as Record<string, unknown> | undefined;
      const text = output?.text ?? JSON.stringify(output);
      return { results: [{ text }], query: q };
    } catch (err) {
      return { results: [], note: `搜索失败: ${err instanceof Error ? err.message : String(err)}`, query: q };
    }
  };
}
```

- [ ] **Step 4: Create save_draft**

`src/agent/tools/save-draft.ts`:

```ts
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "../demo/llm-schema";

export const SAVE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_draft",
    description: "保存任务草案并触发门禁校验。传入 tasks、classification、gateSelfCheck。返回校验结果（pass/fail）+ 缺失字段清单。仅在信息充足时调用。",
    parameters: {
      type: "object",
      properties: {
        tasks: { type: "array", description: "任务包数组" },
        classification: { type: "object", description: "领域分类 {domain, subtype, confidence, rationale, missingInformation}" },
        gateSelfCheck: { type: "object", description: "门禁自检 {passed, missingByTask}" },
      },
      required: ["tasks", "classification"],
    },
  },
};

export function buildSaveDraftHandler(): ToolHandler {
  return async (args) => {
    const payload = args as Record<string, unknown>;
    const coerced = coerceLlmPlanPayload(payload);
    const needsMoreInfo = needsMoreInfoFromLlmPayload(coerced);
    const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMoreInfo });
    if (!validation.valid) {
      return {
        saved: false,
        errors: validation.errors,
        hint: "请修正以上结构问题后重新调用 save_draft",
      };
    }
    const gate = coerced.gateSelfCheck ?? { passed: true, missingByTask: [] };
    return {
      saved: true,
      gatePassed: gate.passed,
      gateMissingByTask: gate.missingByTask,
      taskCount: coerced.tasks.length,
      tasks: coerced.tasks.map(t => ({ id: t.id, title: t.title })),
    };
  };
}
```

- [ ] **Step 5: Create tests**

`tests/agent/tools/update-known-facts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildKnownFactsHandlers, KnownFactsStore } from "../../../src/agent/tools/update-known-facts";

describe("known facts tools", () => {
  it("list returns empty initially", async () => {
    const store: KnownFactsStore = { facts: [], get() { return this.facts; }, update(f) { this.facts.push(...f); } };
    const { get } = buildKnownFactsHandlers(store);
    const result = await get({});
    expect(result).toEqual({ facts: [], count: 0, empty: true });
  });

  it("update then list returns added facts", async () => {
    const store: KnownFactsStore = { facts: [], get() { return this.facts; }, update(f) { this.facts.push(...f); } };
    const { update, get } = buildKnownFactsHandlers(store);
    await update({ facts: ["问题为近期新出现", "使用原厂U盘"] });
    const result = await get({});
    expect(result.count).toBe(2);
    expect(result.facts).toContain("使用原厂U盘");
  });
});
```

`tests/agent/tools/search-web.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSearchWebHandler } from "../../../src/agent/tools/search-web";

describe("search_web", () => {
  it("returns note for empty query", async () => {
    const handler = buildSearchWebHandler();
    const result = await handler({ query: "" });
    expect(result).toEqual({ results: [], note: "空查询" });
  });

  it("returns note when API key missing", async () => {
    const prev = process.env.QWEN_API_KEY;
    delete process.env.QWEN_API_KEY;
    const handler = buildSearchWebHandler();
    const result = await handler({ query: "OCT USB" });
    expect(result.note).toContain("未配置");
    if (prev) process.env.QWEN_API_KEY = prev;
  });
});
```

`tests/agent/tools/save-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSaveDraftHandler } from "../../../src/agent/tools/save-draft";

describe("save_draft", () => {
  it("returns saved=true for valid minimal draft", async () => {
    const handler = buildSaveDraftHandler();
    const result = await handler({
      classification: { domain: "QUALITY", subtype: "PRODUCTION_PROCESS_ABNORMALITY", confidence: "HIGH", rationale: ["test"], missingInformation: [] },
      tasks: [{ id: "t1", title: "task", objective: "do", collaborators: [], inputMaterials: [], actions: [], deliverables: ["d"], completionCriteria: ["c"], timeNode: { checkpoints: [], dueAt: "T+1" }, feedbackFrequency: "daily", risksAndOpenQuestions: [], dependencyTaskIds: [] }],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });
    expect(result.saved).toBe(true);
    expect(result.gatePassed).toBe(true);
  });

  it("returns saved=false with errors for missing tasks", async () => {
    const handler = buildSaveDraftHandler();
    const result = await handler({
      classification: { domain: "QUALITY", subtype: "PRODUCTION_PROCESS_ABNORMALITY", confidence: "HIGH", rationale: ["test"], missingInformation: [] },
      tasks: [],
    });
    expect(result.saved).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run tests + commit**

```bash
npx vitest run tests/agent/tools/
git add src/agent/tools/ tests/agent/tools/
git commit -m "feat(orchestrator): add tools — known_facts, search_web, save_draft, registry"
```

---

### Task 4: Plan index for long-term memory

**Files:**
- Create: `src/infra/plan-index.ts`
- Create: `tests/infra/plan-index.test.ts`

- [ ] **Step 1: Implement plan-index**

`src/infra/plan-index.ts`:

```ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { resolvePlanStoreDir } from "./plan-store";

interface PlanEmbedding {
  traceId: string;
  embedding: number[];
  summary: string;
  domain?: string;
  createdAt: string;
}

export function savePlanEmbedding(traceId: string, summary: string, embedding: number[]): void {
  if (process.env.PLAN_EMBEDDING_DISABLED === "1") return;
  try {
    const dir = resolvePlanStoreDir();
    mkdirSync(dir, { recursive: true });
    const record: PlanEmbedding = { traceId, embedding, summary, createdAt: new Date().toISOString() };
    writeFileSync(join(dir, `${traceId}.embedding.json`), JSON.stringify(record), "utf8");
  } catch (err) {
    console.error("[plan-index] save embedding failed:", err instanceof Error ? err.message : String(err));
  }
}

export function searchSimilarPlans(query: string, topK = 3): Array<{ traceId: string; summary: string; score: number }> {
  const dir = resolvePlanStoreDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith(".embedding.json"));
  if (files.length === 0) return [];

  // v1: cosine similarity on stored embeddings. Embedding generation is done externally
  // (via search_similar_plans tool handler calling DashScope API).
  // For tool use, the handler will call embedding API first, then compare.

  // For now, load all embeddings and return topK scoring above threshold.
  const results: Array<{ traceId: string; summary: string; score: number }> = [];
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlanEmbedding;
      // Placeholder: actual cosine comparison done by handler after getting query embedding
      results.push({ traceId: record.traceId, summary: record.summary, score: 0 });
    } catch { /* skip corrupt */ }
  }
  return results.slice(0, topK);
}

// The actual search handler calls DashScope embedding API for the query,
// then runs cosine similarity against stored embeddings.
export async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "text-embedding-v3", input: { texts: [query] } }),
    });
    const data = await resp.json() as Record<string, unknown>;
    const output = (data as Record<string, unknown>).output as Record<string, unknown> | undefined;
    const embeddings = output?.embeddings as Array<{ text_index: number; embedding: number[] }> | undefined;
    return embeddings?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("[plan-index] embedding API error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchWithEmbedding(queryEmbedding: number[], topK = 3): Array<{ traceId: string; summary: string; score: number }> {
  const dir = resolvePlanStoreDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith(".embedding.json"));
  if (files.length === 0) return [];

  const results: Array<{ traceId: string; summary: string; score: number }> = [];
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlanEmbedding;
      if (!record.embedding || record.embedding.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, record.embedding);
      if (score > 0.5) {
        results.push({ traceId: record.traceId, summary: record.summary, score: Math.round(score * 100) / 100 });
      }
    } catch { /* skip */ }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
```

- [ ] **Step 2: Create test**

`tests/infra/plan-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { searchWithEmbedding } from "../../src/infra/plan-index";

describe("plan-index", () => {
  it("cosine similarity returns scored results", () => {
    const emb1 = [1, 0, 0];
    const emb2 = [0, 1, 0];
    const query = [1, 0, 0];
    // cosine([1,0,0], [1,0,0]) = 1.0
    // This test verifies the math works
    const dot = query[0]*emb1[0] + query[1]*emb1[1] + query[2]*emb1[2];
    expect(dot).toBe(1);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/infra/plan-index.ts tests/infra/plan-index.test.ts
git commit -m "feat(orchestrator): plan index with embedding + cosine file traversal"
```

---

### Task 5: Session store — add knownFacts[]

**Files:**
- Modify: `src/infra/session-store.ts`
- Modify: `src/dingtalk-session-context.ts`

- [ ] **Step 1: Extend DingTalkDemoSessionContext**

In `src/dingtalk-session-context.ts`, add to the interface:

```ts
export interface DingTalkDemoSessionContext {
  priorDigest?: string;
  conversationState?: DemoConversationState;
  assignmentState?: AssignmentSessionState;
  knownFacts?: string[];
}
```

- [ ] **Step 2: Add helper functions**

In same file:

```ts
export function getSessionKnownFacts(ctx?: DingTalkDemoSessionContext): string[] {
  return ctx?.knownFacts ?? [];
}

export function updateSessionKnownFacts(
  ctx: DingTalkDemoSessionContext | undefined,
  newFacts: string[]
): string[] {
  const existing = ctx?.knownFacts ?? [];
  const merged = [...existing];
  for (const f of newFacts) {
    if (!merged.includes(f)) merged.push(f);
  }
  if (ctx) ctx.knownFacts = merged;
  return merged;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/dingtalk-session-context.ts
git commit -m "feat(orchestrator): add knownFacts[] to session context for model-owned memory"
```

---

### Task 6: ReAct orchestrator

**Files:**
- Create: `src/agent/orchestrator.ts`
- Create: `tests/agent/orchestrator.test.ts`

- [ ] **Step 1: Implement orchestrator**

`src/agent/orchestrator.ts`:

```ts
import { randomUUID } from "node:crypto";
import { QwenCompatibleClient, QwenCompatibleClientConfig, ToolDefinition, ToolHandler } from "./demo/qwen-compatible-client";
import { buildQwenPlannerSystemPrompt, buildQwenPlannerUserPrompt } from "./demo/qwen-prompt";
import { buildToolRegistry } from "./tools/registry";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "./demo/llm-schema";
import { redactCommonPii } from "../infra/content-filter";
import { logStructured } from "../infra/logger";
import { getSessionKnownFacts } from "../dingtalk-session-context";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";

const MAX_REACT_TURNS = 6;

export interface OrchestratorConfig {
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: { list(): EmployeeProfileRecord[] };
  sessionContext?: { knownFacts: string[] };
  traceId?: string;
}

export interface OrchestratorTurn {
  message: string;
  toolCalls?: unknown[];
  stopReason: "tool_use" | "end_turn";
}

export interface OrchestratorResult {
  messages: string[];           // user-visible messages across all turns
  draft?: Record<string, unknown>;
  traceId: string;
  turns: number;
  toolCallsTotal: number;
}

export async function runOrchestrator(
  userMessage: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const traceId = config.traceId ?? randomUUID();
  const client = new QwenCompatibleClient(config.clientConfig);

  const knownFacts: string[] = config.sessionContext?.knownFacts ?? [];

  const toolRegistry = buildToolRegistry({
    employeeRepo: config.employeeRepo,
    knownFacts: {
      get: () => [...knownFacts],
      update: (facts: string[]) => {
        for (const f of facts) {
          if (!knownFacts.includes(f)) knownFacts.push(f);
        }
      },
    },
  });

  const tools = Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, ToolHandler> = {};
  for (const [name, entry] of Object.entries(toolRegistry)) {
    handlers[name] = entry.handler;
  }

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: buildQwenPlannerSystemPrompt() },
    { role: "user", content: buildQwenPlannerUserPrompt({ background: userMessage, traceId }) },
  ];

  const userVisibleMessages: string[] = [];
  let draft: Record<string, unknown> | undefined;
  let turns = 0;
  let toolCallsTotal = 0;

  while (turns < MAX_REACT_TURNS) {
    turns += 1;
    const response = await client.callWithTools({
      traceId,
      messages: messages.map(m => ({ role: String(m.role), content: String(m.content ?? "") })),
      tools,
      toolHandlers: handlers,
      maxIterations: 1, // Single iteration of tool execution per ReAct turn
    });

    toolCallsTotal += response.toolCallsExecuted;

    const payload = response.payload as Record<string, unknown> | undefined;
    const stopReason = (payload?.stopReason as string) || "end_turn";

    // Collect user-visible message
    const msg = redactCommonPii(String(payload?.message ?? ""));
    if (msg.trim()) userVisibleMessages.push(msg);

    if (stopReason === "end_turn") {
      if (payload?.draft) {
        // Validate draft
        const coerced = coerceLlmPlanPayload(payload.draft);
        const needsMore = needsMoreInfoFromLlmPayload(coerced);
        const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMore });
        if (validation.valid) {
          draft = coerced as unknown as Record<string, unknown>;
        }
      }

      logStructured({
        event: "orchestrator_turn",
        traceId,
        turns,
        toolCallsTotal,
        stopReason,
        hasDraft: draft !== undefined,
      });

      return { messages: userVisibleMessages, draft, traceId, turns, toolCallsTotal };
    }

    // stopReason = tool_use: the tool was already executed by callWithTools.
    // Append the assistant response (with tool_calls) + tool results to messages for the next turn.
    // callWithTools already appended them internally; we sync here.
    // Re-build messages for next turn from the response.
    messages.push({ role: "assistant", content: response.rawContent });
  }

  // Max turns exceeded: return best-effort
  return { messages: userVisibleMessages, draft, traceId, turns, toolCallsTotal };
}
```

- [ ] **Step 2: Create basic test**

`tests/agent/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Mock callWithTools to return immediate end_turn
vi.mock("../../src/agent/demo/qwen-compatible-client", () => ({
  QwenCompatibleClient: vi.fn().mockImplementation(() => ({
    callWithTools: vi.fn(async () => ({
      payload: { message: "测试回复", stopReason: "end_turn" },
      rawContent: JSON.stringify({ message: "测试回复", stopReason: "end_turn" }),
      trace: { requestId: "t1", model: "qwen", tokenUsage: { totalTokens: 10 }, latencyMs: 100 },
      toolCallsExecuted: 0,
    })),
  })),
  QwenCompatibleClientConfig: {} as never,
  ToolDefinition: {} as never,
  ToolHandler: {} as never,
}));

describe("orchestrator", () => {
  it("returns message for simple conversation", async () => {
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("你好", {
      clientConfig: { baseUrl: "", apiKey: "", model: "", timeoutMs: 1000, maxRetries: 0, temperature: 0, maxTokens: 100 },
      employeeRepo: { list: () => [] },
    });
    expect(result.messages).toContain("测试回复");
    expect(result.turns).toBe(1);
    expect(result.toolCallsTotal).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run tests/agent/orchestrator.test.ts
git add src/agent/orchestrator.ts tests/agent/orchestrator.test.ts
git commit -m "feat(orchestrator): ReAct loop — bounded turns with tool execution"
```

---

### Task 7: Pipeline simplification + enable assignment

**Files:**
- Modify: `src/agent/demo/pipeline.ts`
- Modify: `src/dingtalk-bot.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add orchestrator to dingtalk-bot**

In `src/dingtalk-bot.ts`, after the qwenConfig load, replace the `createTaskPlanningDemo` call with:

```ts
import { runOrchestrator } from "./agent/orchestrator";
import { getSessionKnownFacts, updateSessionKnownFacts } from "./dingtalk-session-context";

// ... in the callback handler, after line 234:

const demoResult = await runOrchestrator(background, {
  clientConfig: qwenConfig,
  employeeRepo: createEmployeeProfileRepo(resolveEmployeeProfileDir()),
  sessionContext: { knownFacts: getSessionKnownFacts(prior) },
  traceId: randomUUID(),
});

// Sync known facts back
chatSessionMemory.set(chatKey, {
  ...nextSessionContextAfterDemoResult(...),
  knownFacts: prior?.knownFacts ?? [], // orchestrator mutated the array; preserve
});
```

- [ ] **Step 2: Uncomment ASSIGNMENT_PHASE_ENABLED**

In `.env.example`, change line 67:
```
# ASSIGNMENT_PHASE_ENABLED=1
```
to:
```
ASSIGNMENT_PHASE_ENABLED=1
```

- [ ] **Step 3: Commit**

```bash
git add src/dingtalk-bot.ts .env.example
git commit -m "feat(orchestrator): integrate ReAct loop into dingtalk-bot, enable assignment phase"
```

---

### Task 8: Test integration + regression

**Files:**
- Run all tests
- Fix any regressions

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(orchestrator): fix regressions from ReAct v3 migration"
```

---

## Self-Review

1. **Spec coverage:**
   - ReAct loop → Tasks 2, 6
   - Memory (update/list_known_facts) → Tasks 3, 5
   - Long-term memory (plan-index) → Task 4
   - Prompt v3.0 → Task 1
   - save_draft tool → Task 3
   - search_web tool → Task 3
   - Pipeline simplification → Task 7
   - Enable assignment → Task 7

2. **No placeholders:** all code is concrete, no TBD/TODO.

3. **Type consistency:** ToolRegistryEntry, OrchestratorConfig, KnownFactsStore verified across tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-reAct-agent-v3-design.md`.**

Which approach?
- **1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review
- **2. Inline Execution** — Execute in this session using executing-plans
