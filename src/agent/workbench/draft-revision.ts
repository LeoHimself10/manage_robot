import { runOrchestrator, type OrchestratorConfig, type OrchestratorResult } from "../orchestrator";
import type { PlanSession } from "../../infra/plan-session-store";
import { prevalidateWorkbenchDraftRevision } from "./draft-revise-prevalidate";

export const WORKBENCH_DRAFT_REVISION_TAG = "[WORKBENCH_DRAFT_REVISION]";

export function buildWorkbenchDraftRevisionUserMessage(input: {
  draft: Record<string, unknown>;
  assignment: Record<string, unknown>;
}): string {
  return [
    WORKBENCH_DRAFT_REVISION_TAG,
    "用户已在工作台 Excel 编辑器中提交完整草案修订。",
    "你的职责：校验 JSON 结构后**原样落库**为顶层 draft；禁止重拆主题、禁止改 WBS 条数语义、禁止 tool_calls。",
    "须输出顶层完整 draft JSON + 简短 message 确认。",
    "",
    JSON.stringify({
      draft: input.draft,
      assignment: input.assignment,
    }),
  ].join("\n");
}

export interface RunWorkbenchDraftRevisionInput {
  session: PlanSession;
  draft: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  orchestratorConfig: OrchestratorConfig;
}

export interface RunWorkbenchDraftRevisionResult {
  ok: true;
  orch: OrchestratorResult;
  prevalidatedDraft: Record<string, unknown>;
  prevalidatedAssignment: Record<string, unknown>;
}

export interface RunWorkbenchDraftRevisionFailure {
  ok: false;
  status: 400 | 503;
  error: string;
  errors?: string[];
}

export async function runWorkbenchDraftRevision(
  input: RunWorkbenchDraftRevisionInput,
): Promise<RunWorkbenchDraftRevisionResult | RunWorkbenchDraftRevisionFailure> {
  const pre = prevalidateWorkbenchDraftRevision({
    draft: input.draft,
    assignment: input.assignment,
    previousDraft: input.session.latestDraft,
    previousAssignment: input.session.latestAssignment as Record<string, unknown> | undefined,
  });
  if (!pre.ok) {
    return { ok: false, status: 400, error: "draft validation failed", errors: pre.errors };
  }

  const userMessage = buildWorkbenchDraftRevisionUserMessage({
    draft: pre.draft,
    assignment: pre.assignment,
  });

  const orch = await runOrchestrator(userMessage, {
    ...input.orchestratorConfig,
    maxToolIterations: 2,
    workbenchDraftRevision: true,
    disableTools: true,
    sessionContext: {
      ...input.orchestratorConfig.sessionContext,
      conversationHistory: input.orchestratorConfig.sessionContext?.conversationHistory ?? [],
      latestDraft: input.session.latestDraft,
      latestAssignment: input.session.latestAssignment,
    },
  });

  const outDraft = orch.draft ?? pre.draft;
  const outTasks = (outDraft as { tasks?: unknown[] } | undefined)?.tasks;
  if (!outDraft || !Array.isArray(outTasks) || outTasks.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "orchestrator did not return a valid draft; session unchanged",
    };
  }

  return {
    ok: true,
    orch,
    prevalidatedDraft: outDraft,
    prevalidatedAssignment: (orch.assignment ?? pre.assignment) as Record<string, unknown>,
  };
}
