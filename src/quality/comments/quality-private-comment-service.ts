import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { logStructured } from "../../infra/logger";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { isQualitySpecialistForReport, resolveQualityCapabilities } from "../../security/quality-capabilities";
import { createQualityStore } from "../infra/quality-store";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";

type DatabaseRow = Record<string, unknown>;
const PRIVATE_FORBIDDEN = "无权访问私密质量评论";

function mask(userId: string): string {
  if (userId.length <= 2) return "**";
  return `${userId.slice(0, 1)}***${userId.slice(-1)}`;
}

export function createQualityPrivateCommentService(deps?: { dbPath?: string; now?: () => string; id?: () => string }) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON"); db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function getEvent(eventId: string): DatabaseRow {
    const event = db.prepare("SELECT id,event_no,title,problem_status,status,updated_at FROM quality_events WHERE id=? AND deleted_at IS NULL").get(eventId) as DatabaseRow | undefined;
    if (!event || String(event.status) === "DRAFT") throw new Error(PRIVATE_FORBIDDEN);
    return event;
  }

  function getThread(threadId: string): DatabaseRow {
    const thread = db.prepare(`
      SELECT t.*,e.event_no,e.title,e.problem_status,e.status AS event_status,e.updated_at AS event_updated_at
      FROM quality_private_threads t JOIN quality_events e ON e.id=t.event_id AND e.deleted_at IS NULL
      WHERE t.thread_id=?
    `).get(threadId) as DatabaseRow | undefined;
    if (!thread || String(thread.event_status) === "DRAFT") throw new Error(PRIVATE_FORBIDDEN);
    return thread;
  }

  function assertRelationship(specialistUserId: string, reportUserId: string): void {
    if (!resolveQualityCapabilities(specialistUserId).roles.includes("quality_specialist")
      || !isQualitySpecialistForReport(specialistUserId, reportUserId)) throw new Error(PRIVATE_FORBIDDEN);
  }

  function assertViewer(thread: DatabaseRow, viewerUserId: string): void {
    const specialistUserId = String(thread.specialist_user_id);
    const reportUserId = String(thread.report_user_id);
    assertRelationship(specialistUserId, reportUserId);
    if (viewerUserId !== specialistUserId && viewerUserId !== reportUserId) throw new Error(PRIVATE_FORBIDDEN);
  }

  function threadView(row: DatabaseRow) {
    return {
      threadId: String(row.thread_id), eventId: String(row.event_id), specialistUserId: String(row.specialist_user_id), reportUserId: String(row.report_user_id),
      eventNo: String(row.event_no), eventTitle: String(row.title), eventSummary: String(row.problem_status), eventStatus: String(row.event_status),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), readOnly: String(row.event_status) === "CLOSED",
    };
  }

  function listAvailableEvents(input: { reportUserId: string; specialistUserId: string }) {
    assertRelationship(input.specialistUserId, input.reportUserId);
    return (db.prepare(`
      SELECT id,event_no,title,problem_status,status,updated_at FROM quality_events
      WHERE deleted_at IS NULL AND status NOT IN ('DRAFT','CLOSED') ORDER BY updated_at DESC,id
    `).all() as DatabaseRow[]).map((event) => ({
      eventId: String(event.id), eventNo: String(event.event_no), title: String(event.title), currentSituation: String(event.problem_status), status: String(event.status), updatedAt: String(event.updated_at),
    }));
  }

  function createThread(input: { eventId: string; specialistUserId: string; reportUserId: string }) {
    assertRelationship(input.specialistUserId, input.reportUserId);
    const event = getEvent(input.eventId);
    if (String(event.status) === "CLOSED") throw new Error("已关闭质量事件只能查看历史评论");
    const existing = db.prepare(`
      SELECT t.*,e.event_no,e.title,e.problem_status,e.status AS event_status
      FROM quality_private_threads t JOIN quality_events e ON e.id=t.event_id WHERE t.event_id=? AND t.specialist_user_id=? AND t.report_user_id=?
    `).get(input.eventId, input.specialistUserId, input.reportUserId) as DatabaseRow | undefined;
    if (existing) return threadView(existing);
    const threadId = id(); const occurredAt = now();
    db.prepare("INSERT INTO quality_private_threads(thread_id,event_id,specialist_user_id,report_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(threadId, input.eventId, input.specialistUserId, input.reportUserId, occurredAt, occurredAt);
    return threadView({ thread_id: threadId, event_id: input.eventId, specialist_user_id: input.specialistUserId, report_user_id: input.reportUserId, event_no: event.event_no, title: event.title, problem_status: event.problem_status, event_status: event.status, created_at: occurredAt, updated_at: occurredAt });
  }

  function listThreads(viewerUserId: string) {
    const rows = db.prepare(`
      SELECT t.*,e.event_no,e.title,e.problem_status,e.status AS event_status,e.updated_at AS event_updated_at
      FROM quality_private_threads t JOIN quality_events e ON e.id=t.event_id AND e.deleted_at IS NULL
      WHERE t.specialist_user_id=? OR t.report_user_id=? ORDER BY t.updated_at DESC,t.thread_id
    `).all(viewerUserId, viewerUserId) as DatabaseRow[];
    return rows.filter((thread) => {
      try { assertViewer(thread, viewerUserId); return true; } catch { return false; }
    }).map(threadView);
  }

  function listMessages(input: { threadId: string; viewerUserId: string }) {
    const thread = getThread(input.threadId); assertViewer(thread, input.viewerUserId);
    return (db.prepare("SELECT message_id,sender_user_id,body,created_at FROM quality_private_messages WHERE thread_id=? ORDER BY created_at,rowid").all(input.threadId) as DatabaseRow[])
      .map((message) => ({ messageId: String(message.message_id), threadId: input.threadId, senderUserId: String(message.sender_user_id), body: String(message.body), createdAt: String(message.created_at) }));
  }

  function sendMessage(input: { threadId: string; senderUserId: string; body: string; requestId: string }) {
    const thread = getThread(input.threadId); assertViewer(thread, input.senderUserId);
    if (String(thread.event_status) === "CLOSED") throw new Error("已关闭质量事件只能查看历史评论");
    const body = z.string().trim().min(1).max(5000).parse(input.body);
    const requestId = z.string().uuid().parse(input.requestId);
    const repeated = db.prepare("SELECT message_id,sender_user_id,body,created_at FROM quality_private_messages WHERE thread_id=? AND request_id=?").get(input.threadId, requestId) as DatabaseRow | undefined;
    if (repeated) return { messageId: String(repeated.message_id), threadId: input.threadId, senderUserId: String(repeated.sender_user_id), body: String(repeated.body), createdAt: String(repeated.created_at) };
    const messageId = id(); const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO quality_private_messages(message_id,thread_id,sender_user_id,body,request_id,created_at) VALUES(?,?,?,?,?,?)")
        .run(messageId, input.threadId, input.senderUserId, body, requestId, occurredAt);
      db.prepare("UPDATE quality_private_threads SET updated_at=? WHERE thread_id=?").run(occurredAt, input.threadId);
      enqueueQualityActionNotifications(db, {
        eventId: String(thread.event_id), eventNo: String(thread.event_no), action: "PRIVATE_COMMENT", actionId: requestId,
        context: { specialistUserId: String(thread.specialist_user_id), reportUserId: String(thread.report_user_id), senderUserId: input.senderUserId },
        subject: "收到一条私密质量意见", summary: `${String(thread.title)}；请进入质量意见页面查看，不在通知中展示正文`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    logStructured({ event: "quality_private_comment_sent", messageId, threadId: input.threadId, sender: mask(input.senderUserId), specialist: mask(String(thread.specialist_user_id)), report: mask(String(thread.report_user_id)), bodyLength: body.length });
    return { messageId, threadId: input.threadId, senderUserId: input.senderUserId, body, createdAt: occurredAt };
  }

  return { listAvailableEvents, createThread, listThreads, listMessages, sendMessage, close: () => db.close() };
}
