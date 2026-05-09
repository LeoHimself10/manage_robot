# Assignment and Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a `DRAFT_READY` turn (v2.11 `responseIntent` `DRAFT` / `REVISE_DRAFT`), run a second LLM pass to produce `AssignmentDraft`, persist it under `./data/`, expose a signed-URL Web workbench for manager overrides, append a DingTalk Markdown follow-up with links (mock interactive cards until DingTalk API permissions exist), and record append-only assignment events—aligned with `docs/superpowers/specs/2026-05-09-assignment-and-dispatch-design.md`.

## v0.2 Modifications (current execution)

四项关键调整（参见 spec v0.2 修订摘要）：

1. **Assignment 阶段异步**（影响 Task 9）：DRAFT_READY 立即返回主管草案；`runAssignmentRecommendation` 用 `void (async () => { ... })()` 后台执行；完成后通过 `sessionWebhook` 推送独立「分配建议」消息；后台失败仅写审计日志，不影响主链路。
2. **单轮 function calling 替代 prompt-only 候选人压缩**（影响 Tasks 5、6）：
   - `QwenCompatibleClient` 新增 `callWithTools({ messages, tools, toolHandlers, maxIterations })`，内部处理 OpenAI 兼容的 tool_call 协议；v0.2 限定 `maxIterations = 1`
   - 暴露唯一工具 `search_employees(domain?, skills?, department?, role?)`
   - LLM 第一轮仅 tool_call 不输出 content；第二轮带 tool result 返回 AssignmentDraft JSON
   - 工具实现见新增文件 `src/agent/assignment/tools/search-employees.ts`
3. **assignmentRecommender 加 1 轮 self-correction**（影响 Task 6）：schema validate 失败时把 errors 回传 LLM 修正；仍失败 → `ASSIGNMENT_GENERATION_FAILED`。
4. **compressProfile 保留 case outcome**（影响 Task 6 Step 3）：cases 段从 `taskType` 改为 `taskType -> outcome`。

执行注意：subagent 在跑 Tasks 5/6/9 时必须先读本 v0.2 段落，再读 task 正文；Tasks 1/2/3/4/7/8/10 不受 v0.2 影响。

---

**Architecture:** Keep `createTaskPlanningDemo` focused on planning; extend its result with `traceId` so downstream code can load `./data/plans/<traceId>.json`. New package `src/agent/assignment/` holds prompt + schema + runner + tools. New `src/integrations/repos/` holds file-backed repos (atomic JSON writes). New `src/security/` holds HMAC signed URLs and initiator whitelist. `src/dingtalk-bot.ts` orchestrates: whitelist → planning → (if `DRAFT_READY`) **async** assignment runner → second `sessionWebhook` push when ready → start optional HTTP server for Web UI on same process. No DB; **single-turn function calling** in v0.2 (LLM 调一次 `search_employees` 工具，再生成 JSON)。

**Tech Stack:** TypeScript (ESM), Node `http`, Vitest, existing `QwenCompatibleClient` extended for generic JSON messages, existing `dotenv` / `tsx` entrypoints.

**Baseline:** `main` already includes conversational intent v2.11 (`merge: feat/conversational-intent-agent`). Touch points: `src/dingtalk-bot.ts`, `src/dingtalk-session-context.ts`, `src/agent/demo/pipeline.ts`, `tests/agent/demo/pipeline.test.ts`.

---

## File structure (create / modify)

| Path | Responsibility |
| --- | --- |
| `src/agent/assignment/types.ts` | `AssignmentDraft`, `SubTaskAssignment`, `AssignmentCandidate`, risk flags (mirror spec §5.3) |
| `src/agent/assignment/assignment-schema.ts` | `coerceAssignmentDraft`, `validateAssignmentDraft` |
| `src/agent/assignment/assignment-prompt.ts` | `ASSIGNMENT_RECOMMENDER_PROMPT_VERSION`, `buildAssignmentSystemPrompt`, `buildAssignmentUserPayload` |
| `src/agent/assignment/run-assignment-recommendation.ts` | `runAssignmentRecommendation(input, deps)` — builds candidate compression, calls LLM, validates, saves draft repo |
| `src/agent/demo/qwen-compatible-client.ts` | Add `generateJsonFromMessages({ traceId, messages })` reusing fetch + SSE assembly |
| `src/integrations/repos/employee-profile-repo.ts` | File-backed list/get from `EMPLOYEE_PROFILE_DIR` |
| `src/integrations/repos/assignment-draft-repo.ts` | Save/load `<planId>.assignment.json` under `ASSIGNMENT_DRAFT_DIR` |
| `src/integrations/repos/assignment-event-repo.ts` | Append JSON lines to `ASSIGNMENT_EVENTS_PATH` |
| `src/integrations/repos/card-state-repo.ts` | `cards/<outTrackId>.json` projection (minimal v1: manager card id only) |
| `src/integrations/dingtalk/assignment-card-mock.ts` | When `DINGTALK_ASSIGNMENT_MOCK=1`, log “would send card” + write `card-callbacks`-style line |
| `src/security/web-entry-token.ts` | Sign / verify `planId`, `userId`, `role`, `exp`, `nonce` with `ASSIGNMENT_WEB_SECRET` |
| `src/security/initiator-whitelist.ts` | `isInitiatorAllowed(senderStaffId)` from `TASK_INITIATOR_USER_IDS` or `TASK_INITIATOR_IDS_FILE` |
| `src/web/assignment-workbench.ts` | `handleAssignmentHttp(req, res)` — GET HTML form, POST JSON save draft |
| `fixtures/employees-seed.json` | Committed fake roster (~15–30 employees per spec §4.5); **not** under `./data/` |
| `scripts/seed-employee-profiles.ts` | Copies `fixtures/employees-seed.json` → `./data/employees/profiles/*.json` |
| `src/infra/assignment-env.ts` | Read env defaults per spec §10.8 |
| `src/dingtalk-session-context.ts` | Extend context type with optional `assignmentState` (spec §8.3) |
| `src/dingtalk-bot.ts` | Whitelist; post-draft assignment; merge Markdown; mount Web routes |
| `src/agent/demo/pipeline.ts` | Add `traceId` to every `TaskPlanningDemoResult` variant |
| `tests/...` | One test file per new unit (see tasks) |
| `.env.example` | New vars from spec §10.8 + whitelist + mock flags |
| `AGENTS.md` | Update “当前实现边界” when assignment ships (assignment phase ≠ full Harness assignment workflow) |

