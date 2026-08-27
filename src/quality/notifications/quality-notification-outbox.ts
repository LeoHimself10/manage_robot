import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";
import {
  assertQualityNotificationBoundary,
  readQualityEventBoundary,
} from "../testing/quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

export interface QualityNotificationInput {
  eventId: string;
  action: string;
  recipientUserId: string;
  subject: string;
  markdown: string;
  detailUrl: string;
  dedupeKey: string;
  channel?: string;
}

export interface QualityNotificationRecord extends QualityNotificationInput {
  notificationId: string;
  channel: string;
  status: "PENDING" | "SENDING" | "SENT" | "RETRY" | "DEAD";
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  sendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

function nullable(value: unknown): string | null { return value == null ? null : String(value); }
function rowToRecord(row: DatabaseRow): QualityNotificationRecord {
  return {
    notificationId: String(row.notification_id), eventId: String(row.event_id), action: String(row.action), recipientUserId: String(row.recipient_user_id),
    channel: String(row.channel), subject: String(row.subject), markdown: String(row.markdown), detailUrl: String(row.detail_url), dedupeKey: String(row.dedupe_key),
    status: String(row.status) as QualityNotificationRecord["status"], attemptCount: Number(row.attempt_count), nextAttemptAt: String(row.next_attempt_at),
    lastError: nullable(row.last_error), sendingStartedAt: nullable(row.sending_started_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), sentAt: nullable(row.sent_at),
  };
}

function safeError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    .replace(/(access[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]");
  return raw.slice(0, 500);
}

export function enqueueQualityNotification(db: DatabaseSync, input: QualityNotificationInput, occurredAt: string, notificationId: string = randomUUID()): QualityNotificationRecord {
  const boundary = readQualityEventBoundary(db, input.eventId);
  assertQualityNotificationBoundary({
    event: boundary,
    recipientUserIds: [input.recipientUserId],
  });
  const channel = boundary.isTest ? "TEST" : (input.channel ?? "DINGTALK");
  db.prepare(`
    INSERT INTO quality_notification_outbox(notification_id,event_id,action,recipient_user_id,channel,subject,markdown,detail_url,dedupe_key,status,attempt_count,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'PENDING',0,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING
  `).run(notificationId, input.eventId, input.action, input.recipientUserId, channel, input.subject, input.markdown, input.detailUrl, input.dedupeKey, occurredAt, occurredAt, occurredAt);
  const row = db.prepare("SELECT * FROM quality_notification_outbox WHERE dedupe_key=?").get(input.dedupeKey) as DatabaseRow;
  return rowToRecord(row);
}

export function createQualityNotificationOutbox(deps?: { dbPath?: string; now?: () => Date; id?: () => string }) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath(); createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath); db.exec("PRAGMA foreign_keys=ON"); db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date()); const id = deps?.id ?? randomUUID;
  const get = (notificationId: string) => {
    const row = db.prepare("SELECT * FROM quality_notification_outbox WHERE notification_id=?").get(notificationId) as DatabaseRow | undefined;
    return row ? rowToRecord(row) : null;
  };

  function enqueue(input: QualityNotificationInput) { return enqueueQualityNotification(db, input, now().toISOString(), id()); }

  function claimNext(): QualityNotificationRecord | null {
    const instant = now(); const nowIso = instant.toISOString(); const staleIso = new Date(instant.getTime() - 10 * 60_000).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE quality_notification_outbox SET status='RETRY',next_attempt_at=?,updated_at=?,sending_started_at=NULL,last_error=COALESCE(last_error,'发送进程中断，已自动恢复') WHERE status='SENDING' AND sending_started_at<=?`)
        .run(nowIso, nowIso, staleIso);
      const row = db.prepare(`SELECT notification_id FROM quality_notification_outbox WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=? ORDER BY next_attempt_at,created_at,notification_id LIMIT 1`).get(nowIso) as DatabaseRow | undefined;
      if (!row) { db.exec("COMMIT"); return null; }
      db.prepare(`UPDATE quality_notification_outbox SET status='SENDING',attempt_count=attempt_count+1,sending_started_at=?,updated_at=? WHERE notification_id=? AND status IN ('PENDING','RETRY')`)
        .run(nowIso, nowIso, String(row.notification_id));
      const claimed = get(String(row.notification_id)); db.exec("COMMIT"); return claimed;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function markSent(notificationId: string): QualityNotificationRecord {
    const occurredAt = now().toISOString();
    db.prepare(`UPDATE quality_notification_outbox SET status='SENT',sent_at=?,updated_at=?,sending_started_at=NULL,last_error=NULL WHERE notification_id=? AND status='SENDING'`)
      .run(occurredAt, occurredAt, notificationId);
    const record = get(notificationId); if (!record) throw new Error("质量通知不存在"); return record;
  }

  function markFailed(notificationId: string, error: unknown): QualityNotificationRecord {
    const current = get(notificationId); if (!current) throw new Error("质量通知不存在");
    if (current.status !== "SENDING") return current;
    const occurred = now(); const dead = current.attemptCount >= 8;
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(current.attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)]!;
    const next = new Date(occurred.getTime() + delay).toISOString();
    db.prepare(`UPDATE quality_notification_outbox SET status=?,next_attempt_at=?,last_error=?,sending_started_at=NULL,updated_at=? WHERE notification_id=? AND status='SENDING'`)
      .run(dead ? "DEAD" : "RETRY", dead ? occurred.toISOString() : next, safeError(error), occurred.toISOString(), notificationId);
    return get(notificationId)!;
  }

  function markSecurityBlocked(notificationId: string): QualityNotificationRecord {
    const occurredAt = now().toISOString();
    db.prepare(`
      UPDATE quality_notification_outbox
      SET status='DEAD',next_attempt_at=?,last_error='测试通知已被安全阻断',
          sending_started_at=NULL,updated_at=?
      WHERE notification_id=? AND status='SENDING'
    `).run(occurredAt, occurredAt, notificationId);
    const record = get(notificationId);
    if (!record) throw new Error("质量通知不存在");
    return record;
  }

  async function processNext(sender: (notification: QualityNotificationRecord) => Promise<void>): Promise<QualityNotificationRecord | null> {
    const notification = claimNext(); if (!notification) return null;
    try { await sender(notification); return markSent(notification.notificationId); }
    catch (error) { return markFailed(notification.notificationId, error); }
  }

  function retryDead(notificationId: string, audit?: { actorUserId: string; requestId: string }): QualityNotificationRecord {
    const occurredAt = now().toISOString();
    if (audit) {
      const repeated = db.prepare("SELECT 1 FROM quality_audit_events WHERE request_id=? AND action='QUALITY_NOTIFICATION_REQUEUED'").get(audit.requestId);
      if (repeated) { const record = get(notificationId); if (!record) throw new Error("质量通知不存在"); return record; }
    }
    const before = get(notificationId); if (!before) throw new Error("质量通知不存在");
    if (readQualityEventBoundary(db, before.eventId).isTest) {
      throw new Error("测试通知不能人工重新发送");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare(`UPDATE quality_notification_outbox SET status='RETRY',next_attempt_at=?,sending_started_at=NULL,updated_at=? WHERE notification_id=? AND status='DEAD'`)
        .run(occurredAt, occurredAt, notificationId);
      if (Number(result.changes) !== 1) throw new Error("仅人工处理状态的通知可重新入队");
      if (audit) db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES(?,?,?,'quality_specialist','QUALITY_NOTIFICATION_REQUEUED',?,?,NULL,?,?)`)
        .run(id(), before.eventId, audit.actorUserId, JSON.stringify({ notificationId, status: before.status, attemptCount: before.attemptCount }), JSON.stringify({ notificationId, status: "RETRY", attemptCount: before.attemptCount }), audit.requestId, occurredAt);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const record = get(notificationId); if (!record) throw new Error("质量通知不存在"); return record;
  }

  function list(eventId?: string) {
    const rows = (eventId ? db.prepare("SELECT * FROM quality_notification_outbox WHERE event_id=? ORDER BY created_at,notification_id").all(eventId) : db.prepare("SELECT * FROM quality_notification_outbox ORDER BY created_at,notification_id").all()) as DatabaseRow[];
    return rows.map(rowToRecord);
  }

  return { enqueue, claimNext, markSent, markFailed, markSecurityBlocked, processNext, retryDead, get, list, close: () => db.close() };
}
