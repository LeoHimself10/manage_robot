import { z } from "zod";

export const QUALITY_ANALYSIS_INPUT_SCHEMA_VERSION = "quality-analysis-input-v1";
export const QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION = "quality-analysis-output-v1";
export const QUALITY_ANALYSIS_PROMPT_VERSION = "quality-analysis-prompt-v1.0.1";
export const QUALITY_ANALYSIS_MODEL_CONFIG_ID = "project-default-qwen-quality-analysis-v1";
export const QUALITY_ANALYSIS_RULE_VERSION = "quality-analysis-rules-v1";
export const QUALITY_ANALYSIS_KNOWLEDGE_VERSION = "quality-product-knowledge-v1";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");

export const qualityDepartmentCandidateSchema = z.object({
  departmentId: text(200),
  departmentName: text(200),
}).strict();

export const qualityAnalysisInputSchema = z.object({
  schemaVersion: z.literal(QUALITY_ANALYSIS_INPUT_SCHEMA_VERSION),
  inputVersion: text(200),
  event: z.object({
    qualityEventId: text(300),
    eventNo: text(100),
    title: text(200),
    problemStatus: text(10_000),
    occurredAt: z.string().nullable(),
    impact: z.string().nullable(),
    riskLevel: z.string().nullable(),
    confirmedCategory: z.string().nullable(),
    eventVersion: z.number().int().positive(),
  }).strict(),
  frozenReportingContext: z.object({
    sourceSnapshots: z.array(z.record(z.string(), z.unknown())).max(200),
    aiOriginalAssessments: z.array(z.record(z.string(), z.unknown())).max(200),
    managerAssessments: z.array(z.record(z.string(), z.unknown())).max(200),
    frozenAt: z.string().nullable(),
  }).strict(),
  similarHistoricalCases: z.array(z.record(z.string(), z.unknown())).max(20),
  attachments: z.array(z.object({
    fileName: text(255),
    mimeType: text(200),
    uploadedAt: text(100),
    humanDescription: z.string().trim().max(2_000),
    contentInspected: z.literal(false),
  }).strict()).max(100),
  departmentCandidates: z.array(qualityDepartmentCandidateSchema).min(1).max(300),
  ruleContext: z.object({
    version: text(100),
    confirmedCategoryReadOnly: z.string().nullable(),
    factHypothesisSeparationRequired: z.literal(true),
  }).strict(),
  productKnowledge: z.object({
    version: text(100),
    statements: z.array(text(1_000)).max(100),
  }).strict(),
  runMetadata: z.object({
    requestId: z.string().uuid(),
    promptVersion: z.literal(QUALITY_ANALYSIS_PROMPT_VERSION),
    modelConfigId: z.literal(QUALITY_ANALYSIS_MODEL_CONFIG_ID),
    requestedBy: text(200),
    requestedAt: text(100),
  }).strict(),
}).strict();

export type QualityAnalysisInput = z.infer<typeof qualityAnalysisInputSchema>;

export const qualityAnalysisOutputSchema = z.object({
  schemaVersion: z.literal(QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  problemDirection: text(500),
  confirmedCategoryReference: text(500),
  sourceFactSummary: z.array(text(1_000)).min(1).max(30),
  confirmedFacts: z.array(text(1_000)).min(1).max(50),
  analysisBasis: z.array(z.object({
    statement: text(1_000),
    sourceType: z.enum(["SOURCE_SNAPSHOT", "AI_ORIGINAL_ASSESSMENT", "MANAGER_ASSESSMENT", "HISTORICAL_CASE", "QUALITY_RULE", "PRODUCT_KNOWLEDGE", "HUMAN_ATTACHMENT_DESCRIPTION"]),
    sourceReference: text(500),
  }).strict()).min(1).max(50),
  preliminaryConclusion: text(3_000),
  causeHypotheses: z.array(text(1_000)).max(30),
  investigationDirections: z.array(text(1_000)).min(1).max(30),
  informationGaps: z.array(text(1_000)).max(30),
  primaryDepartmentCandidates: z.array(z.object({
    departmentName: text(200),
    recommendationReason: text(1_000),
  }).strict()).min(1).max(20),
  collaboratingDepartmentNames: z.array(text(200)).max(30),
  handlingRequirements: z.array(text(1_000)).min(1).max(30),
  deliverables: z.array(z.object({
    name: text(200),
    description: text(2_000),
    acceptanceCriteria: text(2_000),
  }).strict()).min(1).max(30),
  suggestedTotalDueDays: z.number().int().min(1).max(180),
}).strict();

export type QualityAnalysisOutput = z.infer<typeof qualityAnalysisOutputSchema>;

export const qualityDeliverableSchema = z.object({
  deliverableId: text(300),
  name: text(200),
  description: text(2_000),
  acceptanceCriteria: text(2_000),
  source: z.enum(["AI_SUGGESTED", "HUMAN_CUSTOM"]),
  selected: z.boolean(),
  createdAt: text(100),
  updatedAt: text(100),
}).strict();

export type QualityDeliverable = z.infer<typeof qualityDeliverableSchema>;

export const qualityAnalysisDraftContentSchema = z.object({
  problemDirection: text(500),
  confirmedCategoryReference: text(500),
  sourceFactSummary: z.array(text(1_000)).min(1).max(30),
  confirmedFacts: z.array(text(1_000)).min(1).max(50),
  analysisBasis: z.array(text(1_000)).min(1).max(50),
  preliminaryConclusion: text(3_000),
  causeHypotheses: z.array(text(1_000)).max(30),
  investigationDirections: z.array(text(1_000)).min(1).max(30),
  informationGaps: z.array(text(1_000)).max(30),
  handlingRequirements: z.array(text(1_000)).min(1).max(30),
  suggestedTotalDueAt: text(100),
}).strict();

export type QualityAnalysisDraftContent = z.infer<typeof qualityAnalysisDraftContentSchema>;

export const saveQualityAnalysisDraftSchema = z.object({
  expectedVersion: z.number().int().min(0),
  requestId: z.string().uuid(),
  baseAttemptId: z.string().trim().min(1).max(300).nullable().optional(),
  content: qualityAnalysisDraftContentSchema,
  primaryDepartmentId: z.string().trim().max(200).nullable(),
  collaboratorDepartmentIds: z.array(text(200)).max(30),
  deliverables: z.array(qualityDeliverableSchema).min(1).max(50),
  modificationReason: optionalText(2_000),
}).strict();

export type SaveQualityAnalysisDraftInput = z.infer<typeof saveQualityAnalysisDraftSchema>;

export const confirmQualityAnalysisSchema = z.object({
  expectedDraftVersion: z.number().int().positive(),
  expectedEventVersion: z.number().int().positive(),
  requestId: z.string().uuid(),
  modificationReason: text(2_000),
}).strict();