---

### Task 1: Expose `traceId` on `TaskPlanningDemoResult`

**Files:**
- Modify: `src/agent/demo/pipeline.ts` (type union + every `return {`)
- Modify: `tests/agent/demo/pipeline.test.ts` (assert `traceId` on sampled results)
- Modify: `tests/agent/demo/evaluator.test.ts` only if it constructs results without `traceId`

- [ ] **Step 1: Add failing test**

In `tests/agent/demo/pipeline.test.ts`, add:

```ts
it("DRAFT_READY includes traceId for downstream assignment", async () => {
  const result = await createTaskPlanningDemo(
    { background: "生产批次异常，需两天内初步分析", domainHint: "QUALITY" },
    { llmPlanner: async () => qualityLlmPlannerResponse({}) }
  );
  expect(result.status).toBe("DRAFT_READY");
  if (result.status !== "DRAFT_READY") throw new Error("expected draft");
  expect(result.traceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});
```

Use whatever planner stub the file already imports (`qualityLlmPlannerResponse` from `llm-fixtures`).

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/agent/demo/pipeline.test.ts`

Expected: TypeScript error or runtime: `traceId` missing on result.

- [ ] **Step 3: Add `traceId` to the union**

At top of `TaskPlanningDemoResult` definition in `src/agent/demo/pipeline.ts`, add `traceId: string` to **each** variant object type (six branches: `NEEDS_MORE_INFO`, `CONVERSATION`, `GENERATION_FAILED`, `DRAFT_READY`).

- [ ] **Step 4: Populate on every return**

Thread `traceId` from `const traceId = randomUUID();` into every `return { ... }` inside `createTaskPlanningDemo`, including early `NEEDS_MORE_INFO` from `checkInputQuality`, missing planner, validation failure, `CONVERSATION`, `DRAFT_READY`, and `catch` `GENERATION_FAILED`.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/agent/demo/pipeline.test.ts`

Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test` && `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/demo/pipeline.ts tests/agent/demo/pipeline.test.ts
git commit -m "feat(demo): expose traceId on all TaskPlanningDemoResult branches"
```

---

### Task 2: Assignment env defaults + `.env.example`

**Files:**
- Create: `src/infra/assignment-env.ts`
- Modify: `.env.example`
- Test: `tests/infra/assignment-env.test.ts`

- [ ] **Step 1: Implement env readers**

Create `src/infra/assignment-env.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAssignmentDraftDir(): string {
  return process.env.ASSIGNMENT_DRAFT_DIR?.trim() || "./data/plans";
}

export function resolveEmployeeProfileDir(): string {
  return process.env.EMPLOYEE_PROFILE_DIR?.trim() || "./data/employees/profiles";
}

export function resolveEmployeeFixtureSourcePath(): string {
  const env = process.env.EMPLOYEE_FIXTURE_SOURCE?.trim();
  if (env) return env;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/employees-seed.json");
}

export function resolveAssignmentEventsPath(): string {
  return process.env.ASSIGNMENT_EVENTS_PATH?.trim() || "./data/events/assignment-events.jsonl";
}

export function resolveCardCallbacksPath(): string {
  return process.env.CARD_CALLBACKS_PATH?.trim() || "./data/events/card-callbacks.jsonl";
}

export function resolveCardStateDir(): string {
  return process.env.CARD_STATE_DIR?.trim() || "./data/cards";
}

export function resolveAssignmentWebSecret(): string {
  const s = process.env.ASSIGNMENT_WEB_SECRET?.trim();
  if (!s) throw new Error("ASSIGNMENT_WEB_SECRET is required when assignment web UI is enabled");
  return s;
}

export function resolveAssignmentWebPort(): number {
  const n = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787");
  return Number.isFinite(n) && n > 0 ? n : 8787;
}

export function resolveAssignmentWebPublicBaseUrl(): string {
  const u = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim();
  if (!u) throw new Error("ASSIGNMENT_WEB_PUBLIC_BASE_URL is required for DingTalk links (e.g. https://bot.example.com)");
  return u.replace(/\/$/, "");
}

export function isDingtalkAssignmentMock(): boolean {
  const v = process.env.DINGTALK_ASSIGNMENT_MOCK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
```

- [ ] **Step 2: Add test**

`tests/infra/assignment-env.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveAssignmentDraftDir } from "../../src/infra/assignment-env";

