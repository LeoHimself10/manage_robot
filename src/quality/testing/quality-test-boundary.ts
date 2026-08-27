import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getQualityTestActorByUserId, isQualityTestActorUserId } from "./quality-test-actors";

type DatabaseRow = Record<string, unknown>;

export interface QualityEventBoundary {
  eventId: string;
  isTest: boolean;
}

export function readQualityEventBoundary(db: DatabaseSync, eventId: string): QualityEventBoundary {
  const row = db.prepare(
    "SELECT id,is_test FROM quality_events WHERE id=? AND deleted_at IS NULL",
  ).get(eventId) as DatabaseRow | undefined;
  if (!row) throw new Error("质量事件不存在");
  return { eventId: String(row.id), isTest: Number(row.is_test ?? 0) === 1 };
}

export function assertQualityActorBoundary(input: {
  event: QualityEventBoundary;
  actorUserId: string;
}): void {
  const testActor = isQualityTestActorUserId(input.actorUserId);
  if (input.event.isTest && !testActor) throw new Error("测试事件只能由测试身份处理");
  if (!input.event.isTest && testActor) throw new Error("测试身份不能处理真实事件");
}

export function assertQualityNotificationBoundary(input: {
  event: QualityEventBoundary;
  recipientUserIds: string[];
}): void {
  for (const recipientUserId of input.recipientUserIds) {
    const isTestActor = isQualityTestActorUserId(recipientUserId);
    if (input.event.isTest && !isTestActor) {
      throw new Error("测试事件通知已被安全阻断");
    }
    if (!input.event.isTest && isTestActor) {
      throw new Error("真实事件不能通知测试身份");
    }
  }
}

export function testQualitySpecialistUserIds(): string[] {
  return ["QUALITY_TEST_SPECIALIST_001"];
}

export function appendQualityTestActionAudit(db: DatabaseSync, input: {
  eventId: string;
  testActorUserId: string;
  actualAdminUserId: string;
  action: string;
  requestId: string;
  occurredAt: string;
}): void {
  if (!getQualityTestActorByUserId(input.testActorUserId)) {
    throw new Error("测试身份无效");
  }
  db.prepare(`
    INSERT INTO quality_test_action_audit(
      id,event_id,test_actor_user_id,actual_admin_user_id,action,request_id,occurred_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(event_id,request_id) DO NOTHING
  `).run(
    randomUUID(),
    input.eventId,
    input.testActorUserId,
    input.actualAdminUserId,
    input.action,
    input.requestId,
    input.occurredAt,
  );
}
