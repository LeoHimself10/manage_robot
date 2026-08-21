import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import {
  aiHandlingRecommendationSchema,
  aiRiskLevelSchema,
  type AiHandlingRecommendation,
  type AiRiskLevel,
} from "../ai-original-assessment/ai-original-assessment-contracts";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from
  "../ai-original-assessment/historical-feedback-taxonomy-v0";
import { createQualityStore } from "../infra/quality-store";
import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";

type DatabaseRow = Record<string, unknown>;

export const qualityAssessmentAdoptionModeSchema = z.enum([
  "MANUAL",
  "DIRECT",
  "MODIFIED",
]);

export const qualityAssessmentCategoryModeSchema = z.enum([
  "STANDARD",
  "CUSTOM_SECONDARY",
  "CUSTOM_FULL",
]);

const optionalCategoryCodeSchema = z.string().trim().max(100).nullable().optional();
const optionalCustomCategoryNameSchema = z.string().trim().max(100).nullable().optional();

export const saveQualitySourceAssessmentSchema = z.object({
  handlingRecommendation: aiHandlingRecommendationSchema,
  categoryMode: qualityAssessmentCategoryModeSchema.default("STANDARD"),
  primaryCategoryCode: optionalCategoryCodeSchema,
  secondaryCategoryCode: optionalCategoryCodeSchema,
  customPrimaryCategoryName: optionalCustomCategoryNameSchema,
  customSecondaryCategoryName: optionalCustomCategoryNameSchema,
  riskLevel: aiRiskLevelSchema,
  conclusion: z.string().trim().min(1).max(10_000),
  adoptionMode: qualityAssessmentAdoptionModeSchema,
  changeReason: z.string().trim().max(2_000).nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.categoryMode === "STANDARD") {
    if (!value.primaryCategoryCode || !value.secondaryCategoryCode
      || !qualityCategoryPairExists(
        value.primaryCategoryCode,
        value.secondaryCategoryCode,
      )) {
      context.addIssue({
        code: "custom",
        path: ["secondaryCategoryCode"],
        message: "一级、二级分类组合不在正式分类字典中",
      });
    }
  } else if (value.categoryMode === "CUSTOM_SECONDARY") {
    if (!value.primaryCategoryCode || !qualityPrimaryCategoryExists(
      value.primaryCategoryCode,
    )) {
      context.addIssue({
        code: "custom",
        path: ["primaryCategoryCode"],
        message: "自定义二级分类必须保留有效的标准一级分类",
      });
    }
    if (!value.customSecondaryCategoryName?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["customSecondaryCategoryName"],
        message: "自定义二级分类必填",
      });
    }
  } else if (!value.customPrimaryCategoryName?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["customPrimaryCategoryName"],
      message: "自定义分类必填",
    });
  }
  if (value.categoryMode !== "STANDARD" && value.adoptionMode === "DIRECT") {
    context.addIssue({
      code: "custom",
      path: ["adoptionMode"],
      message: "采用自定义分类时必须记录为修改后采纳或人工填写",
    });
  }
  if (value.adoptionMode === "MODIFIED" && !value.changeReason?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["changeReason"],
      message: "修改后采纳必须填写修改原因",
    });
  }
});

export type QualityAssessmentAdoptionMode = z.infer<
  typeof qualityAssessmentAdoptionModeSchema
>;
export type QualityAssessmentCategoryMode = z.infer<
  typeof qualityAssessmentCategoryModeSchema
>;

export interface QualitySourceSnapshotForAssessment {
  sourceVersion: number;
  state: "ACTIVE" | "UPDATED";
  sheetName: string;
  normalizedFeedback: NormalizedQualitySourceRow;
}