describe("assignment-env", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it("defaults ASSIGNMENT_DRAFT_DIR", () => {
    delete process.env.ASSIGNMENT_DRAFT_DIR;
    expect(resolveAssignmentDraftDir()).toBe("./data/plans");
  });
});
```

- [ ] **Step 3: Append `.env.example` block**

Add commented lines per spec §10.8 plus:

```env
# --- Assignment phase (post DRAFT_READY) ---
# ASSIGNMENT_DRAFT_DIR=./data/plans
# EMPLOYEE_PROFILE_DIR=./data/employees/profiles
# EMPLOYEE_FIXTURE_SOURCE=./fixtures/employees-seed.json
# ASSIGNMENT_EVENTS_PATH=./data/events/assignment-events.jsonl
# CARD_CALLBACKS_PATH=./data/events/card-callbacks.jsonl
# CARD_STATE_DIR=./data/cards
# DINGTALK_ASSIGNMENT_MOCK=1
# TASK_INITIATOR_USER_IDS=user1,user2
# TASK_INITIATOR_IDS_FILE=./data/initiators.json
# ASSIGNMENT_PHASE_ENABLED=1
# ASSIGNMENT_WEB_SECRET=change-me-min-32-chars-random
# ASSIGNMENT_WEB_PORT=8787
# ASSIGNMENT_WEB_PUBLIC_BASE_URL=https://your-ecs-host
```

- [ ] **Step 4: Run tests + commit**

`npm test -- tests/infra/assignment-env.test.ts`

```bash
git add src/infra/assignment-env.ts tests/infra/assignment-env.test.ts .env.example
git commit -m "chore: add assignment phase env helpers and .env.example"
```

---

### Task 3: Committed employee fixture + seed script + profile repo

**Files:**
- Create: `fixtures/employees-seed.json` (array of profiles matching spec §9 `EmployeeProfile` minimal fields)
- Create: `scripts/seed-employee-profiles.ts` (tsx runnable)
- Create: `src/integrations/repos/employee-profile-repo.ts`
- Test: `tests/integrations/employee-profile-repo.test.ts`

- [ ] **Step 1: Add minimal `employees-seed.json`**

Create **10** fake employees (enough for tests; expand to 15–30 later). Example single element:

```json
{
  "userId": "emp_qa_001",
  "displayName": "张三",
  "department": "质量部",
  "role": "质量工程师",
  "selfProfile": {
    "skillTags": ["8D", "产线异常", "CAPA"],
    "strengths": ["根因分析", "跨部门沟通"],
    "boundaries": ["不做电气设计"],
    "cases": [
      {
        "taskType": "生产异常",
        "contribution": "主导批次隔离与复测范围",
        "deliverable": "异常报告初稿",
        "outcome": "按期关闭"
      }
    ],
    "tools": ["QMS"],
    "availability": { "capacityHint": "中等", "emergencyOk": true }
  }
}
```

Top-level file: `{ "profiles": [ ... ] }`.

- [ ] **Step 2: Seed script**

`scripts/seed-employee-profiles.ts`: read JSON, `mkdirSync` profile dir, for each profile `writeFileSync(join(dir, `${userId}.json`), JSON.stringify(profile, null, 2))`.

Add to `package.json` scripts: `"seed:employees": "tsx scripts/seed-employee-profiles.ts"`. Run: `npm run seed:employees`

- [ ] **Step 3: Repo implementation**

`src/integrations/repos/employee-profile-repo.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface EmployeeProfileRecord {
  userId: string;
  displayName: string;
  department: string;
  role: string;
  level?: string;
  managerUserId?: string;
  location?: string;
  selfProfile: {
    skillTags: string[];
    strengths: string[];
    boundaries: string[];
    cases: Array<{
      taskType: string;
      contribution: string;
      deliverable: string;
      outcome: string;
    }>;
    tools: string[];
    availability: {
      capacityHint?: string;
      emergencyOk?: boolean;
      rejectedTaskTypes?: string[];
    };
  };
}

export function createEmployeeProfileRepo(profileDir: string) {
  return {
    list(): EmployeeProfileRecord[] {
      const names = readdirSync(profileDir).filter((f) => f.endsWith(".json"));
      return names.map((n) =>
        JSON.parse(readFileSync(join(profileDir, n), "utf8")) as EmployeeProfileRecord
      );
    },
    get(userId: string): EmployeeProfileRecord | undefined {
      try {
        return JSON.parse(
          readFileSync(join(profileDir, `${userId}.json`), "utf8")
        ) as EmployeeProfileRecord;
      } catch {
        return undefined;
      }
    },
  };
}
```

- [ ] **Step 4: Test with temp dir**

Use `fs.mkdtempSync` + write two JSON files + assert `list().length === 2`.

- [ ] **Step 5: Commit**

```bash
git add fixtures/employees-seed.json scripts/seed-employee-profiles.ts src/integrations/repos/employee-profile-repo.ts tests/integrations/employee-profile-repo.test.ts
git commit -m "feat(assignment): employee fixtures and file profile repo"
```

---

### Task 4: Initiator whitelist

**Files:**
- Create: `src/security/initiator-whitelist.ts`
- Test: `tests/security/initiator-whitelist.test.ts`

- [ ] **Step 1: Implement**

```ts
import { readFileSync, existsSync } from "node:fs";

