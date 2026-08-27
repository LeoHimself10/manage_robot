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
    expect(notifications.count).toBe(0);
  }, 20_000);
});