export interface QualitySourceAssessmentRecord {
  sourceKey: string;
  sourceVersion: number;
  handlingRecommendation: AiHandlingRecommendation;
  categoryMode: QualityAssessmentCategoryMode;
  isCustomCategory: boolean;
  primaryCategoryCode: string | null;
  secondaryCategoryCode: string | null;
  customPrimaryCategoryName: string | null;
  customSecondaryCategoryName: string | null;
  categoryDisplayName: string;
  riskLevel: AiRiskLevel;
  conclusion: string;
  adoptionMode: QualityAssessmentAdoptionMode;
  changeReason: string | null;
  reviewedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function qualityCategoryPairExists(
  primaryCategoryCode: string,
  secondaryCategoryCode: string,
): boolean {
  const primary = HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.find(
    (category) => category.primaryCode === primaryCategoryCode,
  );
  return primary?.secondaryCategories.some(
    (category) => category.secondaryCode === secondaryCategoryCode,
  ) ?? false;
}

export function qualityPrimaryCategoryExists(primaryCategoryCode: string): boolean {
  return HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.some(
    (category) => category.primaryCode === primaryCategoryCode,
  );
}

export function qualityAssessmentCategoryDisplayName(input: {
  categoryMode: QualityAssessmentCategoryMode;
  primaryCategoryCode?: string | null;
  secondaryCategoryCode?: string | null;
  customPrimaryCategoryName?: string | null;
  customSecondaryCategoryName?: string | null;
}): string {
  if (input.categoryMode === "CUSTOM_FULL") {
    return input.customPrimaryCategoryName?.trim() || "自定义分类";
  }
  const primary = HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.find(
    (category) => category.primaryCode === input.primaryCategoryCode,
  );
  if (input.categoryMode === "CUSTOM_SECONDARY") {
    return [primary?.primaryLabel, input.customSecondaryCategoryName?.trim()]
      .filter(Boolean)
      .join("／");
  }
  const secondary = primary?.secondaryCategories.find(
    (category) => category.secondaryCode === input.secondaryCategoryCode,
  );
  return [primary?.primaryLabel, secondary?.secondaryLabel]
    .filter(Boolean)
    .join("／");
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizedFeedbackFromRow(row: DatabaseRow): NormalizedQualitySourceRow {
  const normalized = parseObject(row.normalized_json);
  const text = (key: string) => String(normalized[key] ?? "").trim();
  return {
    sourceKey: String(row.source_key),
    rowNumber: Number(row.row_number),
    contentHash: String(row.content_hash),
    feedbackAt: text("feedbackAt"),
    feedbackNo: text("feedbackNo"),
    reporter: text("reporter"),
    deviceModel: text("deviceModel"),
    serialNo: text("serialNo"),
    catheterBatch: text("catheterBatch"),
    issueDescription: text("issueDescription"),
    clinicianAware: text("clinicianAware"),
    impact: text("impact"),
    confirmation: text("confirmation"),
    owner: text("owner"),
    returned: text("returned"),
    category: text("category"),
    status: text("status"),
    solutionEngineer: text("solutionEngineer"),
    solution: text("solution"),
    finalCause: text("finalCause"),
    customerFollowup: text("customerFollowup"),
    rawSnapshot: Object.fromEntries(
      Object.entries(parseObject(row.raw_snapshot_json))
        .map(([key, value]) => [key, String(value ?? "")]),
    ),
  };
}

function assessmentFromRow(row: DatabaseRow): QualitySourceAssessmentRecord {
  const categoryMode = qualityAssessmentCategoryModeSchema.parse(
    row.category_mode ?? "STANDARD",
  );
  const primaryCategoryCode = String(row.primary_category_code ?? "").trim() || null;
  const secondaryCategoryCode = String(row.secondary_category_code ?? "").trim() || null;
  const customPrimaryCategoryName = row.custom_primary_category_name == null
    ? null
    : String(row.custom_primary_category_name).trim() || null;
  const customSecondaryCategoryName = row.custom_secondary_category_name == null
    ? null
    : String(row.custom_secondary_category_name).trim() || null;
  const categoryFields = {
    categoryMode,
    primaryCategoryCode,
    secondaryCategoryCode,
    customPrimaryCategoryName,
    customSecondaryCategoryName,
  };
  return {
    sourceKey: String(row.source_key),
    sourceVersion: Number(row.source_version),
    handlingRecommendation: aiHandlingRecommendationSchema.parse(
      row.handling_recommendation,
    ),
    ...categoryFields,
    isCustomCategory: categoryMode !== "STANDARD",
    categoryDisplayName: qualityAssessmentCategoryDisplayName(categoryFields),
    riskLevel: aiRiskLevelSchema.parse(row.risk_level),
    conclusion: String(row.conclusion),
    adoptionMode: qualityAssessmentAdoptionModeSchema.parse(row.adoption_mode),
    changeReason: row.change_reason == null ? null : String(row.change_reason),
    reviewedBy: String(row.reviewed_by),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createQualitySourceAssessmentService(deps?: {
  dbPath?: string;
  now?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const now = deps?.now ?? (() => new Date().toISOString());

  function getSourceSnapshot(
    sourceKey: string,
  ): QualitySourceSnapshotForAssessment | null {
    const row = db.prepare(`
      SELECT source_key, sheet_name, row_number, state, source_version,
             content_hash, normalized_json, raw_snapshot_json
      FROM quality_source_rows
      WHERE source_key = ? AND state <> 'DELETED'
    `).get(sourceKey) as DatabaseRow | undefined;
    if (!row) return null;
    return {
      sourceVersion: Number(row.source_version),
      state: String(row.state) as "ACTIVE" | "UPDATED",
      sheetName: String(row.sheet_name),
      normalizedFeedback: normalizedFeedbackFromRow(row),
    };
  }

  function getAssessment(sourceKey: string): QualitySourceAssessmentRecord | null {
    const row = db.prepare(
      "SELECT * FROM quality_source_assessments WHERE source_key = ?",
    ).get(sourceKey) as DatabaseRow | undefined;
    return row ? assessmentFromRow(row) : null;
  }

  function getReviewWorkspace(sourceKey: string): {
    source: QualitySourceSnapshotForAssessment;
    assessment: QualitySourceAssessmentRecord | null;
  } {
    const source = getSourceSnapshot(sourceKey);
    if (!source) throw new Error("quality source not found");
    return { source, assessment: getAssessment(sourceKey) };
  }

  function saveAssessment(input: {
    sourceKey: string;
    actorUserId: string;
    assessment: z.input<typeof saveQualitySourceAssessmentSchema>;
  }): QualitySourceAssessmentRecord {
    const assessment = saveQualitySourceAssessmentSchema.parse(input.assessment);
    const source = getSourceSnapshot(input.sourceKey);
    if (!source) throw new Error("quality source not found");
    const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare(
        "SELECT * FROM quality_source_assessments WHERE source_key = ?",
      ).get(input.sourceKey) as DatabaseRow | undefined;
      if (existing && Number(existing.version) !== assessment.expectedVersion) {
        throw new Error("version conflict");
      }
      if (!existing && assessment.expectedVersion !== 0) {
        throw new Error("version conflict");
      }
      if (existing) {
        db.prepare(`
          UPDATE quality_source_assessments SET
            source_version = ?, handling_recommendation = ?,
            primary_category_code = ?, secondary_category_code = ?,
            category_mode = ?, custom_primary_category_name = ?,
            custom_secondary_category_name = ?,
            risk_level = ?, conclusion = ?, adoption_mode = ?,
            change_reason = ?, reviewed_by = ?, version = version + 1,
            updated_at = ?
          WHERE source_key = ? AND version = ?
        `).run(
          source.sourceVersion,
          assessment.handlingRecommendation,
          assessment.categoryMode === "CUSTOM_FULL"
            ? ""
            : assessment.primaryCategoryCode ?? "",
          assessment.categoryMode === "STANDARD"
            ? assessment.secondaryCategoryCode ?? ""
            : "",
          assessment.categoryMode,
          assessment.categoryMode === "CUSTOM_FULL"
            ? assessment.customPrimaryCategoryName?.trim() ?? null
            : null,
          assessment.categoryMode === "CUSTOM_SECONDARY"
            ? assessment.customSecondaryCategoryName?.trim() ?? null
            : null,
          assessment.riskLevel,
          assessment.conclusion,
          assessment.adoptionMode,
          assessment.changeReason?.trim() || null,
          input.actorUserId,
          timestamp,
          input.sourceKey,
          assessment.expectedVersion,
        );
      } else {
        db.prepare(`
          INSERT INTO quality_source_assessments (
            source_key, source_version, handling_recommendation,
            primary_category_code, secondary_category_code, category_mode,
            custom_primary_category_name, custom_secondary_category_name, risk_level,
            conclusion, adoption_mode, change_reason, reviewed_by,
            version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          input.sourceKey,
          source.sourceVersion,
          assessment.handlingRecommendation,
          assessment.categoryMode === "CUSTOM_FULL"
            ? ""
            : assessment.primaryCategoryCode ?? "",
          assessment.categoryMode === "STANDARD"
            ? assessment.secondaryCategoryCode ?? ""
            : "",
          assessment.categoryMode,
          assessment.categoryMode === "CUSTOM_FULL"
            ? assessment.customPrimaryCategoryName?.trim() ?? null
            : null,
          assessment.categoryMode === "CUSTOM_SECONDARY"
            ? assessment.customSecondaryCategoryName?.trim() ?? null
            : null,
          assessment.riskLevel,
          assessment.conclusion,
          assessment.adoptionMode,
          assessment.changeReason?.trim() || null,
          input.actorUserId,
          timestamp,
          timestamp,
        );
      }
      const saved = db.prepare(
        "SELECT * FROM quality_source_assessments WHERE source_key = ?",
      ).get(input.sourceKey) as DatabaseRow;
      db.exec("COMMIT");
      return assessmentFromRow(saved);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    getSourceSnapshot,
    getAssessment,
    getReviewWorkspace,
    saveAssessment,
    close: () => db.close(),
  };
}
