# Conversational Intent Agent Redesign Implementation Plan

**Status（2026-05-09）：** 已在 `feat/conversational-intent-agent` 落地并完成 `npm test` / `npm run typecheck`；下文保留为实施记录与任务分解，勾选状态以仓库提交为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight conversational intent layer so the DingTalk task-planning robot can chat, clarify, discuss, reset, draft, and revise without forcing every turn into a rigid task-table reply.

**Architecture:** Keep a single LLM call and the existing JSON-first pipeline, but extend the model contract with `responseIntent` and `assistantMessage`. The pipeline derives result status from intent, the DingTalk renderer branches on that intent, and session memory stores conversational state rather than only the prior draft digest.

**Tech Stack:** TypeScript, Node.js, DingTalk Stream SDK, Qwen-compatible planner, Vitest.

---

## File Structure

- Modify `src/agent/demo/llm-types.ts`: define `ResponseIntent`, add `responseIntent` and `assistantMessage` to LLM payload/result metadata.
- Modify `src/agent/demo/llm-schema.ts`: coerce and validate new fields; derive a compatible intent when old model output omits it.
- Modify `src/agent/demo/pipeline.ts`: branch on response intent, return conversational result shapes, log intent, and restrict full draft rendering to `DRAFT` / `REVISE_DRAFT`.
- Modify `src/agent/demo/markdown-renderer.ts`: remove `任务理解摘要` from user-facing drafts while preserving diagnostic output.
- Modify `src/dingtalk-needs-more-info-markdown.ts`: render natural assistant messages plus optional questions.
- Modify `src/dingtalk-bot.ts`: maintain richer `conversationState`, reset memory on `RESET_OR_NEW_TASK`, and render each intent appropriately.
- Modify `src/infra/session-digest.ts`: summarize conversational state and stop depending on the removed user-facing summary section.
- Modify `src/agent/demo/qwen-prompt.ts`: bump to `task-planning-agent-v2.11.0` and rewrite guidance around response intent.
- Modify tests under `tests/agent/demo/`: cover schema, pipeline intent branching, renderer behavior, prompt guidance, memory reset, and large-task granularity fixtures.
- Modify docs: `AGENTS.md`, `docs/Qwen-接入实施说明.md`, and the v2.11 design spec if implementation decisions change during development.

---

### Task 1: Extend LLM Contract With Response Intent

**Files:**
- Modify: `src/agent/demo/llm-types.ts`
- Modify: `src/agent/demo/llm-schema.ts`
- Test: `tests/agent/demo/llm-schema.test.ts`
- Test: `tests/agent/demo/llm-fixtures.ts`

- [ ] **Step 1: Add failing schema tests for new fields**

Add these tests to `tests/agent/demo/llm-schema.test.ts`:

```ts
it("coerces responseIntent and assistantMessage from model output", () => {
  const normalized = coerceLlmPlanPayload({
    responseIntent: "discuss",
    assistantMessage: "你说得对，这个任务应先确认风险边界。",
    classification: {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["围绕上一轮草案讨论"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["本轮不是正式质量草案"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    },
    tasks: [],
    openQuestions: [],
    gateSelfCheck: { passed: true, missingByTask: [] },
  });

  expect(normalized.responseIntent).toBe("DISCUSS");
  expect(normalized.assistantMessage).toBe("你说得对，这个任务应先确认风险边界。");
});

it("derives compatible intent when responseIntent is omitted", () => {
  const normalized = coerceLlmPlanPayload({
    clarificationUx: "NON_TASK",
    classification: {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["寒暄"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["非任务"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    },
    tasks: [],
    openQuestions: ["你好，我可以帮你拆解质量或研发任务。"],
    gateSelfCheck: { passed: true, missingByTask: [] },
  });

  expect(normalized.responseIntent).toBe("CHAT");
  expect(normalized.assistantMessage).toBe("你好，我可以帮你拆解质量或研发任务。");
});

it("rejects invalid responseIntent when present", () => {
  const result = validateLlmPlanPayload({
    responseIntent: "MAKE_TABLE_ALWAYS",
    assistantMessage: "x",
    classification: {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["x"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["x"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    },
    tasks: [],
    openQuestions: [],
    gateSelfCheck: { passed: true, missingByTask: [] },
  }, { allowEmptyTasks: true });

  expect(result.valid).toBe(false);
  expect(result.errors).toContain("responseIntent is invalid");
});
```

- [ ] **Step 2: Run failing schema tests**

Run:

```powershell
npm test -- tests/agent/demo/llm-schema.test.ts
```

Expected: FAIL because `responseIntent` and `assistantMessage` are not defined or validated yet.

- [ ] **Step 3: Add types**

In `src/agent/demo/llm-types.ts`, add:

```ts
export type ResponseIntent =
  | "CHAT"
  | "CLARIFY"
  | "DISCUSS"
  | "DRAFT"
  | "REVISE_DRAFT"
  | "RESET_OR_NEW_TASK";
```

Update `LlmPlanPayload`:

```ts
export interface LlmPlanPayload {
  responseIntent: ResponseIntent;
  assistantMessage: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  gateSelfCheck?: LlmGateSelfCheck;
  /** 兼容旧版 LOW 追问 UX；v2.11 优先使用 responseIntent */
  clarificationUx?: ClarificationUxKind;
}
```

Update deprecated `LlmPlanResult` similarly:

```ts
export interface LlmPlanResult {
  responseIntent?: ResponseIntent;
  assistantMessage?: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  gateSelfCheck?: LlmGateSelfCheck;
  clarificationUx?: ClarificationUxKind;
  trace?: InferenceTrace;
}
```

- [ ] **Step 4: Add coercion and validation**

In `src/agent/demo/llm-schema.ts`, update imports:

```ts
import { ClarificationUxKind, LlmPlanPayload, ResponseIntent } from "./llm-types";
```

Add constants near `domainValues`:

```ts
const responseIntentValues = new Set<ResponseIntent>([
  "CHAT",
  "CLARIFY",
  "DISCUSS",
  "DRAFT",
  "REVISE_DRAFT",
  "RESET_OR_NEW_TASK",
]);
```

In `validateLlmPlanPayload`, after `candidate` is declared, add:

```ts
if (candidate.responseIntent !== undefined) {
  const intent = String(candidate.responseIntent).trim().toUpperCase();
  if (!responseIntentValues.has(intent as ResponseIntent)) {
    errors.push("responseIntent is invalid");
  }
}

if (candidate.assistantMessage !== undefined && typeof candidate.assistantMessage !== "string") {
  errors.push("assistantMessage must be string when present");
}
```

In `coerceLlmPlanPayload`, compute intent and message before returning:

```ts
const tasks = normalizeTasks(candidate.tasks);
const clarificationUx = normalizeClarificationUx(candidate.clarificationUx);
const responseIntent = normalizeResponseIntent(candidate.responseIntent, {
  tasks,
  confidence: classification.confidence,
  openQuestions,
  clarificationUx,
});
const assistantMessage = normalizeAssistantMessage(candidate.assistantMessage, openQuestions);

return {
  responseIntent,
  assistantMessage,
  classification,
  capaAdvisory,
  tasks,
  openQuestions,
  gateSelfCheck: normalizeGateSelfCheck(candidate.gateSelfCheck),
  clarificationUx,
};
```

Add helpers:

```ts
function normalizeResponseIntent(
  input: unknown,
  fallback: {
    tasks: TaskPackage[];
    confidence: string;
    openQuestions: string[];
    clarificationUx?: ClarificationUxKind;
  }
): ResponseIntent {
  const normalized = asString(input).toUpperCase();
  if (responseIntentValues.has(normalized as ResponseIntent)) {
    return normalized as ResponseIntent;
  }
  if (fallback.tasks.length > 0) return "DRAFT";
  if (fallback.clarificationUx === "NON_TASK") return "CHAT";
  if (fallback.confidence === "LOW" || fallback.openQuestions.length > 0) return "CLARIFY";
  return "CLARIFY";
}

function normalizeAssistantMessage(input: unknown, openQuestions: string[]): string {
  const value = asString(input);
  if (value) return value;
  return openQuestions[0] ?? "";
}
```

- [ ] **Step 5: Update fixtures with optional intent defaults**

In `tests/agent/demo/llm-fixtures.ts`, update `qualityLlmResult`:

```ts
return {
  responseIntent: "DRAFT",
  assistantMessage: "已根据当前信息生成任务拆解草案。",
  classification: {
    domain: "QUALITY",
    subtype: "PRODUCTION_PROCESS_ABNORMALITY",
    confidence: "HIGH",
    rationale: ["命中生产异常关键词"],
    missingInformation: [],
  },
  // existing fields unchanged
  ...overrides,
};
```

Update `rdVvLlmResult` and `rdAmbiguousLlmResult` with:

```ts
responseIntent: "DRAFT",
assistantMessage: "已根据当前信息生成任务拆解草案。",
```

- [ ] **Step 6: Run schema tests**

Run:

```powershell
npm test -- tests/agent/demo/llm-schema.test.ts
```

Expected: PASS.

---

### Task 2: Branch Pipeline Results by Intent

**Files:**
- Modify: `src/agent/demo/pipeline.ts`
- Test: `tests/agent/demo/pipeline.test.ts`

- [ ] **Step 1: Add failing pipeline tests**

Add tests to `tests/agent/demo/pipeline.test.ts`:

```ts
it("returns CHAT without markdown table for conversational output", async () => {
  const result = await createTaskPlanningDemo(
    { background: "你好", domainHint: "QUALITY" },
    {
      llmPlanner: async () =>
        qualityLlmPlannerResponse({
          responseIntent: "CHAT",
          assistantMessage: "你好，我可以帮你把质量或研发任务拆成可承接的任务包。",
          clarificationUx: "NON_TASK",
          classification: {
            domain: "QUALITY",
            subtype: "QUALITY_OTHER_OR_UNCERTAIN",
            confidence: "LOW",
            rationale: ["寒暄"],
            missingInformation: [],
          },
          tasks: [],
          openQuestions: [],
          capaAdvisory: {
            advisory: "INSUFFICIENT_INFO",
            rationale: ["非任务"],
            disclaimer: CAPA_DISCLAIMER,
            promptingQuestions: [],
          },
          gateSelfCheck: { passed: true, missingByTask: [] },
        }),
    }
  );

  expect(result.status).toBe("CONVERSATION");
  if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
  expect(result.responseIntent).toBe("CHAT");
  expect(result.assistantMessage).toContain("质量或研发任务");
  expect(result.markdown).toBeUndefined();
});

it("returns RESET_OR_NEW_TASK without carrying a task table", async () => {
  const result = await createTaskPlanningDemo(
    { background: "咱们开始一个新任务吧", domainHint: "QUALITY", sessionDigest: "上一轮任务包：旧任务" },
    {
      llmPlanner: async () =>
        qualityLlmPlannerResponse({
          responseIntent: "RESET_OR_NEW_TASK",
          assistantMessage: "好的，我们从新任务开始。请直接告诉我新任务的背景、目标和时间要求。",
          clarificationUx: "NON_TASK",
          classification: {
            domain: "QUALITY",
            subtype: "QUALITY_OTHER_OR_UNCERTAIN",
            confidence: "LOW",
            rationale: ["用户明确要求开始新任务"],
            missingInformation: [],
          },
          tasks: [],
          openQuestions: [],
          capaAdvisory: {
            advisory: "INSUFFICIENT_INFO",
            rationale: ["等待新任务背景"],
            disclaimer: CAPA_DISCLAIMER,
            promptingQuestions: [],
          },
          gateSelfCheck: { passed: true, missingByTask: [] },
        }),
    }
  );

  expect(result.status).toBe("CONVERSATION");
  if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
  expect(result.responseIntent).toBe("RESET_OR_NEW_TASK");
  expect(result.assistantMessage).toContain("新任务");
});
```

