import { randomUUID } from "node:crypto";
import type { AiOriginalAssessmentOutput } from
  "../ai-original-assessment/ai-original-assessment-contracts";
import {
  prepareAiOriginalAssessmentV0WithHistoricalRetrieval,
  runAiOriginalAssessmentV0,
} from "../ai-original-assessment/ai-original-assessment-v0-runner";
import {
  createDefaultHistoricalFeedbackCaseRetriever,
  type HistoricalFeedbackCaseRetriever,
} from "../ai-original-assessment/historical-feedback-case-retriever";
import {
  loadQwenAiOriginalAssessmentConfigFromEnv,
  QwenAiOriginalAssessmentModel,
  type AiOriginalAssessmentModelAdapter,
} from "../ai-original-assessment/qwen-ai-original-assessment-model";
import { createQualitySourceAssessmentService } from
  "./quality-source-assessment-service";

export class QualitySourceAiAssessmentError extends Error {
  constructor(
    public readonly code: "MODEL_NOT_CONFIGURED",
    message: string,
  ) {
    super(message);
    this.name = "QualitySourceAiAssessmentError";
  }
}

export interface QualitySourceAiAssessmentResult {
  sourceKey: string;
  sourceVersion: number;
  output: AiOriginalAssessmentOutput;
  retrievedCases: ReturnType<HistoricalFeedbackCaseRetriever["retrieve"]>;
}

export async function runQualitySourceAiAssessment(input: {
  sourceKey: string;
  dbPath?: string;
  requestId?: string;
  env?: Record<string, string | undefined>;
  model?: AiOriginalAssessmentModelAdapter;
  caseRetriever?: HistoricalFeedbackCaseRetriever;
}): Promise<QualitySourceAiAssessmentResult> {
  const sourceStore = createQualitySourceAssessmentService({ dbPath: input.dbPath });
  let source: ReturnType<typeof sourceStore.getSourceSnapshot>;
  try {
    source = sourceStore.getSourceSnapshot(input.sourceKey);
  } finally {
    sourceStore.close();
  }
  if (!source) throw new Error("quality source not found");

  const caseRetriever = input.caseRetriever
    ?? createDefaultHistoricalFeedbackCaseRetriever();
  const prepared = prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
    normalizedFeedback: source.normalizedFeedback,
    sourceVersion: source.sourceVersion,
    requestId: input.requestId ?? randomUUID(),
    caseRetriever,
  });

  let model = input.model;
  if (!model) {
    const config = loadQwenAiOriginalAssessmentConfigFromEnv(
      input.env ?? process.env,
    );
    if (!config) {
      throw new QualitySourceAiAssessmentError(
        "MODEL_NOT_CONFIGURED",
        "AI原始研判服务未配置模型密钥",
      );
    }
    model = new QwenAiOriginalAssessmentModel(config);
  }

  const result = await runAiOriginalAssessmentV0({ model, prepared });
  return {
    sourceKey: source.normalizedFeedback.sourceKey,
    sourceVersion: source.sourceVersion,
    output: result.output,
    retrievedCases: prepared.input.retrievedCases,
  };
}
