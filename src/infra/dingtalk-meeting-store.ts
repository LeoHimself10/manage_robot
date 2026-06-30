import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";

export interface DingTalkMeetingMemberInput {
  unionId: string;
  userId?: string;
  nickName?: string;
  role?: string;
  rawJson?: Record<string, unknown>;
}

export interface DingTalkMeetingUpsertInput {
  conferenceId: string;
  title?: string;
  roomCode?: string;
  scheduleConferenceId?: string;
  creatorUserId?: string;
  creatorUnionId?: string;
  creatorNick?: string;
  hostUnionId?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  status?: string;
  flashStatus?: string;
  rawJson?: Record<string, unknown>;
}

export interface DingTalkMeetingRow {
  conferenceId: string;
  title?: string;
  roomCode?: string;
  scheduleConferenceId?: string;
  creatorUserId?: string;
  creatorUnionId?: string;
  creatorNick?: string;
  hostUnionId?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  status?: string;
  flashStatus?: string;
  transcriptText?: string;
  transcriptFetchedAt?: string;
  transcriptCached: boolean;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DingTalkMeetingMemberRow {
  conferenceId: string;
  unionId: string;
  userId?: string;
  nickName?: string;
  role?: string;
}

export interface DingTalkMeetingStore {
  upsertMeeting(input: DingTalkMeetingUpsertInput): DingTalkMeetingRow;
  replaceMeetingMembers(conferenceId: string, members: DingTalkMeetingMemberInput[]): void;
  listMeetingMembers(conferenceId: string): DingTalkMeetingMemberRow[];
  listMeetingsForUnionId(input: { unionId: string; sinceMs?: number; limit?: number }): DingTalkMeetingRow[];
  userCanAccessMeeting(conferenceId: string, unionId: string): boolean;
  getMeeting(conferenceId: string): DingTalkMeetingRow | undefined;
  setMeetingTranscript(input: { conferenceId: string; transcriptText: string; fetchedAt?: string }): void;
  setMeetingLastError(input: { conferenceId: string; errorText: string }): void;
  close(): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s || undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function encodeJson(value: Record<string, unknown> | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function mapMeeting(row: Record<string, unknown>): DingTalkMeetingRow {
  const transcriptText = asString(row.transcript_text);
  return {
    conferenceId: String(row.conference_id ?? ""),
    title: asString(row.title),
    roomCode: asString(row.room_code),
    scheduleConferenceId: asString(row.schedule_conference_id),
    creatorUserId: asString(row.creator_user_id),
    creatorUnionId: asString(row.creator_union_id),
    creatorNick: asString(row.creator_nick),
    hostUnionId: asString(row.host_union_id),
    startTimeMs: asNumber(row.start_time_ms),
    endTimeMs: asNumber(row.end_time_ms),
    status: asString(row.status),
    flashStatus: asString(row.flash_status),
    transcriptText,
    transcriptFetchedAt: asString(row.transcript_fetched_at),
    transcriptCached: Boolean(transcriptText),
    lastError: asString(row.last_error),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mapMember(row: Record<string, unknown>): DingTalkMeetingMemberRow {
  return {
    conferenceId: String(row.conference_id ?? ""),
    unionId: String(row.union_id ?? ""),
    userId: asString(row.user_id),
    nickName: asString(row.nick_name),
    role: asString(row.role),
  };
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dingtalk_meetings (
      conference_id TEXT PRIMARY KEY,
      title TEXT,
      room_code TEXT,
      schedule_conference_id TEXT,
      creator_user_id TEXT,
      creator_union_id TEXT,
      creator_nick TEXT,
      host_union_id TEXT,
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      status TEXT,
      flash_status TEXT,
      transcript_text TEXT,
      transcript_fetched_at TEXT,
      last_error TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dingtalk_meeting_members (
      conference_id TEXT NOT NULL,
      union_id TEXT NOT NULL,
      user_id TEXT,
      nick_name TEXT,
      role TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(conference_id, union_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meetings_start ON dingtalk_meetings(start_time_ms);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meeting_members_union ON dingtalk_meeting_members(union_id);
  `);
}

export function createDingTalkMeetingStore(dbPath = resolveWorkbenchSqlitePath()): DingTalkMeetingStore {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 8000");
  ensureSchema(db);

  const qMeeting = db.prepare("SELECT * FROM dingtalk_meetings WHERE conference_id = ?");
  const qMembers = db.prepare(
    "SELECT * FROM dingtalk_meeting_members WHERE conference_id = ? ORDER BY union_id ASC",
  );

  return {
    upsertMeeting(input) {
      const conferenceId = String(input.conferenceId ?? "").trim();
      if (!conferenceId) throw new Error("conferenceId is required");
      const now = nowIso();
      db.prepare(
        `INSERT INTO dingtalk_meetings(
           conference_id, title, room_code, schedule_conference_id,
           creator_user_id, creator_union_id, creator_nick, host_union_id,
           start_time_ms, end_time_ms, status, flash_status, raw_json,
           created_at, updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(conference_id) DO UPDATE SET
           title = COALESCE(excluded.title, dingtalk_meetings.title),
           room_code = COALESCE(excluded.room_code, dingtalk_meetings.room_code),
           schedule_conference_id = COALESCE(excluded.schedule_conference_id, dingtalk_meetings.schedule_conference_id),
           creator_user_id = COALESCE(excluded.creator_user_id, dingtalk_meetings.creator_user_id),
           creator_union_id = COALESCE(excluded.creator_union_id, dingtalk_meetings.creator_union_id),
           creator_nick = COALESCE(excluded.creator_nick, dingtalk_meetings.creator_nick),
           host_union_id = COALESCE(excluded.host_union_id, dingtalk_meetings.host_union_id),
           start_time_ms = COALESCE(excluded.start_time_ms, dingtalk_meetings.start_time_ms),
           end_time_ms = COALESCE(excluded.end_time_ms, dingtalk_meetings.end_time_ms),
           status = COALESCE(excluded.status, dingtalk_meetings.status),
           flash_status = COALESCE(excluded.flash_status, dingtalk_meetings.flash_status),
           raw_json = COALESCE(excluded.raw_json, dingtalk_meetings.raw_json),
           updated_at = excluded.updated_at`,
      ).run(
        conferenceId,
        asString(input.title) ?? null,
        asString(input.roomCode) ?? null,
        asString(input.scheduleConferenceId) ?? null,
        asString(input.creatorUserId) ?? null,
        asString(input.creatorUnionId) ?? null,
        asString(input.creatorNick) ?? null,
        asString(input.hostUnionId) ?? null,
        input.startTimeMs ?? null,
        input.endTimeMs ?? null,
        asString(input.status) ?? null,
        asString(input.flashStatus) ?? null,
        encodeJson(input.rawJson),
        now,
        now,
      );
      return mapMeeting(qMeeting.get(conferenceId) as Record<string, unknown>);
    },

    replaceMeetingMembers(conferenceId, members) {
      const id = String(conferenceId ?? "").trim();
      if (!id) throw new Error("conferenceId is required");
      const now = nowIso();
      const unique = new Map<string, DingTalkMeetingMemberInput>();
      for (const member of members) {
        const unionId = String(member.unionId ?? "").trim();
        if (!unionId) continue;
        if (!unique.has(unionId)) unique.set(unionId, member);
      }
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM dingtalk_meeting_members WHERE conference_id = ?").run(id);
        const insert = db.prepare(
          `INSERT INTO dingtalk_meeting_members(
             conference_id, union_id, user_id, nick_name, role, raw_json, created_at, updated_at
           ) VALUES(?,?,?,?,?,?,?,?)`,
        );
        for (const [unionId, member] of unique) {
          insert.run(
            id,
            unionId,
            asString(member.userId) ?? null,
            asString(member.nickName) ?? null,
            asString(member.role) ?? null,
            encodeJson(member.rawJson),
            now,
            now,
          );
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },

    listMeetingMembers(conferenceId) {
      return (qMembers.all(String(conferenceId ?? "").trim()) as Array<Record<string, unknown>>).map(mapMember);
    },

    listMeetingsForUnionId(input) {
      const unionId = String(input.unionId ?? "").trim();
      if (!unionId) return [];
      const sinceMs = input.sinceMs ?? 0;
      const limit = Math.min(Math.max(Math.floor(Number(input.limit ?? 50)), 1), 200);
      const rows = db
        .prepare(
          `SELECT DISTINCT m.*
             FROM dingtalk_meetings m
             LEFT JOIN dingtalk_meeting_members mm ON mm.conference_id = m.conference_id
            WHERE COALESCE(m.start_time_ms, 0) >= ?
              AND (
                m.creator_union_id = ?
                OR m.host_union_id = ?
                OR mm.union_id = ?
              )
            ORDER BY COALESCE(m.start_time_ms, 0) DESC, m.updated_at DESC
            LIMIT ?`,
        )
        .all(sinceMs, unionId, unionId, unionId, limit) as Array<Record<string, unknown>>;
      return rows.map(mapMeeting);
    },

    userCanAccessMeeting(conferenceId, unionId) {
      const id = String(conferenceId ?? "").trim();
      const uid = String(unionId ?? "").trim();
      if (!id || !uid) return false;
      const row = db
        .prepare(
          `SELECT 1 AS ok
             FROM dingtalk_meetings m
             LEFT JOIN dingtalk_meeting_members mm ON mm.conference_id = m.conference_id
            WHERE m.conference_id = ?
              AND (
                m.creator_union_id = ?
                OR m.host_union_id = ?
                OR mm.union_id = ?
              )
            LIMIT 1`,
        )
        .get(id, uid, uid, uid) as Record<string, unknown> | undefined;
      return Boolean(row);
    },

    getMeeting(conferenceId) {
      const row = qMeeting.get(String(conferenceId ?? "").trim()) as Record<string, unknown> | undefined;
      return row ? mapMeeting(row) : undefined;
    },

    setMeetingTranscript(input) {
      const now = nowIso();
      db.prepare(
        `UPDATE dingtalk_meetings
            SET transcript_text = ?, transcript_fetched_at = ?, last_error = NULL, updated_at = ?
          WHERE conference_id = ?`,
      ).run(
        String(input.transcriptText ?? ""),
        String(input.fetchedAt ?? now),
        now,
        String(input.conferenceId ?? "").trim(),
      );
    },

    setMeetingLastError(input) {
      const now = nowIso();
      db.prepare("UPDATE dingtalk_meetings SET last_error = ?, updated_at = ? WHERE conference_id = ?").run(
        String(input.errorText ?? "").slice(0, 1000),
        now,
        String(input.conferenceId ?? "").trim(),
      );
    },

    close() {
      db.close();
    },
  };
}
