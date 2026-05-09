# Assignment and Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a `DRAFT_READY` turn (v2.11 `responseIntent` `DRAFT` / `REVISE_DRAFT`), run a second LLM pass to produce `AssignmentDraft`, persist it under `./data/`, expose a signed-URL Web workbench for manager overrides, append a DingTalk Markdown follow-up with links (mock interactive cards until DingTalk API permissions exist), and record append-only assignment events—aligned with `docs/superpowers/specs/2026-05-09-assignment-and-dispatch-design.md`.

**Architecture:** Keep `createTaskPlanningDemo` focused on planning; extend its result with `traceId` so downstream code can load `./data/plans/<traceId>.json`. New package `src/agent/assignment/` holds prompt + schema + runner. New `src/integrations/repos/` holds file-backed repos (atomic JSON writes). New `src/security/` holds HMAC signed URLs and initiator whitelist. `src/dingtalk-bot.ts` orchestrates: whitelist → planning → (if `DRAFT_READY`) assignment runner → merge assignment summary into outbound Markdown → start optional HTTP server for Web UI on same process. No DB; no LLM function calling in v1.

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

### Task 5: Extend `QwenCompatibleClient` for arbitrary JSON messages

**Files:**
- Modify: `src/agent/demo/qwen-compatible-client.ts`
- Modify: `tests/agent/demo/qwen-compatible-client.test.ts` (or new test file)

- [ ] **Step 1: Add method**

Add public method:

```ts
export interface GenerateJsonMessagesRequest {
  traceId?: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}

export interface GenerateJsonMessagesResult {
  payload: unknown;
  trace: InferenceTrace;
  rawContent: string;
}

async generateJsonFromMessages(
  request: GenerateJsonMessagesRequest
): Promise<GenerateJsonMessagesResult> {
  // Copy retry loop from generateStructuredPlan but call new private
  // buildChatCompletionPayloadFromMessages(request.messages)
}
```

Implement `buildChatCompletionPayloadFromMessages` mirroring `buildChatCompletionPayload` but without importing planner prompts—only `messages`, `model`, `temperature`, `max_tokens`, `stream`.

Reuse private `callChatCompletions` **after** refactoring: extract `postChatCompletions(body: Record<string, unknown>): Promise<ChatCompletionResponse>` used by both code paths.

Parse JSON via existing `parseAssistantJsonPayload` / `extractAssistantContent` exports if available.

- [ ] **Step 2: Test with mocked `fetch`**

Stub global `fetch` to return `{ ok: true, json: () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) } }` and assert `payload.ok === true`.

- [ ] **Step 3: Commit**

```bash
git add src/agent/demo/qwen-compatible-client.ts tests/agent/demo/qwen-compatible-client.test.ts
git commit -m "feat(qwen): generic JSON completion helper for assignment LLM"
```

---

### Task 6: Assignment schema + prompt + runner

**Files:**
- Create: `src/agent/assignment/types.ts`
- Create: `src/agent/assignment/assignment-schema.ts`
- Create: `src/agent/assignment/assignment-prompt.ts`
- Create: `src/agent/assignment/run-assignment-recommendation.ts`
- Test: `tests/agent/assignment/assignment-schema.test.ts`
- Test: `tests/agent/assignment/run-assignment-recommendation.test.ts`

- [ ] **Step 1: Types**

Mirror spec §5.3 TypeScript interfaces (`AssignmentDraft`, `SubTaskAssignment`, `AssignmentCandidate`, `AssignmentRiskFlag`, `Confidence`).

- [ ] **Step 2: Schema coerce/validate**

Implement `coerceAssignmentDraft(raw: unknown): AssignmentDraft` and `validateAssignmentDraft(d: AssignmentDraft): { valid: boolean; errors: string[] }`:

- Every `assignments[].taskId` must exist in input tasks  
- `primary.userId` / alternates must exist in employee repo  
- `confidence` ∈ `HIGH|MEDIUM|LOW`  
- Required string fields non-empty  

