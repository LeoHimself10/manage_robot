# Conversational Intent Agent Redesign

## Goal

Redesign the DingTalk task-planning MVP so it behaves more like a conversational task-planning agent and less like a rigid task-table generator.

The next version should relax over-constrained prompt behavior, preserve the model's ability to decide how to respond, improve session memory, and render different user-facing formats for chat, clarification, discussion, draft generation, and draft revision.

This design supersedes the prior prompt-only tuning direction. The new direction is a lightweight response-intent layer: keep structured JSON and validation, but make the first-class model decision "what kind of turn is this?" instead of forcing every turn through the full task draft surface.

## Background

Current production behavior has several user-facing problems:

- After two or more turns about the same task, a follow-up can be misread as a new task or as another missing-information prompt.
- Clarification, post-draft discussion, and unrelated chat can still sound like the same task-planning template.
- User-facing drafts include `任务理解摘要`, but the current implementation uses the original user input as that summary, so it feels repetitive and misleading.
- Large tasks are often decomposed too coarsely, even after prompt v2.10 relaxed the old fixed-size task count.
- The current `openQuestions` field is doing too much: natural chat reply, missing-information questions, and discussion response.

Recent agent implementation guidance supports this redesign:

- Anthropic's "Building effective agents" recommends simple composable patterns, adding complexity only where it improves outcomes, and using workflows for predictable paths while letting the model decide where flexibility is required.
- OpenAI's orchestration guidance recommends first deciding who owns the final user-facing answer on each branch, and adding routing/specialists only when the branch truly needs a different contract.
- Production memory guidance commonly separates short-term context, session state, long-term preferences, and retrieval, instead of stuffing raw history into the prompt.

For this product, the right next step is not a complex multi-agent framework. It is a small outer protocol that gives the model room to express conversational intent while the code keeps validation, audit, and dispatch gates reliable.

## Design Principles

- Put conversational judgment in the prompt and model output, not in fixed code templates.
- Keep code responsible for state, safety, validation, rendering, audit, and deployment reliability.
- Only run strict task gate checks when the turn is actually producing or revising a task draft.
- Do not use keyword-based business classification to replace the model's semantic judgment.
- Preserve JSON-only model output for parser stability and traceability.
- Keep the DingTalk user experience simple: one final Markdown bubble per user message, but content should vary by response intent.

## Proposed Response Contract

Add two top-level LLM fields:

```ts
responseIntent:
  | "CHAT"
  | "CLARIFY"
  | "DISCUSS"
  | "DRAFT"
  | "REVISE_DRAFT"
  | "RESET_OR_NEW_TASK";

assistantMessage: string;
```

### Intent Meanings

`CHAT`

- Greeting, unrelated question, lightweight identity explanation, or casual interaction.
- No task table.
- `assistantMessage` should answer naturally and briefly, then guide the user toward sending a quality or R&D task if useful.

`CLARIFY`

- The user appears to have a real task, but key information is missing.
- No task table.
- `assistantMessage` should ask naturally for the most important missing information.
- `openQuestions` may contain structured follow-up questions, but must not be the only natural reply surface.

`DISCUSS`

- The user is asking about, challenging, criticizing, or discussing an existing draft.
- No full task table by default.
- `assistantMessage` should directly answer the point, explain the tradeoff or reasoning, and say whether a revision is recommended.
- If the correction is obvious and the user asked for a change, use `REVISE_DRAFT` instead.

`DRAFT`

- Information is sufficient to produce an initial task decomposition.
- Render the full task draft table and relevant CAPA/gate sections.

`REVISE_DRAFT`

- The user asks to modify, refine, reorder, split, merge, or improve a previous draft.
- Render an updated task draft.
- The model should preserve known facts unless the user changes them.

`RESET_OR_NEW_TASK`

- The user explicitly says to start over, begin a new task, stop using the prior template, or abandon current context.
- Clear or de-prioritize active draft memory.
- Reply naturally that the conversation is ready for the new task, and ask for the new task background.

