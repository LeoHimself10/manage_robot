#!/usr/bin/env npx tsx
/**
 * One-off manual progress digest send (ops). Skips 9:00 window and daily claim.
 *
 *   npx tsx scripts/send-progress-digest-now.ts
 */
import { listDigestRecipients } from "../src/agent/progress-digest/progress-digest-eligibility.js";
import { buildProgressDigestMarkdown } from "../src/agent/progress-digest/progress-digest-build.js";
import { loadProgressDigestPolicy } from "../src/agent/progress-digest/progress-digest-policy.js";
import { formatDateInTz } from "../src/agent/reminders/reminder-policy.js";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store.js";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store.js";
import { createWorkbenchPublishNotifier } from "../src/integrations/dingtalk/workbench-notify.js";
import { logStructured } from "../src/infra/logger.js";

async function main(): Promise<void> {
  const policy = loadProgressDigestPolicy();
  const taskStore = createWorkbenchFormalTaskStore();
  const notifier = createWorkbenchPublishNotifier();
  const peopleStore = createPeopleDirectoryStore();
  const now = new Date();
  const ymd = formatDateInTz(now.toISOString(), policy.timezone).replace(/-/g, "");

  const recipients = listDigestRecipients(taskStore);
  console.log(`Manual progress digest: ${recipients.length} recipient(s)`);

  let sent = 0;
  let failed = 0;

  try {
    for (const recipient of recipients) {
      const name = peopleStore.getContact(recipient.userId)?.name?.trim() ?? recipient.userId;
      const built = await buildProgressDigestMarkdown({
        taskStore,
        userId: recipient.userId,
        audience: recipient.audience,
        policy,
        now,
        resolveName: (uid) => peopleStore.getContact(uid)?.name?.trim(),
      });
      const sourceId = `progress:digest:manual:${recipient.userId}:${recipient.audience}:${ymd}:${Date.now()}`;
      const result = await notifier.notifyProgressDigest({
        userId: recipient.userId,
        subject: built.subject,
        markdown: built.markdown,
        detailUrl: built.detailUrl,
        sourceId,
      });
      if (result.success.length > 0) {
        sent += 1;
        console.log(`OK  ${name} (${recipient.userId}) audience=${recipient.audience} mode=${built.mode} source=${built.renderSource}`);
        logStructured({
          event: "progress_digest_sent",
          trigger: "manual",
          userId: recipient.userId,
          audience: recipient.audience,
          mode: built.mode,
          sourceId,
        });
      } else {
        failed += 1;
        const reason = result.skippedReason ?? result.failed[0]?.reason ?? "unknown";
        console.error(`FAIL ${name} (${recipient.userId}): ${reason}`);
      }
    }
  } finally {
    peopleStore.close();
  }

  console.log(`Done: sent=${sent} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
