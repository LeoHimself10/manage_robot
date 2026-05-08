# Prompt-Only Conversation Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DingTalk follow-up conversations less rigid through prompt-only tuning, while changing user-facing task package table headers to Chinese.

**Architecture:** Keep the current Qwen JSON pipeline and schema unchanged. Tune `src/agent/demo/qwen-prompt.ts` so conversational follow-ups can be answered naturally via the existing LOW / empty-task / `openQuestions` path, and update `src/agent/demo/markdown-renderer.ts` labels only.

**Tech Stack:** TypeScript, Vitest, Qwen OpenAI-compatible JSON prompt, existing DingTalk Markdown renderer.

---

## File Structure

- `src/agent/demo/qwen-prompt.ts`: prompt version and behavioral policy for multi-turn follow-ups, non-task/greeting handling, and complexity-driven task count.
- `src/agent/demo/markdown-renderer.ts`: user-facing task table header labels only.
- `tests/agent/demo/qwen-prompt.test.ts`: prompt assertions for critique-first behavior, relaxed fixed identity wording, and flexible task count.
- `tests/agent/demo/qwen-compatible-client.test.ts`: prompt version assertion.
- `tests/agent/demo/output.test.ts`: Markdown header assertions.
- `AGENTS.md`: prompt version and interaction boundary note.
- `docs/Qwen-接入实施说明.md`: prompt version, prompt-only conversational tuning, and Chinese table header note.
- `docs/superpowers/specs/2026-05-08-prompt-only-conversation-tuning-design.md`: already created spec; include in commit if/when the user asks to commit.

---

### Task 1: Prompt Behavior Tests

**Files:**
- Modify: `tests/agent/demo/qwen-prompt.test.ts`
- Modify: `tests/agent/demo/qwen-compatible-client.test.ts`

- [ ] **Step 1: Update prompt behavior assertions**

Replace the first test in `tests/agent/demo/qwen-prompt.test.ts` so it expects the new prompt behavior:

```ts
describe("buildQwenPlannerSystemPrompt", () => {
  it("v2.10：多轮质疑先自然回应，任务数量按复杂度展开", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("task-planning-agent-v2.10");
    expect(sys).toContain("质疑");
    expect(sys).toContain("先解释");
    expect(sys).toContain("不必每次重生成任务表");
    expect(sys).toContain("复杂度");
    expect(sys).toContain("几十个");
    expect(sys).toContain("JSON");
    expect(sys).not.toContain("其中须有一条以「**本机器人**」为主语");
    expect(sys).not.toContain("请「您」用**一段**完整、可拆解的任务背景描述重新发送");
  });
});
```

- [ ] **Step 2: Keep user prompt embedding test**

Leave the `buildQwenPlannerUserPrompt` test intact unless it fails because exact wording changed. It should still assert:

```ts
expect(user.indexOf("上一轮追问")).toBeLessThan(user.indexOf("domainHint:"));
expect(user).toContain("openQuestions");
```

- [ ] **Step 3: Update client prompt version assertion**

In `tests/agent/demo/qwen-compatible-client.test.ts`, change:

```ts
expect(requestBody.messages[0].content).toContain("v2.9");
```

to:

```ts
expect(requestBody.messages[0].content).toContain("v2.10");
```

- [ ] **Step 4: Run prompt tests and confirm RED**

Run:

```powershell
npm test -- tests/agent/demo/qwen-prompt.test.ts tests/agent/demo/qwen-compatible-client.test.ts
```

Expected: fail because `qwen-prompt.ts` still reports `v2.9.0`, still contains fixed non-task identity wording, and does not contain all new behavior phrases.

---

### Task 2: Implement Prompt-Only Conversation Tuning

**Files:**
- Modify: `src/agent/demo/qwen-prompt.ts`

- [ ] **Step 1: Bump prompt version**

Change:

```ts
export const QWEN_PLANNER_PROMPT_VERSION = "task-planning-agent-v2.9.0";
```

to:

```ts
export const QWEN_PLANNER_PROMPT_VERSION = "task-planning-agent-v2.10.0";
```

- [ ] **Step 2: Replace rigid non-task block**

Replace the current long non-task block that starts with:

```ts
"若用户输入明显为寒暄、灌水、闲聊或与质量/研发任务规划无关...
```

with guidance shaped like:

```ts
"若用户输入明显为寒暄、灌水、闲聊或与质量/研发任务规划无关，须 confidence=LOW、tasks=[]、gateSelfCheck.passed=true 且 missingByTask=[]，可设置 clarificationUx=NON_TASK。openQuestions 应给出简短自然回复或引导，不要套用固定身份段落，不要要求用户机械重发完整背景；如果存在上轮上下文，优先结合上轮上下文判断用户是在追问、质疑还是补充。",
```

- [ ] **Step 3: Add critique-first multi-turn guidance**

Replace the current short-feedback line:

```ts
"如果 user prompt 中包含「上轮上下文」，且本轮输入是短反馈或修订指令...
```

with guidance shaped like:

```ts
"如果 user prompt 中包含「上轮上下文」，先判断本轮用户意图：补充事实且会影响任务时，基于上轮草案更新任务包；明确要求重做、细化、调整时，输出更新后的草案；如果用户是在质疑、追问或指出某个任务可能不对，应先解释判断依据、承认可改之处并给出修改建议，不必每次重生成任务表。若需要自然回应，可用 confidence=LOW、tasks=[]，把简短回复放入 openQuestions。",
```

