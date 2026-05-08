import { CAPA_DISCLAIMER } from "../../../src/domain/capa";
import { TaskPackage } from "../../../src/domain/task-package";
import type { InferenceTrace, LlmPlanResult, LlmPlannerResponse } from "../../../src/agent/demo/llm-types";

export function minimalQualityTask(overrides: Partial<TaskPackage> = {}): TaskPackage {
  return {
    id: "task_1",
    title: "问题事实确认",
    objective: "确认问题事实",
    collaborators: [],
    inputMaterials: ["生产记录"],
    actions: ["收集证据"],
    deliverables: ["问题确认记录"],
    completionCriteria: ["事实明确"],
    timeNode: { checkpoints: ["完成事实确认"], dueAt: "T+1 工作日" },
    feedbackFrequency: "每日反馈",
    risksAndOpenQuestions: [],
    dependencyTaskIds: [],
    ...overrides,
  };
}

export function qualityLlmResult(
  overrides: Partial<LlmPlanResult> = {}
): LlmPlanResult {
  return {
    classification: {
      domain: "QUALITY",
      subtype: "PRODUCTION_PROCESS_ABNORMALITY",
      confidence: "HIGH",
      rationale: ["命中生产异常关键词"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "UNCERTAIN",
      rationale: ["当前信息显示为质量问题"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: ["是否存在重复发生？"],
    },
    tasks: [minimalQualityTask()],
    openQuestions: ["是否存在重复发生？"],
    trace: {
      requestId: "test_trace",
      model: "qwen-plus",
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      latencyMs: 1,
    },
    ...overrides,
  };
}

/** Wraps the same payload shape as {@link qualityLlmResult} for thin-planner / pipeline mocks. */
export function qualityLlmPlannerResponse(
  payloadOverrides: Partial<LlmPlanResult> = {},
  traceOverrides: Partial<InferenceTrace> = {}
): LlmPlannerResponse {
  const base = qualityLlmResult(payloadOverrides);
  const { trace, ...payload } = base;
  return {
    rawJson: payload,
    trace: { ...(trace as InferenceTrace), ...traceOverrides },
  };
}

export function rdVvLlmPlannerResponse(): LlmPlannerResponse {
  const base = rdVvLlmResult();
  const { trace, ...payload } = base;
  return { rawJson: payload, trace: trace as InferenceTrace };
}

export function rdVvLlmResult(): LlmPlanResult {
  return {
    classification: {
      domain: "RD",
      subtype: "VERIFICATION_AND_VALIDATION",
      confidence: "HIGH",
      rationale: ["V&V"],
      missingInformation: [],
    },
    tasks: [
      {
        id: "task_1",
        title: "验证目标与范围确认",
        objective: "明确验证范围",
        collaborators: [],
        inputMaterials: ["需求"],
        actions: ["梳理范围"],
        deliverables: ["范围说明"],
        completionCriteria: ["范围明确"],
        timeNode: { checkpoints: ["评审"], dueAt: "T+2 工作日" },
        feedbackFrequency: "每两日反馈",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ],
    openQuestions: [],
    trace: {
      requestId: "test_vv",
      model: "qwen-plus",
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      latencyMs: 1,
    },
  };
}

export function rdAmbiguousLlmPlannerResponse(): LlmPlannerResponse {
  const base = rdAmbiguousLlmResult();
  const { trace, ...payload } = base;
  return { rawJson: payload, trace: trace as InferenceTrace };
}

export function rdAmbiguousLlmResult(): LlmPlanResult {
  return {
    classification: {
      domain: "RD",
      subtype: "RD_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["研发任务待细化"],
      missingInformation: [],
    },
    tasks: [
      minimalQualityTask({
        id: "rd_1",
        title: "研发任务目标确认",
        objective: "明确目标",
        deliverables: ["目标说明"],
        completionCriteria: ["目标明确"],
      }),
    ],
    openQuestions: [],
    trace: {
      requestId: "test_rd",
      model: "qwen-plus",
      tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      latencyMs: 1,
    },
  };
}
