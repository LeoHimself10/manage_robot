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
}

export interface LlmPlanResult {
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  trace?: InferenceTrace;
}

export interface LlmPlannerRequest {
  background: string;
  domainHint?: PlanDomain;
}
