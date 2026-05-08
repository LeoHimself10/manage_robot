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

export interface LlmPlanPayload {
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  gateSelfCheck?: LlmGateSelfCheck;
}

/** @deprecated Use LlmPlannerResponse from planner; kept for older call sites if any */
export interface LlmPlanResult {
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  gateSelfCheck?: LlmGateSelfCheck;
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
