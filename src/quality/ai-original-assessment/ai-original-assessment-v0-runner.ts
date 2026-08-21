import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";
import { normalizeQualitySourceSheet } from "../source/quality-source-schema";
import {
  AI_ORIGINAL_ASSESSMENT_INPUT_SCHEMA_VERSION,
  aiOriginalAssessmentInputSchema,
  type AiOriginalAssessmentInput,
  type AiOriginalAssessmentOutput,
} from "./ai-original-assessment-contracts";
import {
  AI_ORIGINAL_ASSESSMENT_V0_CASE_LIBRARY_VERSION,
  AI_ORIGINAL_ASSESSMENT_V0_MODEL_CONFIG_ID,
  AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION,
  AI_ORIGINAL_ASSESSMENT_V0_REQUEST_ID,
  V0_CATEGORY_DICTIONARY,
  V0_DEMO_HISTORICAL_CASES,
  V0_DEMO_SOURCE_SHEET,
} from "./ai-original-assessment-v0-context";
import type {
  AiOriginalAssessmentModelAdapter,
  AiOriginalAssessmentModelResponse,
} from "./qwen-ai-original-assessment-model";
import {
  validateAiOriginalAssessment,
  type AiOriginalAssessmentValidationIssue,
} from "./validate-ai-original-assessment";
import {
  HISTORICAL_FEEDBACK_CASE_INDEX_VERSION,
  type HistoricalFeedbackCaseRetriever,
} from "./historical-feedback-case-retriever";

export interface PreparedAiOriginalAssessmentV0 {
  normalizedFeedback: NormalizedQualitySourceRow;
  input: AiOriginalAssessmentInput;
}

export function prepareAiOriginalAssessmentV0FromNormalizedFeedback(options: {
  normalizedFeedback: NormalizedQualitySourceRow;
  requestId: string;
  sourceVersion?: number;
  retrievedCases?: AiOriginalAssessmentInput["retrievedCases"];
  caseLibraryVersion?: string;
}): PreparedAiOriginalAssessmentV0 {
  const { normalizedFeedback } = options;
  const sourceSnapshot = {
    sourceKey: normalizedFeedback.sourceKey,
    sourceVersion: options.sourceVersion ?? 1,
    rowNumber: normalizedFeedback.rowNumber,
    contentHash: normalizedFeedback.contentHash,
    feedbackAt: normalizedFeedback.feedbackAt,
    feedbackNo: normalizedFeedback.feedbackNo,
    reporter: normalizedFeedback.reporter,
    deviceModel: normalizedFeedback.deviceModel,
    serialNo: normalizedFeedback.serialNo,
    catheterBatch: normalizedFeedback.catheterBatch,
    issueDescription: normalizedFeedback.issueDescription,
    clinicianAware: normalizedFeedback.clinicianAware,
    impact: normalizedFeedback.impact,
    confirmation: normalizedFeedback.confirmation,
  };
  const input = aiOriginalAssessmentInputSchema.parse({
    schemaVersion: AI_ORIGINAL_ASSESSMENT_INPUT_SCHEMA_VERSION,
    sourceSnapshot,
    categoryDictionary: V0_CATEGORY_DICTIONARY,
    retrievedCases: options.retrievedCases ?? [],
    runMetadata: {
      requestId: options.requestId,
      modelConfigId: AI_ORIGINAL_ASSESSMENT_V0_MODEL_CONFIG_ID,
      promptVersion: AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION,
      caseLibraryVersion: options.caseLibraryVersion
        ?? HISTORICAL_FEEDBACK_CASE_INDEX_VERSION,
    },
  });

  return { normalizedFeedback, input };
}

/**
 * 正式路径：输入必须先完成标准化，再在模型调用前从本地历史索引检索0～3条案例。
 */
export function prepareAiOriginalAssessmentV0WithHistoricalRetrieval(options: {
  normalizedFeedback: NormalizedQualitySourceRow;
  requestId: string;
  sourceVersion?: number;
  caseRetriever: HistoricalFeedbackCaseRetriever;
}): PreparedAiOriginalAssessmentV0 {
  const retrievedCases = options.caseRetriever.retrieve(options.normalizedFeedback);
  return prepareAiOriginalAssessmentV0FromNormalizedFeedback({
    normalizedFeedback: options.normalizedFeedback,
    requestId: options.requestId,
    sourceVersion: options.sourceVersion,
    retrievedCases,
    caseLibraryVersion: options.caseRetriever.version,
  });
}

export function prepareAiOriginalAssessmentV0(): PreparedAiOriginalAssessmentV0 {
  const normalizedRows = normalizeQualitySourceSheet(V0_DEMO_SOURCE_SHEET);
  if (normalizedRows.length !== 1) {
    throw new Error(`V0演示必须且只能标准化出一条反馈，实际为${normalizedRows.length}条`);
  }
  return prepareAiOriginalAssessmentV0FromNormalizedFeedback({
    normalizedFeedback: normalizedRows[0]!,
    requestId: AI_ORIGINAL_ASSESSMENT_V0_REQUEST_ID,
    retrievedCases: V0_DEMO_HISTORICAL_CASES,
    caseLibraryVersion: AI_ORIGINAL_ASSESSMENT_V0_CASE_LIBRARY_VERSION,
  });
}

export class AiOriginalAssessmentV0RunError extends Error {
  constructor(
    public readonly code: "MODEL_CALL_FAILED" | "MODEL_OUTPUT_INVALID",
    message: string,
    public readonly attempts: number,
    public readonly validationIssues: AiOriginalAssessmentValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AiOriginalAssessmentV0RunError";
  }
}

export interface AiOriginalAssessmentV0RunResult extends PreparedAiOriginalAssessmentV0 {
  output: AiOriginalAssessmentOutput;
  validation: Extract<ReturnType<typeof validateAiOriginalAssessment>, { ok: true }>;
  modelResponse: AiOriginalAssessmentModelResponse;
  attempts: number;
}

export async function runAiOriginalAssessmentV0(input: {
  model: AiOriginalAssessmentModelAdapter;
  prepared?: PreparedAiOriginalAssessmentV0;
}): Promise<AiOriginalAssessmentV0RunResult> {
  const prepared = input.prepared ?? prepareAiOriginalAssessmentV0();
  let modelResponse: AiOriginalAssessmentModelResponse;
  try {
    modelResponse = await input.model.generate({ input: prepared.input });
  } catch (error) {
    throw new AiOriginalAssessmentV0RunError(
      "MODEL_CALL_FAILED",
      `AI原始研判模型调用失败：${error instanceof Error ? error.message : String(error)}`,
      1,
    );
  }

  const validation = validateAiOriginalAssessment(prepared.input, modelResponse.payload);
  if (!validation.ok) {
    throw new AiOriginalAssessmentV0RunError(
      "MODEL_OUTPUT_INVALID",
      "AI本次返回未通过校验，已停止且未伪造结果、未重新调用模型",
      1,
      validation.issues,
    );
  }

  return {
    ...prepared,
    output: validation.output,
    validation,
    modelResponse,
    attempts: 1,
  };
}
