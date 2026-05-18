import { TaskPackage, TaskScope } from "../../domain/task-package";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceTrace {
  traceId?: string;
  requestId: string;
  model: string;
  tokenUsage: TokenUsage;
  latencyMs: number;
  errorCode?: string;
}

export interface LlmCorrectionContext {
  previousRawJson: string;
  validationErrors: string[];
}

// ---------------------------------------------------------------------------
// 主链路（runOrchestrator / 钉钉 / 工作台）使用的草案结构 v6
// ---------------------------------------------------------------------------

/** 单条子任务，所有字段均必须存在（可为空数组 / 空字符串，但 key 不可缺）。 */
export interface OrchestratorTask {
  id: string;
  title: string;
  objective: string;
  deliverables: string[];
  completionCriteria: string[];
  timeNode: {
    dueAt: string;
    checkpoints: string[];
  };
  feedbackFrequency: string;
  /** 前置依赖（无则 []） */
  dependencyTaskIds: string[];
  /** 风险与待澄清 */
  risksAndOpenQuestions: string[];
  /** 开工所需材料 / 输入 */
  inputMaterials: string[];
  /** 具体执行动作 */
  actions: string[];
  /** 协作人 */
  collaborators: string[];
  /** 范围边界 */
  scope: TaskScope;
  /** 指派的钉钉 userId（发布时填入） */
  assigneeUserId?: string;
}

/** 草案顶层 v6（替代旧 LlmPlanPayload 在主链路的职责）。 */
export interface OrchestratorDraft {
  title: string;
  /** 业务诉求 / 总体目标（给主管和员工看） */
  objective: string;
  /** 触发背景 / 来由（给主管和员工看） */
  background: string;
  tasks: OrchestratorTask[];
  /** 抽取器打的标，代码内部用 */
  extractedBy?: string;
  extractedAt?: string;
  /** prepare_publish_task 暂存时打的标 */
  stagedBy?: string;
  stagedAt?: string;
}

// ---------------------------------------------------------------------------
// 以下为 legacy demo 链路（pipeline / evaluator）遗留类型，待删除
// ---------------------------------------------------------------------------
import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { PlanDomain } from "../harness/types";

/** @deprecated 仅 legacy demo 链路（pipeline.ts）使用，主链路用 OrchestratorDraft */
export type ClarificationUxKind = "NON_TASK" | "TASK_GAP";

/** @deprecated 仅 legacy demo 链路使用 */
export type ResponseIntent =
  | "CHAT"
  | "CLARIFY"
  | "DISCUSS"
  | "DRAFT"
  | "REVISE_DRAFT"
  | "RESET_OR_NEW_TASK";

/** @deprecated 仅 legacy demo 链路使用 */
export interface LlmPlanPayload {
  responseIntent: ResponseIntent;
  assistantMessage: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  openQuestions: string[];
  gateSelfCheck?: LlmGateSelfCheck;
  clarificationUx?: ClarificationUxKind;
}

/** @deprecated */
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

/** @deprecated 仅 legacy demo 链路使用 */
export interface LlmPlannerRequest {
  background: string;
  domainHint?: PlanDomain;
  traceId?: string;
  correction?: LlmCorrectionContext;
  sessionDigest?: string;
}

/** @deprecated */
export interface LlmPlannerResponse {
  rawJson: unknown;
  trace: InferenceTrace;
}

/** @deprecated */
export interface LlmGateSelfCheck {
  passed: boolean;
  missingByTask: Array<{
    taskId: string;
    title?: string;
    missingFields: string[];
  }>;
}

/** @deprecated */
export interface DemoGenerationTimings {
  plannerMs: number;
  coerceMs: number;
  validateMs: number;
  gateMs: number;
  renderMs: number;
}

/** @deprecated */
export interface DemoGenerationMetadata {
  trace?: InferenceTrace;
  traces?: InferenceTrace[];
  correctionUsed?: boolean;
  timings?: DemoGenerationTimings;
}
