import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";

export type QualitySourceReviewStatus = "ORDINARY" | "NEEDS_INFO" | "REPORTED";

export interface QualitySourceReviewRecord {
  sourceKey: string;
  status: QualitySourceReviewStatus;
  note: string | null;
  decidedBy: string;
  decidedAt: string;
  sourceContentHash: string;
  assessmentVersion: number | null;
  assessmentSnapshot: Record<string, unknown> | null;
  eventId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type DatabaseRow = Record<string, unknown>;

const WRITEBACK_VALUE: Record<QualitySourceReviewStatus, string> = {
  ORDINARY: "普通反馈",
  NEEDS_INFO: "待补资料",
  REPORTED: "已进入后续流程",
};

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function nullableObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function reviewFromRow(row: DatabaseRow): QualitySourceReviewRecord {
  return {
    sourceKey: String(row.source_key),
    status: String(row.status) as QualitySourceReviewStatus,
    note: nullable(row.note),
    decidedBy: String(row.decided_by),
    decidedAt: String(row.decided_at),
    sourceContentHash: String(row.source_content_hash),
    assessmentVersion: row.assessment_version == null
      ? null
      : Number(row.assessment_version),
    assessmentSnapshot: nullableObject(row.assessment_snapshot_json),
    eventId: nullable(row.event_id),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function reviewJson(review: QualitySourceReviewRecord | null): Record<string, unknown> | null {
  return review as unknown as Record<string, unknown> | null;
}

function assessmentSnapshotFromRow(row: DatabaseRow | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    sourceKey: String(row.source_key),
    sourceVersion: Number(row.source_version),
    handlingRecommendation: String(row.handling_recommendation),
    primaryCategoryCode: nullable(row.primary_category_code),
    secondaryCategoryCode: nullable(row.secondary_category_code),
    categoryMode: String(row.category_mode ?? "STANDARD"),
    customPrimaryCategoryName: nullable(row.custom_primary_category_name),
    customSecondaryCategoryName: nullable(row.custom_secondary_category_name),
    riskLevel: String(row.risk_level),
    conclusion: String(row.conclusion),
    adoptionMode: String(row.adoption_mode),
    changeReason: nullable(row.change_reason),
    aiAssessmentId: nullable(row.ai_assessment_id),
    reviewedBy: String(row.reviewed_by),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function enqueueQualitySourceWriteback(
  db: DatabaseSync,
  input: {
    sourceKey: string;
    reviewVersion: number;
    desiredValue: string;
    occurredAt: string;
    id?: string;
  },
): void {
  const dedupeKey = `${input.sourceKey}:${input.reviewVersion}:${input.desiredValue}`;
  db.prepare(`
    INSERT INTO quality_source_writeback_outbox(
      writeback_id,source_key,review_version,desired_value,dedupe_key,status,
      attempt_count,next_attempt_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,'PENDING',0,?,?,?)
    ON CONFLICT(dedupe_key) DO NOTHING
  `).run(
    input.id ?? randomUUID(),
    input.sourceKey,
    input.reviewVersion,
    input.desiredValue,
    dedupeKey,
    input.occurredAt,
    input.occurredAt,
    input.occurredAt,
  );
}

export function markLinkedSourcesReported(input: {
  db: DatabaseSync;
  eventId: string;
  actorUserId: string;
  requestId: string;
  occurredAt: string;
  id?: () => string;
}): QualitySourceReviewRecord[] {
  const id = input.id ?? randomUUID;
  const sources = input.db.prepare(`
    SELECT l.source_key,r.content_hash
    FROM quality_event_source_links l
    JOIN quality_source_rows r ON r.source_key=l.source_key
    WHERE l.event_id=? ORDER BY l.linked_at,l.source_key
  `).all(input.eventId) as DatabaseRow[];
  const reviews: QualitySourceReviewRecord[] = [];
  for (const source of sources) {
    const sourceKey = String(source.source_key);
    const beforeRow = input.db.prepare("SELECT * FROM quality_source_reviews WHERE source_key=?")
      .get(sourceKey) as DatabaseRow | undefined;
    const before = beforeRow ? reviewFromRow(beforeRow) : null;
    const assessmentRow = input.db.prepare(
      "SELECT * FROM quality_source_assessments WHERE source_key=?",
    ).get(sourceKey) as DatabaseRow | undefined;
    const assessmentSnapshot = assessmentSnapshotFromRow(assessmentRow);
    const nextVersion = (before?.version ?? 0) + 1;
    input.db.prepare(`
      INSERT INTO quality_source_reviews(
        source_key,status,note,decided_by,decided_at,source_content_hash,
        assessment_version,assessment_snapshot_json,event_id,version,created_at,updated_at
      ) VALUES(?,'REPORTED',NULL,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(source_key) DO UPDATE SET
        status='REPORTED',note=NULL,decided_by=excluded.decided_by,
        decided_at=excluded.decided_at,source_content_hash=excluded.source_content_hash,
        assessment_version=excluded.assessment_version,
        assessment_snapshot_json=excluded.assessment_snapshot_json,
        event_id=excluded.event_id,version=quality_source_reviews.version+1,
        updated_at=excluded.updated_at
    `).run(
      sourceKey,
      input.actorUserId,
      input.occurredAt,
      String(source.content_hash),
      assessmentRow == null ? null : Number(assessmentRow.version),
      assessmentSnapshot == null ? null : JSON.stringify(assessmentSnapshot),
      input.eventId,
      input.occurredAt,
      input.occurredAt,
    );
    const after = reviewFromRow(input.db.prepare("SELECT * FROM quality_source_reviews WHERE source_key=?")
      .get(sourceKey) as DatabaseRow);
    input.db.prepare(`
      INSERT INTO quality_source_review_audit(
        id,source_key,actor_user_id,action,before_json,after_json,request_id,occurred_at
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(source_key,request_id) DO NOTHING
    `).run(
      id(), sourceKey, input.actorUserId, "SOURCE_REPORTED",
      before ? JSON.stringify(reviewJson(before)) : null,
      JSON.stringify(reviewJson(after)), input.requestId, input.occurredAt,
    );
    enqueueQualitySourceWriteback(input.db, {
      sourceKey,
      reviewVersion: nextVersion,
      desiredValue: WRITEBACK_VALUE.REPORTED,
      occurredAt: input.occurredAt,
      id: id(),
    });
    reviews.push(after);
  }
  return reviews;
}

export function createQualitySourceReviewService(deps?: {
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

  function get(sourceKey: string): QualitySourceReviewRecord | null {
    const row = db.prepare("SELECT * FROM quality_source_reviews WHERE source_key=?")
      .get(sourceKey) as DatabaseRow | undefined;
    return row ? reviewFromRow(row) : null;
  }

  function reviewSource(input: {
    actorUserId: string;
    sourceKey: string;
    decision: "ORDINARY" | "NEEDS_INFO";
    note?: string;
    expectedVersion: number;
    assessmentVersion?: number;
    requestId: string;
  }): QualitySourceReviewRecord {
    if (!input.actorUserId.trim()) throw new Error("actor user is required");
    if (!input.requestId.trim()) throw new Error("request id is required");
    const source = db.prepare(`
      SELECT source_key,source_version,content_hash,state FROM quality_source_rows
      WHERE source_key=? AND state<>'DELETED'
    `).get(input.sourceKey) as DatabaseRow | undefined;
    if (!source) throw new Error("来源反馈不存在");
    const repeated = db.prepare(`
      SELECT 1 FROM quality_source_review_audit WHERE source_key=? AND request_id=?
    `).get(input.sourceKey, input.requestId);
    if (repeated) {
      const current = get(input.sourceKey);
      if (!current) throw new Error("研判记录不存在");
      return current;
    }
    const before = get(input.sourceKey);
    if (before?.status === "REPORTED") throw new Error("该反馈已进入质量流程，不能在研判页撤回");
    if ((before?.version ?? 0) !== input.expectedVersion) throw new Error("version conflict");
    const note = input.note?.trim() || null;
    const assessmentRow = input.assessmentVersion == null ? undefined : db.prepare(
      "SELECT * FROM quality_source_assessments WHERE source_key=?",
    ).get(input.sourceKey) as DatabaseRow | undefined;
    if (input.assessmentVersion != null) {
      if (!assessmentRow || Number(assessmentRow.version) !== input.assessmentVersion) {
        throw new Error("version conflict");
      }
      if (Number(assessmentRow.source_version) !== Number(source.source_version)) {
        throw new Error("来源资料已更新，请重新研判后再正式处置");
      }
      if (String(assessmentRow.handling_recommendation) !== input.decision) {
        throw new Error("正式处置必须与已保存的主管最终研判一致");
      }
      if (input.decision === "NEEDS_INFO" && !note) {
        throw new Error("待补资料必须填写需要补充的资料或说明");
      }
    }
    const assessmentSnapshot = assessmentSnapshotFromRow(assessmentRow);
    const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!before) {
        db.prepare(`
          INSERT INTO quality_source_reviews(
            source_key,status,note,decided_by,decided_at,source_content_hash,
            assessment_version,assessment_snapshot_json,event_id,version,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,NULL,1,?,?)
        `).run(
          input.sourceKey, input.decision, note, input.actorUserId, occurredAt,
          String(source.content_hash), input.assessmentVersion ?? null,
          assessmentSnapshot == null ? null : JSON.stringify(assessmentSnapshot),
          occurredAt, occurredAt,
        );
      } else {
        const result = db.prepare(`
          UPDATE quality_source_reviews SET
            status=?,note=?,decided_by=?,decided_at=?,source_content_hash=?,event_id=NULL,
            assessment_version=?,assessment_snapshot_json=?,
            version=version+1,updated_at=?
          WHERE source_key=? AND version=? AND status<>'REPORTED'
        `).run(
          input.decision, note, input.actorUserId, occurredAt, String(source.content_hash),
          input.assessmentVersion ?? null,
          assessmentSnapshot == null ? null : JSON.stringify(assessmentSnapshot),
          occurredAt, input.sourceKey, input.expectedVersion,
        );
        if (Number(result.changes) !== 1) throw new Error("version conflict");
      }
      const after = get(input.sourceKey)!;
      db.prepare(`
        INSERT INTO quality_source_review_audit(
          id,source_key,actor_user_id,action,before_json,after_json,request_id,occurred_at
        ) VALUES(?,?,?,?,?,?,?,?)
      `).run(
        id(), input.sourceKey, input.actorUserId,
        input.assessmentVersion == null ? "SOURCE_REVIEWED" : "FINAL_DISPOSITION_CONFIRMED",
        before ? JSON.stringify(reviewJson(before)) : null,
        JSON.stringify(reviewJson(after)), input.requestId, occurredAt,
      );
      enqueueQualitySourceWriteback(db, {
        sourceKey: input.sourceKey,
        reviewVersion: after.version,
        desiredValue: WRITEBACK_VALUE[after.status],
        occurredAt,
        id: id(),
      });
      db.exec("COMMIT");
      return after;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { get, reviewSource, close: () => db.close() };
}