- [ ] **Step 4: Replace fixed task-count guidance**

Replace:

```ts
"控制输出体量以降低钉钉等待时间：充分输入下默认输出 3-5 个任务...
```

with:

```ts
"任务数量由复杂度决定：简单任务可拆成少量任务包；复杂、跨角色、依赖多的任务可细拆到十几个甚至几十个任务包。无论数量多少，都要保持层级清晰、依赖明确、字段短句化，避免为了凑数量而重复或空泛。",
```

- [ ] **Step 5: Keep schema discipline**

Do not remove these prompt constraints:

```ts
"必须仅输出 JSON..."
"JSON 顶层字段必须为 classification、tasks、openQuestions、gateSelfCheck..."
"classification.domain 只能是 QUALITY 或 RD..."
"tasks 必须是数组..."
```

These are required by the current parser and validator.

- [ ] **Step 6: Run prompt tests and confirm GREEN**

Run:

```powershell
npm test -- tests/agent/demo/qwen-prompt.test.ts tests/agent/demo/qwen-compatible-client.test.ts
```

Expected: pass.

---

### Task 3: Chinese Task Table Headers

**Files:**
- Modify: `tests/agent/demo/output.test.ts`
- Modify: `src/agent/demo/markdown-renderer.ts`

- [ ] **Step 1: Write failing output assertion**

In `tests/agent/demo/output.test.ts`, update the task table test so it asserts Chinese headers:

```ts
expect(markdown).toContain(
  "| 任务ID | 任务标题 | 目标 | 交付物 | 验收标准 | 截止时间 | 反馈频率 | 依赖任务 |"
);
expect(markdown).not.toContain("| task ID | title | objective |");
```

- [ ] **Step 2: Run output test and confirm RED**

Run:

```powershell
npm test -- tests/agent/demo/output.test.ts
```

Expected: fail because `renderTaskTable` still renders English headers.

- [ ] **Step 3: Update renderer header**

In `src/agent/demo/markdown-renderer.ts`, change:

```ts
"| task ID | title | objective | deliverables | completion criteria | due date | feedback frequency | dependencies |",
```

to:

```ts
"| 任务ID | 任务标题 | 目标 | 交付物 | 验收标准 | 截止时间 | 反馈频率 | 依赖任务 |",
```

Leave the separator row unchanged:

```ts
"| --- | --- | --- | --- | --- | --- | --- | --- |",
```

- [ ] **Step 4: Run output test and confirm GREEN**

Run:

```powershell
npm test -- tests/agent/demo/output.test.ts
```

Expected: pass.

---

### Task 4: Documentation Alignment

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/Qwen-接入实施说明.md`

- [ ] **Step 1: Update AGENTS prompt version**

In `AGENTS.md`, change:

```md
task-planning-agent-v2.9.0
```

to:

```md
task-planning-agent-v2.10.0
```

- [ ] **Step 2: Update Qwen docs prompt behavior**

In `docs/Qwen-接入实施说明.md`, change the prompt section from `prompt v2.9` to `prompt v2.10`, and describe:

```md
prompt v2.10：在保持 JSON 结构输出的前提下，放松多轮交互策略。用户补充事实或明确要求更新时重生成草案；用户质疑、追问或指出某个任务可能不对时，优先给出自然解释和修改建议，不必每次输出完整任务表。任务数量由复杂度决定，复杂任务可拆到十几个甚至几十个任务包。用户可见任务包表头为中文。
```

- [ ] **Step 3: Run focused tests after docs changes**

Run:

```powershell
npm test -- tests/agent/demo/qwen-prompt.test.ts tests/agent/demo/qwen-compatible-client.test.ts tests/agent/demo/output.test.ts
```

Expected: pass.

---

### Task 5: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: all Vitest files and tests pass.

- [ ] **Step 3: Read lints for edited source and tests**

Use `ReadLints` on:

```txt
src/agent/demo/qwen-prompt.ts
src/agent/demo/markdown-renderer.ts
tests/agent/demo/qwen-prompt.test.ts
tests/agent/demo/qwen-compatible-client.test.ts
tests/agent/demo/output.test.ts
```

Expected: no new linter errors.

- [ ] **Step 4: Review git diff**

Run:

```powershell
git diff -- src/agent/demo/qwen-prompt.ts src/agent/demo/markdown-renderer.ts tests/agent/demo/qwen-prompt.test.ts tests/agent/demo/qwen-compatible-client.test.ts tests/agent/demo/output.test.ts AGENTS.md "docs/Qwen-接入实施说明.md" docs/superpowers/specs/2026-05-08-prompt-only-conversation-tuning-design.md
```

Expected: diff only includes prompt-only conversation tuning, Chinese table headers, tests, docs, and the approved spec.

- [ ] **Step 5: Do not commit unless explicitly requested**

The repository instruction says commits require explicit user request. Stop after verification and report status unless the user asks to commit, push, or deploy.

---

## Self-Review

- Spec coverage: all spec requirements map to prompt tuning, table header rendering, tests, and docs.
- Placeholder scan: no placeholders remain; all paths and commands are concrete.
- Type consistency: no new schema fields are introduced; prompt version uses `task-planning-agent-v2.10.0` consistently.
- Scope check: the plan stays prompt-only and avoids `responseMode`, routers, persistent memory, or rule-based drafting.