- [ ] **Step 2: Run failing pipeline tests**

Run:

```powershell
npm test -- tests/agent/demo/pipeline.test.ts
```

Expected: FAIL because `CONVERSATION`, `responseIntent`, and `assistantMessage` result fields do not exist.

- [ ] **Step 3: Update result union**

In `src/agent/demo/pipeline.ts`, update the type import:

```ts
import type { ClarificationUxKind, DemoGenerationMetadata, ResponseIntent } from "./llm-types";
```

Add a result branch before `DRAFT_READY`:

```ts
  | {
      status: "CONVERSATION";
      responseIntent: Exclude<ResponseIntent, "DRAFT" | "REVISE_DRAFT">;
      assistantMessage: string;
      questions: string[];
      missingFields: string[];
      clarificationUx?: ClarificationUxKind;
      markdown?: undefined;
      classification?: ClassificationResult;
      capaAdvisory?: CapaAdvisory;
      tasks?: undefined;
      gate?: undefined;
      generation?: DemoGenerationMetadata;
    }
```

Update `DRAFT_READY` branch:

```ts
responseIntent: "DRAFT" | "REVISE_DRAFT";
assistantMessage: string;
```

- [ ] **Step 4: Add intent helpers**

Near `MISSING_PLANNER_MESSAGE`, add:

```ts
const DRAFT_INTENTS = new Set<ResponseIntent>(["DRAFT", "REVISE_DRAFT"]);

function isDraftIntent(intent: ResponseIntent): intent is "DRAFT" | "REVISE_DRAFT" {
  return DRAFT_INTENTS.has(intent);
}
```

- [ ] **Step 5: Branch before old needs-more-info return**

Replace the existing `if (needsMoreInfo) { ... return NEEDS_MORE_INFO ... }` block with:

```ts
if (!isDraftIntent(normalized.responseIntent)) {
  appendDemoRunAudit({
    traceId,
    status: "NEEDS_MORE_INFO",
    reason: `llm_response_intent_${normalized.responseIntent.toLowerCase()}`,
    tokenTotals: sumTokenTotals(traces),
    wallClockMs: auditWallMs(),
    timingsMs: { plannerMs, coerceMs, validateMs },
    correctionUsed,
  });
  return {
    status: "CONVERSATION",
    responseIntent: normalized.responseIntent,
    assistantMessage: normalized.assistantMessage,
    questions: normalized.openQuestions,
    missingFields: classification.missingInformation,
    clarificationUx: normalized.clarificationUx,
    classification,
    capaAdvisory,
    generation: {
      trace: activeTrace,
      traces,
      correctionUsed,
      timings: { plannerMs, coerceMs, validateMs, gateMs: 0, renderMs: 0 },
    },
  };
}
```

Leave `needsMoreInfo` calculation in place for validation compatibility, but intent now owns the user-facing branch.

- [ ] **Step 6: Add intent fields to draft logs and return**

In `logStructured`, add:

```ts
responseIntent: normalized.responseIntent,
taskCount: tasks.length,
```

In `appendDemoRunAudit` for `DRAFT_READY`, add:

```ts
responseIntent: normalized.responseIntent,
```

If `appendDemoRunAudit` typing rejects extra fields, add a `metadata` object instead:

```ts
metadata: { responseIntent: normalized.responseIntent, taskCount: tasks.length },
```

In `savePlanSnapshot`, add:

```ts
responseIntent: normalized.responseIntent,
assistantMessage: normalized.assistantMessage,
```

If snapshot typing rejects extra fields, omit this addition and keep observability in structured logs only.

In the `DRAFT_READY` return object, add:

```ts
responseIntent: normalized.responseIntent,
assistantMessage: normalized.assistantMessage,
```

- [ ] **Step 7: Run pipeline tests**

Run:

```powershell
npm test -- tests/agent/demo/pipeline.test.ts
```

Expected: PASS after updating assertions that still expect old `NEEDS_MORE_INFO` for non-task model outputs. Keep the thin input guard as `NEEDS_MORE_INFO` because that is deterministic input QC, not an LLM intent.

---

### Task 3: Render by Intent in DingTalk and Remove User Summary

**Files:**
- Modify: `src/agent/demo/markdown-renderer.ts`
- Modify: `src/dingtalk-needs-more-info-markdown.ts`
- Modify: `src/dingtalk-bot.ts`
- Test: `tests/agent/demo/output.test.ts`
- Test: `tests/agent/demo/pipeline.test.ts`

