import type { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { isDigestSendWindow, loadProgressDigestPolicy, type ProgressDigestPolicy } from "./progress-digest-policy";

export type DigestAudience = "manager" | "employee" | "combined";

export interface DigestRecipient {
  userId: string;
  audience: DigestAudience;
}

type TaskStore = ReturnType<typeof createWorkbenchFormalTaskStore>;

export function listDigestRecipients(taskStore: TaskStore): DigestRecipient[] {
  const managers = new Set(taskStore.listProgressDigestManagerUserIds());
  const employees = new Set(taskStore.listProgressDigestEmployeeUserIds());
  const all = new Set([...managers, ...employees]);
  const out: DigestRecipient[] = [];
  for (const userId of all) {
    const isManager = managers.has(userId);
    const isEmployee = employees.has(userId);
    let audience: DigestAudience = "employee";
    if (isManager && isEmployee) audience = "combined";
    else if (isManager) audience = "manager";
    out.push({ userId, audience });
  }
  return out;
}

export function isProgressDigestScanDue(
  now: Date = new Date(),
  policy: ProgressDigestPolicy = loadProgressDigestPolicy(),
): boolean {
  if (!policy.enabled) return false;
  return isDigestSendWindow(now, policy);
}

export function listEligibleDigestRecipients(
  taskStore: TaskStore,
  now: Date = new Date(),
  policy: ProgressDigestPolicy = loadProgressDigestPolicy(),
): DigestRecipient[] {
  if (!isProgressDigestScanDue(now, policy)) return [];
  return listDigestRecipients(taskStore);
}
