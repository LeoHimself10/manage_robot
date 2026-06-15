/**
 * Eval harness: one user turn through runManagerOrchestratorTurn (legacy or v2 via ORCHESTRATOR_ENGINE).
 */
import type { PlanSession } from "../src/infra/plan-session-store";
import type { QwenPlannerConfig } from "../src/agent/demo/qwen-planner";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import type { ProcessAssignmentTurnResult } from "../src/agent/assignment/process-assignment-turn";
import { runManagerOrchestratorTurn } from "../src/agent/manager-orchestrator-turn";
import { publishResultSucceeded } from "../src/agent/publish-helpers";

export interface DingtalkTurnEvalOptions {
  clientConfig: QwenPlannerConfig;
  senderStaffId: string;
  actorName?: string;
  maxToolIterations?: number;
  /** v2: when false, skip corresponding turn-level requirement retry. */
  allowAssignRetry?: boolean;
  allowSplitRetry?: boolean;
  allowPublishRetry?: boolean;
  managerFollowup?: boolean;
  enableDingtalkPreRetries?: boolean;
  workbenchRole?: "manager" | "admin";
}

export interface DingtalkTurnEvalResult {
  traceId: string;
  tools: string[];
  messages: string[];
  outboundMessage: string;
  ms: number;
  /** Session has draft tasks after turn (channel-agnostic). */
  hasDraftState: boolean;
  /** @deprecated use hasDraftState — legacy JSON直出通道 */
  hasDraftJson: boolean;
  draftForRender?: Record<string, unknown>;
  persistedDraft?: Record<string, unknown>;
  assignState: ProcessAssignmentTurnResult;
  publishResult?: Record<string, unknown>;
  publishOk: boolean;
  stopReason?: string;
  engine: "legacy" | "v2";
  /** Updated session after turn (draft, assignment, pool, conversation history). */
  session: PlanSession;
}

function readEngine(): "legacy" | "v2" {
  const v = String(process.env.ORCHESTRATOR_ENGINE ?? "legacy").trim().toLowerCase();
  return v === "v2" ? "v2" : "legacy";
}

export async function runDingtalkLikeTurn(
  session: PlanSession,
  userMessage: string,
  opts: DingtalkTurnEvalOptions,
): Promise<DingtalkTurnEvalResult> {
  const engine = readEngine();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const t0 = Date.now();

  const turn = await runManagerOrchestratorTurn({
    userMessage,
    session,
    employeeRepo,
    clientConfig: opts.clientConfig,
    senderStaffId: opts.senderStaffId,
    actorName: opts.actorName,
    workbenchRole: opts.workbenchRole,
    v2RetryOpts: engine === "v2"
      ? {
          allowAssignRetry: opts.allowAssignRetry !== false,
          allowPublishRetry: opts.allowPublishRetry !== false,
          allowSplitRetry: opts.allowSplitRetry !== false,
        }
      : undefined,
  });

  session = turn.session;
  const outboundMessage = turn.orchResult.messages.join("\n\n");
  const persistedDraft = (turn.persistedDraft ?? session.latestDraft) as
    | Record<string, unknown>
    | undefined;

  const taskCount = Array.isArray((persistedDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? (persistedDraft as { tasks: unknown[] }).tasks.length
    : 0;
  const hasDraftState = taskCount > 0;

  session.conversationHistory = [
    ...session.conversationHistory,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: outboundMessage || "(empty)" },
  ].slice(-12);
  session.updatedAt = new Date().toISOString();

  const publishResult = turn.publishResult ?? turn.orchResult.publishResult;

  return {
    traceId: turn.orchResult.traceId,
    tools: turn.orchResult.toolInvocationNames ?? [],
    messages: turn.orchResult.messages,
    outboundMessage,
    ms: Date.now() - t0,
    hasDraftState,
    hasDraftJson: turn.orchResult.draft !== undefined || hasDraftState,
    draftForRender: turn.draftForRender,
    persistedDraft,
    assignState: turn.assignState,
    publishResult,
    publishOk: publishResultSucceeded(publishResult),
    stopReason: turn.orchResult.observabilityFlags?.includes("orchestrator_max_turns_exceeded")
      ? "max_turns_exceeded"
      : "end_turn",
    engine,
    session,
  };
}

/** Reject eval user scripts that leak internal tool names (models should discover tools themselves). */
export function assertNaturalUserMessage(message: string): string[] {
  const banned = [
    /\bbulk_assign_tasks\b/i,
    /\bupdate_draft_task\b/i,
    /\bprepare_publish_task\b/i,
    /\bpublish_task\b/i,
    /\bsearch_employees\b/i,
    /\bassignment JSON\b/i,
    /\btaskId\b/i,
    /\btask_id\b/i,
    /\bREDRAFT\b/,
    /\bcandidatePool\b/i,
    /\breplace_draft\b/i,
  ];
  const hits = banned.filter((re) => re.test(message)).map((re) => re.source);
  return hits.length ? [`user message mentions internal tool/id: ${hits.join(", ")}`] : [];
}