- [ ] **Step 1: Add failing renderer tests**

In `tests/agent/demo/output.test.ts`, add:

```ts
it("omits task understanding summary for user-facing drafts", () => {
  const markdown = renderPlanDraftMarkdown({
    summary: "这段不应出现在用户侧。",
    classification: {
      domain: "QUALITY",
      subtype: "PRODUCTION_PROCESS_ABNORMALITY",
      confidence: "HIGH",
      rationale: ["生产异常"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "UNCERTAIN",
      rationale: ["需要确认是否重复发生"],
      disclaimer:
        "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
      promptingQuestions: [],
    },
    tasks: [
      {
        id: "task_1",
        title: "问题事实确认",
        objective: "确认事实",
        collaborators: [],
        inputMaterials: ["生产记录"],
        actions: ["确认事实"],
        deliverables: ["事实确认记录"],
        completionCriteria: ["范围清楚"],
        timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1" },
        feedbackFrequency: "每日",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ],
    gate: { passed: true, missingByTask: [] },
    openQuestions: [],
  });

  expect(markdown).not.toContain("## 任务理解摘要");
  expect(markdown).not.toContain("这段不应出现在用户侧。");
  expect(markdown).toContain("## 建议任务包");
});
```

- [ ] **Step 2: Run failing renderer tests**

Run:

```powershell
npm test -- tests/agent/demo/output.test.ts
```

Expected: FAIL because user-facing renderer still includes `## 任务理解摘要`.

- [ ] **Step 3: Remove summary from user-facing renderer**

In `src/agent/demo/markdown-renderer.ts`, change the user sections from:

```ts
const sections = [
  ["# 任务拆解草案", "_以下草案可继续回复「再细化」「调整截止时间」「补充风险」等要求进行修改。_"].join(
    "\n\n"
  ),
  renderSummary(input.summary),
];
```

to:

```ts
const sections = [
  ["# 任务拆解草案", "_以下草案可继续回复「再细化」「调整截止时间」「补充风险」等要求进行修改。_"].join(
    "\n\n"
  ),
];
```

Keep `renderDiagnosticPlanDraftMarkdown` unchanged.

- [ ] **Step 4: Add assistant-message formatter**

Replace `src/dingtalk-needs-more-info-markdown.ts` with:

```ts
/**
 * DingTalk non-draft replies: show the model's natural assistant message first,
 * then append concise structured questions only when they add information.
 */
export function formatNeedsMoreInfoDingTalkMarkdown(
  questions: string[],
  assistantMessage?: string
): string {
  const sections: string[] = [];
  const message = assistantMessage?.trim();
  if (message) sections.push(message);

  const cleanQuestions = questions.map((q) => q.trim()).filter(Boolean);
  const deduped = cleanQuestions.filter((q) => q !== message);
  if (deduped.length > 0) {
    sections.push(deduped.join("\n\n"));
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 5: Branch DingTalk formatting**

In `src/dingtalk-bot.ts`, update `formatDemoReply`:

```ts
function formatDemoReply(result: TaskPlanningDemoResult): {
  title: string;
  markdownText: string;
} {
  if (result.status === "CONVERSATION") {
    return {
      title: conversationTitle(result.responseIntent),
      markdownText: formatNeedsMoreInfoDingTalkMarkdown(
        result.questions,
        result.assistantMessage
      ),
    };
  }
  if (result.status === "NEEDS_MORE_INFO") {
    const markdownText = formatNeedsMoreInfoDingTalkMarkdown(result.questions);
    return { title: "待补充信息", markdownText };
  }
  if (result.status === "GENERATION_FAILED") {
    // existing block unchanged
  }
  return {
    title: result.responseIntent === "REVISE_DRAFT" ? "任务拆解草案（已更新）" : "任务拆解草案",
    markdownText: truncateMarkdown(result.markdown),
  };
}
```

Add helper above `formatDemoReply`:

```ts
function conversationTitle(intent: string): string {
  switch (intent) {
    case "CHAT":
      return "消息";
    case "CLARIFY":
      return "待补充信息";
    case "DISCUSS":
      return "任务讨论";
    case "RESET_OR_NEW_TASK":
      return "新任务";
    default:
      return "消息";
  }
}
```

- [ ] **Step 6: Run rendering tests**

Run:

```powershell
npm test -- tests/agent/demo/output.test.ts tests/agent/demo/pipeline.test.ts
```

Expected: PASS.

---

### Task 4: Upgrade Session Memory

**Files:**
- Modify: `src/infra/session-digest.ts`
- Modify: `src/dingtalk-bot.ts`
- Test: create `tests/infra/session-digest.test.ts` or extend existing infra tests if present

- [ ] **Step 1: Add failing session digest tests**

Create `tests/infra/session-digest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAPA_DISCLAIMER } from "../../src/domain/capa";
import {
  buildConversationStateFromResult,
  summarizePriorDemoForPrompt,
} from "../../src/infra/session-digest";
import type { TaskPlanningDemoResult } from "../../src/agent/demo/pipeline";