## Prompt Strategy

The prompt should be rewritten around a turn-level decision process:

1. Read current user input and session memory.
2. Decide `responseIntent`.
3. Produce the minimum useful response for that intent.
4. Only produce `tasks` when intent is `DRAFT` or `REVISE_DRAFT`.
5. For `DRAFT` and `REVISE_DRAFT`, decompose by actual complexity, not by a fixed target count.

Remove or weaken rigid rules:

- No fixed identity paragraph for non-task input.
- No mechanical "please resend a complete task background" wording.
- No assumption that every short follow-up must regenerate a complete task table.
- No use of `openQuestions` as the only surface for natural conversation.
- No user-facing summary section that simply repeats the user's original message.

Keep strict constraints:

- JSON-only output.
- No fabricated facts, deadlines, deliverables, or acceptance criteria.
- Domain and subtype enum constraints.
- QUALITY outputs include CAPA advisory only when the turn is producing or revising a QUALITY task draft, or when schema compatibility requires a harmless insufficient-info advisory.
- RD outputs must not include CAPA advisory.
- Gate self-check applies to task-producing intents only.

## Memory Design

Replace the current single `priorDigest` style with a richer session digest that remains prompt-friendly and bounded:

```ts
interface DingTalkDemoSessionContext {
  priorDigest?: string;
  conversationState?: {
    currentTopicSummary?: string;
    lastResponseIntent?: ResponseIntent;
    activeDraftBrief?: string;
    knownFacts?: string[];
    unresolvedQuestions?: string[];
    userPreferences?: string[];
    userRejectedTemplate?: boolean;
    lastUserIntent?: string;
  };
}
```

The memory summary should include:

- What task or topic is currently active.
- Whether there is an active draft.
- Which facts are already known.
- Which questions remain unresolved.
- Whether the user asked to avoid templates or start a new task.
- The last response intent.

When the user triggers `RESET_OR_NEW_TASK`, the active draft should be cleared or de-prioritized. The next prompt should not keep dragging the previous task's missing-information questions into the new conversation.

The memory implementation can stay in-process for MVP, but its shape should be compatible with future persistence.

## Rendering Design

DingTalk should still send one Markdown message per user turn, but the content should depend on `responseIntent`.

| Intent | User-facing rendering |
| --- | --- |
| `CHAT` | `assistantMessage` only |
| `CLARIFY` | `assistantMessage`, optionally followed by concise questions |
| `DISCUSS` | `assistantMessage` only unless a revision is explicitly requested |
| `RESET_OR_NEW_TASK` | reset confirmation plus prompt for new task background |
| `DRAFT` | full task draft table and relevant advisory/gate content |
| `REVISE_DRAFT` | updated full task draft table and relevant advisory/gate content |

Remove `## 任务理解摘要` from the user-facing DingTalk draft. If diagnostic output still needs the original input or summary, keep it only in diagnostic/audit paths.

## Task Granularity

Prompt guidance should make task count complexity-driven and concrete:

- Simple single-owner tasks may have a few task packages.
- Medium cross-functional work should normally break into role- or phase-specific packages.
- Complex quality or R&D initiatives may require 10-20+ packages when ownership, dependencies, evidence, validation, and acceptance need separation.
- If the user asks for detailed decomposition, the model should not collapse the work into three broad tasks unless the work is genuinely simple.

Add an evaluation set covering:

- Simple task.
- Medium task.
- Large quality task.
- Large R&D task.
- User explicitly asks for fine-grained WBS.
- User asks to split one broad task into more executable sub-tasks.

Evaluation should inspect task count, ownership boundaries, deliverables, acceptance criteria, dependency quality, and avoidance of filler tasks.

## Thinking Mode

Do not enable model thinking globally.

Recommended policy:

