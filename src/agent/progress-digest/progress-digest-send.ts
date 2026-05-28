import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { logStructured } from "../../infra/logger";
import { formatDateInTz, startOfDayInTz } from "../reminders/reminder-policy";
import { buildProgressDigestMarkdown } from "./progress-digest-build";
import type { DigestAudience, DigestRecipient } from "./progress-digest-eligibility";
import { loadProgressDigestPolicy, type ProgressDigestPolicy } from "./progress-digest-policy";

export interface ProgressDigestSendResult {
  ok: boolean;
  skipped?: string;
  mode?: "full" | "brief" | "delivery";
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;
type PeopleStore = ReturnType<typeof createPeopleDirectoryStore>;

function buildSourceId(userId: string, audience: DigestAudience, now: Date, timezone: string): string {
  const ymd = formatDateInTz(now.toISOString(), timezone).replace(/-/g, "");
  return `progress:digest:${userId}:${audience}:${ymd}`;
}

export async function sendProgressDigest(
  recipient: DigestRecipient,
  deps: {
    taskStore: TaskStore;
    notifier: WorkbenchPublishNotifier;
    peopleStore: PeopleStore;
    policy?: ProgressDigestPolicy;
    now?: Date;
  },
): Promise<ProgressDigestSendResult> {
  const policy = deps.policy ?? loadProgressDigestPolicy();
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const sourceId = buildSourceId(recipient.userId, recipient.audience, now, policy.timezone);

  const claim = deps.taskStore.tryClaimProgressDigest({
    userId: recipient.userId,
    audience: recipient.audience,
    nowIso,
    todayStartIso: startOfDayInTz(now, policy.timezone),
    sourceId,
  });
  if (!claim.claimed) {
    return { ok: false, skipped: claim.reason ?? "claim_failed" };
  }

  const built = await buildProgressDigestMarkdown({
    taskStore: deps.taskStore,
    userId: recipient.userId,
    audience: recipient.audience,
    policy,
    now,
    resolveName: (uid) => deps.peopleStore.getContact(uid)?.name?.trim(),
  });

  const notifyResult = await deps.notifier.notifyProgressDigest({
    userId: recipient.userId,
    subject: built.subject,
    markdown: built.markdown,
    detailUrl: built.detailUrl,
    sourceId,
  });

  if (notifyResult.success.length > 0) {
    logStructured({
      event: "progress_digest_sent",
      userId: recipient.userId,
      audience: recipient.audience,
      mode: built.mode,
      sourceId,
    });
    return { ok: true, mode: built.mode };
  }

  logStructured({
    event: "progress_digest_notify_failed",
    userId: recipient.userId,
    audience: recipient.audience,
    reason: notifyResult.skippedReason ?? notifyResult.failed[0]?.reason,
    sourceId,
  });
  return {
    ok: false,
    skipped: notifyResult.skippedReason ?? notifyResult.failed[0]?.reason ?? "notify_failed",
  };
}
