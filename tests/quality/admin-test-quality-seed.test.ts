import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("administrator isolated quality seed", () => {
  it("creates exactly 30 idempotent simulated events covering every workflow status", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-test-quality-seed-"));
    roots.push(root);
    const dbPath = join(root, "workbench.sqlite");
    const run = () => execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed-admin-test-quality-data.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WORKBENCH_SQLITE_PATH: dbPath,
          WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED: "1",
        },
        encoding: "utf8",
      },
    );

    expect(run()).toContain("isolated quality events ready: 30");
    const damaged = new DatabaseSync(dbPath);
    damaged.prepare(`UPDATE quality_source_rows SET state='DELETED'
      WHERE sheet_id='QUALITY_TEST_ISOLATED'`).run();
    damaged.close();
    expect(run()).toContain("isolated quality events ready: 30");

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      SELECT status,COUNT(*) AS count
      FROM quality_events
      WHERE is_test=1
      GROUP BY status
      ORDER BY status
    `).all() as Array<{ status: string; count: number }>;
    const eventNos = db.prepare(`
      SELECT event_no
      FROM quality_events
      WHERE is_test=1
      ORDER BY event_no
    `).all() as Array<{ event_no: string }>;
    const notifications = db.prepare(`
      SELECT COUNT(*) AS count
      FROM quality_notification_outbox
      WHERE event_id LIKE 'quality-test-event-extra-%'
    `).get() as { count: number };
    const sourceStates = db.prepare(`
      SELECT state,COUNT(*) AS count
      FROM quality_source_rows
      WHERE sheet_id='QUALITY_TEST_ISOLATED'
      GROUP BY state
    `).all() as Array<{ state: string; count: number }>;
    const formalStatuses = db.prepare(`
      SELECT s.status,COUNT(*) AS count
      FROM quality_task_links l
      JOIN subtasks s ON s.subtask_id=l.subtask_id
      WHERE l.node_id LIKE 'quality-test-extra-node-%-employee'
      GROUP BY s.status
      ORDER BY s.status
    `).all() as Array<{ status: string; count: number }>;
    const employeeAssignments = db.prepare(`
      SELECT n.assignee_user_id,COUNT(*) AS count
      FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id
      WHERE n.node_id LIKE 'quality-test-extra-node-%-employee'
      GROUP BY n.assignee_user_id
      ORDER BY n.assignee_user_id
    `).all() as Array<{ assignee_user_id: string; count: number }>;
    db.close();

    expect(eventNos).toHaveLength(30);
    expect(eventNos[0]?.event_no).toBe("QT-DEMO-000");
    expect(eventNos[29]?.event_no).toBe("QT-DEMO-029");
    expect(Object.fromEntries(rows.map((row) => [row.status, row.count]))).toEqual({
      CLOSED: 3,
      DRAFT: 2,
      IN_PROGRESS: 8,
      PENDING_ACCEPTANCE: 5,
      PENDING_ANALYSIS: 3,
      PENDING_ASSIGNMENT: 3,
      PENDING_PRIMARY_REVIEW: 3,
      PENDING_QUALITY_REVIEW: 3,
    });
    expect(Object.fromEntries(formalStatuses.map((row) => [row.status, row.count]))).toEqual({
      ASSIGNED: 2,
      DONE: 12,
      IN_PROGRESS: 3,
    });
    expect(employeeAssignments.map((row) => row.assignee_user_id)).toEqual([
      "QUALITY_TEST_EMPLOYEE_001",
      "QUALITY_TEST_EMPLOYEE_002",
      "QUALITY_TEST_EMPLOYEE_003",
    ]);
    expect(notifications.count).toBe(0);
    expect(sourceStates).toEqual([{ state: "ACTIVE", count: 30 }]);
  }, 20_000);

  it("extends the legacy twelve-event dataset to thirty without replacing existing IDs", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-test-quality-legacy-seed-"));
    roots.push(root);
    const dbPath = join(root, "workbench.sqlite");
    const env = {
      ...process.env,
      WORKBENCH_SQLITE_PATH: dbPath,
      QUALITY_TEST_ACTORS_ENABLED: "1",
      WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED: "1",
    };
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed-quality-test-data.ts", "--confirm"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    const runAdminSeed = () => execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed-admin-test-quality-data.ts"],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );

    expect(runAdminSeed()).toContain("isolated quality events ready: 30");
    expect(runAdminSeed()).toContain("isolated quality events ready: 30");

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const counts = db.prepare(`
      SELECT COUNT(*) AS total,COUNT(DISTINCT event_no) AS distinct_event_nos
      FROM quality_events WHERE is_test=1
    `).get() as { total: number; distinct_event_nos: number };
    const first = db.prepare(`
      SELECT id FROM quality_events WHERE event_no='QT-DEMO-000'
    `).get() as { id: string };
    const employees = db.prepare(`
      SELECT DISTINCT n.assignee_user_id
      FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id
      WHERE n.assignee_kind='EMPLOYEE'
      ORDER BY n.assignee_user_id
    `).all() as Array<{ assignee_user_id: string }>;
    db.close();

    expect(counts).toEqual({ total: 30, distinct_event_nos: 30 });
    expect(first.id).toBe("quality-test-event-analysis");
    expect(employees.map((row) => row.assignee_user_id)).toEqual([
      "QUALITY_TEST_EMPLOYEE_001",
      "QUALITY_TEST_EMPLOYEE_002",
      "QUALITY_TEST_EMPLOYEE_003",
    ]);
  }, 30_000);
});
