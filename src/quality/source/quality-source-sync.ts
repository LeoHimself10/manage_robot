import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import {
  normalizeQualitySourceSheet,
  type NormalizedQualitySourceRow,
  type QualitySourceSheet,
} from "./quality-source-schema";

const DEFAULT_SOURCE_ID = "dingtalk-client-feedback";

export interface QualitySourceSyncResult {
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
  rowCount: number;
  succeededAt: string;
}

type DatabaseRow = Record<string, unknown>;

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function normalizedJson(row: NormalizedQualitySourceRow): string {
  const { rawSnapshot: _rawSnapshot, ...normalized } = row;
  return JSON.stringify(normalized);
}

export function createQualitySourceSync(deps: {
  reader: { readFirstSheet(): Promise<QualitySourceSheet> };
  dbPath?: string;
  sourceId?: string;
  now?: () => string;
  refreshCandidates?: () => Promise<void>;
  logError?: (event: Record<string, unknown>) => void;
}): { syncNow(): Promise<QualitySourceSyncResult>; close(): void } {
  const db = new DatabaseSync(deps.dbPath ?? resolveWorkbenchSqlitePath());
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const sourceId = deps.sourceId ?? DEFAULT_SOURCE_ID;
  const now = deps.now ?? (() => new Date().toISOString());
  const logError = deps.logError ?? ((event) => console.error(JSON.stringify(event)));

  function markRunning(startedAt: string): void {
    transaction(db, () => {
      db.prepare(`
        INSERT INTO quality_source_sync_state (
          source_id, status, last_started_at, version, updated_at
        ) VALUES (?, 'RUNNING', ?, 1, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          status = 'RUNNING', last_started_at = excluded.last_started_at,
          last_error = NULL, version = quality_source_sync_state.version + 1,
          updated_at = excluded.updated_at
      `).run(sourceId, startedAt, startedAt);
    });
  }

  function markFailed(error: unknown, failedAt: string): void {
    const summary = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    transaction(db, () => {
      db.prepare(`
        INSERT INTO quality_source_sync_state (
          source_id, status, last_started_at, last_failed_at, last_error, version, updated_at
        ) VALUES (?, 'FAILED', ?, ?, ?, 1, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          status = 'FAILED', last_failed_at = excluded.last_failed_at,
          last_error = excluded.last_error, version = quality_source_sync_state.version + 1,
          updated_at = excluded.updated_at
      `).run(sourceId, failedAt, failedAt, summary, failedAt);
    });
  }

  async function syncNow(): Promise<QualitySourceSyncResult> {
    const startedAt = now();
    markRunning(startedAt);
    let result: QualitySourceSyncResult;
    try {
      const sheet = await deps.reader.readFirstSheet();
      const rows = normalizeQualitySourceSheet(sheet);
      const succeededAt = now();
      result = transaction(db, () => {
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        let deleted = 0;
        const currentKeys = new Set(rows.map((row) => row.sourceKey));

        for (const row of rows) {
          const existing = db.prepare(
            "SELECT * FROM quality_source_rows WHERE source_key = ?",
          ).get(row.sourceKey) as DatabaseRow | undefined;
          if (!existing) {
            db.prepare(`
              INSERT INTO quality_source_rows (
                source_key, sheet_id, sheet_name, row_number, state, source_version,
                content_hash, normalized_json, raw_snapshot_json, previous_snapshot_json,
                first_seen_at, last_seen_at, source_updated_at, synced_at, version
              ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, NULL, ?, ?, NULL, ?, 1)
            `).run(
              row.sourceKey,
              sheet.sheetId,
              sheet.sheetName,
              row.rowNumber,
              row.contentHash,
              normalizedJson(row),
              JSON.stringify(row.rawSnapshot),
              succeededAt,
              succeededAt,
              succeededAt,
            );
            inserted += 1;
            continue;
          }

          const changed = String(existing.content_hash) !== row.contentHash
            || String(existing.state) === "DELETED";
          if (changed) {
            db.prepare(`
              UPDATE quality_source_rows SET
                sheet_id = ?, sheet_name = ?, row_number = ?, state = 'UPDATED',
                source_version = source_version + 1, content_hash = ?, normalized_json = ?,
                previous_snapshot_json = raw_snapshot_json, raw_snapshot_json = ?,
                last_seen_at = ?, synced_at = ?, version = version + 1
              WHERE source_key = ?
            `).run(
              sheet.sheetId,
              sheet.sheetName,
              row.rowNumber,
              row.contentHash,
              normalizedJson(row),
              JSON.stringify(row.rawSnapshot),
              succeededAt,
              succeededAt,
              row.sourceKey,
            );
            updated += 1;
          } else {
            db.prepare(`
              UPDATE quality_source_rows SET
                sheet_id = ?, sheet_name = ?, row_number = ?, last_seen_at = ?, synced_at = ?
              WHERE source_key = ?
            `).run(
              sheet.sheetId,
              sheet.sheetName,
              row.rowNumber,
              succeededAt,
              succeededAt,
              row.sourceKey,
            );
            unchanged += 1;
          }
        }

        const activeRows = db.prepare(
          `SELECT source_key FROM quality_source_rows
           WHERE state <> 'DELETED' AND sheet_id <> 'QUALITY_TEST_ISOLATED'`,
        ).all() as DatabaseRow[];
        for (const row of activeRows) {
          const sourceKey = String(row.source_key);
          if (currentKeys.has(sourceKey)) continue;
          db.prepare(`
            UPDATE quality_source_rows SET
              state = 'DELETED', source_version = source_version + 1,
              previous_snapshot_json = raw_snapshot_json, synced_at = ?, version = version + 1
            WHERE source_key = ? AND state <> 'DELETED'
          `).run(succeededAt, sourceKey);
          deleted += 1;
        }

        db.prepare(`
          UPDATE quality_source_sync_state SET
            status = 'SUCCEEDED', last_succeeded_at = ?, last_error = NULL,
            version = version + 1, updated_at = ?
          WHERE source_id = ?
        `).run(succeededAt, succeededAt, sourceId);
        return { inserted, updated, unchanged, deleted, rowCount: rows.length, succeededAt };
      });
    } catch (error) {
      markFailed(error, now());
      throw error;
    }
    if (deps.refreshCandidates) {
      try {
        await deps.refreshCandidates();
      } catch (error) {
        logError({
          event: "quality_candidate_refresh_failed",
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
      }
    }
    return result;
  }

  return { syncNow, close: () => db.close() };
}
