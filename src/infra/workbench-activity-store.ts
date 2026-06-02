import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";

/** Stored surface; admin rolls up to manager audience in queries. */
export type WorkbenchActivitySurface = "manager" | "employee" | "admin";

export type WorkbenchActivityKind = "page_view" | "agent_turn";

export type WorkbenchAudience = "manager" | "employee";

function migrateActivityColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(workbench_activity_events)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("kind")) {
    db.exec(
      `ALTER TABLE workbench_activity_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'page_view'`,
    );
  }
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_activity_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'page_view',
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_activity_occurred
      ON workbench_activity_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_workbench_activity_user
      ON workbench_activity_events(user_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_workbench_activity_surface
      ON workbench_activity_events(surface, occurred_at);
  `);
  migrateActivityColumns(db);
}

function surfacesForAudience(audience: WorkbenchAudience): string[] {
  return audience === "manager" ? ["manager", "admin"] : ["employee"];
}

export function createWorkbenchActivityStore(dbPath = resolveWorkbenchSqlitePath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  return {
    recordEvent(input: {
      userId: string;
      surface: WorkbenchActivitySurface;
      path: string;
      kind?: WorkbenchActivityKind;
      occurredAt?: string;
    }): void {
      const userId = String(input.userId ?? "").trim();
      if (!userId) return;
      const path = String(input.path ?? "").trim().slice(0, 500) || "/workbench";
      db.prepare(
        `INSERT INTO workbench_activity_events (id, user_id, surface, path, kind, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        userId,
        input.surface,
        path,
        input.kind ?? "page_view",
        input.occurredAt ?? new Date().toISOString(),
      );
    },

    countDistinctUsers(fromIso: string, toIso: string): number {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS c FROM workbench_activity_events
           WHERE occurred_at >= ? AND occurred_at < ?`,
        )
        .get(fromIso, toIso) as { c: number };
      return Number(row?.c ?? 0);
    },

    countDistinctUsersForAudience(
      fromIso: string,
      toIso: string,
      audience: WorkbenchAudience,
    ): number {
      const surfaces = surfacesForAudience(audience);
      const placeholders = surfaces.map(() => "?").join(", ");
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS c FROM workbench_activity_events
           WHERE occurred_at >= ? AND occurred_at < ? AND surface IN (${placeholders})`,
        )
        .get(fromIso, toIso, ...surfaces) as { c: number };
      return Number(row?.c ?? 0);
    },
  };
}

export type WorkbenchActivityStore = ReturnType<typeof createWorkbenchActivityStore>;

let shared: WorkbenchActivityStore | undefined;

export function getWorkbenchActivityStore(): WorkbenchActivityStore {
  if (!shared) shared = createWorkbenchActivityStore();
  return shared;
}

/** Test-only: clear singleton so WORKBENCH_SQLITE_PATH can vary per case. */
export function resetWorkbenchActivityStoreForTests(): void {
  shared = undefined;
}
