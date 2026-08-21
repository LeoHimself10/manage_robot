import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  runAiOriginalAssessmentV0Batch,
} from "../src/quality/ai-original-assessment/ai-original-assessment-v0-batch";
import {
  prepareAiOriginalAssessmentV0WithHistoricalRetrieval,
} from "../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import {
  createDefaultHistoricalFeedbackCaseRetriever,
} from "../src/quality/ai-original-assessment/historical-feedback-case-retriever";
import {
  loadQwenAiOriginalAssessmentConfigFromEnv,
  QwenAiOriginalAssessmentModel,
} from "../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";
import {
  HISTORICAL_FEEDBACK_TAXONOMY_VERSION,
} from "../src/quality/ai-original-assessment/historical-feedback-taxonomy-v0";
import {
  normalizeQualitySourceSheet,
  type QualitySourceSheet,
} from "../src/quality/source/quality-source-schema";

const fixtureSchema = z.object({
  batchItemId: z.string().trim().min(1),
  sourceRow: z.number().int().positive(),
  feedbackAt: z.string().trim(),
  deviceModel: z.string().trim(),
  issueDescription: z.string(),
  expectedPrimaryCategoryCode: z.string().trim().min(1),
  expectedSecondaryCategoryCode: z.string().trim().min(1),
  expectedRiskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  expectedHandlingRecommendation: z.enum(["ORDINARY", "NEEDS_INFO", "QUALITY_ANOMALY"]),
  reviewNote: z.string().trim().optional(),
}).strict();

const fixtureFileSchema = z.object({
  datasetVersion: z.string().trim().min(1),
  deidentificationNote: z.string().trim().min(1),
  records: z.array(fixtureSchema).min(20).max(50),
}).strict();

