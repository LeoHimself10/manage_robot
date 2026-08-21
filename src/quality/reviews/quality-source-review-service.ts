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

function reviewFromRow(row: DatabaseRow): QualitySourceReviewRecord {
  return {
    sourceKey: String(row.source_key),
    status: String(row.status) as QualitySourceReviewStatus,
    note: nullable(row.note),
    decidedBy: String(row.decided_by),
    decidedAt: String(row.decided_at),
    sourceContentHash: String(row.source_content_hash),
    eventId: nullable(row.event_id),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function reviewJson(review: QualitySourceReviewRecord | null): Record<string, unknown> | null {
  return review as unknown as Record<string, unknown> | null;
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
    const nextVersion = (before?.version ?? 0) + 1;
    input.db.prepare(`
      INSERT INTO quality_source_reviews(
        source_key,status,note,decided_by,decided_at,source_content_hash,event_id,
        version,created_at,updated_at
      ) VALUES(?,'REPORTED',NULL,?,?,?,?,1,?,?)
      ON CONFLICT(source_key) DO UPDATE SET
        status='REPORTED',note=NULL,decided_by=excluded.decided_by,
        decided_at=excluded.decided_at,source_content_hash=excluded.source_content_hash,
        event_id=excluded.event_id,version=quality_source_reviews.version+1,
        updated_at=excluded.updated_at
    `).run(
      sourceKey,
      input.actorUserId,
      input.occurredAt,
      String(source.content_hash),
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
    requestId: string;
  }): QualitySourceReviewRecord {
    if (!input.actorUserId.trim()) throw new Error("actor user is required");
    if (!input.requestId.trim()) throw new Error("request id is required");
    const source = db.prepare(`
      SELECT source_key,content_hash,state FROM quality_source_rows
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
    const occurredAt = now();
    const note = input.note?.trim() || null;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!before) {
        db.prepare(`
          INSERT INTO quality_source_reviews(
            source_key,status,note,decided_by,decided_at,source_content_hash,event_id,
            version,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,NULL,1,?,?)
        `).run(
          input.sourceKey, input.decision, note, input.actorUserId, occurredAt,
          String(source.content_hash), occurredAt, occurredAt,
        );
      } else {
        const result = db.prepare(`
          UPDATE quality_source_reviews SET
            status=?,note=?,decided_by=?,decided_at=?,source_content_hash=?,event_id=NULL,
            version=version+1,updated_at=?
          WHERE source_key=? AND version=? AND status<>'REPORTED'
        `).run(
          input.decision, note, input.actorUserId, occurredAt, String(source.content_hash),
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
        id(), input.sourceKey, input.actorUserId, "SOURCE_REVIEWED",
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
