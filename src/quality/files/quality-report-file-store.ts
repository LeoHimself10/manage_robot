import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

export const QUALITY_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const QUALITY_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export interface QualityReportFileMetadata {
  id: string;
  eventId: string;
  originalName: string;
  mimeType: string;
  description: string;
  sizeBytes: number;
  sha256: string;
  status: "ACTIVE" | "ARCHIVED";
  uploadedBy: string;
  createdAt: string;
}

type DatabaseRow = Record<string, unknown>;

export function cleanQualityOriginalName(value: string): string {
  const clean = basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean || clean.length > 255) throw new Error("invalid original file name");
  return clean;
}

function metadataFromRow(row: DatabaseRow): QualityReportFileMetadata {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    description: String(row.description ?? ""),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    status: String(row.status) as QualityReportFileMetadata["status"],
    uploadedBy: String(row.uploaded_by),
    createdAt: String(row.created_at),
  };
}

export function createQualityReportFileStore(deps?: {
  dbPath?: string;
  rootDir?: string;
  maxBytes?: number;
  now?: () => string;
  id?: () => string;
}) {
  const db = new DatabaseSync(deps?.dbPath ?? resolveWorkbenchSqlitePath());
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const rootDir = deps?.rootDir ?? process.env.QUALITY_FILE_DIR?.trim() ?? "data/quality-files";
  const maxBytes = deps?.maxBytes ?? QUALITY_MAX_FILE_BYTES;
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function authorizedEvent(eventId: string, actorUserId: string): DatabaseRow {
    const row = db.prepare(`
      SELECT * FROM quality_events
      WHERE id = ? AND created_by = ? AND deleted_at IS NULL
    `).get(eventId, actorUserId) as DatabaseRow | undefined;
    if (!row) throw new Error("event not found");
    return row;
  }

  function save(input: {
    eventId: string;
    actorUserId: string;
    requestId?: string;
    originalName: string;
    mimeType: string;
    description?: string;
    buffer: Buffer;
  }): QualityReportFileMetadata {
    const event = authorizedEvent(input.eventId, input.actorUserId);
    if (String(event.status) === "CLOSED") throw new Error("已关闭质量事件只读");
    if (!QUALITY_ALLOWED_MIME_TYPES.has(input.mimeType)) throw new Error("file type not allowed");
    if (input.buffer.byteLength > maxBytes) throw new Error("file too large");
    const originalName = cleanQualityOriginalName(input.originalName);
    const description = String(input.description ?? "").trim();
    if (description.length > 2_000) throw new Error("附件说明不能超过2000字");
    const fileId = id();
    const storageKey = id();
    const occurredAt = now();
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    mkdirSync(rootDir, { recursive: true });
    const finalPath = join(rootDir, storageKey);
    const tempPath = join(rootDir, `.tmp-${storageKey}`);
    writeFileSync(tempPath, input.buffer, { flag: "wx", mode: 0o600 });
    renameSync(tempPath, finalPath);
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`
        INSERT INTO quality_report_files (
          id, event_id, draft_version, storage_key, original_name, mime_type,
          description, size_bytes, sha256, status, uploaded_by, created_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1)
      `).run(
        fileId,
        input.eventId,
        Number(event.version),
        storageKey,
        originalName,
        input.mimeType,
        description,
        input.buffer.byteLength,
        sha256,
        input.actorUserId,
        occurredAt,
      );
      const updated = db.prepare(`
        UPDATE quality_events SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL
      `).run(occurredAt, input.eventId, Number(event.version));
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        INSERT INTO quality_audit_events (
          id, event_id, actor_user_id, actor_role, action,
          before_json, after_json, reason, request_id, occurred_at
        ) VALUES (?, ?, ?, 'aftersales_manager', 'REPORT_FILE_ADDED', ?, ?, NULL, ?, ?)
      `).run(
        id(),
        input.eventId,
        input.actorUserId,
        JSON.stringify({ eventVersion: Number(event.version) }),
        JSON.stringify({
          eventVersion: Number(event.version) + 1,
          fileId,
          originalName,
          mimeType: input.mimeType,
          description,
          sizeBytes: input.buffer.byteLength,
          sha256,
        }),
        input.requestId ?? `file-upload:${fileId}`,
        occurredAt,
      );
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* transaction did not start or already ended */ }
      unlinkSync(finalPath);
      throw error;
    }
    return {
      id: fileId,
      eventId: input.eventId,
      originalName,
      mimeType: input.mimeType,
      description,
      sizeBytes: input.buffer.byteLength,
      sha256,
      status: "ACTIVE",
      uploadedBy: input.actorUserId,
      createdAt: occurredAt,
    };
  }

  function readForAuthorizedUser(
    fileId: string,
    actorUserId: string,
    actorRole?: "admin" | "aftersales_manager" | "quality_specialist",
  ): Buffer {
    const row = db.prepare(`
      SELECT f.*, e.created_by, e.deleted_at, e.status AS event_status
      FROM quality_report_files f
      JOIN quality_events e ON e.id = f.event_id
      WHERE f.id = ? AND f.status = 'ACTIVE'
        AND e.deleted_at IS NULL
        AND (e.created_by = ? OR ? = 'admin' OR (? = 'quality_specialist' AND e.status <> 'DRAFT'))
    `).get(fileId, actorUserId, actorRole ?? "", actorRole ?? "") as DatabaseRow | undefined;
    if (!row) throw new Error("file not found");
    const buffer = readFileSync(join(rootDir, String(row.storage_key)));
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== String(row.sha256)) throw new Error("file digest mismatch");
    return buffer;
  }

  function getMetadata(
    fileId: string,
    actorUserId: string,
    actorRole?: "admin" | "aftersales_manager" | "quality_specialist",
  ): QualityReportFileMetadata {
    const row = db.prepare(`
      SELECT f.*, e.status AS event_status FROM quality_report_files f
      JOIN quality_events e ON e.id = f.event_id
      WHERE f.id = ? AND e.deleted_at IS NULL
        AND (e.created_by = ? OR ? = 'admin' OR (? = 'quality_specialist' AND e.status <> 'DRAFT'))
    `).get(fileId, actorUserId, actorRole ?? "", actorRole ?? "") as DatabaseRow | undefined;
    if (!row) throw new Error("file not found");
    return metadataFromRow(row);
  }

  return {
    save,
    readForAuthorizedUser,
    getMetadata,
    close: () => db.close(),
  };
}
