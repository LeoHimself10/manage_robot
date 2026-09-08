import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";
import {
  qualityAssessmentCategoryDisplayName,
  qualityCategoryPairExists,
  qualityPrimaryCategoryExists,
  type QualityAssessmentAdoptionMode,
  type QualityAssessmentCategoryMode,
} from "../reviews/quality-source-assessment-service";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "./quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

function nullableText(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function validateCategory(input: {
  categoryMode: QualityAssessmentCategoryMode;
  primaryCategoryCode?: string | null;
  secondaryCategoryCode?: string | null;
  customPrimaryCategoryName?: string | null;
  customSecondaryCategoryName?: string | null;
  adoptionMode: QualityAssessmentAdoptionMode;
}) {
  if (input.categoryMode === "STANDARD") {
    if (!input.primaryCategoryCode || !input.secondaryCategoryCode
      || !qualityCategoryPairExists(input.primaryCategoryCode, input.secondaryCategoryCode)) {
      throw new Error("请选择正确对应的一级、二级分类");
    }
  } else if (input.categoryMode === "CUSTOM_SECONDARY") {
    if (!input.primaryCategoryCode || !qualityPrimaryCategoryExists(input.primaryCategoryCode)) {
      throw new Error("自定义二级分类必须保留有效的一级分类");
    }
    if (!input.customSecondaryCategoryName?.trim()) throw new Error("自定义二级分类必填");
  } else if (!input.customPrimaryCategoryName?.trim()) {
    throw new Error("自定义分类必填");
  }
  if (input.categoryMode !== "STANDARD" && input.adoptionMode === "DIRECT") {
    throw new Error("采用自定义分类时必须记录为修改后采纳或人工填写");
  }
}

export function createQualityTestAftersalesService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function update(input: {
    eventId: string;
    testAftersalesUserId: string;
    actualAdminUserId: string;
    expectedVersion: number;
    requestId: string;
    problemStatus: string;
    isQualityEvent: boolean;
    categoryMode: QualityAssessmentCategoryMode;
    primaryCategoryCode?: string | null;
    secondaryCategoryCode?: string | null;
    customPrimaryCategoryName?: string | null;
    customSecondaryCategoryName?: string | null;
    urgency: "LOW" | "MEDIUM" | "HIGH";
    supplement: string;
    adoptionMode: QualityAssessmentAdoptionMode;
    reason: string;
    submissionMode?: "SAVE_DRAFT" | "CONFIRM";
  }) {
    if (input.testAftersalesUserId !== "QUALITY_TEST_AFTERSALES_001") {
      throw new Error("只有马荣鑫（测试）可以修订测试研判");
    }
    const boundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({ event: boundary, actorUserId: input.testAftersalesUserId });
    if (!boundary.isTest) throw new Error("真实质量事件不能使用测试研判动作");
    const submissionMode = input.submissionMode ?? "CONFIRM";
    const pushesQualityAnalysis = input.isQualityEvent && submissionMode === "CONFIRM";
    if (!input.isQualityEvent && submissionMode === "SAVE_DRAFT") {
      throw new Error("普通事件请直接保存为普通事件");
    }
    const expectedAuditAction = input.isQualityEvent
      ? (pushesQualityAnalysis ? "CONFIRM_QUALITY_EVENT" : "SAVE_QUALITY_ASSESSMENT")
      : "RECORD_ORDINARY_EVENT";
    const before = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!before) throw new Error("质量事件不存在");
    const repeated = db.prepare(`
      SELECT action,test_actor_user_id,actual_admin_user_id
      FROM quality_test_action_audit
      WHERE event_id=? AND request_id=?
    `).get(input.eventId, input.requestId) as DatabaseRow | undefined;
    if (repeated) {
      if (String(repeated.action) !== expectedAuditAction
        || String(repeated.test_actor_user_id) !== input.testAftersalesUserId
        || String(repeated.actual_admin_user_id) !== input.actualAdminUserId) {
        throw new Error("requestId 已用于其他测试研判操作");
      }
      const currentAssessment = db.prepare(`
        SELECT assessment.handling_recommendation
        FROM quality_source_assessments assessment
        JOIN quality_event_source_links link ON link.source_key=assessment.source_key
        WHERE link.event_id=?
        ORDER BY assessment.updated_at DESC LIMIT 1
      `).get(input.eventId) as DatabaseRow | undefined;
      return {
        eventVersion: Number(before.version),
        disposition: String(currentAssessment?.handling_recommendation
          ?? (input.isQualityEvent ? "QUALITY_ANOMALY" : "ORDINARY")),
        pushedToAnalysis: pushesQualityAnalysis,
      };
    }
    const downstreamStarted = String(before.status) !== "PENDING_ANALYSIS"
      || Boolean(db.prepare(`
        SELECT 1 FROM quality_analysis_versions WHERE event_id=? LIMIT 1
      `).get(input.eventId))
      || Boolean(db.prepare(`
        SELECT 1 FROM quality_assignment_nodes WHERE event_id=? LIMIT 1
      `).get(input.eventId));
    if (downstreamStarted) {
      throw new Error("质量初析或任务分配已开始，主管研判不能再修改");
    }
    if (Number(before.version) !== input.expectedVersion) throw new Error("version conflict");
    const problemStatus = input.problemStatus.trim();
    const supplement = input.supplement.trim();
    const reason = input.reason.trim();
    if (!problemStatus) throw new Error("请完整填写研判内容");
    if (input.isQualityEvent && input.adoptionMode !== "DIRECT" && !reason) {
      throw new Error("确认质量事件时请填写研判或修改原因");
    }
    const decisionReason = reason || (input.isQualityEvent
      ? (pushesQualityAnalysis ? "直接采纳AI原始研判" : "保存质量研判草稿")
      : "确认不属于质量事件，保存为普通事件");
    validateCategory(input);
    const handlingRecommendation = input.isQualityEvent ? "QUALITY_ANOMALY" : "ORDINARY";
    const categoryDisplayName = qualityAssessmentCategoryDisplayName(input);
    if (!categoryDisplayName) throw new Error("人工确认分类不能为空");
    const occurredAt = now();
    try {
      db.exec("BEGIN IMMEDIATE");
      let linkedSources = db.prepare(`
        SELECT source.source_key,source.source_version,source.content_hash
        FROM quality_event_source_links link
        JOIN quality_source_rows source ON source.source_key=link.source_key
        WHERE link.event_id=? AND source.state<>'DELETED'
        ORDER BY link.linked_at,source.source_key
      `).all(input.eventId) as DatabaseRow[];
      if (linkedSources.length === 0) {
        const sourceKey = `quality-test-source:${input.eventId}`;
        const snapshot = {
          反馈单号: String(before.event_no),
          问题描述: problemStatus,
          问题分类: categoryDisplayName,
          数据说明: "由隔离测试事件补建的来源快照",
        };
        const snapshotJson = JSON.stringify(snapshot);
        const contentHash = createHash("sha256").update(snapshotJson).digest("hex");
        db.prepare(`
          INSERT OR IGNORE INTO quality_source_rows(
            source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
            normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,
            last_seen_at,source_updated_at,synced_at,version
          ) VALUES(?, 'QUALITY_TEST_ISOLATED', '隔离测试来源', 1, 'ACTIVE', 1, ?,
            ?, ?, NULL, ?, ?, ?, ?, 1)
        `).run(
          sourceKey, contentHash,
          JSON.stringify({ sourceKey, issueDescription: problemStatus, category: categoryDisplayName }),
          snapshotJson, occurredAt, occurredAt, occurredAt, occurredAt,
        );
        db.prepare(`
          INSERT OR IGNORE INTO quality_event_source_links(
            id,event_id,source_key,source_version,source_state_at_link,
            source_snapshot_json,linked_by,linked_at
          ) VALUES(?,?,?,1,'ACTIVE',?,?,?)
        `).run(
          `quality-test-source-link:${input.eventId}`,
          input.eventId,
          sourceKey,
          snapshotJson,
          input.testAftersalesUserId,
          occurredAt,
        );
        linkedSources = [{ source_key: sourceKey, source_version: 1, content_hash: contentHash }];
      }

      for (const source of linkedSources) {
        const sourceKey = String(source.source_key);
        const existingAssessment = db.prepare(
          "SELECT * FROM quality_source_assessments WHERE source_key=?",
        ).get(sourceKey) as DatabaseRow | undefined;
        const existingReview = db.prepare(
          "SELECT * FROM quality_source_reviews WHERE source_key=?",
        ).get(sourceKey) as DatabaseRow | undefined;
        const aiAssessment = db.prepare(`
          SELECT id FROM quality_source_ai_assessments
          WHERE source_key=? AND source_version=?
          ORDER BY created_at DESC,id DESC LIMIT 1
        `).get(sourceKey, Number(source.source_version)) as DatabaseRow | undefined;
        if (input.adoptionMode !== "MANUAL" && !aiAssessment) {
          throw new Error("采纳AI建议前必须先完成当前来源版本的AI原始研判");
        }
        const assessmentVersion = Number(existingAssessment?.version ?? 0) + 1;
        const assessmentSnapshot = {
          sourceKey,
          sourceVersion: Number(source.source_version),
          handlingRecommendation,
          categoryMode: input.categoryMode,
          primaryCategoryCode: input.categoryMode === "CUSTOM_FULL"
            ? null : input.primaryCategoryCode ?? null,
          secondaryCategoryCode: input.categoryMode === "STANDARD"
            ? input.secondaryCategoryCode ?? null : null,
          customPrimaryCategoryName: input.categoryMode === "CUSTOM_FULL"
            ? nullableText(input.customPrimaryCategoryName) : null,
          customSecondaryCategoryName: input.categoryMode === "CUSTOM_SECONDARY"
            ? nullableText(input.customSecondaryCategoryName) : null,
          categoryDisplayName,
          riskLevel: input.urgency,
          conclusion: supplement,
          adoptionMode: input.adoptionMode,
          changeReason: input.adoptionMode === "DIRECT" ? null : nullableText(reason),
          reviewedBy: input.testAftersalesUserId,
          version: assessmentVersion,
          updatedAt: occurredAt,
        };
        if (existingAssessment) {
          db.prepare(`
            UPDATE quality_source_assessments SET
              source_version=?,handling_recommendation=?,primary_category_code=?,
              secondary_category_code=?,category_mode=?,custom_primary_category_name=?,
              custom_secondary_category_name=?,risk_level=?,conclusion=?,adoption_mode=?,
              change_reason=?,ai_assessment_id=?,reviewed_by=?,version=version+1,updated_at=?
            WHERE source_key=?
          `).run(
            Number(source.source_version), handlingRecommendation,
            input.categoryMode === "CUSTOM_FULL" ? "" : input.primaryCategoryCode ?? "",
            input.categoryMode === "STANDARD" ? input.secondaryCategoryCode ?? "" : "",
            input.categoryMode,
            input.categoryMode === "CUSTOM_FULL" ? nullableText(input.customPrimaryCategoryName) : null,
            input.categoryMode === "CUSTOM_SECONDARY" ? nullableText(input.customSecondaryCategoryName) : null,
            input.urgency, supplement || problemStatus, input.adoptionMode,
            input.adoptionMode === "DIRECT" ? null : nullableText(reason),
            aiAssessment?.id == null ? null : String(aiAssessment.id),
            input.testAftersalesUserId, occurredAt, sourceKey,
          );
        } else {
          db.prepare(`
            INSERT INTO quality_source_assessments(
              source_key,source_version,handling_recommendation,primary_category_code,
              secondary_category_code,category_mode,custom_primary_category_name,
              custom_secondary_category_name,risk_level,conclusion,adoption_mode,
              change_reason,ai_assessment_id,reviewed_by,version,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
          `).run(
            sourceKey, Number(source.source_version), handlingRecommendation,
            input.categoryMode === "CUSTOM_FULL" ? "" : input.primaryCategoryCode ?? "",
            input.categoryMode === "STANDARD" ? input.secondaryCategoryCode ?? "" : "",
            input.categoryMode,
            input.categoryMode === "CUSTOM_FULL" ? nullableText(input.customPrimaryCategoryName) : null,
            input.categoryMode === "CUSTOM_SECONDARY" ? nullableText(input.customSecondaryCategoryName) : null,
            input.urgency, supplement || problemStatus, input.adoptionMode,
            input.adoptionMode === "DIRECT" ? null : nullableText(reason),
            aiAssessment?.id == null ? null : String(aiAssessment.id),
            input.testAftersalesUserId, occurredAt, occurredAt,
          );
        }
        db.prepare(`
          INSERT INTO quality_source_assessment_audit(
            id,source_key,assessment_version,actor_user_id,action,before_json,
            after_json,request_id,occurred_at
          ) VALUES(?,?,?,?,?,?,?,?,?)
        `).run(
          id(), sourceKey, assessmentVersion, input.testAftersalesUserId,
          existingAssessment ? "ASSESSMENT_UPDATED" : "ASSESSMENT_CREATED",
          existingAssessment ? JSON.stringify(existingAssessment) : null,
          JSON.stringify(assessmentSnapshot), input.requestId, occurredAt,
        );

        if (!input.isQualityEvent || pushesQualityAnalysis) {
          const reviewStatus = input.isQualityEvent ? "REPORTED" : "ORDINARY";
          const reviewNote = input.isQualityEvent
            ? null : "主管确认不属于质量事件，按普通事件留档";
          const reviewVersion = Number(existingReview?.version ?? 0) + 1;
          if (existingReview) {
            db.prepare(`
              UPDATE quality_source_reviews SET
                status=?,note=?,decided_by=?,decided_at=?,source_content_hash=?,
                assessment_version=?,assessment_snapshot_json=?,event_id=?,
                version=version+1,updated_at=?
              WHERE source_key=?
            `).run(
              reviewStatus, reviewNote, input.testAftersalesUserId, occurredAt,
              String(source.content_hash), assessmentVersion, JSON.stringify(assessmentSnapshot),
              input.isQualityEvent ? input.eventId : null, occurredAt, sourceKey,
            );
          } else {
            db.prepare(`
              INSERT INTO quality_source_reviews(
                source_key,status,note,decided_by,decided_at,source_content_hash,
                assessment_version,assessment_snapshot_json,event_id,version,created_at,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)
            `).run(
              sourceKey, reviewStatus, reviewNote, input.testAftersalesUserId, occurredAt,
              String(source.content_hash), assessmentVersion, JSON.stringify(assessmentSnapshot),
              input.isQualityEvent ? input.eventId : null, occurredAt, occurredAt,
            );
          }
          const savedReview = db.prepare(
            "SELECT * FROM quality_source_reviews WHERE source_key=?",
          ).get(sourceKey) as DatabaseRow;
          db.prepare(`
            INSERT INTO quality_source_review_audit(
              id,source_key,actor_user_id,action,before_json,after_json,request_id,occurred_at
            ) VALUES(?,?,?,?,?,?,?,?)
          `).run(
            id(), sourceKey, input.testAftersalesUserId,
            input.isQualityEvent ? "SOURCE_REPORTED" : "SOURCE_REVIEWED",
            existingReview ? JSON.stringify(existingReview) : null,
            JSON.stringify({ ...savedReview, version: reviewVersion }), input.requestId, occurredAt,
          );
        }
      }

      const updated = db.prepare(`
        UPDATE quality_events
        SET problem_status=?,initial_category=?,urgency=?,supplement=?,
            version=version+1,updated_at=?
        WHERE id=? AND is_test=1 AND version=? AND status<>'CLOSED'
      `).run(
        problemStatus,
        categoryDisplayName,
        input.urgency,
        supplement || null,
        occurredAt,
        input.eventId,
        input.expectedVersion,
      );
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      const after = db.prepare("SELECT * FROM quality_events WHERE id=?")
        .get(input.eventId) as DatabaseRow;
      db.prepare(`
        INSERT INTO quality_event_supplements(
          id,event_id,kind,content,before_json,after_json,reason,created_by,created_at,version
        ) VALUES(?,?,'CORRECTION',?,?,?,?,?, ?,1)
      `).run(
        id(),
        input.eventId,
        decisionReason,
        JSON.stringify(before),
        JSON.stringify(after),
        decisionReason,
        input.testAftersalesUserId,
        occurredAt,
      );
      db.prepare(`
        INSERT INTO quality_audit_events(
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,
          reason,request_id,occurred_at
        ) VALUES(?,?,?,'aftersales_manager',?,?,?,?,?,?)
      `).run(
        id(),
        input.eventId,
        input.testAftersalesUserId,
        input.isQualityEvent && !pushesQualityAnalysis
          ? "AFTERSALES_ASSESSMENT_SAVED"
          : "AFTERSALES_QUALITY_DECISION",
        JSON.stringify(before),
        JSON.stringify(after),
        `${input.isQualityEvent
          ? (pushesQualityAnalysis ? "确认属于质量事件并推送质量初析" : "保存质量研判，尚未推送")
          : "确认不属于质量事件"}：${decisionReason}`,
        input.requestId,
        occurredAt,
      );
      appendQualityTestActionAudit(db, {
        eventId: input.eventId,
        testActorUserId: input.testAftersalesUserId,
        actualAdminUserId: input.actualAdminUserId,
        action: input.isQualityEvent
          ? (pushesQualityAnalysis ? "CONFIRM_QUALITY_EVENT" : "SAVE_QUALITY_ASSESSMENT")
          : "RECORD_ORDINARY_EVENT",
        requestId: input.requestId,
        occurredAt,
      });
      db.exec("COMMIT");
      return {
        eventVersion: input.expectedVersion + 1,
        disposition: handlingRecommendation,
        pushedToAnalysis: pushesQualityAnalysis,
      };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    }
  }

  return { update, close: () => db.close() };
}
