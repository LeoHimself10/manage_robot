import { logStructured } from "../../infra/logger";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import {
  listManagerOverdueAlerts,
  listPreDueEmployeeReminders,
} from "./reminder-eligibility";
import { loadReminderPolicy } from "./reminder-policy";
import { sendManagerOverdueAlert, sendPreDueEmployeeReminder } from "./reminder-send";

export function createReminderScheduler(deps?: {
  taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
  notifier?: ReturnType<typeof createWorkbenchPublishNotifier>;
}) {
  const policy = loadReminderPolicy();
  const taskStore = deps?.taskStore ?? createWorkbenchFormalTaskStore();
  const notifier = deps?.notifier ?? createWorkbenchPublishNotifier();
  let timer: NodeJS.Timeout | undefined;
  let scanning = false;

  async function runScan(): Promise<void> {
    if (scanning) return;
    scanning = true;
    const startedAt = Date.now();
    let preDueSent = 0;
    let preDueSkipped = 0;
    let preDueFailed = 0;
    let managerOverdueSent = 0;
    let managerOverdueSkipped = 0;
    let managerOverdueFailed = 0;
    try {
      const now = new Date();
      const preDueEligible = listPreDueEmployeeReminders(taskStore, now, policy);
      const peopleStore = createPeopleDirectoryStore();
      try {
        for (const item of preDueEligible) {
          const result = await sendPreDueEmployeeReminder(item.subtaskId, {
            taskStore,
            notifier,
            peopleStore,
            policy,
          });
          if (result.ok) preDueSent += 1;
          else if (result.skipped) preDueSkipped += 1;
          else preDueFailed += 1;
        }

        const managerEligible = listManagerOverdueAlerts(
          taskStore,
          now,
          policy,
          (uid) => peopleStore.getContact(uid)?.name?.trim(),
        );
        for (const item of managerEligible) {
          const result = await sendManagerOverdueAlert(
            {
              subtaskId: item.subtaskId,
              overdueSince: item.overdueSince,
              assigneeDisplayName: item.assigneeDisplayName,
            },
            { taskStore, notifier, peopleStore, policy },
          );
          if (result.ok) managerOverdueSent += 1;
          else if (result.skipped) managerOverdueSkipped += 1;
          else managerOverdueFailed += 1;
        }

        logStructured({
          event: "reminder_scan_done",
          preDueEligible: preDueEligible.length,
          preDueSent,
          preDueSkipped,
          preDueFailed,
          managerOverdueEligible: managerEligible.length,
          managerOverdueSent,
          managerOverdueSkipped,
          managerOverdueFailed,
          durationMs: Date.now() - startedAt,
        });
      } finally {
        peopleStore.close();
      }
    } catch (err) {
      logStructured({
        event: "reminder_scan_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scanning = false;
    }
  }

  return {
    runScan,
    startIntervalLoop() {
      if (!policy.enabled) return;
      if (timer) return;
      void runScan().catch(() => undefined);
      timer = setInterval(() => {
        void runScan().catch(() => undefined);
      }, policy.scanIntervalMs);
    },
    stopIntervalLoop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
