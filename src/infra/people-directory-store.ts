import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashExternalAccountPassword, verifyExternalAccountPassword } from "./external-account-password";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";

export interface ExternalWorkbenchAccountRow {
  userId: string;
  username: string;
  passwordHash: string;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DingTalkContactRow {
  userId: string;
  unionId?: string;
  name: string;
  /** Present when row comes from `searchContacts` (match quality / UI badge). */
  matchedField?: "name" | "department" | "other";
  departmentIds: string[];
  departmentNames: string[];
  position?: string;
  jobNumber?: string;
  mobileMasked?: string;
  emailMasked?: string;
  active: boolean;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
  rawJson?: Record<string, unknown>;
  lastSyncedAt: string;
  deletedAt?: string;
}

export interface EmployeeCapabilityProfileRow {
  userId: string;
  skillTags: string[];
  strengths: string[];
  boundaries: string[];
  cases: Array<{
    taskType: string;
    contribution?: string;
    deliverable?: string;
    outcome: string;
  }>;
  tools: string[];
  availability: {
    capacityHint?: string;
    emergencyOk?: boolean;
    rejectedTaskTypes?: string[];
  };
  background?: string;
  source?: string;
  selfUpdatedAt?: string;
  managerVerifiedAt?: string;
  managerVerifiedBy?: string;
  updatedAt: string;
}

export interface EmployeeDirectorySnapshot {
  userId: string;
  displayName: string;
  /** Primary display name (first department) */
  department: string;
  /** All synced department IDs (for server-side filtering) */
  departmentIds?: string[];
  /** All synced department names (aligned with departmentIds when possible) */
  departmentNames?: string[];
  role: string;
  level?: string;
  managerUserId?: string;
  location?: string;
  active: boolean;
  selfProfile: {
    skillTags: string[];
    strengths: string[];
    boundaries: string[];
    cases: EmployeeCapabilityProfileRow["cases"];
    tools: string[];
    availability: EmployeeCapabilityProfileRow["availability"];
    background?: string;
  };
  taskHistory: {
    totalAssigned: number;
    doneCount: number;
    blockedCount: number;
    rejectedCount: number;
    acceptedCount: number;
    inProgressCount: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseObject<T extends object>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

/** Merge case lists by `outcome` (trimmed); later entries win. */
export function mergeCasesByOutcome(
  existing: EmployeeCapabilityProfileRow["cases"],
  incoming: EmployeeCapabilityProfileRow["cases"],
): EmployeeCapabilityProfileRow["cases"] {
  const map = new Map<string, EmployeeCapabilityProfileRow["cases"][number]>();
  for (const c of existing) {
    const k = String(c.outcome ?? "").trim();
    if (k) map.set(k, c);
  }
  for (const c of incoming) {
    const k = String(c.outcome ?? "").trim();
    if (k) map.set(k, c);
  }
  return Array.from(map.values());
}

export function createPeopleDirectoryStore(dbPath = resolveWorkbenchSqlitePath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS dingtalk_contacts (
      user_id TEXT PRIMARY KEY,
      union_id TEXT,
      name TEXT NOT NULL,
      department_ids_json TEXT NOT NULL DEFAULT '[]',
      department_names_json TEXT NOT NULL DEFAULT '[]',
      position TEXT,
      job_number TEXT,
      mobile_masked TEXT,
      email_masked TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_boss INTEGER NOT NULL DEFAULT 0,
      is_senior INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      last_synced_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dingtalk_contacts_active ON dingtalk_contacts(active);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_contacts_name ON dingtalk_contacts(name);

    CREATE TABLE IF NOT EXISTS employee_profiles (
      user_id TEXT PRIMARY KEY,
      skill_tags_json TEXT NOT NULL DEFAULT '[]',
      strengths_json TEXT NOT NULL DEFAULT '[]',
      boundaries_json TEXT NOT NULL DEFAULT '[]',
      cases_json TEXT NOT NULL DEFAULT '[]',
      tools_json TEXT NOT NULL DEFAULT '[]',
      availability_json TEXT NOT NULL DEFAULT '{}',
      background_json TEXT,
      source TEXT,
      self_updated_at TEXT,
      manager_verified_at TEXT,
      manager_verified_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee_profile_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      payload_json TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_employee_profile_events_user ON employee_profile_events(user_id);

    CREATE TABLE IF NOT EXISTS dingtalk_contact_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      total_contacts INTEGER NOT NULL DEFAULT 0,
      upserted_contacts INTEGER NOT NULL DEFAULT 0,
      deactivated_contacts INTEGER NOT NULL DEFAULT 0,
      error_text TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_workbench_accounts (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_external_workbench_accounts_username
      ON external_workbench_accounts(username);
  `);

  const upsertExternalAccountStmt = db.prepare(`
    INSERT INTO external_workbench_accounts(
      user_id, username, password_hash, display_name, enabled, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      username=excluded.username,
      password_hash=excluded.password_hash,
      display_name=excluded.display_name,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `);
  const findExternalAccountByUsernameStmt = db.prepare(
    "SELECT * FROM external_workbench_accounts WHERE username = ? LIMIT 1",
  );
  const findExternalAccountByUserIdStmt = db.prepare(
    "SELECT * FROM external_workbench_accounts WHERE user_id = ? LIMIT 1",
  );
  const updateExternalAccountPasswordStmt = db.prepare(
    "UPDATE external_workbench_accounts SET password_hash = ?, updated_at = ? WHERE user_id = ?",
  );

  function mapExternalAccountRow(row: Record<string, unknown>): ExternalWorkbenchAccountRow {
    return {
      userId: String(row.user_id ?? ""),
      username: String(row.username ?? ""),
      passwordHash: String(row.password_hash ?? ""),
      displayName: String(row.display_name ?? ""),
      enabled: Number(row.enabled ?? 0) === 1,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  }

  const upsertContactStmt = db.prepare(`
    INSERT INTO dingtalk_contacts(
      user_id, union_id, name, department_ids_json, department_names_json, position,
      job_number, mobile_masked, email_masked, active, is_admin, is_boss, is_senior,
      raw_json, last_synced_at, deleted_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      union_id=excluded.union_id,
      name=excluded.name,
      department_ids_json=excluded.department_ids_json,
      department_names_json=excluded.department_names_json,
      position=excluded.position,
      job_number=excluded.job_number,
      mobile_masked=excluded.mobile_masked,
      email_masked=excluded.email_masked,
      active=excluded.active,
      is_admin=excluded.is_admin,
      is_boss=excluded.is_boss,
      is_senior=excluded.is_senior,
      raw_json=excluded.raw_json,
      last_synced_at=excluded.last_synced_at,
      deleted_at=excluded.deleted_at
  `);

  const upsertProfileStmt = db.prepare(`
    INSERT INTO employee_profiles(
      user_id, skill_tags_json, strengths_json, boundaries_json, cases_json, tools_json,
      availability_json, background_json, source, self_updated_at, manager_verified_at,
      manager_verified_by, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      skill_tags_json=excluded.skill_tags_json,
      strengths_json=excluded.strengths_json,
      boundaries_json=excluded.boundaries_json,
      cases_json=excluded.cases_json,
      tools_json=excluded.tools_json,
      availability_json=excluded.availability_json,
      background_json=excluded.background_json,
      source=excluded.source,
      self_updated_at=excluded.self_updated_at,
      manager_verified_at=excluded.manager_verified_at,
      manager_verified_by=excluded.manager_verified_by,
      updated_at=excluded.updated_at
  `);

  const findContactStmt = db.prepare("SELECT * FROM dingtalk_contacts WHERE user_id = ?");
  const listContactsStmt = db.prepare(
    "SELECT * FROM dingtalk_contacts ORDER BY active DESC, name ASC, user_id ASC",
  );
  const searchContactsStmt = db.prepare(`
    SELECT *,
      CASE
        WHEN lower(name) LIKE '%' || ? || '%' THEN 'name'
        WHEN EXISTS (
          SELECT 1 FROM json_each(department_names_json)
          WHERE typeof(value) = 'text' AND lower(value) LIKE '%' || ? || '%'
        ) THEN 'department'
        ELSE 'other'
      END AS matched_field
    FROM dingtalk_contacts
    WHERE (
      ? = ''
      OR lower(name) LIKE '%' || ? || '%'
      OR EXISTS (
        SELECT 1 FROM json_each(department_names_json)
        WHERE typeof(value) = 'text' AND lower(value) LIKE '%' || ? || '%'
      )
    )
    ORDER BY (CASE WHEN lower(name) LIKE '%' || ? || '%' THEN 0 ELSE 1 END),
             active DESC, name ASC
    LIMIT ?
  `);
  const findProfileStmt = db.prepare("SELECT * FROM employee_profiles WHERE user_id = ?");
  const listProfilesStmt = db.prepare("SELECT * FROM employee_profiles ORDER BY user_id ASC");
  const syncRunStmt = db.prepare(`
    INSERT INTO dingtalk_contact_sync_runs(
      mode, status, total_contacts, upserted_contacts, deactivated_contacts, error_text, started_at, finished_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `);
  const appendProfileEventStmt = db.prepare(`
    INSERT INTO employee_profile_events(user_id, event_type, actor_user_id, payload_json, occurred_at)
    VALUES(?,?,?,?,?)
  `);

  function mapContactRow(raw: Record<string, unknown>): DingTalkContactRow {
    const mf = String(raw.matched_field ?? "").trim();
    const matchedField: DingTalkContactRow["matchedField"] =
      mf === "name" || mf === "department" || mf === "other" ? mf : undefined;
    return {
      userId: String(raw.user_id ?? ""),
      unionId: asString(raw.union_id),
      name: String(raw.name ?? ""),
      matchedField,
      departmentIds: parseArray<string>(raw.department_ids_json),
      departmentNames: parseArray<string>(raw.department_names_json),
      position: asString(raw.position),
      jobNumber: asString(raw.job_number),
      mobileMasked: asString(raw.mobile_masked),
      emailMasked: asString(raw.email_masked),
      active: Number(raw.active ?? 0) === 1,
      isAdmin: Number(raw.is_admin ?? 0) === 1,
      isBoss: Number(raw.is_boss ?? 0) === 1,
      isSenior: Number(raw.is_senior ?? 0) === 1,
      rawJson: parseObject<Record<string, unknown>>(raw.raw_json, {}),
      lastSyncedAt: String(raw.last_synced_at ?? ""),
      deletedAt: asString(raw.deleted_at),
    };
  }

  function mapProfileRow(raw: Record<string, unknown>): EmployeeCapabilityProfileRow {
    return {
      userId: String(raw.user_id ?? ""),
      skillTags: parseArray<string>(raw.skill_tags_json),
      strengths: parseArray<string>(raw.strengths_json),
      boundaries: parseArray<string>(raw.boundaries_json),
      cases: parseArray<EmployeeCapabilityProfileRow["cases"][number]>(raw.cases_json),
      tools: parseArray<string>(raw.tools_json),
      availability: parseObject<EmployeeCapabilityProfileRow["availability"]>(
        raw.availability_json,
        {},
      ),
      background: asString(raw.background_json),
      source: asString(raw.source),
      selfUpdatedAt: asString(raw.self_updated_at),
      managerVerifiedAt: asString(raw.manager_verified_at),
      managerVerifiedBy: asString(raw.manager_verified_by),
      updatedAt: String(raw.updated_at ?? ""),
    };
  }

  function buildSnapshot(contact?: DingTalkContactRow, profile?: EmployeeCapabilityProfileRow): EmployeeDirectorySnapshot {
    return {
      userId: contact?.userId ?? profile?.userId ?? "",
      displayName: contact?.name ?? profile?.userId ?? "",
      department: contact?.departmentNames?.[0] ?? "未分配部门",
      departmentIds: contact?.departmentIds?.length ? [...contact.departmentIds] : undefined,
      departmentNames: contact?.departmentNames?.length ? [...contact.departmentNames] : undefined,
      role: contact?.position ?? "Employee",
      level: undefined,
      managerUserId: undefined,
      location: undefined,
      active: contact?.active ?? false,
      selfProfile: {
        skillTags: profile?.skillTags ?? [],
        strengths: profile?.strengths ?? [],
        boundaries: profile?.boundaries ?? [],
        cases: profile?.cases ?? [],
        tools: profile?.tools ?? [],
        availability: profile?.availability ?? {},
        background: profile?.background,
      },
      taskHistory: {
        totalAssigned: 0,
        doneCount: 0,
        blockedCount: 0,
        rejectedCount: 0,
        acceptedCount: 0,
        inProgressCount: 0,
      },
    };
  }

  function buildTaskStatsMap(): Map<string, EmployeeDirectorySnapshot["taskHistory"]> {
    const result = new Map<string, EmployeeDirectorySnapshot["taskHistory"]>();
    try {
      const hasSubtasks = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subtasks'")
        .get() as Record<string, unknown> | undefined);
      if (!hasSubtasks) return result;
      const qTaskStats = db.prepare(`
        SELECT
          assignee_user_id AS user_id,
          COUNT(*) AS total_assigned,
          SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) AS done_count,
          SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked_count,
          SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
          SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
          SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count
        FROM subtasks
        GROUP BY assignee_user_id
      `);
      const rows = qTaskStats.all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const userId = String(row.user_id ?? "");
        if (!userId) continue;
        result.set(userId, {
          totalAssigned: Number(row.total_assigned ?? 0),
          doneCount: Number(row.done_count ?? 0),
          blockedCount: Number(row.blocked_count ?? 0),
          rejectedCount: Number(row.rejected_count ?? 0),
          acceptedCount: Number(row.accepted_count ?? 0),
          inProgressCount: Number(row.in_progress_count ?? 0),
        });
      }
    } catch {
      // tables may not exist yet in early boot; keep zero stats.
    }
    return result;
  }

  return {
    upsertContact(input: Omit<DingTalkContactRow, "lastSyncedAt"> & { lastSyncedAt?: string }): void {
      const lastSyncedAt = input.lastSyncedAt ?? nowIso();
      upsertContactStmt.run(
        input.userId,
        input.unionId ?? null,
        input.name,
        stringifyJson(input.departmentIds ?? []),
        stringifyJson(input.departmentNames ?? []),
        input.position ?? null,
        input.jobNumber ?? null,
        input.mobileMasked ?? null,
        input.emailMasked ?? null,
        input.active ? 1 : 0,
        input.isAdmin ? 1 : 0,
        input.isBoss ? 1 : 0,
        input.isSenior ? 1 : 0,
        input.rawJson ? stringifyJson(input.rawJson) : null,
        lastSyncedAt,
        input.deletedAt ?? null,
      );
    },

    deactivateContact(userId: string, deletedAt = nowIso()): void {
      db.prepare("UPDATE dingtalk_contacts SET active = 0, deleted_at = ?, last_synced_at = ? WHERE user_id = ?")
        .run(deletedAt, deletedAt, userId);
    },

    getContact(userId: string): DingTalkContactRow | undefined {
      const row = findContactStmt.get(userId) as Record<string, unknown> | undefined;
      return row ? mapContactRow(row) : undefined;
    },

    listContacts(): DingTalkContactRow[] {
      return (listContactsStmt.all() as Array<Record<string, unknown>>).map(mapContactRow);
    },

    searchContacts(keyword: string, limit = 50): DingTalkContactRow[] {
      const normalized = keyword.trim().toLowerCase();
      const lim = Math.max(1, Math.trunc(limit));
      return (
        searchContactsStmt.all(
          normalized,
          normalized,
          normalized,
          normalized,
          normalized,
          normalized,
          lim,
        ) as Array<Record<string, unknown>>
      ).map(mapContactRow);
    },

    listActiveContactsByExactName(name: string): DingTalkContactRow[] {
      const needle = name.trim();
      if (!needle) return [];
      const rows = db
        .prepare(
          `SELECT * FROM dingtalk_contacts
            WHERE active = 1 AND TRIM(name) = ?
            ORDER BY last_synced_at DESC, user_id ASC`,
        )
        .all(needle) as Array<Record<string, unknown>>;
      return rows.map(mapContactRow);
    },

    resolveContactByName(name: string): {
      contact?: DingTalkContactRow;
      ambiguous?: boolean;
      candidates?: DingTalkContactRow[];
    } {
      const candidates = this.listActiveContactsByExactName(name);
      if (candidates.length === 0) return {};
      if (candidates.length === 1) return { contact: candidates[0] };

      const score = (c: DingTalkContactRow): number => {
        let s = 0;
        const usedInTasks = db
          .prepare(
            `SELECT 1 FROM subtasks WHERE assignee_user_id = ?
             UNION SELECT 1 FROM tasks WHERE manager_user_id = ? LIMIT 1`,
          )
          .get(c.userId, c.userId);
        if (usedInTasks) s += 100;
        if (c.unionId) s += 10;
        if (c.lastSyncedAt) s += 1;
        return s;
      };
      const sorted = [...candidates].sort((a, b) => score(b) - score(a) || a.userId.localeCompare(b.userId));
      return { contact: sorted[0], ambiguous: true, candidates };
    },

    upsertProfile(input: Omit<EmployeeCapabilityProfileRow, "updatedAt"> & { updatedAt?: string }): void {
      const updatedAt = input.updatedAt ?? nowIso();
      upsertProfileStmt.run(
        input.userId,
        stringifyJson(input.skillTags ?? []),
        stringifyJson(input.strengths ?? []),
        stringifyJson(input.boundaries ?? []),
        stringifyJson(input.cases ?? []),
        stringifyJson(input.tools ?? []),
        stringifyJson(input.availability ?? {}),
        input.background ?? null,
        input.source ?? null,
        input.selfUpdatedAt ?? null,
        input.managerVerifiedAt ?? null,
        input.managerVerifiedBy ?? null,
        updatedAt,
      );
    },

    /**
     * Employee self-service PATCH merge: omitted JSON fields keep DB values;
     * `cases: []` does not wipe agent-populated cases; non-empty `cases` merges by outcome.
     * `manager_verified_*` are never cleared by this path (employee cannot unset).
     */
    mergeSelfServiceProfile(userId: string, body: Record<string, unknown>): void {
      const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
      const existing = this.getProfile(userId);
      const base: EmployeeCapabilityProfileRow = existing ?? {
        userId,
        skillTags: [],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: {},
        updatedAt: nowIso(),
      };

      const toStringArray = (value: unknown): string[] =>
        Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];

      const skillTags = has("skillTags") ? toStringArray(body.skillTags) : base.skillTags;
      const strengths = has("strengths") ? toStringArray(body.strengths) : base.strengths;
      const boundaries = has("boundaries") ? toStringArray(body.boundaries) : base.boundaries;
      const tools = has("tools") ? toStringArray(body.tools) : base.tools;

      let availability = base.availability;
      if (has("availability") && body.availability && typeof body.availability === "object") {
        const ar = body.availability as Record<string, unknown>;
        availability = {
          capacityHint:
            ar.capacityHint !== undefined
              ? String(ar.capacityHint ?? "").trim() || undefined
              : base.availability.capacityHint,
          emergencyOk:
            typeof ar.emergencyOk === "boolean" ? ar.emergencyOk : base.availability.emergencyOk,
          rejectedTaskTypes:
            ar.rejectedTaskTypes !== undefined
              ? toStringArray(ar.rejectedTaskTypes)
              : base.availability.rejectedTaskTypes,
        };
        if (!availability.capacityHint) delete availability.capacityHint;
        if (availability.emergencyOk === undefined) delete availability.emergencyOk;
        if (!availability.rejectedTaskTypes?.length) delete availability.rejectedTaskTypes;
      }

      let cases = base.cases;
      if (has("cases") && Array.isArray(body.cases)) {
        const incoming: EmployeeCapabilityProfileRow["cases"] = [];
        for (const item of body.cases as unknown[]) {
          const row = item as Record<string, unknown>;
          const taskType = String(row.taskType ?? "").trim();
          const outcome = String(row.outcome ?? "").trim();
          if (!taskType || !outcome) continue;
          incoming.push({
            taskType,
            contribution: String(row.contribution ?? "").trim() || undefined,
            deliverable: String(row.deliverable ?? "").trim() || undefined,
            outcome,
          });
        }
        if (incoming.length > 0) {
          cases = mergeCasesByOutcome(base.cases, incoming);
        }
      }

      let background = base.background;
      if (has("background")) {
        background = typeof body.background === "string" ? body.background : base.background;
      }

      this.upsertProfile({
        userId,
        skillTags,
        strengths,
        boundaries,
        cases,
        tools,
        availability,
        background,
        source: "employee_self_service",
        selfUpdatedAt: new Date().toISOString(),
        managerVerifiedAt: base.managerVerifiedAt,
        managerVerifiedBy: base.managerVerifiedBy,
      });
    },

    getProfile(userId: string): EmployeeCapabilityProfileRow | undefined {
      const row = findProfileStmt.get(userId) as Record<string, unknown> | undefined;
      return row ? mapProfileRow(row) : undefined;
    },

    listProfiles(): EmployeeCapabilityProfileRow[] {
      return (listProfilesStmt.all() as Array<Record<string, unknown>>).map(mapProfileRow);
    },

    appendProfileEvent(input: {
      userId: string;
      eventType: string;
      actorUserId?: string;
      payload?: Record<string, unknown>;
      occurredAt?: string;
    }): void {
      appendProfileEventStmt.run(
        input.userId,
        input.eventType,
        input.actorUserId ?? null,
        stringifyJson(input.payload ?? {}),
        input.occurredAt ?? nowIso(),
      );
    },

    appendSyncRun(input: {
      mode: "full" | "reconcile" | "event";
      status: "ok" | "failed";
      totalContacts: number;
      upsertedContacts: number;
      deactivatedContacts: number;
      errorText?: string;
      startedAt: string;
      finishedAt: string;
    }): void {
      syncRunStmt.run(
        input.mode,
        input.status,
        input.totalContacts,
        input.upsertedContacts,
        input.deactivatedContacts,
        input.errorText ?? null,
        input.startedAt,
        input.finishedAt,
      );
    },

    listEmployeeSnapshots(options?: {
      includeInactive?: boolean;
      keyword?: string;
    }): EmployeeDirectorySnapshot[] {
      const contacts = options?.keyword
        ? this.searchContacts(options.keyword, 200)
        : this.listContacts();
      const profiles = this.listProfiles();
      const profileMap = new Map(profiles.map((p) => [p.userId, p]));
      const taskStats = buildTaskStatsMap();
      const snapshots = contacts
        .filter((contact) => options?.includeInactive || contact.active)
        .map((contact) => {
          const snapshot = buildSnapshot(contact, profileMap.get(contact.userId));
          snapshot.taskHistory = taskStats.get(contact.userId) ?? snapshot.taskHistory;
          return snapshot;
        });
      for (const profile of profiles) {
        if (snapshots.some((item) => item.userId === profile.userId)) continue;
        const fallback = buildSnapshot(undefined, profile);
        fallback.taskHistory = taskStats.get(profile.userId) ?? fallback.taskHistory;
        if (options?.keyword) {
          const text = `${fallback.userId} ${fallback.displayName}`.toLowerCase();
          if (!text.includes(options.keyword.toLowerCase())) continue;
        }
        snapshots.push(fallback);
      }
      return snapshots;
    },

    getEmployeeSnapshot(userId: string): EmployeeDirectorySnapshot | undefined {
      const contact = this.getContact(userId);
      const profile = this.getProfile(userId);
      if (!contact && !profile) return undefined;
      const snapshot = buildSnapshot(contact, profile);
      const stats = buildTaskStatsMap().get(userId);
      if (stats) snapshot.taskHistory = stats;
      return snapshot;
    },

    upsertExternalAccount(input: {
      userId: string;
      username: string;
      password?: string;
      passwordHash?: string;
      displayName: string;
      enabled?: boolean;
      createdAt?: string;
      updatedAt?: string;
    }): void {
      const userId = String(input.userId ?? "").trim();
      const username = String(input.username ?? "").trim();
      const displayName = String(input.displayName ?? "").trim() || userId;
      if (!userId || !username) {
        throw new Error("userId and username are required");
      }
      const passwordHash = input.passwordHash
        ?? (input.password ? hashExternalAccountPassword(input.password) : "");
      if (!passwordHash) {
        throw new Error("password or passwordHash is required");
      }
      const now = nowIso();
      const createdAt = input.createdAt ?? now;
      const updatedAt = input.updatedAt ?? now;
      upsertExternalAccountStmt.run(
        userId,
        username,
        passwordHash,
        displayName,
        input.enabled === false ? 0 : 1,
        createdAt,
        updatedAt,
      );
    },

    getExternalAccountByUsername(username: string): ExternalWorkbenchAccountRow | undefined {
      const row = findExternalAccountByUsernameStmt.get(String(username ?? "").trim()) as
        | Record<string, unknown>
        | undefined;
      return row ? mapExternalAccountRow(row) : undefined;
    },

    getExternalAccountByUserId(userId: string): ExternalWorkbenchAccountRow | undefined {
      const row = findExternalAccountByUserIdStmt.get(String(userId ?? "").trim()) as
        | Record<string, unknown>
        | undefined;
      return row ? mapExternalAccountRow(row) : undefined;
    },

    verifyExternalAccountLogin(
      username: string,
      password: string,
    ): ExternalWorkbenchAccountRow | undefined {
      const account = this.getExternalAccountByUsername(username);
      if (!account || !account.enabled) return undefined;
      if (!verifyExternalAccountPassword(password, account.passwordHash)) return undefined;
      return account;
    },

    updateExternalAccountPassword(userId: string, newPassword: string): boolean {
      const normalized = String(userId ?? "").trim();
      if (!normalized) return false;
      const existing = this.getExternalAccountByUserId(normalized);
      if (!existing) return false;
      updateExternalAccountPasswordStmt.run(
        hashExternalAccountPassword(newPassword),
        nowIso(),
        normalized,
      );
      return true;
    },

    close(): void {
      db.close();
    },
  };
}