export function isTaskInitiatorAllowed(userId: string): boolean {
  const file = process.env.TASK_INITIATOR_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(arr)) {
      return arr.map(String).includes(userId);
    }
  }
  const raw = process.env.TASK_INITIATOR_USER_IDS?.trim();
  if (!raw) return true;
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return allow.has(userId);
}
```

Spec D4: empty env ⇒ allow all (dev-friendly); production sets whitelist.

- [ ] **Step 2: Tests**

- No env ⇒ `"any"` allowed true  
- `TASK_INITIATOR_USER_IDS=a,b` ⇒ only a,b  
- Temp file with `["x"]` ⇒ only x  

- [ ] **Step 3: Commit**

```bash
git add src/security/initiator-whitelist.ts tests/security/initiator-whitelist.test.ts
git commit -m "feat(security): task initiator whitelist for assignment phase"
```

---

### Task 5: Add function calling support to `QwenCompatibleClient`（v0.2）

**Files:**
- Modify: `src/agent/demo/qwen-compatible-client.ts`
- Modify: `tests/agent/demo/qwen-compatible-client.test.ts` (or new test file)

**目标：** 新增 `callWithTools` 方法，处理 OpenAI 兼容的 `tools` + `tool_calls` 协议；v0.2 限定单轮（`maxIterations=1`）。沿用现有 fetch + retry + SSE 拼装逻辑，但新方法非 stream（避免 stream + tool_call 协议复杂化）。

- [ ] **Step 1: 接口与类型**

```ts
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface CallWithToolsRequest {
  traceId?: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content?: string; tool_call_id?: string; tool_calls?: unknown[] }>;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  maxIterations?: number; // 默认 1
}

export interface CallWithToolsResult {
  payload: unknown;       // 最后一轮 assistant content 的 JSON.parse 结果
  rawContent: string;     // 最后一轮 assistant content 文本
  trace: InferenceTrace;  // 累计 tokenUsage / latency
  toolCallsExecuted: number;
}
```

- [ ] **Step 2: 实现 callWithTools**

伪代码（关键路径）：

```ts
async callWithTools(req: CallWithToolsRequest): Promise<CallWithToolsResult> {
  const maxIter = req.maxIterations ?? 1;
  const messages = [...req.messages];
  const traceStart = Date.now();
  let totalTokens = 0;
  let toolCallsExecuted = 0;
  let lastRequestId: string | undefined;
  let lastModel: string | undefined;

  for (let iter = 0; iter <= maxIter; iter += 1) {
    const body = {
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      messages,
      tools: req.tools,
      tool_choice: iter === 0 ? "auto" : "none", // v0.2：第二轮强制不再 tool_call
      response_format: iter === maxIter ? { type: "json_object" } : undefined,
    };
    const response = await this.postChatCompletions(body); // 抽出共用 fetch+retry
    lastRequestId = response.id;
    lastModel = response.model;
    totalTokens += response.usage?.total_tokens ?? 0;

    const choice = response.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error("Qwen response missing message");

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      if (iter >= maxIter) {
        throw new Error(`tool_calls returned at last iteration ${iter}; v0.2 limits to ${maxIter}`);
      }
      // 把 assistant tool_call 消息追加进 messages，然后逐个执行 handler
      messages.push({ role: "assistant", tool_calls: msg.tool_calls } as unknown as typeof messages[number]);
      for (const tc of msg.tool_calls) {
        const handler = req.toolHandlers[tc.function.name];
        if (!handler) throw new Error(`No handler for tool ${tc.function.name}`);
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || "{}");
        } catch {
          throw new Error(`Invalid tool_call arguments JSON: ${tc.function.arguments}`);
        }
        const result = await handler(parsedArgs);
        toolCallsExecuted += 1;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    if (msg.content) {
      const parsed = parseAssistantJsonPayload(msg.content);
      return {
        payload: parsed,
        rawContent: msg.content,
        trace: {
          traceId: req.traceId,
          requestId: lastRequestId ?? `req_${Date.now()}`,
          model: lastModel ?? this.config.model,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens },
          latencyMs: Date.now() - traceStart,
        },
        toolCallsExecuted,
      };
    }

    throw new Error("Qwen response had neither tool_calls nor content");
  }

  throw new Error("callWithTools exhausted maxIterations without final content");
}
```

- 复用 `postChatCompletions(body)`：把现有 `callChatCompletions` 中 fetch + retry + 错误处理抽出为通用方法，`generateStructuredPlan` 与 `callWithTools` 共用。
- v0.2 限定 stream=false（即使配置开启 SSE 也不影响 callWithTools；stream 与 tool_call 协议组合会显著增加复杂度，留待后续）。
- 第二轮强制 `tool_choice: "none"` 避免无限调用；如果模型仍返回 tool_calls 则报错走 self-correction。

- [ ] **Step 3: 单元测试**

测试场景（用 `vi.stubGlobal("fetch", ...)` mock 多轮 fetch）：

1. 单轮 tool_call → 第二轮纯 JSON 响应；断言 `toolCallsExecuted === 1` 且 `payload` 来自第二轮。
2. 模型未调工具直接出 JSON：`toolCallsExecuted === 0`，结果立即返回。
3. 第二轮还出 tool_call → 抛错（v0.2 限定单轮）。
4. tool_call args 是非法 JSON → 抛错。
5. handler 找不到 → 抛错。

- [ ] **Step 4: 提交**

```bash
git add src/agent/demo/qwen-compatible-client.ts tests/agent/demo/qwen-compatible-client.test.ts
git commit -m "feat(qwen): single-turn function calling support for assignment runner"
```

---

### Task 6: Assignment schema + prompt + runner（v0.2：function calling + self-correction + outcome 字段）

**Files:**
- Create: `src/agent/assignment/types.ts`
- Create: `src/agent/assignment/assignment-schema.ts`
- Create: `src/agent/assignment/assignment-prompt.ts`
- Create: `src/agent/assignment/tools/search-employees.ts`（v0.2 新增）
- Create: `src/agent/assignment/run-assignment-recommendation.ts`
- Test: `tests/agent/assignment/assignment-schema.test.ts`
- Test: `tests/agent/assignment/tools/search-employees.test.ts`（v0.2 新增）
- Test: `tests/agent/assignment/run-assignment-recommendation.test.ts`

- [ ] **Step 1: Types**

Mirror spec §5.3 TypeScript interfaces (`AssignmentDraft`, `SubTaskAssignment`, `AssignmentCandidate`, `AssignmentRiskFlag`, `Confidence`).

- [ ] **Step 2: Schema coerce/validate**

Implement `coerceAssignmentDraft(raw: unknown): AssignmentDraft` and `validateAssignmentDraft(d: AssignmentDraft): { valid: boolean; errors: string[] }`:

- Every `assignments[].taskId` must exist in input tasks
- `primary.userId` / alternates must exist in employee repo
- `confidence` ∈ `HIGH|MEDIUM|LOW`
- 风险类型 `risks[].type` ∈ `OVERLOAD | MISSING_PERMISSION | CROSS_DEPARTMENT | RECENT_REJECTION | INSUFFICIENT_EVIDENCE | OTHER`
- alternates 不应包含 primary.userId
- Required string fields non-empty

- [ ] **Step 3: search_employees tool（v0.2 新增）**

`src/agent/assignment/tools/search-employees.ts`：

```ts
import type { EmployeeProfileRecord } from "../../../integrations/repos/employee-profile-repo";
import type { ToolDefinition, ToolHandler } from "../../demo/qwen-compatible-client";