- `CHAT`, `CLARIFY`, `DISCUSS`, and `RESET_OR_NEW_TASK`: thinking off for low latency.
- `DRAFT` and `REVISE_DRAFT`: optionally enable thinking for complex inputs, especially when there are many dependencies, roles, or quality-system implications.
- Evaluation should compare thinking on/off for complex drafts before production rollout.

If the current Qwen-compatible API does not expose a stable thinking toggle, keep this as a configurable future option rather than blocking the redesign.

## Compatibility Strategy

To avoid a risky migration, implement compatibility in two phases:

### Phase 1: Accept New Fields, Preserve Old Shape

- Add optional `responseIntent` and `assistantMessage` to coercion and validation.
- Default missing `responseIntent` from existing signals:
  - empty tasks + low confidence -> `CLARIFY`
  - non-task clarification UX -> `CHAT`
  - non-empty tasks -> `DRAFT`
- Keep existing fields during transition.

### Phase 2: Prompt Requires New Fields

- Bump prompt version to `task-planning-agent-v2.11.0`.
- Require `responseIntent` and `assistantMessage`.
- Update DingTalk rendering to branch on intent.
- Keep schema validation strict enough to catch malformed JSON, but avoid hard-coding conversational wording in code.

## Testing Strategy

Add unit tests for:

- Prompt contains v2.11 response-intent guidance.
- Non-task input can produce `CHAT` with no task table.
- Real but incomplete task can produce `CLARIFY`.
- User challenge after a draft can produce `DISCUSS`.
- User asks "start a new task" can produce `RESET_OR_NEW_TASK` and memory reset behavior.
- DRAFT and REVISE_DRAFT still pass task shape and gate validation.
- DingTalk renderer omits `任务理解摘要` for user-facing drafts.
- Large-task fixture expects more than a minimal three-task decomposition unless clearly justified.

Add regression fixtures for model comparison:

- Current Qwen default.
- Qwen with optional thinking, if supported.
- GPT-5.5, if available through the compatible client or a test harness.
- DeepSeek V4 Pro, if available through the compatible client or a test harness.

## Observability

Log the following fields in structured traces:

- `responseIntent`
- `lastResponseIntent`
- whether active draft memory was used
- whether memory was reset
- task count for draft-producing turns
- prompt version
- model name
- optional thinking flag
- token and latency totals

This lets future tuning compare whether failures come from intent classification, memory, prompt behavior, or model capability.

## Risks

- Intent instability: the model may choose `DISCUSS` when the user expected a revised draft, or vice versa.
- Schema expansion increases implementation and testing scope.
- If the prompt becomes too permissive, drafts may lose required task-package discipline.
- More flexible rendering can hide gate failures if DRAFT/REVISE_DRAFT handling is not carefully separated.

Mitigation:

- Keep business gate validation strict for DRAFT/REVISE_DRAFT.
- Add regression fixtures for the exact failure cases observed in DingTalk.
- Start with in-process memory improvements before adding persistent memory.
- Keep one model call for MVP unless evaluation proves a separate router materially improves results.

## Non-Goals

- Do not build a complex multi-agent orchestration framework in this iteration.
- Do not add OA workflow, acceptance workflow, or execution feedback closure.
- Do not replace semantic LLM judgment with keyword routing.
- Do not preserve the old user-facing rigid template if it conflicts with conversational intent.

## Acceptance Criteria

- A user can say "不要给我发这个模板了" and the bot does not repeat the previous missing-information template.
- A user can say "咱们开始一个新任务吧" and the bot resets or de-prioritizes old task context.
- A user can discuss or challenge a draft without receiving a full task table every time.
- Missing-information replies are natural and concise.
- Unrelated chat receives a normal identity-aware response and gentle redirection.
- User-facing DingTalk drafts no longer include `任务理解摘要`.
- Large task prompts produce appropriately fine-grained decompositions in the evaluation set.
- Existing DRAFT/REVISE_DRAFT outputs remain valid JSON and pass gate checks.
