import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceTrace {
  /** Pipeline-generated correlation id (optional) */
  traceId?: string;
  requestId: string;
  model: string;
  tokenUsage: TokenUsage;
  latencyMs: number;
  errorCode?: string;
}

/** 模型在 NEEDS_MORE_INFO 时可选：钉钉等渠道用于区分「打招呼/非任务」与「真实任务缺信息」 */
export type ClarificationUxKind = "NON_TASK" | "TASK_GAP";

export type ResponseIntent =
  | "CHAT"
  | "CLARIFY"
  | "DISCUSS"
  | "DRAFT"
  | "REVISE_DRAFT"
  | "RESET_OR_NEW_TASK";

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

/** @deprecated Use LlmPlannerResponse from planner; kept for older call sites if any */
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

export interface LlmCorrectionContext {
  previousRawJson: string;
  validationErrors: string[];
}

export interface LlmPlannerRequest {
  background: string;
  domainHint?: PlanDomain;
  traceId?: string;
  correction?: LlmCorrectionContext;
  /** Prior-turn continuity (e.g. DingTalk digest); forwarded to planner user prompt only. */
  sessionDigest?: string;
}

/** Thin planner output: parsed JSON from the model (single parse), not yet schema-coerced */
export interface LlmPlannerResponse {
  rawJson: unknown;
  trace: InferenceTrace;
}

export interface LlmGateSelfCheck {
  passed: boolean;
  missingByTask: Array<{
    taskId: string;
    title?: string;
    missingFields: string[];
  }>;
}

/** Wall-clock segments for createTaskPlanningDemo (ms). plannerMs is sum of all LLM calls. */
export interface DemoGenerationTimings {
  plannerMs: number;
  coerceMs: number;
  validateMs: number;
  gateMs: number;
  renderMs: number;
}

export interface DemoGenerationMetadata {
  trace?: InferenceTrace;
  /** One entry per successful llmPlanner invocation (includes correction pass). */
  traces?: InferenceTrace[];
  correctionUsed?: boolean;
  timings?: DemoGenerationTimings;
}