export const SEARCH_EMPLOYEES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_employees",
    description:
      "Search candidate employees by domain, skills, department, or role. " +
      "Use this ONCE at the start to retrieve a focused candidate list before generating AssignmentDraft. " +
      "Do not call this tool more than once.",
    parameters: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["QUALITY", "RD"],
          description: "Filter by task domain",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Required skill tags (any-of match)",
        },
        department: { type: "string" },
        role: { type: "string" },
      },
    },
  },
};

const DEFAULT_LIMIT = 30;

const DOMAIN_DEPARTMENT_HINTS: Record<string, string[]> = {
  QUALITY: ["质量部", "测试部", "供应商质量"],
  RD: ["研发部", "硬件部", "软件部", "结构部"],
};

export interface SearchEmployeesResult {
  candidates: string[]; // 压缩画像（每位一段）
  truncated: boolean;
  total: number;
}

export function compressProfile(p: EmployeeProfileRecord): string {
  // v0.2: cases 段保留 taskType -> outcome
  return [
    `${p.userId} ${p.displayName} | ${p.department} | ${p.role}`,
    `tags: ${p.selfProfile.skillTags.join(",")}`,
    `strengths: ${p.selfProfile.strengths.join(";")}`,
    `boundaries: ${p.selfProfile.boundaries.join(";")}`,
    `cases: ${p.selfProfile.cases.map((c) => `${c.taskType}->${c.outcome}`).join(",")}`,
    p.selfProfile.availability.capacityHint
      ? `availability: ${p.selfProfile.availability.capacityHint}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSearchEmployeesHandler(repo: { list(): EmployeeProfileRecord[] }): ToolHandler {
  return async (args) => {
    const a = args as {
      domain?: string;
      skills?: string[];
      department?: string;
      role?: string;
    };
    const all = repo.list();
    let filtered = all;

    if (a.domain) {
      const allowedDepts = DOMAIN_DEPARTMENT_HINTS[a.domain] ?? [];
      if (allowedDepts.length > 0) {
        filtered = filtered.filter((e) => allowedDepts.includes(e.department));
      }
    }
    if (a.department) {
      filtered = filtered.filter((e) => e.department === a.department);
    }
    if (a.role) {
      filtered = filtered.filter((e) => e.role === a.role);
    }
    if (a.skills && a.skills.length > 0) {
      filtered = filtered.filter((e) =>
        a.skills!.some((s) => e.selfProfile.skillTags.includes(s))
      );
    }

    const truncated = filtered.length > DEFAULT_LIMIT;
    const top = filtered.slice(0, DEFAULT_LIMIT);
    return {
      candidates: top.map(compressProfile),
      truncated,
      total: filtered.length,
    } satisfies SearchEmployeesResult;
  };
}
```

测试要点（`tests/agent/assignment/tools/search-employees.test.ts`）：
1. 空 args → 返回所有候选人（受 limit 截断）
2. domain=QUALITY → 只返回 `质量部 / 测试部 / 供应商质量` 的人
3. skills 命中任一即返回（any-of）
4. truncated 标志：注入 35 个 fake 员工，断言 truncated=true 且 candidates.length===30
5. compressProfile 输出包含 `taskType->outcome`（v0.2 验证点）

- [ ] **Step 4: Prompt**

`assignment-prompt.ts`: export `ASSIGNMENT_RECOMMENDER_PROMPT_VERSION = "assignment-recommender-agent-v0.2.0"` and system text instructing:
- 仅输出 JSON
- 必须先调用 `search_employees` 工具一次（v0.2 限定单轮）
- 拿到候选人后基于压缩画像生成 AssignmentDraft
- 不确定时用 `LOW + managerQuestions`，不要硬编人选
- 引用候选人画像中的具体证据写进 rationale
- `primary.userId` 与 `alternates[].userId` 必须来自工具返回的候选人列表，不要凭空捏造

User payload: stringify `{ planSummary, tasks: simplified task array }`（v0.2：候选人不再塞进 prompt，由 tool 调用拉取）。

- [ ] **Step 5: Runner（v0.2：function calling + self-correction）**

```ts
export interface RunAssignmentRecommendationInput {
  traceId: string;
  tasks: TaskPackage[];
  classificationSummary: string;
  domainHint?: "QUALITY" | "RD";
}

export interface RunAssignmentRecommendationDeps {
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  qwenConfig: QwenPlannerConfig;
  draftRepo: ReturnType<typeof createAssignmentDraftRepo>;
  eventRepo: ReturnType<typeof createAssignmentEventRepo>;
}

export async function runAssignmentRecommendation(
  input: RunAssignmentRecommendationInput,
  deps: RunAssignmentRecommendationDeps
): Promise<{ ok: true; draft: AssignmentDraft } | { ok: false; reason: string }> {
  const client = new QwenCompatibleClient(deps.qwenConfig);
  const handler = buildSearchEmployeesHandler(deps.employeeRepo);

  const sys = buildAssignmentSystemPrompt();
  const user = buildAssignmentUserPrompt(input);

  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content?: string }> = [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];

  // 第 1 轮：function calling + 生成
  let response;
  try {
    response = await client.callWithTools({
      traceId: input.traceId,
      messages,
      tools: [SEARCH_EMPLOYEES_TOOL],
      toolHandlers: { search_employees: handler },
      maxIterations: 1,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let coerced = coerceAssignmentDraft(response.payload);
  let v = validateAssignmentDraft(coerced, { allowedUserIds: deps.employeeRepo.list().map((e) => e.userId), taskIds: input.tasks.map((t) => t.id) });

  // v0.2：1 轮 self-correction
  if (!v.valid) {
    const correctionMessages = [
      ...messages,
      {
        role: "assistant" as const,
        content: JSON.stringify(response.payload),
      },
      {
        role: "user" as const,
        content: `你上一次输出未通过 schema 校验，请仅修正以下问题后再次输出完整 JSON：\n${v.errors.map((e) => `- ${e}`).join("\n")}`,
      },
    ];
    try {
      response = await client.callWithTools({
        traceId: input.traceId,
        messages: correctionMessages,
        tools: [SEARCH_EMPLOYEES_TOOL],
        toolHandlers: { search_employees: handler },
        maxIterations: 1,
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    coerced = coerceAssignmentDraft(response.payload);
    v = validateAssignmentDraft(coerced, { allowedUserIds: deps.employeeRepo.list().map((e) => e.userId), taskIds: input.tasks.map((t) => t.id) });
  }

  if (!v.valid) {
    return { ok: false, reason: v.errors.join("; ") };
  }

  await deps.draftRepo.save(coerced);
  await deps.eventRepo.append({
    eventId: crypto.randomUUID(),
    traceId: input.traceId,
    planId: input.traceId,
    type: "recommended_for_task",
    occurredAt: new Date().toISOString(),
    payload: {
      promptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
      toolCallsExecuted: response.toolCallsExecuted,
      correctionUsed: messages.length !== correctionMessages?.length, // 简化：可改为显式 flag
    },
  });

  logStructured({
    event: "assignment_draft_ready",
    traceId: input.traceId,
    assignmentPromptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
    assigneeCount: input.tasks.length,
    toolCallsExecuted: response.toolCallsExecuted,
  });

  return { ok: true, draft: coerced };
}
```

Adjust imports (`crypto` from `node:crypto`, `logStructured` from infra)。

- [ ] **Step 6: 测试**

- Schema：valid fixture passes; missing taskId fails; alternates 含 primary 失败
- search_employees handler：见 Step 3 测试要点
- Runner 集成：mock `client.callWithTools` 让其返回（a）有 tool_call 触发 handler、（b）最终 JSON；断言 draftRepo.save 被调用、events 被追加
- Self-correction：mock 第一次返回 invalid payload、第二次返回 valid；断言 callWithTools 被调用 2 次

- [ ] **Step 7: Commit**

```bash
git add src/agent/assignment tests/agent/assignment
git commit -m "feat(assignment): function-calling recommender with self-correction"
```

---

### Task 7: Draft / event / card repos (atomic writes)

**Files:**
- Create: `src/integrations/repos/assignment-draft-repo.ts`
- Create: `src/integrations/repos/assignment-event-repo.ts`
- Create: `src/integrations/repos/card-state-repo.ts`
- Test: `tests/integrations/assignment-draft-repo.test.ts` etc.

- [ ] **Step 1: Draft repo**

Write `${planId}.assignment.json` via write-to-`.tmp` + rename (same pattern as `plan-store.ts`).

- [ ] **Step 2: Event repo**

Append line JSON.stringify(event) + `\n` using `fs.appendFileSync` with mkdir parent.

- [ ] **Step 3: Card state repo**

`upsert(outTrackId, obj)` write JSON file under card dir.

- [ ] **Step 4: Tests**

Temp dirs only.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/repos/assignment-draft-repo.ts src/integrations/repos/assignment-event-repo.ts src/integrations/repos/card-state-repo.ts tests/integrations
git commit -m "feat(assignment): file-backed draft, event, and card state repos"
```

---

### Task 8: Signed Web entry URL + minimal HTTP workbench

**Files:**
- Create: `src/security/web-entry-token.ts`
- Create: `src/web/assignment-workbench.ts`
- Modify: `src/dingtalk-bot.ts` (start server when env set)
- Test: `tests/security/web-entry-token.test.ts`

- [ ] **Step 1: Token**

HMAC-SHA256 over canonical string:

```
v1|${planId}|${userId}|${role}|${expUnix}|${nonce}
```

Secret `ASSIGNMENT_WEB_SECRET`. Export:

```ts
export function signAssignmentEntry(params: {
  planId: string;
  userId: string;
  role: "manager";
  ttlSeconds: number;
}): { token: string; exp: number; nonce: string };

export function verifyAssignmentEntry(token: string): {
  planId: string;
  userId: string;
  role: string;
  exp: number;
  nonce: string;
};
```

Reject expired tokens.

- [ ] **Step 2: HTTP handler**

`src/web/assignment-workbench.ts`:

- `GET /assignment/workbench?token=...` — verify; load `AssignmentDraft` + task titles from plan snapshot; return HTML `<table>` of primary/alternates + textarea override notes + **placeholder** “Save” POST (implemented as POST `/assignment/workbench/save` JSON body `{ token, overrides: Record<taskId, userId> }`).

- Validate POST token; write updated draft via draft repo; append `assignment_overridden` event.

Use only `node:http`, no Express.

- [ ] **Step 3: Mount server**

In `dingtalk-bot.ts`, if `process.env.ASSIGNMENT_WEB_SECRET` and `ASSIGNMENT_WEB_PUBLIC_BASE_URL` present, call `http.createServer((req,res) => handleAssignmentOrHealth(req,res)).listen(resolveAssignmentWebPort())`. **Merge** with existing `startHealthServer`: single server handles `/health`, `/assignment/workbench`, `/assignment/workbench/save`.

- [ ] **Step 4: Tests**

Sign + verify round-trip; reject tamper.

- [ ] **Step 5: Commit**

```bash
git add src/security/web-entry-token.ts src/web/assignment-workbench.ts src/dingtalk-bot.ts tests/security/web-entry-token.test.ts
git commit -m "feat(assignment): signed URL and minimal assignment workbench HTTP"
```

---

### Task 9: Session context + DingTalk Markdown follow-up

**Files:**
- Modify: `src/dingtalk-session-context.ts`
- Modify: `tests/dingtalk-session-context.test.ts`
- Create: `src/dingtalk/assignment-markdown-appendix.ts` — builds second Markdown block
- Create: `src/integrations/dingtalk/assignment-card-mock.ts`

- [ ] **Step 1: Extend `DingTalkDemoSessionContext`**

```ts
export interface AssignmentSessionState {
  stage?: "RECOMMENDING" | "AWAITING_DISPATCH_CONFIRM" | "DISPATCHED";
  lastAssignmentTraceId?: string;
}

export interface DingTalkDemoSessionContext {
  priorDigest?: string;
  conversationState?: DemoConversationState;
  assignmentState?: AssignmentSessionState;
}
```

Update `nextSessionContextAfterDemoResult` to accept optional callback **or** set assignment state in dingtalk-bot after assignment (simpler: mutate context in bot before `chatSessionMemory.set`):

After planning + assignment, build:

```ts
const next = nextSessionContextAfterDemoResult(demoResult, prior, maxChars);
next.assignmentState = { stage: "AWAITING_DISPATCH_CONFIRM", lastAssignmentTraceId: demoResult.traceId };
chatSessionMemory.set(chatKey, next);
```

- [ ] **Step 2: Markdown appendix**

Function `buildAssignmentFollowUpMarkdown(params: { baseUrl: string; token: string; draft: AssignmentDraft }): string` returning:

```md
---
### 分配建议（预览）
（以下为模型推荐，请在链接中确认或调整）

| 子任务 | 推荐负责人 | 置信度 |
...

[打开分配工作台确认](https://host/assignment/workbench?token=...)
```

- [ ] **Step 3: Mock card**

If `DINGTALK_ASSIGNMENT_MOCK=1`, append line to `CARD_CALLBACKS_PATH` with `{ kind:"mock_manager_card", traceId, outTrackId }`.

- [ ] **Step 4: Bot integration（v0.2：async）**

In `dingtalk-bot.ts`:

1. **DRAFT_READY 立即返回主管草案**：使用现有 `formatDemoReply` 拼出 Markdown，调用 `sendMarkdownReply` 推送，**不再等待 assignment**。
2. **Assignment 异步执行**：满足 `demoResult.status === "DRAFT_READY"` 且 `isTaskInitiatorAllowed(payload.senderStaffId)` 且 `process.env.ASSIGNMENT_PHASE_ENABLED === "1"` 时，用 `void (async () => { ... })()` 启动后台任务；后台任务完成后**单独**通过同一 `sessionWebhook` 推送一条「分配建议」Markdown。
3. **失败处理**：assignment 后台失败时仅写 `assignment-events.jsonl` + `console.error`，不推送任何错误消息给用户（避免打扰）。
4. **会话状态更新**：`chatSessionMemory.set` 在 DRAFT_READY 立即同步执行（含 `assignmentState.stage = "RECOMMENDING"`）；后台 assignment 完成时再次 `chatSessionMemory.set` 更新为 `AWAITING_DISPATCH_CONFIRM`。
5. **签名 URL 与 mock 卡片**：与原 v1 设计一致，但仅在异步任务完成时才生成。

伪代码：

```ts
// 主链路：先送草案
const { title, markdownText } = formatDemoReply(demoResult);
const replyPromise = sendMarkdownReply({ client, sessionWebhook: payload.sessionWebhook, messageId, senderStaffId: payload.senderStaffId, title, markdownText });
dingtalkResponse = await replyPromise;

// session：先把 conversation state 写好
let sessionContext = nextSessionContextAfterDemoResult(demoResult, prior, sessionDigestMaxChars);

// 异步：assignment phase
if (
  demoResult.status === "DRAFT_READY" &&
  isTaskInitiatorAllowed(payload.senderStaffId) &&
  process.env.ASSIGNMENT_PHASE_ENABLED === "1"
) {
  sessionContext = {
    ...sessionContext,
    assignmentState: { stage: "RECOMMENDING", lastAssignmentTraceId: demoResult.traceId },
  };
  chatSessionMemory.set(chatKey, sessionContext);

  const sessionWebhook = payload.sessionWebhook;
  const senderStaffId = payload.senderStaffId;
  const replyMessageId = messageId;
  void (async () => {
    try {
      const ar = await runAssignmentRecommendation(
        {
          traceId: demoResult.traceId,
          tasks: demoResult.tasks,
          classificationSummary: `${demoResult.classification.domain}/${demoResult.classification.subtype}`,
          domainHint: demoResult.classification.domain,
        },
        {
          employeeRepo: createEmployeeProfileRepo(resolveEmployeeProfileDir()),
          qwenConfig,
          draftRepo: createAssignmentDraftRepo(resolveAssignmentDraftDir()),
          eventRepo: createAssignmentEventRepo(resolveAssignmentEventsPath()),
        }
      );
      if (!ar.ok) {
        console.error("[assignment] generation failed:", ar.reason);
        return;
      }
      const signed = signAssignmentEntry({
        planId: demoResult.traceId,
        userId: senderStaffId,
        role: "manager",
        ttlSeconds: 1800,
      });
      const link = `${resolveAssignmentWebPublicBaseUrl()}/assignment/workbench?token=${encodeURIComponent(signed.token)}`;
      const markdown = buildAssignmentFollowUpMarkdown({
        baseUrl: resolveAssignmentWebPublicBaseUrl(),
        token: signed.token,
        draft: ar.draft,
      });
      await sendMarkdownReply({
        client,
        sessionWebhook,
        messageId: replyMessageId,
        senderStaffId,
        title: "分配建议",
        markdownText: markdown,
      });
      if (isDingtalkAssignmentMock()) {
        mockManagerCard({ traceId: demoResult.traceId, outTrackId: `assign:${demoResult.traceId}` });
      }
      // 更新 session
      const next = chatSessionMemory.get(chatKey);
      chatSessionMemory.set(chatKey, {
        ...(next ?? sessionContext),
        assignmentState: { stage: "AWAITING_DISPATCH_CONFIRM", lastAssignmentTraceId: demoResult.traceId },
      });
    } catch (err) {
      console.error("[assignment] background error:", err instanceof Error ? err.message : err);
    }
  })();
} else {
  chatSessionMemory.set(chatKey, sessionContext);
}
```

Gate behind `ASSIGNMENT_PHASE_ENABLED=1` so production defaults unchanged until ready。

- [ ] **Step 5: Tests**

Extend `tests/dingtalk-session-context.test.ts` if assignment state merged into builder; else bot-level test optional behind integration skip.

- [ ] **Step 6: Commit**

```bash
git add src/dingtalk-session-context.ts src/dingtalk-bot.ts src/dingtalk/assignment-markdown-appendix.ts src/integrations/dingtalk/assignment-card-mock.ts tests/dingtalk-session-context.test.ts
git commit -m "feat(dingtalk): optional assignment phase after DRAFT_READY"
```

---

### Task 10: Documentation + deploy notes

**Files:**
- Modify: `AGENTS.md` (assignment phase behind env flag; still not full 承接三态)
- Modify: `docs/deploy-aliyun-dingtalk.md` (open firewall port for `ASSIGNMENT_WEB_PORT`, set public URL)
- Modify: `docs/Qwen-接入实施说明.md` (second LLM call for assignment; token cost note)

- [ ] **Step 1: AGENTS.md**

Document: `ASSIGNMENT_PHASE_ENABLED`, whitelist, second Qwen call, mock cards, Web URL requirement.

- [ ] **Step 2: Deploy**

Security group + reverse proxy if HTTPS required for signed links.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md docs/deploy-aliyun-dingtalk.md docs/Qwen-接入实施说明.md
git commit -m "docs: assignment phase env flags and deployment"
```

---

## Self-review

**1. Spec coverage**

| Spec section | Task |
| --- | --- |
| §3 flow / sync assignment | Task 9 |
| §4 profiles / fixtures | Task 3 |
| §5 AssignmentDraft / LLM | Task 6 |
| §6 cards + Web | Tasks 8–9 (mock cards + workbench) |
| §7 sedimentation | Task 6–7 events (minimal track); Phase D deferred |
| §8 v2.11 touch `dingtalk-session-context` | Task 9 |
| §9 contracts | Task 6 types |
| §10 storage | Tasks 2, 7 |
| §11 observability | Append structured log in runner (add `logStructured` in Task 6 Step 4 — **must add** `event:"assignment_draft_ready"` with traceId) |
| §12 security signed URL | Task 8 |
| §13 tests | Each task |
| §17 D1–D5 | D1 mock; D2 Task 8; D3 Task 9 sync; D4 Task 4; D5 N/A |

**Gap fixed inline:** Add in Task 6 runner after successful validate:

```ts
logStructured({
  event: "assignment_draft_ready",
  traceId: input.traceId,
  assignmentPromptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
  assigneeCount: input.tasks.length,
});
```

**2. Placeholder scan**

No TBD/TODO steps; all file paths concrete.

**3. Type consistency**

- `planId` === `traceId` per spec §5.3 comment — use `input.traceId` consistently in repos and events.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-assignment-and-dispatch.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
