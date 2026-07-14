import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { enqueueQualityNotification } from "./quality-notification-outbox";

export type QualityNotificationAction =
  | "EVENT_SUBMITTED" | "PRIMARY_ASSIGNED" | "NODE_DELEGATED" | "NODE_REJECTED"
  | "NODE_EVIDENCE_SUBMITTED" | "NODE_RETURNED" | "PRIMARY_APPROVED"
  | "QUALITY_CLOSED" | "QUALITY_RETURNED" | "PRIVATE_COMMENT" | "QUALITY_OVERDUE";

export interface QualityNotificationContext {
  qualitySpecialistUserIds?: string[];
  aftersalesManagerUserId?: string | null;
  primaryManagerUserId?: string | null;
  directParentUserId?: string | null;
  directAssigneeUserId?: string | null;
  returnedAssigneeUserId?: string | null;
  specialistUserId?: string | null;
  reportUserId?: string | null;
  senderUserId?: string | null;
}

function unique(items: Array<string | null | undefined>): string[] { return [...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean))]; }

export function recipientsFor(action: QualityNotificationAction, context: QualityNotificationContext): string[] {
  switch (action) {
    case "EVENT_SUBMITTED": return unique(context.qualitySpecialistUserIds ?? []);
    case "PRIMARY_ASSIGNED": return unique([context.primaryManagerUserId]);
    case "NODE_DELEGATED": return unique([context.directAssigneeUserId]);
    case "NODE_REJECTED": return unique([context.directParentUserId, context.primaryManagerUserId, ...(context.qualitySpecialistUserIds ?? [])]);
    case "NODE_EVIDENCE_SUBMITTED": return unique([context.directParentUserId]);
    case "NODE_RETURNED": return unique([context.returnedAssigneeUserId]);
    case "PRIMARY_APPROVED": return unique(context.qualitySpecialistUserIds ?? []);
    case "QUALITY_CLOSED": return unique([context.aftersalesManagerUserId, context.primaryManagerUserId]);
    case "QUALITY_RETURNED": return unique([context.aftersalesManagerUserId, context.primaryManagerUserId, context.returnedAssigneeUserId]);
    case "PRIVATE_COMMENT": return unique([context.senderUserId === context.reportUserId ? context.specialistUserId : context.reportUserId]);
    case "QUALITY_OVERDUE": return unique([context.primaryManagerUserId, ...(context.qualitySpecialistUserIds ?? [])]);
  }
}

function detailUrl(eventId: string): string {
  const base = String(process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ?? process.env.WORKBENCH_NOTIFY_DETAIL_URL_BASE ?? "https://www.dingtalk.com").trim().replace(/\/+$/, "");
  if (base === "https://www.dingtalk.com") return base;
  const url = new URL(`${base}/workbench/quality`); url.searchParams.set("eventId", eventId); return url.toString();
}

export function enqueueQualityActionNotifications(db: DatabaseSync, input: {
  eventId: string;
  eventNo: string;
  action: QualityNotificationAction;
  actionId: string;
  context: QualityNotificationContext;
  subject: string;
  summary: string;
  occurredAt: string;
  reminderCycle?: string;
}): string[] {
  const recipients = recipientsFor(input.action, input.context);
  for (const recipientUserId of recipients) {
    const dedupeKey = createHash("sha256").update([input.eventId, input.actionId, recipientUserId, input.reminderCycle ?? ""].join("|")).digest("hex");
    enqueueQualityNotification(db, {
      eventId: input.eventId, action: input.action, recipientUserId,
      subject: input.subject,
      markdown: `### ${input.subject}\n- **质量事件**：${input.eventNo}\n- **说明**：${input.summary.slice(0, 1000)}`,
      detailUrl: detailUrl(input.eventId), dedupeKey,
    }, input.occurredAt);
  }
  return recipients;
}