describe("session digest conversational state", () => {
  it("records reset intent and avoids carrying old task questions", () => {
    const result: TaskPlanningDemoResult = {
      status: "CONVERSATION",
      responseIntent: "RESET_OR_NEW_TASK",
      assistantMessage: "好的，我们从新任务开始。",
      questions: [],
      missingFields: [],
      clarificationUx: "NON_TASK",
      generation: undefined,
    };

    const state = buildConversationStateFromResult(result, {
      currentTopicSummary: "旧质量问题",
      unresolvedQuestions: ["旧问题现象是什么？"],
    });

    expect(state.userRejectedTemplate).toBe(true);
    expect(state.activeDraftBrief).toBeUndefined();
    expect(state.unresolvedQuestions).toEqual([]);
  });

  it("summarizes active draft without reading user-facing markdown summary", () => {
    const result: TaskPlanningDemoResult = {
      status: "DRAFT_READY",
      responseIntent: "DRAFT",
      assistantMessage: "已生成草案。",
      questions: ["是否存在重复发生？"],
      missingFields: [],
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["需确认重复性"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "问题事实确认",
          objective: "确认事实",
          collaborators: [],
          inputMaterials: ["记录"],
          actions: ["确认"],
          deliverables: ["事实记录"],
          completionCriteria: ["事实明确"],
          timeNode: { checkpoints: ["T+1"], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      gate: { passed: true, missingByTask: [] },
      markdown: "# 任务拆解草案\n\n## 建议任务包",
      generation: {
        trace: undefined,
        traces: [],
        correctionUsed: false,
        timings: { plannerMs: 0, coerceMs: 0, validateMs: 0, gateMs: 0, renderMs: 0 },
      },
    };

    const state = buildConversationStateFromResult(result);
    const digest = summarizePriorDemoForPrompt(result, 2000, state);

    expect(state.activeDraftBrief).toContain("task_1 问题事实确认");
    expect(digest).toContain("当前会话状态");
    expect(digest).not.toContain("任务理解摘要");
  });
});
```

- [ ] **Step 2: Run failing memory tests**

Run:

```powershell
npm test -- tests/infra/session-digest.test.ts
```

Expected: FAIL because `buildConversationStateFromResult` and the new signature do not exist.

- [ ] **Step 3: Add conversation state types and builder**

In `src/infra/session-digest.ts`, add:

```ts
import type { ResponseIntent } from "../agent/demo/llm-types";

export interface DemoConversationState {
  currentTopicSummary?: string;
  lastResponseIntent?: ResponseIntent;
  activeDraftBrief?: string;
  knownFacts?: string[];
  unresolvedQuestions?: string[];
  userPreferences?: string[];
  userRejectedTemplate?: boolean;
  lastUserIntent?: string;
}

export function buildConversationStateFromResult(
  result: TaskPlanningDemoResult,
  previous?: DemoConversationState
): DemoConversationState {
  if (result.status === "CONVERSATION" && result.responseIntent === "RESET_OR_NEW_TASK") {
    return {
      lastResponseIntent: "RESET_OR_NEW_TASK",
      userRejectedTemplate: true,
      lastUserIntent: "用户要求开始新任务或停止沿用旧模板",
      knownFacts: [],
      unresolvedQuestions: [],
      userPreferences: [...(previous?.userPreferences ?? []), "用户不希望重复旧模板"],
    };
  }

  if (result.status === "CONVERSATION") {
    return {
      ...previous,
      lastResponseIntent: result.responseIntent,
      lastUserIntent: result.assistantMessage,
      unresolvedQuestions: result.questions,
      userRejectedTemplate: previous?.userRejectedTemplate ?? false,
    };
  }

  if (result.status === "DRAFT_READY") {
    return {
      ...previous,
      currentTopicSummary: `${result.classification.domain}/${result.classification.subtype}`,
      lastResponseIntent: result.responseIntent,
      activeDraftBrief: summarizeTasks(result.tasks),
      knownFacts: [
        `领域=${result.classification.domain}`,
        `子类型=${result.classification.subtype}`,
        `置信度=${result.classification.confidence}`,
      ],
      unresolvedQuestions: result.questions.slice(0, 10),
      userRejectedTemplate: false,
    };
  }

  return previous ?? {};
}
```

Add helper:

```ts
function summarizeTasks(tasks: Array<{ id: string; title: string; objective: string }>): string {
  return tasks
    .slice(0, 8)
    .map((task) => `${task.id} ${task.title}：${oneLine(task.objective)}`)
    .join("；");
}
```

- [ ] **Step 4: Update digest signature**

Change `summarizePriorDemoForPrompt` signature:

```ts
export function summarizePriorDemoForPrompt(
  result: TaskPlanningDemoResult,
  maxChars = DEFAULT_MAX_CHARS,
  state?: DemoConversationState
): string | undefined {
```

At the top of the function after `const lines: string[] = [];`, add:

```ts
if (state) {
  lines.push("当前会话状态：");
  if (state.lastResponseIntent) lines.push(`- 上轮回复意图：${state.lastResponseIntent}`);
  if (state.currentTopicSummary) lines.push(`- 当前主题：${state.currentTopicSummary}`);
  if (state.activeDraftBrief) lines.push(`- 活跃草案：${state.activeDraftBrief}`);
  if (state.knownFacts?.length) lines.push(`- 已知事实：${state.knownFacts.join("；")}`);
  if (state.unresolvedQuestions?.length) lines.push(`- 未解决问题：${state.unresolvedQuestions.join("；")}`);
  if (state.userPreferences?.length) lines.push(`- 用户偏好：${state.userPreferences.join("；")}`);
  if (state.userRejectedTemplate) lines.push("- 用户已表达不希望重复旧模板或旧追问。");
}
```

Remove the `extractMarkdownSection(result.markdown, "任务理解摘要")` block entirely.

- [ ] **Step 5: Update DingTalk session context**

In `src/dingtalk-bot.ts`, update imports:

```ts
import {
  buildConversationStateFromResult,
  readConversationStateFromDigest,
  summarizePriorDemoForPrompt,
  type DemoConversationState,
} from "./infra/session-digest";
```

Do not add `readConversationStateFromDigest` unless implemented. Use this import instead:

```ts
import {
  buildConversationStateFromResult,
  summarizePriorDemoForPrompt,
  type DemoConversationState,
} from "./infra/session-digest";
```

Update interface:

```ts
interface DingTalkDemoSessionContext {
  priorDigest?: string;
  conversationState?: DemoConversationState;
}
```

Replace next digest calculation:

```ts
const nextState = buildConversationStateFromResult(demoResult, prior?.conversationState);
const nextDigest =
  summarizePriorDemoForPrompt(demoResult, sessionDigestMaxChars, nextState) ??
  prior?.priorDigest;
chatSessionMemory.set(chatKey, {
  priorDigest: demoResult.status === "CONVERSATION" && demoResult.responseIntent === "RESET_OR_NEW_TASK"
    ? nextDigest
    : nextDigest,
  conversationState: nextState,
});
```

The ternary currently returns the same value on both branches. Replace it with the simpler final code:

```ts
chatSessionMemory.set(chatKey, {
  priorDigest: nextDigest,
  conversationState: nextState,
});
```

- [ ] **Step 6: Run memory tests**

Run:

```powershell
npm test -- tests/infra/session-digest.test.ts
```

Expected: PASS.

---

### Task 5: Rewrite Prompt to v2.11 Conversational Intent

**Files:**
- Modify: `src/agent/demo/qwen-prompt.ts`
- Test: `tests/agent/demo/qwen-prompt.test.ts`
- Modify: `docs/Qwen-接入实施说明.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add failing prompt tests**

In `tests/agent/demo/qwen-prompt.test.ts`, update the version test:

```ts
it("v2.11：先判断回复意图，再决定聊天、追问、讨论、出稿或修订", () => {
  const sys = buildQwenPlannerSystemPrompt();
  expect(sys).toContain("task-planning-agent-v2.11.0");
  expect(sys).toContain("responseIntent");
  expect(sys).toContain("assistantMessage");
  expect(sys).toContain("CHAT");
  expect(sys).toContain("CLARIFY");
  expect(sys).toContain("DISCUSS");
  expect(sys).toContain("DRAFT");
  expect(sys).toContain("REVISE_DRAFT");
  expect(sys).toContain("RESET_OR_NEW_TASK");
  expect(sys).toContain("只有当 responseIntent 为 DRAFT 或 REVISE_DRAFT");
  expect(sys).toContain("不要把 openQuestions 当作自然回复的唯一出口");
  expect(sys).toContain("不要输出固定身份段落");
  expect(sys).toContain("复杂任务可拆成 10-20 个甚至更多任务包");
  expect(sys).not.toContain("本机器人为钉钉内任务规划 Demo 助手");
});
```

- [ ] **Step 2: Run failing prompt tests**

Run:

```powershell
npm test -- tests/agent/demo/qwen-prompt.test.ts
```

Expected: FAIL because prompt is still v2.10.

- [ ] **Step 3: Bump prompt version**

In `src/agent/demo/qwen-prompt.ts`:

```ts
export const QWEN_PLANNER_PROMPT_VERSION = "task-planning-agent-v2.11.0";
```

- [ ] **Step 4: Replace system prompt body**

Keep imports and function signatures. Replace the `return [` array inside `buildQwenPlannerSystemPrompt` with:

```ts
return [
  `promptVersion: ${QWEN_PLANNER_PROMPT_VERSION}`,
  "你是任务规划与承接确认助手。你的目标不是机械填表，而是在对话中帮助用户把质量或研发任务逐步变成可承接、可验收、可追溯的任务包。",
  "必须仅输出 JSON，不要输出解释文字；不要使用 markdown 代码围栏包裹，应直接输出单个 JSON 对象。不要编造输入中没有依据的事实、时间、交付物或验收标准。",
  "每轮先判断 responseIntent，再决定输出内容。responseIntent 只能是 CHAT、CLARIFY、DISCUSS、DRAFT、REVISE_DRAFT、RESET_OR_NEW_TASK。",
  "必须输出 assistantMessage。assistantMessage 是用户可直接看到的自然回复；不要把 openQuestions 当作自然回复的唯一出口。",
  "CHAT：用于寒暄、无关话题、轻量身份说明或普通问答。自然回应即可，可简短说明你能帮助拆解质量或研发任务，并引导用户提供任务背景。不要输出固定身份段落，不要机械要求用户按固定句式重发。",
  "CLARIFY：用户在说真实任务但关键信息不足。assistantMessage 应自然追问最关键的信息；openQuestions 可放结构化问题。不要输出任务表，不要重复追问上轮已经给出的事实。",
  "DISCUSS：用户在讨论、质疑、反驳、评价或询问上一轮草案。先回答问题、解释取舍或建议怎么改；默认不重出完整任务表。若用户明确要求修改，或修正结论已经足够明确，使用 REVISE_DRAFT。",
  "DRAFT：用户提供的信息足以生成初稿时使用。此时 tasks 必须至少 1 条，并完整输出任务包、分类、门禁自检；QUALITY 域输出 capaAdvisory，RD 域不得输出 capaAdvisory。",
  "REVISE_DRAFT：用户要求基于上一轮草案细化、调整、重排、补充风险、拆细任务或改变截止时间时使用。应保留未被用户改变的已知事实，并输出更新后的完整任务包。",
  "RESET_OR_NEW_TASK：用户明确说重新开始、开始新任务、不要这个模板、别沿用上一轮、换个任务时使用。assistantMessage 应确认已准备开始新任务，并请用户提供新任务背景；tasks=[]，gateSelfCheck.passed=true，missingByTask=[]。",
  "只有当 responseIntent 为 DRAFT 或 REVISE_DRAFT 时才输出实质任务表内容。CHAT、CLARIFY、DISCUSS、RESET_OR_NEW_TASK 均应 tasks=[]，gateSelfCheck.passed=true 且 missingByTask=[]。",
  "classification 仍必须输出。非任务或对话态可使用 LOW 与 *_OTHER_OR_UNCERTAIN，但不要让分类字段支配自然对话。若存在上轮上下文，先判断本轮是在继续、讨论、重置还是补充，不要把围绕上一轮的短反馈误判成新任务。",
  "任务数量按复杂度决定。简单单人任务可少量拆分；跨角色、跨阶段、有并行依赖、质量闭环或研发验证的大任务，应拆成足够细的任务包，复杂任务可拆成 10-20 个甚至更多任务包。不要为了凑数填充低价值任务，也不要为了压缩数量牺牲可承接性。",
  "tasks 中 deliverables 必须是具体可交付物，completionCriteria 必须是可验证通过标准，timeNode.dueAt 必须来自用户约束或合理模型判断，feedbackFrequency 必须说明反馈节奏。",
  "QUALITY 域在 DRAFT/REVISE_DRAFT 时必须输出完整 capaAdvisory：advisory、rationale、disclaimer、promptingQuestions 缺一不可。信息不足但仍为 QUALITY 对话态时，可使用 INSUFFICIENT_INFO 的无害 CAPA 建议以满足结构兼容。",
  "RD 域不得输出 capaAdvisory。",
  "生成任务后执行 gateSelfCheck：对每个 task 检查 deliverables、completionCriteria、timeNode.dueAt、feedbackFrequency；检查 dependencyTaskIds 是否存在；检查是否存在循环依赖。若 tasks 为空，则 gateSelfCheck.passed=true 且 missingByTask=[]。",
  "JSON 顶层字段必须为 responseIntent、assistantMessage、classification、tasks、openQuestions、gateSelfCheck；可选 clarificationUx；QUALITY 域按规则包含 capaAdvisory。",
  "classification 必须是对象：{domain, subtype, confidence, rationale, missingInformation}。domain 只能是 QUALITY 或 RD。",
  "classification.subtype 必须与 domain 匹配，且只能是下列字面量之一：QUALITY=PRODUCTION_PROCESS_ABNORMALITY | INSPECTION_OR_TEST_ABNORMALITY | CUSTOMER_COMPLAINT_OR_FIELD_ISSUE | SUPPLIER_ISSUE | DESIGN_RELATED_QUALITY_TASK | QUALITY_OTHER_OR_UNCERTAIN；RD=REQUIREMENT_OR_DESIGN_INPUT | SOLUTION_DEVELOPMENT | VERIFICATION_AND_VALIDATION | DESIGN_CHANGE_ACTION | RD_OTHER_OR_UNCERTAIN。",
  "tasks 必须是数组，元素字段：id,title,objective,collaborators,inputMaterials,actions,deliverables,completionCriteria,timeNode,feedbackFrequency,risksAndOpenQuestions,dependencyTaskIds。timeNode 字段必须包含 checkpoints 和 dueAt。gateSelfCheck.missingByTask 元素必须包含 taskId、title、missingFields。",
].join("\n");
```

- [ ] **Step 5: Update user prompt wording**

In `buildQwenPlannerUserPrompt`, replace the current instruction string with:

```ts
"请基于以下输入和上轮上下文判断本轮 responseIntent，并输出对应 JSON。需要聊天就自然回复；需要追问就简洁追问；需要讨论就先解释；只有信息足够生成或修订任务草案时才输出任务包：",
```

- [ ] **Step 6: Update docs**

In `AGENTS.md`, change current prompt version to:

```md
当前 **`task-planning-agent-v2.11.0`**
```

In `docs/Qwen-接入实施说明.md`, add a v2.11 note:

```md
5. **prompt v2.11**：引入 `responseIntent` 与 `assistantMessage`。模型先判断本轮是聊天、追问、讨论、出稿、修订还是新任务重置；钉钉侧按意图渲染，只有 `DRAFT` / `REVISE_DRAFT` 输出完整任务表。用户侧不再展示 `任务理解摘要`，自然回复不再挤在 `openQuestions` 中。
```

- [ ] **Step 7: Run prompt tests**

Run:

```powershell
npm test -- tests/agent/demo/qwen-prompt.test.ts
```

Expected: PASS.

---

### Task 6: Add Intent Evaluation Fixtures

**Files:**
- Create: `tests/agent/demo/conversational-intent-eval.test.ts`
- Reuse: `src/agent/demo/qwen-prompt.ts`

- [ ] **Step 1: Add test file with prompt contract fixtures**

Create `tests/agent/demo/conversational-intent-eval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

const cases = [
  {
    name: "template rejection",
    input: "不要给我发这个模板了",
    expectedIntent: "DISCUSS or RESET_OR_NEW_TASK",
  },
  {
    name: "new task reset",
    input: "咱们开始一个新任务吧",
    expectedIntent: "RESET_OR_NEW_TASK",
  },
  {
    name: "post draft challenge",
    input: "为什么你把风险排查放在后面？这是不是不合理？",
    expectedIntent: "DISCUSS",
  },
  {
    name: "large detailed decomposition",
    input: "请把一个跨研发、质量、生产的设计变更验证项目细拆到可执行层级",
    expectedIntent: "DRAFT with 10-20+ tasks when facts are sufficient",
  },
];

describe("conversational intent prompt eval fixtures", () => {
  it("documents the critical user turns the v2.11 prompt must handle", () => {
    const prompt = buildQwenPlannerSystemPrompt();

    for (const item of cases) {
      expect(item.input.length).toBeGreaterThan(0);
      expect(item.expectedIntent.length).toBeGreaterThan(0);
    }
    expect(prompt).toContain("RESET_OR_NEW_TASK");
    expect(prompt).toContain("DISCUSS");
    expect(prompt).toContain("10-20");
  });
});
```

This is a lightweight prompt-contract test, not a live model eval. Live model comparison should be added later behind explicit API configuration.

- [ ] **Step 2: Run eval fixture test**

Run:

```powershell
npm test -- tests/agent/demo/conversational-intent-eval.test.ts
```

Expected: PASS.

---

### Task 7: Full Verification and Documentation Pass

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-05-09-conversational-intent-agent-redesign.md`
- Modify if needed: `docs/Qwen-接入实施说明.md`
- Modify if needed: `AGENTS.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- tests/agent/demo/llm-schema.test.ts tests/agent/demo/pipeline.test.ts tests/agent/demo/output.test.ts tests/agent/demo/qwen-prompt.test.ts tests/infra/session-digest.test.ts tests/agent/demo/conversational-intent-eval.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Check lints in edited files**

Use Cursor lints for:

```text
src/agent/demo/llm-types.ts
src/agent/demo/llm-schema.ts
src/agent/demo/pipeline.ts
src/agent/demo/markdown-renderer.ts
src/dingtalk-needs-more-info-markdown.ts
src/dingtalk-bot.ts
src/infra/session-digest.ts
src/agent/demo/qwen-prompt.ts
tests/agent/demo/llm-schema.test.ts
tests/agent/demo/pipeline.test.ts
tests/agent/demo/output.test.ts
tests/agent/demo/qwen-prompt.test.ts
tests/infra/session-digest.test.ts
tests/agent/demo/conversational-intent-eval.test.ts
```

Expected: no new diagnostics in edited files.

- [ ] **Step 5: Manual DingTalk smoke scenarios after deployment**

After implementation is committed, pushed, and deployed, test these messages in DingTalk:

```text
你好
```

Expected: natural `CHAT` response, no task table.

```text
不要给我发这个模板了
```

Expected: natural `DISCUSS` response acknowledging the preference, no repeated quality missing-information template.

```text
咱们开始一个新任务吧
```

Expected: `RESET_OR_NEW_TASK`, prior draft context cleared or de-prioritized.

```text
生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。
```

Expected: `DRAFT`, full task table, no `任务理解摘要`.

```text
这个拆得太粗了，继续细化到可以直接分派给不同执行人
```

Expected: `REVISE_DRAFT`, more granular task packages than the prior draft.

- [ ] **Step 6: Commit checkpoint**

Only commit when the user explicitly asks for a commit. Suggested message:

```bash
git add AGENTS.md docs/Qwen-接入实施说明.md docs/superpowers/specs/2026-05-09-conversational-intent-agent-redesign.md docs/superpowers/plans/2026-05-09-conversational-intent-agent-redesign.md src/agent/demo/llm-types.ts src/agent/demo/llm-schema.ts src/agent/demo/pipeline.ts src/agent/demo/markdown-renderer.ts src/agent/demo/qwen-prompt.ts src/dingtalk-bot.ts src/dingtalk-needs-more-info-markdown.ts src/infra/session-digest.ts tests/agent/demo/llm-schema.test.ts tests/agent/demo/pipeline.test.ts tests/agent/demo/output.test.ts tests/agent/demo/qwen-prompt.test.ts tests/agent/demo/conversational-intent-eval.test.ts tests/infra/session-digest.test.ts
git commit -m "feat(demo): add conversational response intents"
```

---

## Self-Review

### Spec Coverage

- `responseIntent` and `assistantMessage`: Task 1 and Task 5.
- Intent-based pipeline and rendering: Task 2 and Task 3.
- Remove user-facing `任务理解摘要`: Task 3.
- Richer session memory and reset behavior: Task 4.
- Task granularity and model comparison prep: Task 5 and Task 6.
- Thinking mode: documented as future/configurable in spec; no code change in this plan because the current Qwen-compatible client does not yet expose a stable toggle.
- Observability: Task 2 logs intent and task count where current logging types allow it.

### Red-Flag Scan

No implementation steps rely on vague future work markers or incomplete code. Every code-changing step includes concrete target snippets and exact test commands.

### Type Consistency

The plan consistently uses `ResponseIntent`, `responseIntent`, `assistantMessage`, `CONVERSATION`, `DRAFT`, `REVISE_DRAFT`, and `RESET_OR_NEW_TASK` across schema, pipeline, memory, renderer, and tests.
