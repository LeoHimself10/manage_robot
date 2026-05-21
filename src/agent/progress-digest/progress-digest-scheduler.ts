import { logStructured } from "../../infra/logger";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { listEligibleDigestRecipients } from "./progress-digest-eligibility";
import { loadProgressDigestPolicy } from "./progress-digest-policy";
import { sendProgressDigest } from "./progress-digest-send";

export function createProgressDigestScheduler(deps?: {
  taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
  notifier?: ReturnType<typeof createWorkbenchPublishNotifier>;
}) {
  const policy = loadProgressDigestPolicy();
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
      const eligible = listEligibleDigestRecipients(taskStore);
      const peopleStore = createPeopleDirectoryStore();
      try {
        for (const recipient of eligible) {
          const result = await sendProgressDigest(recipient, {
            taskStore,
            notifier,
            peopleStore,
            policy,
          });
          if (result.ok) sent += 1;
          else if (result.skipped) skipped += 1;
          else failed += 1;
        }
      } finally {
        peopleStore.close();
      }
      logStructured({
        event: "progress_digest_scan_done",
        eligible: eligible.length,
        sent,
        skipped,
        failed,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      logStructured({
        event: "progress_digest_scan_failed",
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