- [ ] **Step 3: Prompt**

`assignment-prompt.ts`: export `ASSIGNMENT_RECOMMENDER_PROMPT_VERSION = "assignment-recommender-agent-v0.1.0"` and system text instructing: JSON only, single object matching schema, reference candidate evidence in `rationale`, use `LOW` + `managerQuestions` when unsure, never invent userIds.

User payload: stringify `{ planSummary, tasks: simplified task array, candidates: compressed bios }`.

Compression helper in `run-assignment-recommendation.ts`:

```ts
function compressProfile(p: EmployeeProfileRecord): string {
  return [
    `${p.userId} ${p.displayName} | ${p.department} | ${p.role}`,
    `tags: ${p.selfProfile.skillTags.join(",")}`,
    `strengths: ${p.selfProfile.strengths.join(";")}`,
    `boundaries: ${p.selfProfile.boundaries.join(";")}`,
    `cases: ${p.selfProfile.cases.map((c) => c.taskType).join(",")}`,
  ].join("\n");
}
```

- [ ] **Step 4: Runner**

```ts
export interface RunAssignmentRecommendationInput {
  traceId: string;
  tasks: TaskPackage[];
  classificationSummary: string;
  assigneeHint?: string;
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
  const candidates = deps.employeeRepo.list().map(compressProfile);
  const client = new QwenCompatibleClient(deps.qwenConfig);
  const sys = buildAssignmentSystemPrompt();
  const user = buildAssignmentUserPrompt(input, candidates);
  const raw = await client.generateJsonFromMessages({
    traceId: input.traceId,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const coerced = coerceAssignmentDraft(raw.payload);
  const v = validateAssignmentDraft(coerced);
  if (!v.valid) return { ok: false, reason: v.errors.join("; ") };
  await deps.draftRepo.save(coerced);
  await deps.eventRepo.append({
    eventId: crypto.randomUUID(),
    traceId: input.traceId,
    planId: input.traceId,
    type: "recommended_for_task",
    occurredAt: new Date().toISOString(),
    payload: { promptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION },
  });
  return { ok: true, draft: coerced };
}
```

Adjust imports (`crypto` from `node:crypto`).

- [ ] **Step 5: Tests**

- Schema: valid fixture passes; missing taskId fails  
- Runner: mock `QwenCompatibleClient` by injecting deps **or** pass `generateJsonFromMessages` stub via optional param `llm?: ...` for testability (preferred: optional `depsOverrides` in runner)

- [ ] **Step 6: Commit**

```bash
git add src/agent/assignment tests/agent/assignment
git commit -m "feat(assignment): recommender schema, prompt, and runner"
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

- [ ] **Step 4: Bot integration**

In `dingtalk-bot.ts` after `createTaskPlanningDemo`:

```ts
let outboundMarkdown = markdownText;
if (
  demoResult.status === "DRAFT_READY" &&
  isTaskInitiatorAllowed(payload.senderStaffId) &&
  process.env.ASSIGNMENT_PHASE_ENABLED === "1"
) {
  const ar = await runAssignmentRecommendation(...);
  if (ar.ok) {
    const signed = signAssignmentEntry({
      planId: demoResult.traceId,
      userId: payload.senderStaffId,
      role: "manager",
      ttlSeconds: 1800,
    });
    const link = `${resolveAssignmentWebPublicBaseUrl()}/assignment/workbench?token=${encodeURIComponent(signed.token)}`;
    outboundMarkdown = `${markdownText}\n\n${buildAssignmentFollowUpMarkdown({
      baseUrl: resolveAssignmentWebPublicBaseUrl(),
      token: signed.token,
      draft: ar.draft,
    })}`;
    if (isDingtalkAssignmentMock()) mockManagerCard(...);
  }
}
```

Gate behind `ASSIGNMENT_PHASE_ENABLED=1` so production defaults unchanged until ready.

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
