import type {
  AiOriginalAssessmentInput,
  AiOriginalAssessmentOutput,
} from "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import { prepareAiOriginalAssessmentV0 } from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import type { AiOriginalAssessmentModelResponse } from
  "../../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";

export function buildValidAiSimulatedOutput(
  input: AiOriginalAssessmentInput = prepareAiOriginalAssessmentV0().input,
): AiOriginalAssessmentOutput {
  const firstHistoricalCase = input.retrievedCases[0];
  return {
    schemaVersion: "ai-original-assessment-output-v0",
    requestId: input.runMetadata.requestId,
    handlingRecommendation: "QUALITY_ANOMALY",
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    riskLevel: "HIGH",
    reasoningBasis: [{
      statement: "反馈明确写明导管无法使用且测试操作被暂停，建议人工优先审核。",
      citationIds: ["CIT-FEEDBACK"],
    }, ...(firstHistoricalCase ? [{
      statement: "本次实际检索出的历史案例可作为辅助参考。",
      citationIds: ["CIT-CASE"],
    }] : [])],
    similarCases: firstHistoricalCase ? [{
      caseId: firstHistoricalCase.caseId,
      similarityReason: "均涉及相似的导管使用异常。",
    }] : [],
    missingInformation: [{
      field: "returnedSampleInspection",
      reason: "尚无返回样品检查结果，建议人工后续确认。",
    }],
    uncertainties: [{
      topic: "实际产品和临床影响",
      reason: "当前输入为完全脱敏的模拟台架反馈，不能据此确认真实产品缺陷或临床影响。",
    }],
    citations: [
      {
        citationId: "CIT-FEEDBACK",
        sourceType: "FEEDBACK",
        sourceId: input.sourceSnapshot.sourceKey,
        description: "本次标准化反馈中的问题描述。",
      },
      ...(firstHistoricalCase ? [{
        citationId: "CIT-CASE",
        sourceType: "HISTORICAL_CASE" as const,
        sourceId: firstHistoricalCase.caseId,
        description: "本次实际检索提供的历史案例。",
      }] : []),
    ],
    provenance: {
      modelConfigId: input.runMetadata.modelConfigId,
      promptVersion: input.runMetadata.promptVersion,
      categoryDictionaryVersion: input.categoryDictionary.version,
      caseLibraryVersion: input.runMetadata.caseLibraryVersion,
    },
  };
}

export function offlineModelResponse(payload: unknown): AiOriginalAssessmentModelResponse {
  return {
    payload,
    rawContent: JSON.stringify(payload),
    messages: [],
    trace: {
      requestId: "offline-model-response",
      model: "offline-model",
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: 0,
    },
    toolCallsExecuted: 0,
  };
}
