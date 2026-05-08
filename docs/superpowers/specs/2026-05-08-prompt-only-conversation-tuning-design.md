# Prompt-Only Conversation Tuning Design

## Goal

Improve the DingTalk MVP interaction without adding a new routing stage or response-mode field. The robot should still use the current Qwen structured JSON pipeline, but the prompt should stop forcing every follow-up into a full task decomposition. User-facing task tables should use Chinese headers.

## Current Problems

- Follow-up messages such as "这个任务是不是不对" are treated like a new task-planning request, so the bot replies in the task decomposition format instead of answering the challenge naturally.
- The prompt contains overly rigid wording for non-task input, including fixed identity guidance such as "本机器人为钉钉内任务规划 Demo 助手..." and requiring the user to resend a complete background. This can be triggered incorrectly during an existing conversation.
- The rendered task package table still uses English headers: `task ID`, `title`, `objective`, `deliverables`, etc.

## Scope

In scope:

- Prompt wording in `src/agent/demo/qwen-prompt.ts`.
- User-facing Markdown labels in `src/agent/demo/markdown-renderer.ts`.
- Prompt and output tests.
- Documentation updates where prompt version or interaction behavior is mentioned.

Out of scope:

- No new `responseMode` or schema field.
- No separate intent-classifier model call.
- No persistent memory beyond the current in-process `sessionDigest`.
- No rule-based business draft generation.

## Recommended Approach

Use the existing JSON contract, but loosen the prompt's behavioral policy:

- The model still returns JSON because `QwenCompatibleClient` parses a single JSON object and the pipeline validates it.
- For genuine draft updates, the model returns `DRAFT_READY`-compatible JSON with tasks.
- For conversational follow-ups, critiques, or clarification about a previous draft, the model can return the existing low-confidence / empty-task shape and put a concise natural reply in `openQuestions`. The DingTalk side already renders `NEEDS_MORE_INFO` by joining `openQuestions` without bullets, so this can serve as a lightweight conversational reply without adding a new schema field.
- If the user clearly provides new facts that should change the draft, the model should update the task package rather than only chat.

This keeps the change small while reducing the chance that the bot mechanically outputs a full table for every turn.

## Prompt Changes

### Relax Conversational Constraints

Replace the current strict non-task block with guidance that distinguishes:

- **New task background:** generate a task package.
- **Supplemental facts:** update the existing draft if the facts materially affect tasks.
- **User critique or challenge:** answer the point first, explain whether the challenged task should change, and only regenerate the draft if the user explicitly asks or the correction is obvious.
- **General greeting / unrelated input:** reply briefly and naturally, without a fixed identity paragraph.

Avoid requiring any exact sentence such as "本机器人为钉钉内任务规划 Demo 助手". The prompt may say the bot should be clear about its role when helpful, but should not mandate fixed wording.

### Keep Output Discipline

The prompt should continue to require:

- JSON-only output, because downstream parsing depends on it.
- No fabricated facts, deliverables, deadlines, or acceptance criteria.
- Classification and task fields that satisfy the existing schema.
- Quality-domain CAPA advisory shape when the output domain is `QUALITY`, because schema validation currently requires it.

### Move These From Hard-Sounding Rules To Prompt Guidance

The following current restrictions can be softened into guidance rather than absolute behavior:

- Fixed non-task identity wording and "请您用一段完整..." resend instruction.
- "Short feedback must produce an improved draft" should become "short feedback may update the draft when it asks for revision; critique may receive a direct answer first."
- Task count should be guided by task complexity, not a fixed `3-5` target. Simple work may need only a few task packages; complex cross-functional work can be decomposed into dozens of packages if that makes ownership, dependencies, and acceptance clearer.
- Rationale and open question length should be "concise and useful", not mechanically minimized.
- Domain fallback for non-task input should not dominate conversational follow-ups; if there is prior context, use it.

### Keep These As Hard Constraints

These should stay as code/schema constraints or strict prompt requirements:

- JSON object only.
- `classification.domain` enum: `QUALITY` or `RD`.
- `classification.subtype` allowed values.
- Required task object field shapes.
- `openQuestions` as `string[]`.
- `gateSelfCheck` shape when present.
- `capaAdvisory` required for `QUALITY` and absent for `RD`, unless schema is redesigned later.
- `INPUT_MAX_CHARS` and PII redaction.

## Markdown Changes

Change the task table header from English to Chinese:

| Current | Target |
| --- | --- |
| task ID | 任务ID |
| title | 任务标题 |
| objective | 目标 |
| deliverables | 交付物 |
| completion criteria | 验收标准 |
| due date | 截止时间 |
| feedback frequency | 反馈频率 |
| dependencies | 依赖任务 |

Do not change the internal `TaskPackage` field names; only the rendered Markdown table header changes.

## Expected Behavior Examples

### User Challenges A Task

Prior draft exists. User says: "task_2 是不是不应该放在 task_1 前面？"

Expected: concise response in `openQuestions`, for example:

"你说得对，若 task_1 是事实确认，task_2 依赖事实输入，就不应该排在 task_1 前面。建议把 task_2 的依赖设为 task_1；如果你需要，我可以按这个顺序更新草案。"

No full task table is required unless the user asks to update.

### User Adds New Facts

User says: "补充一下，已经影响 30 台，客户要求明天下午前给初步结论。"

Expected: update the draft, especially scope, due date, and completion criteria.

### User Requests Fine-Grained Decomposition

User says: "这个任务很复杂，拆细一点，能拆几十个也可以。"

Expected: produce a more detailed task package set when useful. The model should preserve readable grouping and dependencies instead of forcing a small task count.

### User Says Hello

User says: "hi"

Expected: short natural guidance, not a fixed identity paragraph:

"你好，可以直接发质量或研发任务背景。我会帮你拆成可承接、可验收的任务草案。"

## Testing Plan

- Update `tests/agent/demo/qwen-prompt.test.ts` to assert the prompt contains critique-first guidance and no longer requires the fixed "本机器人..." wording.
- Add prompt assertions that "质疑", "先解释", and "不必每次重生成任务表" are represented.
- Add prompt assertions that task count is complexity-driven and may exceed a small fixed range.
- Update `tests/agent/demo/output.test.ts` to assert the task table header uses Chinese labels.
- Update `tests/agent/demo/qwen-compatible-client.test.ts` if prompt version changes.

## Documentation Updates

- Bump prompt version in `src/agent/demo/qwen-prompt.ts`.
- Update `AGENTS.md` current prompt version.
- Update `docs/Qwen-接入实施说明.md` to describe prompt-only conversational tuning and Chinese task table headers.

## Risks

Prompt-only routing cannot guarantee perfect behavior. The model may still sometimes choose a task-table response for a conversational challenge. If this remains unstable after testing in DingTalk, the next design should add an explicit `responseMode` field or a lightweight intent router.

## Self-Review

- No placeholders remain.
- The design stays within the user's chosen prompt-only direction.
- The spec distinguishes relaxable prompt behavior from hard schema/runtime constraints.
- The table header change is scoped to rendering only and does not affect domain data types.
- The task-count guidance no longer imposes a small default cap; it allows detailed decomposition when useful.
