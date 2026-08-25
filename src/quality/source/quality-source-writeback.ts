import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createDingTalkWorkbookClient,
  type DailyReportDocConfig,
  type DingTalkSheetProperties,
} from "../../agent/daily-report-digest/dingtalk-workbook-client";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";
import {
  normalizeQualitySourceSheet,
  type NormalizedQualitySourceRow,
} from "./quality-source-schema";

const EXPECTED_SHEET_NAME = "客户端问题反馈记录表";
const STATUS_HEADER = "质量研判状态";
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

interface WorkbookWriteClient {
  listSheets(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
  ): Promise<Array<{ id: string; name: string }>>;
  getSheetProperties(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    sheetId: string,
  ): Promise<DingTalkSheetProperties>;
  readSheetValues(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    sheetId: string,
    rangeAddress: string,
  ): Promise<unknown[][]>;
  writeSheetRangeValues(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    sheetId: string,
    rangeAddress: string,
    values: string[][],
  ): Promise<void>;
}

type DatabaseRow = Record<string, unknown>;

export type QualitySourceWritebackStatus =
  | "PENDING"
  | "SENDING"
  | "RETRY"
  | "SENT"
  | "DEAD"
  | "SUPERSEDED";

export interface QualitySourceWritebackRecord {
  writebackId: string;
  sourceKey: string;
  reviewVersion: number;
  desiredValue: string;
  dedupeKey: string;
  status: QualitySourceWritebackStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  sendingStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

function requiredEnv(env: Record<string, string | undefined>, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function columnLetter(zeroBasedColumn: number): string {
  let current = zeroBasedColumn;
  let result = "";
  while (current >= 0) {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  }
  return result;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value.trim().replace(/[./]/g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
}

function sixMonthCutoff(now: Date): number {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return cutoff.getTime();
}

function groupConsecutiveRows(rows: number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const groups: Array<{ start: number; end: number }> = [];
  for (const row of sorted) {
    const last = groups.at(-1);
    if (last && row === last.end + 1) last.end = row;
    else groups.push({ start: row, end: row });
  }
  return groups;
}

function stableFallbackMatches(
  candidate: NormalizedQualitySourceRow,
  expected: NormalizedQualitySourceRow,
): boolean {
  const pairs = [
    [candidate.feedbackAt, expected.feedbackAt],
    [candidate.reporter, expected.reporter],
    [candidate.serialNo, expected.serialNo],
  ].filter((pair) => pair[1].trim().length > 0);
  return pairs.length >= 2 && pairs.every(([actual, wanted]) => actual.trim() === wanted.trim());
}

function locateSourceRow(
  rows: NormalizedQualitySourceRow[],
  source: NormalizedQualitySourceRow,
): NormalizedQualitySourceRow {
  if (source.feedbackNo.trim()) {
    const byFeedbackNo = rows.filter((row) => row.feedbackNo === source.feedbackNo);
    if (byFeedbackNo.length === 1) return byFeedbackNo[0]!;
    if (byFeedbackNo.length > 1) throw new Error("反馈单号在钉钉原表中不唯一，已停止回写");
  }
  const exact = rows.filter((row) => row.sourceKey === source.sourceKey);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error("来源标识在钉钉原表中不唯一，已停止回写");
  const fallback = rows.filter((row) => stableFallbackMatches(row, source));
  if (fallback.length === 1) return fallback[0]!;
  if (fallback.length > 1) throw new Error("来源稳定字段匹配到多行，已停止回写");
  throw new Error("在钉钉原表中找不到对应反馈，已停止回写");
}

export function createDingTalkQualitySourceWriter(deps?: {
  env?: Record<string, string | undefined>;
  client?: WorkbookWriteClient;
  now?: () => Date;
}) {
  const env = deps?.env ?? process.env;
  const client = deps?.client ?? createDingTalkWorkbookClient();
  const now = deps?.now ?? (() => new Date());

  async function loadSheet() {
    const appKey = requiredEnv(env, "DINGTALK_CLIENT_ID");
    const appSecret = requiredEnv(env, "DINGTALK_CLIENT_SECRET");
    const workbookId = requiredEnv(env, "QUALITY_SOURCE_WORKBOOK_ID");
    const operatorUnionId = requiredEnv(env, "QUALITY_SOURCE_OPERATOR_UNION_ID");
    const doc: DailyReportDocConfig = {
      workspaceId: String(env.QUALITY_SOURCE_WORKSPACE_ID ?? "quality-source").trim(),
      operatorUnionId,
    };
    const sheets = await client.listSheets(appKey, appSecret, doc, workbookId);
    const sheet = sheets[0];
    if (!sheet || sheet.name !== EXPECTED_SHEET_NAME) {
      throw new Error(`first sheet must be ${EXPECTED_SHEET_NAME}; received ${sheet?.name || "none"}`);
    }
    const properties = await client.getSheetProperties(appKey, appSecret, doc, workbookId, sheet.id);
    const endColumn = columnLetter(properties.lastNonEmptyColumn);
    const range = `A1:${endColumn}${properties.lastNonEmptyRow + 1}`;
    const sheetRows = await client.readSheetValues(appKey, appSecret, doc, workbookId, sheet.id, range);
    if (!Array.isArray(sheetRows[0])) throw new Error("quality source header row is empty");
    return { appKey, appSecret, workbookId, doc, sheet, properties, sheetRows };
  }

  async function ensureStatusColumnAndBackfill(): Promise<{
    column: string;
    columnIndex: number;
    headerCreated: boolean;
    backfilled: number;
    normalizedRows: NormalizedQualitySourceRow[];
    sheetRows: unknown[][];
    context: Awaited<ReturnType<typeof loadSheet>>;
  }> {
    const context = await loadSheet();
    const headers = context.sheetRows[0] as unknown[];
    let columnIndex = headers.findIndex((header) => String(header ?? "").trim() === STATUS_HEADER);
    const headerCreated = columnIndex < 0;
    if (headerCreated) {
      columnIndex = context.properties.lastNonEmptyColumn + 1;
      const column = columnLetter(columnIndex);
      await client.writeSheetRangeValues(
        context.appKey, context.appSecret, context.doc, context.workbookId, context.sheet.id,
        `${column}1:${column}1`, [[STATUS_HEADER]],
      );
    }
    const normalizedRows = normalizeQualitySourceSheet({
      sheetId: context.sheet.id,
      sheetName: context.sheet.name,
      rows: context.sheetRows,
    });
    const cutoff = sixMonthCutoff(now());
    const rowsToBackfill = normalizedRows.filter((row) => {
      const occurred = timestamp(row.feedbackAt);
      if (occurred == null || occurred < cutoff) return false;
      return !String(context.sheetRows[row.rowNumber - 1]?.[columnIndex] ?? "").trim();
    }).map((row) => row.rowNumber);
    const column = columnLetter(columnIndex);
    for (const group of groupConsecutiveRows(rowsToBackfill)) {
      await client.writeSheetRangeValues(
        context.appKey, context.appSecret, context.doc, context.workbookId, context.sheet.id,
        `${column}${group.start}:${column}${group.end}`,
        Array.from({ length: group.end - group.start + 1 }, () => ["未研判"]),
      );
    }
    return {
      column,
      columnIndex,
      headerCreated,
      backfilled: rowsToBackfill.length,
      normalizedRows,
      sheetRows: context.sheetRows,
      context,
    };
  }

  async function writeStatus(input: {
    source: NormalizedQualitySourceRow;
    desiredValue: string;
  }) {
    const prepared = await ensureStatusColumnAndBackfill();
    const current = locateSourceRow(prepared.normalizedRows, input.source);
    await client.writeSheetRangeValues(
      prepared.context.appKey,
      prepared.context.appSecret,
      prepared.context.doc,
      prepared.context.workbookId,
      prepared.context.sheet.id,
      `${prepared.column}${current.rowNumber}:${prepared.column}${current.rowNumber}`,
      [[input.desiredValue]],
    );
    return {
      rowNumber: current.rowNumber,
      column: prepared.column,
      headerCreated: prepared.headerCreated,
      backfilled: prepared.backfilled,
    };
  }

  return { ensureStatusColumnAndBackfill, writeStatus };
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function writebackFromRow(row: DatabaseRow): QualitySourceWritebackRecord {
  return {
    writebackId: String(row.writeback_id),
    sourceKey: String(row.source_key),
    reviewVersion: Number(row.review_version),
    desiredValue: String(row.desired_value),
    dedupeKey: String(row.dedupe_key),
    status: String(row.status) as QualitySourceWritebackStatus,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: String(row.next_attempt_at),
    lastError: nullable(row.last_error),
    sendingStartedAt: nullable(row.sending_started_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    sentAt: nullable(row.sent_at),
  };
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    .replace(/(access[_-]?token|client[_-]?secret|password|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 500);
}

export function createQualitySourceWritebackOutbox(deps?: {
  dbPath?: string;
  now?: () => Date;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date());

  function get(writebackId: string): QualitySourceWritebackRecord | null {
    const row = db.prepare("SELECT * FROM quality_source_writeback_outbox WHERE writeback_id=?")
      .get(writebackId) as DatabaseRow | undefined;
    return row ? writebackFromRow(row) : null;
  }

  function claimNext(): QualitySourceWritebackRecord | null {
    const instant = now();
    const nowIso = instant.toISOString();
    const staleIso = new Date(instant.getTime() - 10 * 60_000).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE quality_source_writeback_outbox SET
          status='RETRY',next_attempt_at=?,updated_at=?,sending_started_at=NULL,
          last_error=COALESCE(last_error,'回写进程中断，已自动恢复')
        WHERE status='SENDING' AND sending_started_at<=?
      `).run(nowIso, nowIso, staleIso);
      const row = db.prepare(`
        SELECT * FROM quality_source_writeback_outbox
        WHERE status IN ('PENDING','RETRY') AND next_attempt_at<=?
        ORDER BY next_attempt_at,created_at,review_version,writeback_id LIMIT 1
      `).get(nowIso) as DatabaseRow | undefined;
      if (!row) {
        db.exec("COMMIT");
        return null;
      }
      const latest = db.prepare(`
        SELECT MAX(review_version) AS version FROM quality_source_writeback_outbox
        WHERE source_key=? AND status<>'SUPERSEDED'
      `).get(String(row.source_key)) as DatabaseRow;
      if (Number(row.review_version) < Number(latest.version)) {
        db.prepare(`
          UPDATE quality_source_writeback_outbox SET status='SUPERSEDED',updated_at=?
          WHERE writeback_id=? AND status IN ('PENDING','RETRY')
        `).run(nowIso, String(row.writeback_id));
        db.exec("COMMIT");
        return get(String(row.writeback_id));
      }
      db.prepare(`
        UPDATE quality_source_writeback_outbox SET
          status='SENDING',attempt_count=attempt_count+1,sending_started_at=?,updated_at=?
        WHERE writeback_id=? AND status IN ('PENDING','RETRY')
      `).run(nowIso, nowIso, String(row.writeback_id));
      db.exec("COMMIT");
      return get(String(row.writeback_id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function markSent(writebackId: string): QualitySourceWritebackRecord {
    const occurredAt = now().toISOString();
    db.prepare(`
      UPDATE quality_source_writeback_outbox SET
        status='SENT',sent_at=?,updated_at=?,sending_started_at=NULL,last_error=NULL
      WHERE writeback_id=? AND status='SENDING'
    `).run(occurredAt, occurredAt, writebackId);
    return get(writebackId)!;
  }

  function markFailed(writebackId: string, error: unknown): QualitySourceWritebackRecord {
    const current = get(writebackId);
    if (!current) throw new Error("质量来源回写任务不存在");
    if (current.status !== "SENDING") return current;
    const occurred = now();
    const dead = current.attemptCount >= 8;
    const delay = RETRY_DELAYS_MS[Math.min(Math.max(current.attemptCount - 1, 0), RETRY_DELAYS_MS.length - 1)]!;
    const next = new Date(occurred.getTime() + delay).toISOString();
    db.prepare(`
      UPDATE quality_source_writeback_outbox SET
        status=?,next_attempt_at=?,last_error=?,sending_started_at=NULL,updated_at=?
      WHERE writeback_id=? AND status='SENDING'
    `).run(
      dead ? "DEAD" : "RETRY",
      dead ? occurred.toISOString() : next,
      safeError(error),
      occurred.toISOString(),
      writebackId,
    );
    return get(writebackId)!;
  }

  async function processNext(sender: (input: QualitySourceWritebackRecord & {
    source: NormalizedQualitySourceRow;
  }) => Promise<void>): Promise<QualitySourceWritebackRecord | null> {
    const record = claimNext();
    if (!record || record.status === "SUPERSEDED") return record;
    const sourceRow = db.prepare("SELECT normalized_json FROM quality_source_rows WHERE source_key=? AND state<>'DELETED'")
      .get(record.sourceKey) as DatabaseRow | undefined;
    if (!sourceRow) return markFailed(record.writebackId, new Error("来源反馈不存在或已删除"));
    const source = JSON.parse(String(sourceRow.normalized_json)) as NormalizedQualitySourceRow;
    try {
      await sender({ ...record, source });
      return markSent(record.writebackId);
    } catch (error) {
      return markFailed(record.writebackId, error);
    }
  }

  function retryDead(writebackId: string): QualitySourceWritebackRecord {
    const occurredAt = now().toISOString();
    const result = db.prepare(`
      UPDATE quality_source_writeback_outbox SET
        status='RETRY',next_attempt_at=?,sending_started_at=NULL,updated_at=?
      WHERE writeback_id=? AND status='DEAD'
    `).run(occurredAt, occurredAt, writebackId);
    if (Number(result.changes) !== 1) throw new Error("仅回写失败任务可重新入队");
    return get(writebackId)!;
  }

  function list(sourceKey?: string): QualitySourceWritebackRecord[] {
    const rows = (sourceKey
      ? db.prepare("SELECT * FROM quality_source_writeback_outbox WHERE source_key=? ORDER BY created_at,writeback_id").all(sourceKey)
      : db.prepare("SELECT * FROM quality_source_writeback_outbox ORDER BY created_at,writeback_id").all()) as DatabaseRow[];
    return rows.map(writebackFromRow);
  }

  return { get, list, claimNext, processNext, retryDead, close: () => db.close() };
}
