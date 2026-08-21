import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const normalizedOptionalString = z.string().trim();
const nullableOptionalString = normalizedOptionalString.nullable().optional();

export const AI_ORIGINAL_ASSESSMENT_INPUT_SCHEMA_VERSION =
  "ai-original-assessment-input-v0.2" as const;
export const AI_ORIGINAL_ASSESSMENT_OUTPUT_SCHEMA_VERSION =
  "ai-original-assessment-output-v0" as const;

export const aiHandlingRecommendationSchema = z.enum([
  "ORDINARY",
  "NEEDS_INFO",
  "QUALITY_ANOMALY",
]);

export const aiRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const aiCategoryDictionarySchema = z.object({
  version: nonEmptyString,
  categories: z.array(z.object({
    primaryCode: nonEmptyString,
    primaryLabel: nonEmptyString,
    primaryDefinition: nonEmptyString,
    secondaryCategories: z.array(z.object({
      secondaryCode: nonEmptyString,
      secondaryLabel: nonEmptyString,
      definition: nonEmptyString,
      applicableScope: z.array(nonEmptyString).min(1),
      excludedScope: z.array(nonEmptyString).min(1),
      typicalExpressions: z.array(nonEmptyString).min(1),
    }).strict()).min(1),
  }).strict()).min(1),
}).strict().superRefine((dictionary, context) => {
  const primaryCodes = new Set<string>();
  const primaryLabels = new Set<string>();
  const secondaryCodes = new Set<string>();
  const secondaryLabels = new Set<string>();
  dictionary.categories.forEach((category, primaryIndex) => {
    if (primaryCodes.has(category.primaryCode)) {
      context.addIssue({
        code: "custom",
        path: ["categories", primaryIndex, "primaryCode"],
        message: `一级分类编码重复: ${category.primaryCode}`,
      });
    }
    primaryCodes.add(category.primaryCode);

    if (primaryLabels.has(category.primaryLabel)) {
      context.addIssue({
        code: "custom",
        path: ["categories", primaryIndex, "primaryLabel"],
        message: `一级分类名称重复: ${category.primaryLabel}`,
      });
    }
    primaryLabels.add(category.primaryLabel);

    category.secondaryCategories.forEach((secondary, secondaryIndex) => {
      if (secondaryCodes.has(secondary.secondaryCode)) {
        context.addIssue({
          code: "custom",
          path: ["categories", primaryIndex, "secondaryCategories", secondaryIndex, "secondaryCode"],
          message: `二级分类编码重复: ${secondary.secondaryCode}`,
        });
      }
      secondaryCodes.add(secondary.secondaryCode);

      if (secondaryLabels.has(secondary.secondaryLabel)) {
        context.addIssue({
          code: "custom",
          path: ["categories", primaryIndex, "secondaryCategories", secondaryIndex, "secondaryLabel"],
          message: `二级分类名称重复: ${secondary.secondaryLabel}`,
        });
      }
      secondaryLabels.add(secondary.secondaryLabel);
    });
  });
});

export const aiHistoricalCaseSchema = z.object({
  caseId: nonEmptyString,
  title: nonEmptyString,
  summary: nonEmptyString,
  primaryCategoryCode: nonEmptyString,
  secondaryCategoryCode: nonEmptyString,
  riskLevel: aiRiskLevelSchema.optional(),
  outcome: nonEmptyString,
  sourceReference: nonEmptyString,
}).strict();