type Fixture = z.infer<typeof fixtureSchema>;

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildSourceSheet(fixtures: Fixture[]): QualitySourceSheet {
  return {
    sheetId: "deidentified-historical-acceptance-v0",
    sheetName: "脱敏历史反馈",
    rows: [
      [
        "反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号",
        "报损导管批次", "问题描述", "术者是否可以感知", "对术者造成的影响",
        "确认情况",
      ],
      ...fixtures.map((fixture, index) => [
        fixture.feedbackAt,
        `HIST-V0-DEID-${String(index + 1).padStart(3, "0")}`,
        "脱敏历史记录",
        fixture.deviceModel,
        "",
        "",
        fixture.issueDescription,
        "",
        "",
        "",
      ]),
    ],
  };
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    throw new Error(
      "用法：npm run quality:ai-original-assessment-v0:batch -- <脱敏输入.json> <结果.json>",
    );
  }

  const fixtureFile = fixtureFileSchema.parse(
    JSON.parse(await readFile(resolve(inputPath), "utf8")),
  );
  const normalizedRows = normalizeQualitySourceSheet(buildSourceSheet(fixtureFile.records));
  if (normalizedRows.length !== fixtureFile.records.length) {
    throw new Error(
      `标准化记录数不一致：输入${fixtureFile.records.length}，标准化${normalizedRows.length}`,
    );
  }

  const config = loadQwenAiOriginalAssessmentConfigFromEnv();
  if (!config) {
    throw new Error("缺少DASHSCOPE_API_KEY或QWEN_API_KEY，未发起模型请求");
  }

  const model = new QwenAiOriginalAssessmentModel(config);
  const caseRetriever = createDefaultHistoricalFeedbackCaseRetriever();
  const preparedItems = normalizedRows.map((normalizedFeedback, index) => ({
    batchItemId: fixtureFile.records[index]!.batchItemId,
    prepared: prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
      normalizedFeedback,
      requestId: `quality-ai-original-assessment-v0-batch-${String(index + 1).padStart(3, "0")}`,
      caseRetriever,
    }),
  }));
  const preparedById = new Map(
    preparedItems.map((item) => [item.batchItemId, item.prepared]),
  );
  const batch = await runAiOriginalAssessmentV0Batch({
    model,
    items: preparedItems,
    onItemComplete(result, completed, total) {
      process.stdout.write(JSON.stringify({
        completed,
        total,
        batchItemId: result.batchItemId,
        ok: result.ok,
        code: result.ok ? undefined : result.error.code,
      }) + "\n");
    },
  });

  const fixturesById = new Map(
    fixtureFile.records.map((fixture) => [fixture.batchItemId, fixture]),
  );
  const compactItems = batch.items.map((item) => {
    const fixture = fixturesById.get(item.batchItemId)!;
    const retrievedCases = preparedById.get(item.batchItemId)!.input.retrievedCases.map(
      (historicalCase) => ({
        caseId: historicalCase.caseId,
        title: historicalCase.title,
        sourceReference: historicalCase.sourceReference,
      }),
    );
    if (!item.ok) {
      return {
        batchItemId: item.batchItemId,
        sourceRow: fixture.sourceRow,
        issueDescription: fixture.issueDescription,
        ok: false as const,
        error: item.error,
        expected: {
          primaryCategoryCode: fixture.expectedPrimaryCategoryCode,
          secondaryCategoryCode: fixture.expectedSecondaryCategoryCode,
          riskLevel: fixture.expectedRiskLevel,
          handlingRecommendation: fixture.expectedHandlingRecommendation,
        },
        retrievedCases,
        requiresHumanReview: true,
      };
    }
    const output = item.result.output;
    const categoryMatch = output.primaryCategoryCode === fixture.expectedPrimaryCategoryCode
      && output.secondaryCategoryCode === fixture.expectedSecondaryCategoryCode;
    const riskMatch = output.riskLevel === fixture.expectedRiskLevel;
    const handlingMatch = output.handlingRecommendation
      === fixture.expectedHandlingRecommendation;
    const honestInsufficient = fixture.expectedSecondaryCategoryCode !== "INSUFFICIENT_INFO"
      || (
        output.primaryCategoryCode === "OTHER_UNCLEAR"
        && output.secondaryCategoryCode === "INSUFFICIENT_INFO"
        && output.handlingRecommendation === "NEEDS_INFO"
      );
    return {
      batchItemId: item.batchItemId,
      sourceRow: fixture.sourceRow,
      issueDescription: fixture.issueDescription,
      ok: true as const,
      expected: {
        primaryCategoryCode: fixture.expectedPrimaryCategoryCode,
        secondaryCategoryCode: fixture.expectedSecondaryCategoryCode,
        riskLevel: fixture.expectedRiskLevel,
        handlingRecommendation: fixture.expectedHandlingRecommendation,
      },
      retrievedCases,
      actual: {
        handlingRecommendation: output.handlingRecommendation,
        primaryCategoryCode: output.primaryCategoryCode,
        secondaryCategoryCode: output.secondaryCategoryCode,
        riskLevel: output.riskLevel,
        reasoningBasis: output.reasoningBasis,
        missingInformation: output.missingInformation,
        uncertainties: output.uncertainties,
      },
      categoryMatch,
      riskMatch,
      handlingMatch,
      honestInsufficient,
      requiresHumanReview: !categoryMatch || !riskMatch || !handlingMatch || !honestInsufficient,
      modelRequestId: item.result.modelResponse.trace.requestId,
    };
  });

  const successfulItems = compactItems.filter((item) => item.ok);
  const manualReviewItems = compactItems
    .filter((item) => item.requiresHumanReview)
    .map((item) => item.batchItemId);
  const resultDocument = {
    reportVersion: "AI_ORIGINAL_ASSESSMENT_V0_ACCEPTANCE_REPORT_V1",
    generatedAt: new Date().toISOString(),
    taxonomyVersion: HISTORICAL_FEEDBACK_TAXONOMY_VERSION,
    datasetVersion: fixtureFile.datasetVersion,
    deidentificationNote: fixtureFile.deidentificationNote,
    model: config.clientConfig.model,
    safeguards: {
      aiAdviceOnly: true,
      humanFinalReviewRequired: true,
      directBusinessStateMutation: false,
      toolCallsAllowed: false,
      automaticRetries: 0,
      singleFailureDoesNotAbortBatch: compactItems.length === fixtureFile.records.length,
    },
    summary: {
      total: batch.total,
      succeeded: batch.succeeded,
      failed: batch.failed,
      jsonParseAndSchemaSuccess: batch.succeeded,
      legalCategoryCodes: batch.succeeded,
      validParentChildPairs: batch.succeeded,
      categoryMatchesHumanExpectation: successfulItems.filter(
        (item) => item.ok && item.categoryMatch,
      ).length,
      riskMatchesHumanExpectation: successfulItems.filter(
        (item) => item.ok && item.riskMatch,
      ).length,
      handlingMatchesHumanExpectation: successfulItems.filter(
        (item) => item.ok && item.handlingMatch,
      ).length,
      expectedInsufficientRecords: fixtureFile.records.filter(
        (item) => item.expectedSecondaryCategoryCode === "INSUFFICIENT_INFO",
      ).length,
      honestInsufficientRecords: successfulItems.filter(
        (item) => item.ok
          && item.expected.secondaryCategoryCode === "INSUFFICIENT_INFO"
          && item.honestInsufficient,
      ).length,
      manualReviewCount: manualReviewItems.length,
    },
    distributions: {
      primaryCategory: countBy(successfulItems.flatMap(
        (item) => item.ok ? [item.actual.primaryCategoryCode] : [],
      )),
      secondaryCategory: countBy(successfulItems.flatMap(
        (item) => item.ok ? [item.actual.secondaryCategoryCode] : [],
      )),
      riskLevel: countBy(successfulItems.flatMap(
        (item) => item.ok ? [item.actual.riskLevel] : [],
      )),
      handlingRecommendation: countBy(successfulItems.flatMap(
        (item) => item.ok ? [item.actual.handlingRecommendation] : [],
      )),
      failureCode: countBy(compactItems.flatMap(
        (item) => item.ok ? [] : [item.error.code],
      )),
    },
    manualReviewItems,
    items: compactItems,
  };

  await writeFile(resolve(outputPath), JSON.stringify(resultDocument, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(resultDocument.summary) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`批量验收失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
