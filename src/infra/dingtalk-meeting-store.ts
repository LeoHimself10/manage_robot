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
  sourceKind?: "video_conference" | "ai_minutes" | "unified";
  videoConferenceId?: string;
  taskUuid?: string;
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

export interface DingTalkMeetingTranscriptFragmentInput {
  fragmentKey?: string;
  source?: string;
  speakerName?: string;
  unionId?: string;
  startTimeMs?: number;
  endTimeMs?: number;
  text: string;
  rawJson?: Record<string, unknown>;
}

export interface DingTalkMeetingRow {
  conferenceId: string;
  sourceKind: "video_conference" | "ai_minutes" | "unified";
  videoConferenceId?: string;
  taskUuid?: string;
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
  transcriptSource?: string;
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
  setMeetingTranscript(input: { conferenceId: string; transcriptText: string; fetchedAt?: string; source?: string }): void;
  appendMeetingTranscriptFragments(input: {
    conferenceId: string;
    source?: string;
    fragments: DingTalkMeetingTranscriptFragmentInput[];
  }): number;
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

function transcriptLine(fragment: Pick<DingTalkMeetingTranscriptFragmentInput, "speakerName" | "text">): string {
  const text = String(fragment.text ?? "").trim();
  if (!text) return "";
  const speaker = String(fragment.speakerName ?? "").trim();
  return speaker ? `${speaker}: ${text}` : text;
}

function mapMeeting(row: Record<string, unknown>): DingTalkMeetingRow {
  const transcriptText = asString(row.transcript_text);
  const taskUuid = asString(row.task_uuid);
  const videoConferenceId =
    asString(row.video_conference_id) ??
    (row.source_kind !== "ai_minutes" ? asString(row.conference_id) : undefined);
  return {
    conferenceId: String(row.conference_id ?? ""),
    sourceKind:
      taskUuid && videoConferenceId
        ? "unified"
        : taskUuid
          ? "ai_minutes"
          : "video_conference",
    videoConferenceId,
    taskUuid,
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
    transcriptSource: asString(row.transcript_source),
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
      source_kind TEXT NOT NULL DEFAULT 'video_conference',
      video_conference_id TEXT,
      task_uuid TEXT,
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
      transcript_source TEXT,
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
    CREATE TABLE IF NOT EXISTS dingtalk_meeting_transcript_fragments (
      conference_id TEXT NOT NULL,
      fragment_key TEXT NOT NULL,
      source TEXT,
      speaker_name TEXT,
      union_id TEXT,
      start_time_ms INTEGER,
      end_time_ms INTEGER,
      text TEXT NOT NULL,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(conference_id, fragment_key)
    );
    CREATE TABLE IF NOT EXISTS dingtalk_meeting_aliases (
      alias_id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meetings_start ON dingtalk_meetings(start_time_ms);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meeting_members_union ON dingtalk_meeting_members(union_id);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meeting_fragments_order
      ON dingtalk_meeting_transcript_fragments(conference_id, start_time_ms, created_at);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_meeting_aliases_meeting
      ON dingtalk_meeting_aliases(meeting_id);
  `);
  const meetingColumns = new Set(
    (db.prepare("PRAGMA table_info(dingtalk_meetings)").all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? ""),
    ),
  );
  if (!meetingColumns.has("transcript_source")) {
    db.exec("ALTER TABLE dingtalk_meetings ADD COLUMN transcript_source TEXT");
  }
  if (!meetingColumns.has("source_kind")) {
    db.exec("ALTER TABLE dingtalk_meetings ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'video_conference'");
  }
  if (!meetingColumns.has("task_uuid")) {
    db.exec("ALTER TABLE dingtalk_meetings ADD COLUMN task_uuid TEXT");
  }
  if (!meetingColumns.has("video_conference_id")) {
    db.exec("ALTER TABLE dingtalk_meetings ADD COLUMN video_conference_id TEXT");
    db.exec(
      "UPDATE dingtalk_meetings SET video_conference_id = conference_id WHERE source_kind <> 'ai_minutes' AND conference_id NOT LIKE 'minutes:%'",
    );
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_dingtalk_meetings_task_uuid ON dingtalk_meetings(task_uuid) WHERE task_uuid IS NOT NULL",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_dingtalk_meetings_video_conference_id ON dingtalk_meetings(video_conference_id) WHERE video_conference_id IS NOT NULL",
  );
}

export function createDingTalkMeetingStore(dbPath = resolveWorkbenchSqlitePath()): DingTalkMeetingStore {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 8000");
  ensureSchema(db);

  const qMeeting = db.prepare("SELECT * FROM dingtalk_meetings WHERE conference_id = ?");
  const qMembers = db.prepare(
    "SELECT * FROM dingtalk_meeting_members WHERE conference_id = ? ORDER BY union_id ASC",
  );

  function resolveMeetingId(value: unknown): string {
    const id = String(value ?? "").trim();
    if (!id) return "";
    const alias = db
      .prepare("SELECT meeting_id FROM dingtalk_meeting_aliases WHERE alias_id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return asString(alias?.meeting_id) ?? id;
  }

  function normalizeMeetingTitle(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function findCrossSourceMatch(input: DingTalkMeetingUpsertInput): string | undefined {
    const startTimeMs = Number(input.startTimeMs);
    const title = normalizeMeetingTitle(input.title);
    if (!Number.isFinite(startTimeMs) || startTimeMs <= 0 || title.length < 2) return undefined;
    const wantsAi = input.sourceKind === "ai_minutes" || Boolean(input.taskUuid);
    const rows = db
      .prepare(
        `SELECT *
           FROM dingtalk_meetings
          WHERE start_time_ms BETWEEN ? AND ?
            AND ${wantsAi ? "video_conference_id IS NOT NULL" : "task_uuid IS NOT NULL"}
          ORDER BY updated_at DESC
          LIMIT 20`,
      )
      .all(startTimeMs - 5 * 60_000, startTimeMs + 5 * 60_000) as Array<Record<string, unknown>>;
    const matches = rows.filter((row) => {
      const candidateTitle = normalizeMeetingTitle(row.title);
      const titleMatches =
        candidateTitle === title ||
        (Math.min(candidateTitle.length, title.length) >= 6 &&
          (candidateTitle.includes(title) || title.includes(candidateTitle)));
      if (!titleMatches) return false;
      const incomingCreator = asString(input.creatorUnionId);
      const existingCreator = asString(row.creator_union_id);
      if (incomingCreator && existingCreator && incomingCreator !== existingCreator) return false;
      if (!incomingCreator && !existingCreator) {
        return Math.abs(Number(row.start_time_ms ?? 0) - startTimeMs) <= 60_000;
      }
      return true;
    });
    return matches.length === 1 ? String(matches[0]?.conference_id ?? "") || undefined : undefined;
  }

  function mergeMeetingRows(preferredId: string, duplicateId: string): void {
    if (!preferredId || !duplicateId || preferredId === duplicateId) return;
    const preferred = qMeeting.get(preferredId) as Record<string, unknown> | undefined;
    const duplicate = qMeeting.get(duplicateId) as Record<string, unknown> | undefined;
    if (!preferred || !duplicate) return;
    const now = nowIso();
    db.exec("BEGIN");
    try {
      // Release unique identifiers before moving them to the canonical row.
      db.prepare(
        "UPDATE dingtalk_meetings SET task_uuid = NULL, video_conference_id = NULL WHERE conference_id = ?",
      ).run(duplicateId);
      const preferredSource = asString(preferred.transcript_source);
      const duplicateSource = asString(duplicate.transcript_source);
      const preferDuplicateTranscript =
        Boolean(asString(duplicate.transcript_text)) &&
        (!asString(preferred.transcript_text) ||
          (duplicateSource?.startsWith("ai_minutes") &&
            !preferredSource?.startsWith("ai_minutes")));
      db.prepare(
        `UPDATE dingtalk_meetings
            SET source_kind = 'unified',
                video_conference_id = COALESCE(video_conference_id, ?),
                task_uuid = COALESCE(task_uuid, ?),
                title = COALESCE(title, ?),
                room_code = COALESCE(room_code, ?),
                schedule_conference_id = COALESCE(schedule_conference_id, ?),
                creator_user_id = COALESCE(creator_user_id, ?),
                creator_union_id = COALESCE(creator_union_id, ?),
                creator_nick = COALESCE(creator_nick, ?),
                host_union_id = COALESCE(host_union_id, ?),
                start_time_ms = COALESCE(start_time_ms, ?),
                end_time_ms = COALESCE(end_time_ms, ?),
                status = COALESCE(status, ?),
                flash_status = COALESCE(flash_status, ?),
                transcript_text = ?,
                transcript_fetched_at = ?,
                transcript_source = ?,
                last_error = CASE WHEN ? IS NOT NULL THEN NULL ELSE COALESCE(last_error, ?) END,
                updated_at = ?
          WHERE conference_id = ?`,
      ).run(
        asString(duplicate.video_conference_id) ?? null,
        asString(duplicate.task_uuid) ?? null,
        asString(duplicate.title) ?? null,
        asString(duplicate.room_code) ?? null,
        asString(duplicate.schedule_conference_id) ?? null,
        asString(duplicate.creator_user_id) ?? null,
        asString(duplicate.creator_union_id) ?? null,
        asString(duplicate.creator_nick) ?? null,
        asString(duplicate.host_union_id) ?? null,
        asNumber(duplicate.start_time_ms) ?? null,
        asNumber(duplicate.end_time_ms) ?? null,
        asString(duplicate.status) ?? null,
        asString(duplicate.flash_status) ?? null,
        preferDuplicateTranscript
          ? asString(duplicate.transcript_text) ?? null
          : asString(preferred.transcript_text) ?? asString(duplicate.transcript_text) ?? null,
        preferDuplicateTranscript
          ? asString(duplicate.transcript_fetched_at) ?? null
          : asString(preferred.transcript_fetched_at) ??
              asString(duplicate.transcript_fetched_at) ??
              null,
        preferDuplicateTranscript
          ? duplicateSource ?? null
          : preferredSource ?? duplicateSource ?? null,
        preferDuplicateTranscript
          ? asString(duplicate.transcript_text) ?? null
          : asString(preferred.transcript_text) ?? asString(duplicate.transcript_text) ?? null,
        asString(duplicate.last_error) ?? null,
        now,
        preferredId,
      );
      db.prepare(
        `INSERT INTO dingtalk_meeting_members(
           conference_id, union_id, user_id, nick_name, role, raw_json, created_at, updated_at
         )
         SELECT ?, union_id, user_id, nick_name, role, raw_json, created_at, ?
           FROM dingtalk_meeting_members
          WHERE conference_id = ?
         ON CONFLICT(conference_id, union_id) DO UPDATE SET
           user_id = COALESCE(dingtalk_meeting_members.user_id, excluded.user_id),
           nick_name = COALESCE(dingtalk_meeting_members.nick_name, excluded.nick_name),
           role = COALESCE(dingtalk_meeting_members.role, excluded.role),
           updated_at = excluded.updated_at`,
      ).run(preferredId, now, duplicateId);
      db.prepare(
        `INSERT OR IGNORE INTO dingtalk_meeting_transcript_fragments(
           conference_id, fragment_key, source, speaker_name, union_id,
           start_time_ms, end_time_ms, text, raw_json, created_at
         )
         SELECT ?, fragment_key, source, speaker_name, union_id,
                start_time_ms, end_time_ms, text, raw_json, created_at
           FROM dingtalk_meeting_transcript_fragments
          WHERE conference_id = ?`,
      ).run(preferredId, duplicateId);
      db.prepare("DELETE FROM dingtalk_meeting_members WHERE conference_id = ?").run(duplicateId);
      db.prepare("DELETE FROM dingtalk_meeting_transcript_fragments WHERE conference_id = ?").run(
        duplicateId,
      );
      db.prepare("DELETE FROM dingtalk_meetings WHERE conference_id = ?").run(duplicateId);
      db.prepare("UPDATE dingtalk_meeting_aliases SET meeting_id = ? WHERE meeting_id = ?").run(
        preferredId,
        duplicateId,
      );
      db.prepare(
        `INSERT INTO dingtalk_meeting_aliases(alias_id, meeting_id, created_at)
         VALUES(?,?,?)
         ON CONFLICT(alias_id) DO UPDATE SET meeting_id = excluded.meeting_id`,
      ).run(duplicateId, preferredId, now);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    upsertMeeting(input) {
      const rawRequestedId = String(input.conferenceId ?? "").trim();
      const requestedId = resolveMeetingId(rawRequestedId);
      if (!requestedId) throw new Error("conferenceId is required");
      const taskUuid = asString(input.taskUuid);
      const incomingVideoConferenceId =
        asString(input.videoConferenceId) ??
        (input.sourceKind !== "ai_minutes" && !requestedId.startsWith("minutes:")
          ? requestedId
          : undefined);
      const byTask = taskUuid
        ? (db
            .prepare("SELECT conference_id FROM dingtalk_meetings WHERE task_uuid = ?")
            .get(taskUuid) as Record<string, unknown> | undefined)
        : undefined;
      const byVideo = incomingVideoConferenceId
        ? (db
            .prepare(
              "SELECT conference_id FROM dingtalk_meetings WHERE video_conference_id = ? OR conference_id = ?",
            )
            .get(incomingVideoConferenceId, incomingVideoConferenceId) as
            | Record<string, unknown>
            | undefined)
        : undefined;
      const taskMeetingId = asString(byTask?.conference_id);
      const videoMeetingId = asString(byVideo?.conference_id);
      const crossSourceMeetingId = findCrossSourceMatch(input);
      let conferenceId =
        videoMeetingId ??
        (crossSourceMeetingId && crossSourceMeetingId !== taskMeetingId
          ? crossSourceMeetingId
          : undefined) ??
        taskMeetingId ??
        crossSourceMeetingId ??
        (incomingVideoConferenceId || requestedId);

      if (incomingVideoConferenceId && conferenceId.startsWith("minutes:")) {
        const now = nowIso();
        db.prepare(
          `INSERT OR IGNORE INTO dingtalk_meetings(
             conference_id, source_kind, video_conference_id, created_at, updated_at
           ) VALUES(?, 'video_conference', ?, ?, ?)`,
        ).run(incomingVideoConferenceId, incomingVideoConferenceId, now, now);
        mergeMeetingRows(incomingVideoConferenceId, conferenceId);
        conferenceId = incomingVideoConferenceId;
      }
      if (taskMeetingId && taskMeetingId !== conferenceId) {
        mergeMeetingRows(conferenceId, taskMeetingId);
      }
      if (videoMeetingId && videoMeetingId !== conferenceId) {
        mergeMeetingRows(conferenceId, videoMeetingId);
      }
      const now = nowIso();
      db.prepare(
        `INSERT INTO dingtalk_meetings(
           conference_id, source_kind, video_conference_id, task_uuid, title, room_code, schedule_conference_id,
           creator_user_id, creator_union_id, creator_nick, host_union_id,
           start_time_ms, end_time_ms, status, flash_status, raw_json,
           created_at, updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(conference_id) DO UPDATE SET
           source_kind = CASE
             WHEN COALESCE(excluded.task_uuid, dingtalk_meetings.task_uuid) IS NOT NULL
              AND COALESCE(excluded.video_conference_id, dingtalk_meetings.video_conference_id) IS NOT NULL
             THEN 'unified'
             ELSE COALESCE(excluded.source_kind, dingtalk_meetings.source_kind)
           END,
           video_conference_id = COALESCE(excluded.video_conference_id, dingtalk_meetings.video_conference_id),
           task_uuid = COALESCE(excluded.task_uuid, dingtalk_meetings.task_uuid),
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
        input.sourceKind ?? "video_conference",
        incomingVideoConferenceId ?? null,
        taskUuid ?? null,
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
      const id = resolveMeetingId(conferenceId);
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
      return (qMembers.all(resolveMeetingId(conferenceId)) as Array<Record<string, unknown>>).map(mapMember);
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
      const id = resolveMeetingId(conferenceId);
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
      const row = qMeeting.get(resolveMeetingId(conferenceId)) as Record<string, unknown> | undefined;
      return row ? mapMeeting(row) : undefined;
    },

    setMeetingTranscript(input) {
      const now = nowIso();
      db.prepare(
        `UPDATE dingtalk_meetings
            SET transcript_text = ?,
                transcript_fetched_at = ?,
                transcript_source = COALESCE(?, transcript_source),
                last_error = NULL,
                updated_at = ?
          WHERE conference_id = ?`,
      ).run(
        String(input.transcriptText ?? ""),
        String(input.fetchedAt ?? now),
        asString(input.source) ?? null,
        now,
        resolveMeetingId(input.conferenceId),
      );
    },

    appendMeetingTranscriptFragments(input) {
      const conferenceId = resolveMeetingId(input.conferenceId);
      if (!conferenceId) throw new Error("conferenceId is required");
      const source = asString(input.source) ?? "asr_event";
      const now = nowIso();
      const unique = new Map<string, DingTalkMeetingTranscriptFragmentInput>();
      for (const fragment of input.fragments ?? []) {
        const text = String(fragment.text ?? "").trim();
        if (!text) continue;
        const key = asString(fragment.fragmentKey) ?? [
          source,
          asString(fragment.unionId) ?? "",
          fragment.startTimeMs ?? "",
          text,
        ].join(":");
        if (!unique.has(key)) unique.set(key, { ...fragment, text, fragmentKey: key });
      }
      if (!unique.size) return 0;

      let inserted = 0;
      db.exec("BEGIN");
      try {
        const insert = db.prepare(
          `INSERT OR IGNORE INTO dingtalk_meeting_transcript_fragments(
             conference_id, fragment_key, source, speaker_name, union_id,
             start_time_ms, end_time_ms, text, raw_json, created_at
           ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const [fragmentKey, fragment] of unique) {
          const result = insert.run(
            conferenceId,
            fragmentKey,
            source,
            asString(fragment.speakerName) ?? null,
            asString(fragment.unionId) ?? null,
            fragment.startTimeMs ?? null,
            fragment.endTimeMs ?? null,
            String(fragment.text ?? "").trim(),
            encodeJson(fragment.rawJson),
            now,
          );
          if (Number(result.changes ?? 0) > 0) inserted += 1;
        }
        if (inserted > 0) {
          const rows = db
            .prepare(
              `SELECT speaker_name, text
                 FROM dingtalk_meeting_transcript_fragments
                WHERE conference_id = ?
                ORDER BY COALESCE(start_time_ms, 0), created_at, fragment_key`,
            )
            .all(conferenceId) as Array<Record<string, unknown>>;
          const fragmentsText = rows
            .map((row) => transcriptLine({ speakerName: asString(row.speaker_name), text: String(row.text ?? "") }))
            .filter(Boolean)
            .join("\n");
          const current = qMeeting.get(conferenceId) as Record<string, unknown> | undefined;
          const currentText = asString(current?.transcript_text);
          const currentSource = asString(current?.transcript_source);
          const nextText =
            !currentText || !currentSource || currentSource === source
              ? fragmentsText
              : [currentText, ...[...unique.values()].map(transcriptLine).filter((line) => line && !currentText.includes(line))]
                  .filter(Boolean)
                  .join("\n");
          db.prepare(
            `UPDATE dingtalk_meetings
                SET transcript_text = ?,
                    transcript_fetched_at = ?,
                    transcript_source = ?,
                    last_error = NULL,
                    updated_at = ?
              WHERE conference_id = ?`,
          ).run(nextText, now, source, now, conferenceId);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return inserted;
    },

    setMeetingLastError(input) {
      const now = nowIso();
      db.prepare("UPDATE dingtalk_meetings SET last_error = ?, updated_at = ? WHERE conference_id = ?").run(
        String(input.errorText ?? "").slice(0, 1000),
        now,
        resolveMeetingId(input.conferenceId),
      );
    },

    close() {
      db.close();
    },
  };
}
