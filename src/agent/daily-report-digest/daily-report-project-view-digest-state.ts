import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

export interface ProjectViewDigestStateStore {
  db: DatabaseSync;
  close(): void;
}

function ensureTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_report_project_view_digest_state (
      view_id TEXT NOT NULL,
      date_ymd TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (view_id, date_ymd, user_id)
    );
  `);
}

export function createProjectViewDigestStateStore(
  dbPath = resolveWorkbenchSqlitePath(),
): ProjectViewDigestStateStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureTable(db);
  return {
    db,
    close() {
      db.close();
    },
  };
}

export function hasProjectViewDigestSent(
  viewId: string,
  dateYmd: string,
  userId: string,
  store: ProjectViewDigestStateStore,
): boolean {
  const row = store.db
    .prepare(
      `SELECT 1 FROM daily_report_project_view_digest_state
       WHERE view_id = ? AND date_ymd = ? AND user_id = ?`,
    )
    .get(viewId.trim(), dateYmd.trim(), userId.trim());
  return row != null;
}

export function markProjectViewDigestSent(
  viewId: string,
  dateYmd: string,
  userId: string,
  store: ProjectViewDigestStateStore,
): void {
  store.db
    .prepare(
      `INSERT INTO daily_report_project_view_digest_state
         (view_id, date_ymd, user_id, sent_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(view_id, date_ymd, user_id) DO UPDATE SET sent_at = excluded.sent_at`,
    )
    .run(viewId.trim(), dateYmd.trim(), userId.trim(), new Date().toISOString());
}
