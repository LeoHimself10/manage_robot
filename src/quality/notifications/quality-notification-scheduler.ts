import { DatabaseSync } from "node:sqlite";
import { logStructured } from "../../infra/logger";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchPublishNotifier, type WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { listQualitySpecialistUserIds } from "../../security/quality-capabilities";
import { createQualityStore } from "../infra/quality-store";
import { createQualityNotificationOutbox } from "./quality-notification-outbox";
import { enqueueQualityActionNotifications, recipientsFor } from "./quality-notification-policy";
import {
  assertQualityNotificationBoundary,
  readQualityEventBoundary,
} from "../testing/quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

export function createQualityNotificationScheduler(deps?: {
  dbPath?: string;
  now?: () => Date;
  notifier?: WorkbenchPublishNotifier;
  intervalMs?: number;
  batchSize?: number;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath(); createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath); db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date()); const notifier = deps?.notifier ?? createWorkbenchPublishNotifier();
  const intervalMs = deps?.intervalMs ?? 30_000; const batchSize = deps?.batchSize ?? 50;
  const outbox = createQualityNotificationOutbox({ dbPath, now }); let timer: NodeJS.Timeout | undefined; let running = false;

  function enqueueOverdue(): number {
    const instant = now(); const nowIso = instant.toISOString(); const cycle = nowIso.slice(0, 10);
    const rows = db.prepare(`
      SELECT n.node_id,n.assignee_user_id,n.due_at,e.id AS event_id,e.event_no,e.title,
             primary_node.assignee_user_id AS primary_user_id,parent.assignee_user_id AS parent_user_id
      FROM quality_assignment_nodes n JOIN quality_events e ON e.id=n.event_id AND e.deleted_at IS NULL
      LEFT JOIN quality_assignment_nodes primary_node ON primary_node.node_id=e.primary_node_id
      LEFT JOIN quality_assignment_nodes parent ON parent.node_id=n.parent_node_id
      WHERE n.due_at<? AND n.status IN ('PENDING_ACCEPTANCE','IN_PROGRESS','RETURNED','PENDING_PARENT_REVIEW')
        AND e.status <> 'CLOSED' AND e.is_test=0
      ORDER BY n.due_at,n.node_id
    `).all(nowIso) as DatabaseRow[];
    let queued = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const excluded = new Set([String(row.assignee_user_id), String(row.parent_user_id ?? "")]);
        const supplemental = recipientsFor("QUALITY_OVERDUE", { primaryManagerUserId: row.primary_user_id == null ? null : String(row.primary_user_id), qualitySpecialistUserIds: listQualitySpecialistUserIds() })
          .filter((recipient) => !excluded.has(recipient));
        if (!supplemental.length) continue;
        enqueueQualityActionNotifications(db, {
          eventId: String(row.event_id), eventNo: String(row.event_no), action: "QUALITY_OVERDUE", actionId: String(row.node_id),
          context: { primaryManagerUserId: supplemental.find((item) => item === String(row.primary_user_id ?? "")), qualitySpecialistUserIds: supplemental.filter((item) => item !== String(row.primary_user_id ?? "")) },
          subject: "质量任务已逾期", summary: `${String(row.title)}；节点期限 ${String(row.due_at)}，请关注处理进展`, occurredAt: nowIso, reminderCycle: cycle,
        });
        queued += supplemental.length;
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return queued;
  }

  async function sendPending(): Promise<{ processed: number; sent: number; failed: number }> {
    let processed = 0; let sent = 0; let failed = 0;
    for (; processed < batchSize; processed += 1) {
      const notification = outbox.claimNext();
      if (!notification) break;
      const boundary = readQualityEventBoundary(db, notification.eventId);
      try {
        assertQualityNotificationBoundary({
          event: boundary,
          recipientUserIds: [notification.recipientUserId],
        });
        if (boundary.isTest) {
          if (notification.channel !== "TEST") throw new Error("测试通知通道配置错误");
          outbox.markSent(notification.notificationId);
          sent += 1;
          continue;
        }
        if (notification.channel === "TEST") throw new Error("真实通知通道配置错误");
        const notify = notifier.notifyQualityAction;
        if (!notify) throw new Error("质量通知通道未配置");
        const outcome = await notify.call(notifier, { recipientUserId: notification.recipientUserId, subject: notification.subject, markdown: notification.markdown, detailUrl: notification.detailUrl });
        if (outcome.skippedExternal?.some((item) => item.userId === notification.recipientUserId)) {
          outbox.markSent(notification.notificationId);
          sent += 1;
          continue;
        }
        if (!outcome.enabled || !outcome.success.some((item) => item.userId === notification.recipientUserId)) {
          throw new Error(outcome.failed.map((item) => item.reason).join("；") || outcome.skippedReason || "质量通知未成功发送");
        }
        outbox.markSent(notification.notificationId);
        sent += 1;
      } catch (error) {
        if (boundary.isTest || notification.channel === "TEST") {
          outbox.markSecurityBlocked(notification.notificationId);
        } else {
          outbox.markFailed(notification.notificationId, error);
        }
        failed += 1;
      }
    }
    return { processed, sent, failed };
  }

  async function runScan() {
    if (running) return { skipped: true, overdueQueued: 0, processed: 0, sent: 0, failed: 0 };
    running = true;
    try {
      const overdueQueued = enqueueOverdue(); const result = await sendPending();
      logStructured({ event: "quality_notification_scan_done", overdueQueued, ...result });
      return { skipped: false, overdueQueued, ...result };
    } finally { running = false; }
  }

  return {
    runScan, enqueueOverdue, sendPending,
    startIntervalLoop() { if (timer || process.env.NODE_ENV === "test") return; void runScan().catch(() => undefined); timer = setInterval(() => { void runScan().catch(() => undefined); }, intervalMs); },
    stopIntervalLoop() { if (timer) clearInterval(timer); timer = undefined; },
    close() { if (timer) clearInterval(timer); timer = undefined; outbox.close(); db.close(); },
  };
}
