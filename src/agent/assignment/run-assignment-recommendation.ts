import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig, CallWithToolsResult } from "../demo/qwen-compatible-client";
import { QwenCompatibleClient } from "../demo/qwen-compatible-client";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import { logStructured } from "../../infra/logger";
import type { AssignmentDraft } from "./types";
import { coerceAssignmentDraft, validateAssignmentDraft } from "./assignment-schema";
import {
  ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
  buildAssignmentSystemPrompt,
  buildAssignmentUserPrompt,
} from "./assignment-prompt";
import {
  SEARCH_EMPLOYEES_TOOL,
  GET_EMPLOYEE_DETAILS_TOOL,
  buildSearchEmployeesHandler,
  createSearchQuotaState,
  buildGetEmployeeDetailsHandler,
} from "./tools/search-employees";

export interface TaskPackage {
  id: string;
  title: string;
  objective: string;
  deliverables: string[];
  timeNode: { dueAt: string };
}

export interface RunAssignmentRecommendationInput {
  planId: string;
  traceId: string;
  tasks: TaskPackage[];
  classificationSummary: string;
  domainHint?: "QUALITY" | "RD";
  userInstruction?: string;
  previousAssignment?: Record<string, unknown>;
  knownFacts?: string[];
}

export interface RunAssignmentRecommendationDeps {
  employeeRepo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  };
  /** 用于 search_employees 本部门优先排序（与钉钉主链路一致时可传发起人 userId） */
  actorUserId?: string;
  qwenConfig: QwenCompatibleClientConfig;
  draftRepo: { save(draft: AssignmentDraft): Promise<void> };
  eventRepo: { append(event: Record<string, unknown>): Promise<void> };
  maxToolIterations?: number;
  selfCorrectionAttempts?: number;
}

export async function runAssignmentRecommendation(
  input: RunAssignmentRecommendationInput,
  deps: RunAssignmentRecommendationDeps,
): Promise<{ ok: true; draft: AssignmentDraft } | { ok: false; reason: string }> {
  const client = new QwenCompatibleClient(deps.qwenConfig);
  const maxToolIterations = Math.max(1, deps.maxToolIterations ?? 6);
  const selfCorrectionAttempts = Math.max(0, deps.selfCorrectionAttempts ?? 1);

  const listFn = () => deps.employeeRepo.list();
  const getFn = (userId: string) =>
    deps.employeeRepo.get?.(userId) ?? listFn().find((e) => e.userId === userId);
  const employeeRepoResolved = { list: listFn, get: getFn };
  const sharedQuota = createSearchQuotaState();
  const searchHandler = buildSearchEmployeesHandler(employeeRepoResolved, {
    actorUserId: deps.actorUserId,
    quotaState: sharedQuota,
  });
  const detailsHandler = buildGetEmployeeDetailsHandler(employeeRepoResolved, {
    quotaState: sharedQuota,
  });
  const assignmentTools = [SEARCH_EMPLOYEES_TOOL, GET_EMPLOYEE_DETAILS_TOOL];
  const assignmentToolHandlers = {
    search_employees: searchHandler,
    get_employee_details: detailsHandler,
  };

  const systemPrompt = buildAssignmentSystemPrompt();
  const userPrompt = buildAssignmentUserPrompt({
    planId: input.planId,
    traceId: input.traceId,
    tasks: input.tasks,
    classificationSummary: input.classificationSummary,
    userInstruction: input.userInstruction,
    previousAssignment: input.previousAssignment,
    knownFacts: input.knownFacts,
  });

  const messages: Array<{ role: string; content?: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // First call: with tools
  let result: CallWithToolsResult;
  try {
    result = await client.callWithTools({
      traceId: input.traceId,
      messages: messages as Parameters<QwenCompatibleClient["callWithTools"]>[0]["messages"],
      tools: assignmentTools,
      toolHandlers: assignmentToolHandlers,
      maxIterations: maxToolIterations,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logStructured({ event: "ASSIGNMENT_RECOMMENDER_FAILED", traceId: input.traceId, reason });
    return { ok: false, reason };
  }

  // Coerce
  let draft: AssignmentDraft;
  try {
    draft = coerceAssignmentDraft(result.payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logStructured({ event: "ASSIGNMENT_COERCE_FAILED", traceId: input.traceId, reason });
    return { ok: false, reason };
  }

  // Set metadata
  draft.planId = draft.planId || input.planId;
  draft.traceId = input.traceId;
  draft.generatedAt = draft.generatedAt || new Date().toISOString();
  draft.promptVersion = ASSIGNMENT_RECOMMENDER_PROMPT_VERSION;
  draft.modelName = draft.modelName || deps.qwenConfig.model;

  // Validate
  const allowedUserIds = deps.employeeRepo.list().map((e) => e.userId);
  const taskIds = input.tasks.map((t) => t.id);
  const validation = validateAssignmentDraft(draft, { allowedUserIds, taskIds });

  if (!validation.valid) {
    if (selfCorrectionAttempts === 0) {
      const reason = `验证失败：${validation.errors.join("；")}`;
      logStructured({ event: "ASSIGNMENT_VALIDATION_FAILED", traceId: input.traceId, reason });
      return { ok: false, reason };
    }

    // Self-correction: one round
    const errorMsg = `验证失败：${validation.errors.join("；")}\n请修正后重新生成完整的 AssignmentDraft JSON。`;

    const correctedMessages: Array<{ role: string; content?: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "assistant", content: JSON.stringify(result.payload) },
      { role: "user", content: errorMsg },
    ];

    try {
      const correctedResult = await client.callWithTools({
        traceId: input.traceId,
        messages: correctedMessages as Parameters<QwenCompatibleClient["callWithTools"]>[0]["messages"],
        tools: assignmentTools,
        toolHandlers: assignmentToolHandlers,
        maxIterations: maxToolIterations,
      });

      draft = coerceAssignmentDraft(correctedResult.payload);
      draft.planId = draft.planId || input.planId;
      draft.traceId = input.traceId;
      draft.generatedAt = draft.generatedAt || new Date().toISOString();
      draft.promptVersion = ASSIGNMENT_RECOMMENDER_PROMPT_VERSION;
      draft.modelName = draft.modelName || deps.qwenConfig.model;

      const revalidation = validateAssignmentDraft(draft, { allowedUserIds, taskIds });
      if (!revalidation.valid) {
        const reason = `自修正后仍验证失败：${revalidation.errors.join("；")}`;
        logStructured({ event: "ASSIGNMENT_SELF_CORRECT_FAILED", traceId: input.traceId, reason });
        return { ok: false, reason };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logStructured({ event: "ASSIGNMENT_SELF_CORRECT_ERROR", traceId: input.traceId, reason });
      return { ok: false, reason };
    }
  }

  // Save
  try {
    await deps.draftRepo.save(draft);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logStructured({ event: "ASSIGNMENT_DRAFT_SAVE_FAILED", traceId: input.traceId, reason });
    return { ok: false, reason };
  }

  // Append event
  try {
    await deps.eventRepo.append({
      eventType: "ASSIGNMENT_DRAFT_GENERATED",
      traceId: input.traceId,
      planId: draft.planId,
      draftId: randomUUID(),
      assignmentCount: draft.assignments.length,
      promptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
      modelName: draft.modelName,
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal: log but don't fail
    logStructured({
      event: "ASSIGNMENT_EVENT_APPEND_FAILED",
      traceId: input.traceId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  logStructured({
    event: "ASSIGNMENT_DRAFT_GENERATED",
    traceId: input.traceId,
    planId: draft.planId,
    assignmentCount: draft.assignments.length,
  });

  return { ok: true, draft };
}
