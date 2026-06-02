import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchActivityStore } from "../../src/infra/workbench-activity-store";
import { zonedMidnightUtcIso } from "../../src/agent/reminders/reminder-policy";

describe("workbench activity store", () => {
  let dbPath = "";

  beforeEach(() => {
    dbPath = join(tmpdir(), `wb-act-${Date.now()}.sqlite`);
    mkdirSync(join(dbPath, ".."), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(dbPath, { force: true });
    } catch {
      // ignore
    }
  });

  it("rolls admin surface into manager audience", () => {
    const store = createWorkbenchActivityStore(dbPath);
    const tz = "Asia/Shanghai";
    const day = "2026-06-03";
    const from = zonedMidnightUtcIso(day, tz);
    const to = zonedMidnightUtcIso("2026-06-04", tz);
    const at = new Date(Date.parse(from) + 3600_000).toISOString();

    store.recordEvent({
      userId: "u-admin",
      surface: "admin",
      path: "/workbench/admin/ops",
      occurredAt: at,
    });
    store.recordEvent({
      userId: "u-emp",
      surface: "employee",
      path: "/workbench/employee",
      occurredAt: at,
    });

    expect(store.countDistinctUsersForAudience(from, to, "manager")).toBe(1);
    expect(store.countDistinctUsersForAudience(from, to, "employee")).toBe(1);
    expect(store.countDistinctUsers(from, to)).toBe(2);
  });
});
