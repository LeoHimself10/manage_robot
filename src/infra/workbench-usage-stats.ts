import {
  getWorkbenchActivityStore,
  type WorkbenchActivitySurface,
  type WorkbenchAudience,
} from "./workbench-activity-store";
import { resolveWorkbenchUserDisplayNames } from "./workbench-user-labels";
import type { createWorkbenchFormalTaskStore } from "./workbench-formal-task-store";

export interface WorkbenchUsageCounts {
  dau: number;
  wau: number;
  manager: { dau: number; wau: number };
  employee: { dau: number; wau: number };
}

export interface WorkbenchActiveUserRow {
  userId: string;
  displayName: string;
  eventCount: number;
  surfaces: string[];
  surfaceLabel: string;
}

function surfaceLabel(surface: WorkbenchActivitySurface | string): string {
  if (surface === "manager") return "主管端";
  if (surface === "employee") return "员工端";
  if (surface === "admin") return "Admin";
  return String(surface);
}

function joinSurfaceLabels(surfaces: string[]): string {
  const labels = [...new Set(surfaces.map((s) => surfaceLabel(s)))];
  return labels.join(" / ") || "—";
}

function enrichActiveUserRows(
  rows: Array<{ userId: string; eventCount: number; surfaces: string[] }>,
): WorkbenchActiveUserRow[] {
  const names = resolveWorkbenchUserDisplayNames(rows.map((r) => r.userId));
  return rows.map((row) => ({
    userId: row.userId,
    displayName: names.get(row.userId) ?? row.userId,
    eventCount: row.eventCount,
    surfaces: row.surfaces,
    surfaceLabel: joinSurfaceLabels(row.surfaces),
  }));
}

export function queryWorkbenchUsageCounts(input: {
  dayFromIso: string;
  dayToIso: string;
  weekFromIso: string;
  weekToIso: string;
}): WorkbenchUsageCounts {
  const store = getWorkbenchActivityStore();
  const managerDau = store.countDistinctUsersForAudience(
    input.dayFromIso,
    input.dayToIso,
    "manager",
  );
  const employeeDau = store.countDistinctUsersForAudience(
    input.dayFromIso,
    input.dayToIso,
    "employee",
  );
  const managerWau = store.countDistinctUsersForAudience(
    input.weekFromIso,
    input.weekToIso,
    "manager",
  );
  const employeeWau = store.countDistinctUsersForAudience(
    input.weekFromIso,
    input.weekToIso,
    "employee",
  );
  return {
    dau: store.countDistinctUsers(input.dayFromIso, input.dayToIso),
    wau: store.countDistinctUsers(input.weekFromIso, input.weekToIso),
    manager: { dau: managerDau, wau: managerWau },
    employee: { dau: employeeDau, wau: employeeWau },
  };
}

export function queryWorkbenchActiveUsers(input: {
  fromIso: string;
  toIso: string;
  audience?: WorkbenchAudience;
  limit?: number;
}): WorkbenchActiveUserRow[] {
  const store = getWorkbenchActivityStore();
  return enrichActiveUserRows(
    store.listActiveUsers({
      fromIso: input.fromIso,
      toIso: input.toIso,
      audience: input.audience,
      limit: input.limit,
    }),
  );
}

export function collectManagerTeamUserIds(
  taskStore: ReturnType<typeof createWorkbenchFormalTaskStore>,
  managerUserId: string,
): string[] {
  const ids = new Set<string>();
  const manager = String(managerUserId ?? "").trim();
  if (manager) ids.add(manager);
  for (const task of taskStore.listManagerTasks(manager)) {
    const key = String(task.taskNo ?? task.taskId ?? "").trim();
    if (!key) continue;
    const detail = taskStore.getTaskDetail(key);
    if (!detail) continue;
    for (const sub of detail.subtasks) {
      const assignee = String(sub.assigneeUserId ?? "").trim();
      if (assignee) ids.add(assignee);
    }
  }
  return [...ids];
}

export function queryManagerTeamWorkbenchActiveUsers(input: {
  taskStore: ReturnType<typeof createWorkbenchFormalTaskStore>;
  managerUserId: string;
  fromIso: string;
  toIso: string;
  limit?: number;
}): WorkbenchActiveUserRow[] {
  const teamIds = collectManagerTeamUserIds(input.taskStore, input.managerUserId);
  if (teamIds.length === 0) return [];
  const store = getWorkbenchActivityStore();
  return enrichActiveUserRows(
    store.listActiveUsers({
      fromIso: input.fromIso,
      toIso: input.toIso,
      userIds: teamIds,
      limit: input.limit,
    }),
  );
}
