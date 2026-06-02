import { getWorkbenchActivityStore, type WorkbenchAudience } from "./workbench-activity-store";

export interface WorkbenchUsageCounts {
  dau: number;
  wau: number;
  manager: { dau: number; wau: number };
  employee: { dau: number; wau: number };
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
