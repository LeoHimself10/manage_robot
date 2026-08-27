import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "./quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

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
    initialCategory: string;
    urgency: "LOW" | "MEDIUM" | "HIGH";
    supplement: string;
    reason: string;
  }) {
    if (input.testAftersalesUserId !== "QUALITY_TEST_AFTERSALES_001") {
      throw new Error("只有马荣鑫（测试）可以修订测试研判");
    }
    const boundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({ event: boundary, actorUserId: input.testAftersalesUserId });
    if (!boundary.isTest) throw new Error("真实质量事件不能使用测试研判动作");
    const before = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!before) throw new Error("质量事件不存在");
    if (String(before.status) === "CLOSED") throw new Error("已关闭测试事件只读");
    if (Number(before.version) !== input.expectedVersion) throw new Error("version conflict");
    const problemStatus = input.problemStatus.trim();
    const initialCategory = input.initialCategory.trim();
    const supplement = input.supplement.trim();
    const reason = input.reason.trim();
    if (!problemStatus || !initialCategory || !reason) throw new Error("请完整填写研判内容和修订原因");
    const occurredAt = now();
    try {
      db.exec("BEGIN IMMEDIATE");
      const updated = db.prepare(`
        UPDATE quality_events
        SET problem_status=?,initial_category=?,urgency=?,supplement=?,
            version=version+1,updated_at=?
        WHERE id=? AND is_test=1 AND version=? AND status<>'CLOSED'
      `).run(
        problemStatus,
        initialCategory,
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
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
        reason,
        input.testAftersalesUserId,
        occurredAt,
      );
      db.prepare(`
        INSERT INTO quality_audit_events(
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,
          reason,request_id,occurred_at
        ) VALUES(?,?,?,'aftersales_manager','REPORT_CORRECTED',?,?,?,?,?)
      `).run(
        id(),
        input.eventId,
        input.testAftersalesUserId,
        JSON.stringify(before),
        JSON.stringify(after),
        reason,
        input.requestId,
        occurredAt,
      );
      appendQualityTestActionAudit(db, {
        eventId: input.eventId,
        testActorUserId: input.testAftersalesUserId,
        actualAdminUserId: input.actualAdminUserId,
        action: "UPDATE_AFTERSALES_REVIEW",
        requestId: input.requestId,
        occurredAt,
      });
      db.exec("COMMIT");
      return { eventVersion: input.expectedVersion + 1 };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    }
  }

  return { update, close: () => db.close() };
}
