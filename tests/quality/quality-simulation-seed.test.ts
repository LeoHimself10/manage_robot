import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import {
  removeQualitySimulation,
  seedQualitySimulation,
} from "../../scripts/seed-quality-simulation";

describe("quality simulation seed", () => {
  let root = "";
  let dbPath = "";
  const envKeys = [
    "WORKBENCH_SQLITE_PATH",
    "PLAN_SESSION_DIR",
    "PLAN_SESSION_EVENTS_PATH",
    "WORKBENCH_MANAGER_USER_IDS",
    "WORKBENCH_DYNAMIC_MANAGER_IDS_FILE",
    "WORKBENCH_PROJECT_PORTFOLIO_USER_IDS",
    "QUALITY_AFTERSALES_MANAGER_USER_IDS",
    "QUALITY_MANAGEMENT_USER_IDS",
    "QUALITY_SPECIALIST_USER_IDS",
    "QUALITY_NOTIFICATION_WORKER_ENABLED",
    "WORKBENCH_DINGTALK_NOTIFY_ENABLED",
  ] as const;
  let originalEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "quality-simulation-seed-"));
    dbPath = join(root, "workbench.sqlite");
    const sessionDir = join(root, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      WORKBENCH_SQLITE_PATH: dbPath,
      PLAN_SESSION_DIR: sessionDir,
      PLAN_SESSION_EVENTS_PATH: join(root, "session-events.jsonl"),
      WORKBENCH_MANAGER_USER_IDS: "manager-a,manager-b",
      WORKBENCH_DYNAMIC_MANAGER_IDS_FILE: join(root, "dynamic-managers.json"),
      WORKBENCH_PROJECT_PORTFOLIO_USER_IDS: "manager-b",
      QUALITY_AFTERSALES_MANAGER_USER_IDS: "manager-a",
      QUALITY_MANAGEMENT_USER_IDS: "quality-employee-a",
      QUALITY_SPECIALIST_USER_IDS: "quality-employee-a",
      QUALITY_NOTIFICATION_WORKER_ENABLED: "0",
      WORKBENCH_DINGTALK_NOTIFY_ENABLED: "0",
    });
    createQualityStore(dbPath).close();
    const people = createPeopleDirectoryStore(dbPath);
    const save = (userId: string, name: string, departmentId: string, departmentName: string) =>
      people.upsertContact({
        userId,
        name,
        departmentIds: [departmentId],
        departmentNames: [departmentName],
        position: userId.startsWith("manager") ? "主管" : "质量员工",
        active: true,
        isAdmin: false,
        isBoss: false,
        isSenior: false,
      });
    save("manager-a", "甲主管", "dept-a", "研发中心");
    save("manager-b", "乙主管", "dept-b", "质量部");
    save("quality-employee-a", "质量员工甲", "dept-quality", "质量管理组");
    people.close();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("creates 20 varied, idempotent records without notifications or formal task links", () => {
    expect(seedQualitySimulation({ dbPath })).toMatchObject({ requested: 20, inserted: 20, skipped: 0 });
    const db = new DatabaseSync(dbPath);
    const total = db.prepare("SELECT COUNT(*) AS count FROM quality_events WHERE id LIKE 'quality-simulation-20260825-%' AND deleted_at IS NULL")
      .get() as { count: number };
    expect(total.count).toBe(20);
    const statuses = db.prepare(`SELECT status,COUNT(*) AS count FROM quality_events
      WHERE id LIKE 'quality-simulation-20260825-%' GROUP BY status ORDER BY status`).all() as
      Array<{ status: string; count: number }>;
    expect(Object.fromEntries(statuses.map((item) => [item.status, item.count]))).toEqual({
      CLOSED: 2,
      IN_PROGRESS: 3,
      PENDING_ACCEPTANCE: 3,
      PENDING_ANALYSIS: 4,
      PENDING_ASSIGNMENT: 5,
      PENDING_PRIMARY_REVIEW: 2,
      PENDING_QUALITY_REVIEW: 1,
    });
    expect((db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_handoffs WHERE event_id LIKE 'quality-simulation-20260825-%'").get() as { count: number }).count).toBe(5);
    expect((db.prepare("SELECT COUNT(*) AS count FROM quality_notification_outbox WHERE event_id LIKE 'quality-simulation-20260825-%'").get() as { count: number }).count).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links WHERE node_id LIKE 'sim-node-%'").get() as { count: number }).count).toBe(0);
    const minimumNodeDueAt = (db.prepare("SELECT MIN(due_at) AS dueAt FROM quality_assignment_nodes WHERE event_id LIKE 'quality-simulation-20260825-%'")
      .get() as { dueAt: string }).dueAt;
    expect(Date.parse(minimumNodeDueAt)).toBeGreaterThan(Date.now());
    db.close();

    expect(seedQualitySimulation({ dbPath })).toMatchObject({ requested: 20, inserted: 0, skipped: 20 });
    expect(removeQualitySimulation(dbPath)).toMatchObject({ softDeleted: 20, planningThreadsRemoved: 5 });
    const removed = new DatabaseSync(dbPath);
    expect((removed.prepare("SELECT COUNT(*) AS count FROM quality_events WHERE id LIKE 'quality-simulation-20260825-%' AND deleted_at IS NULL").get() as { count: number }).count).toBe(0);
    removed.close();
  });
});
