import { logStructured } from "../../infra/logger";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { listSchedulerEligibleReminders } from "./reminder-eligibility";
import { loadReminderPolicy } from "./reminder-policy";
import { sendSubtaskReminder } from "./reminder-send";

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
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const eligible = listSchedulerEligibleReminders(taskStore);
      const peopleStore = createPeopleDirectoryStore();
      try {
        for (const item of eligible) {
          const result = await sendSubtaskReminder(
            {
              subtaskId: item.subtaskId,
              trigger: "scheduler",
              actorUserId: item.managerUserId,
              requestedTier: item.tier,
            },
            { taskStore, notifier, peopleStore, policy },
          );
          if (result.ok) sent += 1;
          else if (result.skipped) skipped += 1;
          else failed += 1;
        }
      } finally {
        peopleStore.close();
      }
      logStructured({
        event: "reminder_scan_done",
        eligible: eligible.length,
        sent,
        skipped,
        failed,
        durationMs: Date.now() - startedAt,
      });
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
