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
  aiAssessmentId: string;
  sourceKey: string;
  sourceVersion: number;
  requestId: string;
  output: AiOriginalAssessmentOutput;
  retrievedCases: ReturnType<HistoricalFeedbackCaseRetriever["retrieve"]>;
  createdAt: string;
}

export async function runQualitySourceAiAssessment(input: {
  sourceKey: string;
  dbPath?: string;
  requestId?: string;
  actorUserId?: string;
  env?: Record<string, string | undefined>;
  model?: AiOriginalAssessmentModelAdapter;
  caseRetriever?: HistoricalFeedbackCaseRetriever;
}): Promise<QualitySourceAiAssessmentResult> {
  const requestId = input.requestId ?? randomUUID();
  const sourceStore = createQualitySourceAssessmentService({ dbPath: input.dbPath });
  let source: ReturnType<typeof sourceStore.getSourceSnapshot>;
  let repeated: ReturnType<typeof sourceStore.getAiAssessmentByRequest>;
  try {
    source = sourceStore.getSourceSnapshot(input.sourceKey);
    repeated = sourceStore.getAiAssessmentByRequest(input.sourceKey, requestId);
  } finally {
    sourceStore.close();
  }
  if (!source) throw new Error("quality source not found");
  if (repeated && repeated.sourceVersion === source.sourceVersion) {
    return {
      aiAssessmentId: repeated.assessmentId,
      sourceKey: repeated.sourceKey,
      sourceVersion: repeated.sourceVersion,
      requestId: repeated.requestId,
      output: repeated.output,
      retrievedCases: repeated.retrievedCases as ReturnType<
        HistoricalFeedbackCaseRetriever["retrieve"]
      >,
      createdAt: repeated.createdAt,
    };
  }

  const caseRetriever = input.caseRetriever
    ?? createDefaultHistoricalFeedbackCaseRetriever();
  const prepared = prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
    normalizedFeedback: source.normalizedFeedback,
    sourceVersion: source.sourceVersion,
    requestId,
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
  const persistence = createQualitySourceAssessmentService({ dbPath: input.dbPath });
  let saved: ReturnType<typeof persistence.saveAiAssessment>;
  try {
    saved = persistence.saveAiAssessment({
      sourceKey: source.normalizedFeedback.sourceKey,
      sourceVersion: source.sourceVersion,
      requestId,
      sourceSnapshot: source.normalizedFeedback,
      output: result.output,
      retrievedCases: prepared.input.retrievedCases as unknown as Array<
        Record<string, unknown>
      >,
      actorUserId: input.actorUserId?.trim() || "system",
    });
  } finally {
    persistence.close();
  }
  return {
    aiAssessmentId: saved.assessmentId,
    sourceKey: source.normalizedFeedback.sourceKey,
    sourceVersion: source.sourceVersion,
    requestId,
    output: saved.output,
    retrievedCases: saved.retrievedCases as ReturnType<
      HistoricalFeedbackCaseRetriever["retrieve"]
    >,
    createdAt: saved.createdAt,
  };
}