export const aiOriginalAssessmentInputSchema = z.object({
  schemaVersion: z.literal(AI_ORIGINAL_ASSESSMENT_INPUT_SCHEMA_VERSION),
  sourceSnapshot: z.object({
    sourceKey: nonEmptyString,
    sourceVersion: z.number().int().positive(),
    rowNumber: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    feedbackAt: normalizedOptionalString,
    feedbackNo: normalizedOptionalString,
    reporter: normalizedOptionalString,
    deviceModel: normalizedOptionalString,
    serialNo: normalizedOptionalString,
    catheterBatch: normalizedOptionalString,
    issueDescription: normalizedOptionalString,
    clinicianAware: normalizedOptionalString,
    impact: nullableOptionalString,
    confirmation: nullableOptionalString,
  }).strict(),
  categoryDictionary: aiCategoryDictionarySchema,
  retrievedCases: z.array(aiHistoricalCaseSchema).max(3),
  runMetadata: z.object({
    requestId: nonEmptyString,
    modelConfigId: nonEmptyString,
    promptVersion: nonEmptyString,
    caseLibraryVersion: nonEmptyString,
  }).strict(),
}).strict().superRefine((input, context) => {
  const caseIds = new Set<string>();
  input.retrievedCases.forEach((historicalCase, index) => {
    if (caseIds.has(historicalCase.caseId)) {
      context.addIssue({
        code: "custom",
        path: ["retrievedCases", index, "caseId"],
        message: `历史案例ID重复: ${historicalCase.caseId}`,
      });
    }
    caseIds.add(historicalCase.caseId);
  });

});

export const aiOriginalAssessmentOutputSchema = z.object({
  schemaVersion: z.literal(AI_ORIGINAL_ASSESSMENT_OUTPUT_SCHEMA_VERSION),
  requestId: nonEmptyString,
  handlingRecommendation: aiHandlingRecommendationSchema,
  primaryCategoryCode: nonEmptyString,
  secondaryCategoryCode: nonEmptyString,
  riskLevel: aiRiskLevelSchema,
  reasoningBasis: z.array(z.object({
    statement: nonEmptyString,
    citationIds: z.array(nonEmptyString).min(1),
  }).strict()).min(1),
  similarCases: z.array(z.object({
    caseId: nonEmptyString,
    similarityReason: nonEmptyString,
  }).strict()).max(3),
  missingInformation: z.array(z.object({
    field: nonEmptyString,
    reason: nonEmptyString,
  }).strict()),
  uncertainties: z.array(z.object({
    topic: nonEmptyString,
    reason: nonEmptyString,
  }).strict()).min(1),
  citations: z.array(z.object({
    citationId: nonEmptyString,
    sourceType: z.enum(["FEEDBACK", "HISTORICAL_CASE"]),
    sourceId: nonEmptyString,
    description: nonEmptyString,
  }).strict()).min(1),
  provenance: z.object({
    modelConfigId: nonEmptyString,
    promptVersion: nonEmptyString,
    categoryDictionaryVersion: nonEmptyString,
    caseLibraryVersion: nonEmptyString,
  }).strict(),
}).strict().superRefine((output, context) => {
  const citationIds = new Set<string>();
  output.citations.forEach((citation, index) => {
    if (citationIds.has(citation.citationId)) {
      context.addIssue({
        code: "custom",
        path: ["citations", index, "citationId"],
        message: `引用ID重复: ${citation.citationId}`,
      });
    }
    citationIds.add(citation.citationId);
  });

  const similarCaseIds = new Set<string>();
  output.similarCases.forEach((similarCase, index) => {
    if (similarCaseIds.has(similarCase.caseId)) {
      context.addIssue({
        code: "custom",
        path: ["similarCases", index, "caseId"],
        message: `相似案例ID重复: ${similarCase.caseId}`,
      });
    }
    similarCaseIds.add(similarCase.caseId);
  });
});

export type AiHandlingRecommendation = z.infer<typeof aiHandlingRecommendationSchema>;
export type AiRiskLevel = z.infer<typeof aiRiskLevelSchema>;
export type AiCategoryDictionary = z.infer<typeof aiCategoryDictionarySchema>;
export type AiOriginalAssessmentInput = z.infer<typeof aiOriginalAssessmentInputSchema>;
export type AiOriginalAssessmentOutput = z.infer<typeof aiOriginalAssessmentOutputSchema>;
