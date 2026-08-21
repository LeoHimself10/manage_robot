import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import type {
  CreateQualityDraftInput,
  QualityAuditActorRole,
  QualityAuditEvent,
  QualityAssignmentNode,
  QualityDraftPatch,
  QualityEventRecord,
  QualityNodeReview,
  QualitySourceSnapshot,
  QualityTaskLink,
} from "../domain/quality-types";

const QUALITY_SCHEMA_SQL = String.raw`
CREATE TABLE IF NOT EXISTS quality_source_sync_state (
  source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('IDLE','RUNNING','SUCCEEDED','FAILED')),
  last_started_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  last_error TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_source_rows (
  source_key TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK(row_number >= 1),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','UPDATED','DELETED')),
  source_version INTEGER NOT NULL DEFAULT 1 CHECK(source_version >= 1),
  content_hash TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  raw_snapshot_json TEXT NOT NULL,
  previous_snapshot_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_updated_at TEXT,
  synced_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_quality_source_rows_state_seen
ON quality_source_rows(state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS quality_candidates (
  id TEXT PRIMARY KEY,
  candidate_type TEXT NOT NULL CHECK(candidate_type IN ('ANOMALY','DATA_INCOMPLETE')),
  status TEXT NOT NULL CHECK(status IN ('OPEN','DISMISSED','REPORTED')),
  score REAL,
  rule_codes_json TEXT NOT NULL,
  source_keys_json TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_candidates_status_detected
ON quality_candidates(status, detected_at DESC);

CREATE TABLE IF NOT EXISTS quality_source_assessments (
  source_key TEXT PRIMARY KEY REFERENCES quality_source_rows(source_key),
  source_version INTEGER NOT NULL CHECK(source_version >= 1),
  handling_recommendation TEXT NOT NULL CHECK(handling_recommendation IN (
    'ORDINARY','NEEDS_INFO','QUALITY_ANOMALY'
  )),
  primary_category_code TEXT NOT NULL,
  secondary_category_code TEXT NOT NULL,
  category_mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(category_mode IN (
    'STANDARD','CUSTOM_SECONDARY','CUSTOM_FULL'
  )),
  custom_primary_category_name TEXT,
  custom_secondary_category_name TEXT,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW','MEDIUM','HIGH')),
  conclusion TEXT NOT NULL CHECK(length(conclusion) BETWEEN 1 AND 10000),
  adoption_mode TEXT NOT NULL CHECK(adoption_mode IN ('MANUAL','DIRECT','MODIFIED')),
  change_reason TEXT,
  reviewed_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_source_assessments_updated
ON quality_source_assessments(updated_at DESC);

CREATE TABLE IF NOT EXISTS quality_events (
  id TEXT PRIMARY KEY,
  event_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN (
    'DRAFT','PENDING_ASSIGNMENT','PENDING_ACCEPTANCE','IN_PROGRESS',
    'PENDING_PRIMARY_REVIEW','PENDING_QUALITY_REVIEW','CLOSED'
  )),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  problem_status TEXT NOT NULL CHECK(length(problem_status) BETWEEN 1 AND 10000),
  occurred_at TEXT,
  feedback_at TEXT,
  feedback_user_id TEXT,
  feedback_name TEXT,
  device_model TEXT,
  device_serial TEXT,
  catheter_batch TEXT,
  clinician_aware TEXT,
  impact TEXT,
  initial_category TEXT,
  urgency TEXT CHECK(urgency IS NULL OR urgency IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  supplement TEXT,
  created_by TEXT NOT NULL,
  submitted_by TEXT,
  submitted_at TEXT,
  original_primary_department_id TEXT,
  overall_due_at TEXT,
  primary_node_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_events_status_updated
ON quality_events(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS quality_event_source_links (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  source_key TEXT NOT NULL UNIQUE,
  source_version INTEGER NOT NULL CHECK(source_version >= 1),
  source_state_at_link TEXT NOT NULL CHECK(source_state_at_link IN ('ACTIVE','UPDATED','DELETED')),
  source_snapshot_json TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_event_source_links_event
ON quality_event_source_links(event_id, linked_at);

CREATE TABLE IF NOT EXISTS quality_event_relations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  relation_type TEXT NOT NULL,
  related_event_id TEXT REFERENCES quality_events(id),
  related_source_key TEXT,
  relation_snapshot_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(related_event_id IS NOT NULL OR related_source_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_quality_event_relations_event
ON quality_event_relations(event_id, created_at);

CREATE TABLE IF NOT EXISTS quality_event_supplements (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_quality_event_supplements_event
ON quality_event_supplements(event_id, created_at);

CREATE TABLE IF NOT EXISTS quality_report_files (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  draft_version INTEGER NOT NULL CHECK(draft_version >= 1),
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_quality_report_files_event
ON quality_report_files(event_id, created_at);

CREATE TABLE IF NOT EXISTS quality_audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_audit_events_event_occurred
ON quality_audit_events(event_id, occurred_at, id);

CREATE TRIGGER IF NOT EXISTS quality_audit_events_no_update
BEFORE UPDATE ON quality_audit_events
BEGIN
  SELECT RAISE(ABORT, 'quality audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS quality_audit_events_no_delete
BEFORE DELETE ON quality_audit_events
BEGIN
  SELECT RAISE(ABORT, 'quality audit events are append-only');
END;

CREATE TABLE IF NOT EXISTS quality_assignment_nodes (
  node_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  parent_node_id TEXT REFERENCES quality_assignment_nodes(node_id),
  depth INTEGER NOT NULL CHECK(depth >= 0),
  assignee_user_id TEXT NOT NULL,
  assignee_kind TEXT NOT NULL CHECK(assignee_kind IN ('MANAGER','EMPLOYEE')),
  department_name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  status TEXT NOT NULL CHECK(status IN (
    'PENDING_ACCEPTANCE','IN_PROGRESS','PENDING_PARENT_REVIEW','APPROVED',
    'REJECTED','RETURNED','CANCELLED'
  )),
  due_at TEXT NOT NULL,
  requirement TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  accepted_at TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_assignment_nodes_event_parent
ON quality_assignment_nodes(event_id, parent_node_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_assignment_nodes_primary
ON quality_assignment_nodes(event_id) WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS quality_task_links (
  node_id TEXT PRIMARY KEY REFERENCES quality_assignment_nodes(node_id),
  task_id TEXT NOT NULL UNIQUE,
  subtask_id TEXT NOT NULL UNIQUE,
  integration_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_evidence (
  evidence_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  node_id TEXT NOT NULL REFERENCES quality_assignment_nodes(node_id),
  evidence_version INTEGER NOT NULL CHECK(evidence_version >= 1),
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(node_id, evidence_version, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_evidence_node_version
ON quality_evidence(node_id, evidence_version, created_at);

CREATE TABLE IF NOT EXISTS quality_node_reviews (
  review_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  node_id TEXT NOT NULL REFERENCES quality_assignment_nodes(node_id),
  reviewer_user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVE','RETURN')),
  reason TEXT,
  evidence_version INTEGER,
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_node_reviews_node
ON quality_node_reviews(node_id, created_at);

CREATE TABLE IF NOT EXISTS quality_private_threads (
  thread_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  specialist_user_id TEXT NOT NULL,
  report_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, specialist_user_id, report_user_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_private_threads_parties
ON quality_private_threads(specialist_user_id, report_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS quality_private_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES quality_private_threads(thread_id),
  sender_user_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_quality_private_messages_thread
ON quality_private_messages(thread_id, created_at, message_id);

CREATE TRIGGER IF NOT EXISTS quality_private_messages_no_update
BEFORE UPDATE ON quality_private_messages
BEGIN
  SELECT RAISE(ABORT, 'quality private messages are append-only');
END;

CREATE TRIGGER IF NOT EXISTS quality_private_messages_no_delete
BEFORE DELETE ON quality_private_messages
BEGIN
  SELECT RAISE(ABORT, 'quality private messages are append-only');
END;

CREATE TABLE IF NOT EXISTS quality_notification_outbox (
  notification_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES quality_events(id),
  action TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'DINGTALK',
  subject TEXT NOT NULL,
  markdown TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENDING','SENT','RETRY','DEAD')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  sending_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_quality_notification_outbox_due
ON quality_notification_outbox(status, next_attempt_at, created_at);
`;

type DatabaseRow = Record<string, unknown>;

export interface QualityStore {
  createDraft(input: CreateQualityDraftInput): QualityEventRecord;
  getEvent(eventId: string): QualityEventRecord | null;
  updateDraft(input: {
    eventId: string;
    actorUserId: string;
    actorRole: QualityAuditActorRole;
    requestId: string;
    expectedVersion: number;
    patch: QualityDraftPatch;
    reason?: string | null;
  }): QualityEventRecord;
  linkSourceToEvent(input: {
    eventId: string;
    actorUserId: string;
    actorRole: QualityAuditActorRole;
    requestId: string;
    source: QualitySourceSnapshot;
  }): void;
  listAuditEvents(eventId: string): QualityAuditEvent[];
  createAssignmentNode(input: Omit<QualityAssignmentNode,
    "version" | "acceptedAt" | "submittedAt" | "createdAt" | "updatedAt"
  >): QualityAssignmentNode;
  getAssignmentNode(nodeId: string): QualityAssignmentNode | null;
  listDirectChildren(nodeId: string): QualityAssignmentNode[];
  listAncestors(nodeId: string): QualityAssignmentNode[];
  updateAssignmentNode(input: {
    nodeId: string;
    expectedVersion: number;
    patch: Partial<Pick<QualityAssignmentNode,
      "status" | "dueAt" | "requirement" | "acceptedAt" | "submittedAt" | "isPrimary"
    >>;
  }): QualityAssignmentNode;
  setPrimaryNode(input: {
    eventId: string;
    nodeId: string;
    expectedEventVersion: number;
    actorUserId: string;
    requestId: string;
  }): QualityEventRecord;
  createTaskLink(input: Omit<QualityTaskLink, "createdAt">): QualityTaskLink;
  getTaskLinkByNodeId(nodeId: string): QualityTaskLink | null;
  getAssignmentNodeBySubtaskId(subtaskId: string): QualityAssignmentNode | null;
  appendNodeReview(input: Omit<QualityNodeReview, "reviewId" | "createdAt"> & { reviewId?: string }): QualityNodeReview;
  listNodeReviews(nodeId: string): QualityNodeReview[];
  close(): void;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function eventFromRow(row: DatabaseRow): QualityEventRecord {
  return {
    eventId: String(row.id),
    eventNo: String(row.event_no),
    status: String(row.status) as QualityEventRecord["status"],
    title: String(row.title),
    problemStatus: String(row.problem_status),
    occurredAt: nullableString(row.occurred_at),
    feedbackAt: nullableString(row.feedback_at),
    feedbackUserId: nullableString(row.feedback_user_id),
    feedbackName: nullableString(row.feedback_name),
    deviceModel: nullableString(row.device_model),
    deviceSerial: nullableString(row.device_serial),
    catheterBatch: nullableString(row.catheter_batch),
    clinicianAware: nullableString(row.clinician_aware),
    impact: nullableString(row.impact),
    initialCategory: nullableString(row.initial_category),
    urgency: nullableString(row.urgency) as QualityEventRecord["urgency"],
    supplement: nullableString(row.supplement),
    createdBy: String(row.created_by),
    submittedBy: nullableString(row.submitted_by),
    submittedAt: nullableString(row.submitted_at),
    originalPrimaryDepartmentId: nullableString(row.original_primary_department_id),
    overallDueAt: nullableString(row.overall_due_at),
    primaryNodeId: nullableString(row.primary_node_id),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: nullableString(row.deleted_at),
  };
}

function assignmentNodeFromRow(row: DatabaseRow): QualityAssignmentNode {
  return {
    nodeId: String(row.node_id),
    eventId: String(row.event_id),
    parentNodeId: nullableString(row.parent_node_id),
    depth: Number(row.depth),
    assigneeUserId: String(row.assignee_user_id),
    assigneeKind: String(row.assignee_kind) as QualityAssignmentNode["assigneeKind"],
    departmentName: String(row.department_name),
    isPrimary: Number(row.is_primary) === 1,
    status: String(row.status) as QualityAssignmentNode["status"],
    dueAt: String(row.due_at),
    requirement: String(row.requirement),
    version: Number(row.version),
    createdBy: String(row.created_by),
    requestId: String(row.request_id),
    acceptedAt: nullableString(row.accepted_at),
    submittedAt: nullableString(row.submitted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function taskLinkFromRow(row: DatabaseRow): QualityTaskLink {
  return {
    nodeId: String(row.node_id),
    taskId: String(row.task_id),
    subtaskId: String(row.subtask_id),
    integrationKey: String(row.integration_key),
    createdAt: String(row.created_at),
  };
}

function nodeReviewFromRow(row: DatabaseRow): QualityNodeReview {
  return {
    reviewId: String(row.review_id),
    eventId: String(row.event_id),
    nodeId: String(row.node_id),
    reviewerUserId: String(row.reviewer_user_id),
    decision: String(row.decision) as QualityNodeReview["decision"],
    reason: nullableString(row.reason),
    evidenceVersion: row.evidence_version == null ? null : Number(row.evidence_version),
    requestId: String(row.request_id),
    createdAt: String(row.created_at),
  };
}

function parseAuditJson(value: unknown): Record<string, unknown> | null {
  if (value == null || value === "") return null;
  const parsed = JSON.parse(String(value)) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function assertDraftText(title: string, problemStatus: string): void {
  const cleanTitle = title.trim();
  const cleanProblemStatus = problemStatus.trim();
  if (!cleanTitle || cleanTitle.length > 200) {
    throw new Error("title must contain 1 to 200 characters");
  }
  if (!cleanProblemStatus || cleanProblemStatus.length > 10000) {
    throw new Error("problem status must contain 1 to 10000 characters");
  }
}

function withTransaction<T>(db: DatabaseSync, operation: () => T): T {
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

export function createQualityStore(
  dbPath = resolveWorkbenchSqlitePath(),
  deps?: { now?: () => string; id?: () => string },
): QualityStore {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(QUALITY_SCHEMA_SQL);
  const qualityEventColumns = new Set(
    (db.prepare("PRAGMA table_info(quality_events)").all() as Array<{ name?: string }>)
      .map((row) => String(row.name ?? "")),
  );
  if (!qualityEventColumns.has("primary_node_id")) {
    db.exec("ALTER TABLE quality_events ADD COLUMN primary_node_id TEXT");
  }
  const qualityEvidenceColumns = new Set(
    (db.prepare("PRAGMA table_info(quality_evidence)").all() as Array<{ name?: string }>)
      .map((row) => String(row.name ?? "")),
  );
  if (!qualityEvidenceColumns.has("summary")) {
    db.exec("ALTER TABLE quality_evidence ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
  }
  if (!qualityEvidenceColumns.has("request_id")) {
    db.exec("ALTER TABLE quality_evidence ADD COLUMN request_id TEXT");
  }
  const qualityAssessmentColumns = new Set(
    (db.prepare("PRAGMA table_info(quality_source_assessments)").all() as Array<{ name?: string }>)
      .map((row) => String(row.name ?? "")),
  );
  if (!qualityAssessmentColumns.has("category_mode")) {
    db.exec("ALTER TABLE quality_source_assessments ADD COLUMN category_mode TEXT NOT NULL DEFAULT 'STANDARD' CHECK(category_mode IN ('STANDARD','CUSTOM_SECONDARY','CUSTOM_FULL'))");
  }
  if (!qualityAssessmentColumns.has("custom_primary_category_name")) {
    db.exec("ALTER TABLE quality_source_assessments ADD COLUMN custom_primary_category_name TEXT");
  }
  if (!qualityAssessmentColumns.has("custom_secondary_category_name")) {
    db.exec("ALTER TABLE quality_source_assessments ADD COLUMN custom_secondary_category_name TEXT");
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_evidence_request
    ON quality_evidence(request_id) WHERE request_id IS NOT NULL`);
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function getEvent(eventId: string): QualityEventRecord | null {
    const row = db.prepare(
      "SELECT * FROM quality_events WHERE id = ? AND deleted_at IS NULL",
    ).get(eventId) as
      | DatabaseRow
      | undefined;
    return row ? eventFromRow(row) : null;
  }

  function appendAudit(input: {
    eventId: string;
    actorUserId: string;
    actorRole: QualityAuditActorRole;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason?: string | null;
    requestId: string;
    occurredAt: string;
  }): void {
    db.prepare(`
      INSERT INTO quality_audit_events (
        id, event_id, actor_user_id, actor_role, action,
        before_json, after_json, reason, request_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id(),
      input.eventId,
      input.actorUserId,
      input.actorRole,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.reason ?? null,
      input.requestId,
      input.occurredAt,
    );
  }

  function createDraft(input: CreateQualityDraftInput): QualityEventRecord {
    assertDraftText(input.title, input.problemStatus);
    const occurredAt = now();
    return withTransaction(db, () => {
      db.prepare(`
        INSERT INTO quality_events (
          id, event_no, status, title, problem_status, occurred_at, feedback_at,
          feedback_user_id, feedback_name, device_model, device_serial, catheter_batch,
          clinician_aware, impact, initial_category, urgency, supplement, created_by,
          version, created_at, updated_at
        ) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        input.eventId,
        input.eventNo,
        input.title.trim(),
        input.problemStatus.trim(),
        input.occurredAt ?? null,
        input.feedbackAt ?? null,
        input.feedbackUserId ?? null,
        input.feedbackName ?? null,
        input.deviceModel ?? null,
        input.deviceSerial ?? null,
        input.catheterBatch ?? null,
        input.clinicianAware ?? null,
        input.impact ?? null,
        input.initialCategory ?? null,
        input.urgency ?? null,
        input.supplement ?? null,
        input.actorUserId,
        occurredAt,
        occurredAt,
      );
      const created = getEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: "DRAFT_CREATED",
        before: null,
        after: created as unknown as Record<string, unknown>,
        requestId: input.requestId,
        occurredAt,
      });
      return created;
    });
  }

  function updateDraft(input: {
    eventId: string;
    actorUserId: string;
    actorRole: QualityAuditActorRole;
    requestId: string;
    expectedVersion: number;
    patch: QualityDraftPatch;
    reason?: string | null;
  }): QualityEventRecord {
    const before = getEvent(input.eventId);
    if (!before) throw new Error("quality event not found");
    if (before.status !== "DRAFT") throw new Error("draft is no longer editable");
    if (before.createdBy !== input.actorUserId) throw new Error("draft owner mismatch");
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const next: QualityEventRecord = { ...before, ...input.patch };
    assertDraftText(next.title, next.problemStatus);
    const occurredAt = now();

    return withTransaction(db, () => {
      const result = db.prepare(`
        UPDATE quality_events SET
          title = ?, problem_status = ?, occurred_at = ?, feedback_at = ?,
          feedback_user_id = ?, feedback_name = ?, device_model = ?, device_serial = ?,
          catheter_batch = ?, clinician_aware = ?, impact = ?, initial_category = ?,
          urgency = ?, supplement = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'DRAFT' AND created_by = ?
          AND version = ? AND deleted_at IS NULL
      `).run(
        next.title.trim(),
        next.problemStatus.trim(),
        next.occurredAt,
        next.feedbackAt,
        next.feedbackUserId,
        next.feedbackName,
        next.deviceModel,
        next.deviceSerial,
        next.catheterBatch,
        next.clinicianAware,
        next.impact,
        next.initialCategory,
        next.urgency,
        next.supplement,
        occurredAt,
        input.eventId,
        input.actorUserId,
        input.expectedVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("version conflict");
      const saved = getEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: "DRAFT_UPDATED",
        before: before as unknown as Record<string, unknown>,
        after: saved as unknown as Record<string, unknown>,
        reason: input.reason,
        requestId: input.requestId,
        occurredAt,
      });
      return saved;
    });
  }

  function linkSourceToEvent(input: {
    eventId: string;
    actorUserId: string;
    actorRole: QualityAuditActorRole;
    requestId: string;
    source: QualitySourceSnapshot;
  }): void {
    if (!getEvent(input.eventId)) throw new Error("quality event not found");
    const occurredAt = now();
    try {
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO quality_event_source_links (
            id, event_id, source_key, source_version, source_state_at_link,
            source_snapshot_json, linked_by, linked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id(),
          input.eventId,
          input.source.sourceKey,
          input.source.sourceVersion,
          input.source.sourceState,
          JSON.stringify(input.source.snapshot),
          input.actorUserId,
          occurredAt,
        );
        appendAudit({
          eventId: input.eventId,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          action: "SOURCE_LINKED",
          before: null,
          after: {
            sourceKey: input.source.sourceKey,
            sourceVersion: input.source.sourceVersion,
            sourceState: input.source.sourceState,
          },
          requestId: input.requestId,
          occurredAt,
        });
      });
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: quality_event_source_links\.source_key/.test(error.message)) {
        throw new Error("source already reported");
      }
      throw error;
    }
  }

  function listAuditEvents(eventId: string): QualityAuditEvent[] {
    return (db.prepare(`
      SELECT * FROM quality_audit_events
      WHERE event_id = ?
      ORDER BY occurred_at, rowid
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      actorUserId: String(row.actor_user_id),
      actorRole: String(row.actor_role) as QualityAuditActorRole,
      action: String(row.action),
      before: parseAuditJson(row.before_json),
      after: parseAuditJson(row.after_json),
      reason: nullableString(row.reason),
      requestId: String(row.request_id),
      occurredAt: String(row.occurred_at),
    }));
  }

  function getAssignmentNode(nodeId: string): QualityAssignmentNode | null {
    const row = db.prepare("SELECT * FROM quality_assignment_nodes WHERE node_id = ?")
      .get(nodeId) as DatabaseRow | undefined;
    return row ? assignmentNodeFromRow(row) : null;
  }

  function createAssignmentNode(input: Omit<QualityAssignmentNode,
    "version" | "acceptedAt" | "submittedAt" | "createdAt" | "updatedAt"
  >): QualityAssignmentNode {
    const existing = db.prepare(
      "SELECT * FROM quality_assignment_nodes WHERE event_id = ? AND request_id = ?",
    ).get(input.eventId, input.requestId) as DatabaseRow | undefined;
    if (existing) {
      const node = assignmentNodeFromRow(existing);
      if (
        node.nodeId !== input.nodeId
        || node.parentNodeId !== input.parentNodeId
        || node.assigneeUserId !== input.assigneeUserId
        || node.dueAt !== input.dueAt
      ) throw new Error("quality assignment request conflict");
      return node;
    }
    if (!getEvent(input.eventId)) throw new Error("quality event not found");
    if (input.parentNodeId) {
      const parent = getAssignmentNode(input.parentNodeId);
      if (!parent || parent.eventId !== input.eventId) throw new Error("quality parent node not found");
      if (input.depth !== parent.depth + 1) throw new Error("quality node depth mismatch");
    } else if (input.depth !== 0) {
      throw new Error("quality root depth mismatch");
    }
    const occurredAt = now();
    db.prepare(`
      INSERT INTO quality_assignment_nodes (
        node_id, event_id, parent_node_id, depth, assignee_user_id, assignee_kind,
        department_name, is_primary, status, due_at, requirement, version,
        created_by, request_id, accepted_at, submitted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL, ?, ?)
    `).run(
      input.nodeId,
      input.eventId,
      input.parentNodeId,
      input.depth,
      input.assigneeUserId,
      input.assigneeKind,
      input.departmentName,
      input.isPrimary ? 1 : 0,
      input.status,
      input.dueAt,
      input.requirement,
      input.createdBy,
      input.requestId,
      occurredAt,
      occurredAt,
    );
    return getAssignmentNode(input.nodeId)!;
  }

  function listDirectChildren(nodeId: string): QualityAssignmentNode[] {
    return (db.prepare(`
      SELECT * FROM quality_assignment_nodes WHERE parent_node_id = ?
      ORDER BY created_at, node_id
    `).all(nodeId) as DatabaseRow[]).map(assignmentNodeFromRow);
  }

  function listAncestors(nodeId: string): QualityAssignmentNode[] {
    return (db.prepare(`
      WITH RECURSIVE ancestors(node_id, parent_node_id, distance) AS (
        SELECT parent_node_id, NULL, 1 FROM quality_assignment_nodes WHERE node_id = ?
        UNION ALL
        SELECT n.parent_node_id, NULL, a.distance + 1
        FROM ancestors a JOIN quality_assignment_nodes n ON n.node_id = a.node_id
        WHERE a.node_id IS NOT NULL
      )
      SELECT n.*, a.distance FROM ancestors a
      JOIN quality_assignment_nodes n ON n.node_id = a.node_id
      ORDER BY a.distance
    `).all(nodeId) as DatabaseRow[]).map(assignmentNodeFromRow);
  }

  function updateAssignmentNode(input: {
    nodeId: string;
    expectedVersion: number;
    patch: Partial<Pick<QualityAssignmentNode,
      "status" | "dueAt" | "requirement" | "acceptedAt" | "submittedAt" | "isPrimary"
    >>;
  }): QualityAssignmentNode {
    const before = getAssignmentNode(input.nodeId);
    if (!before) throw new Error("quality assignment node not found");
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const next = { ...before, ...input.patch };
    const occurredAt = now();
    const result = db.prepare(`
      UPDATE quality_assignment_nodes SET
        status = ?, due_at = ?, requirement = ?, accepted_at = ?, submitted_at = ?,
        is_primary = ?, version = version + 1, updated_at = ?
      WHERE node_id = ? AND version = ?
    `).run(
      next.status,
      next.dueAt,
      next.requirement,
      next.acceptedAt,
      next.submittedAt,
      next.isPrimary ? 1 : 0,
      occurredAt,
      input.nodeId,
      input.expectedVersion,
    );
    if (Number(result.changes) !== 1) throw new Error("version conflict");
    return getAssignmentNode(input.nodeId)!;
  }

  function setPrimaryNode(input: {
    eventId: string;
    nodeId: string;
    expectedEventVersion: number;
    actorUserId: string;
    requestId: string;
  }): QualityEventRecord {
    const before = getEvent(input.eventId);
    const node = getAssignmentNode(input.nodeId);
    if (!before || !node || node.eventId !== input.eventId) throw new Error("quality event or node not found");
    if (before.primaryNodeId === input.nodeId) return before;
    if (before.primaryNodeId && before.primaryNodeId !== input.nodeId) {
      throw new Error("primary quality owner is immutable");
    }
    if (before.version !== input.expectedEventVersion) throw new Error("version conflict");
    const occurredAt = now();
    return withTransaction(db, () => {
      const updated = db.prepare(`
        UPDATE quality_events SET primary_node_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND primary_node_id IS NULL
      `).run(input.nodeId, occurredAt, input.eventId, input.expectedEventVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare("UPDATE quality_assignment_nodes SET is_primary = 1 WHERE node_id = ?")
        .run(input.nodeId);
      const after = getEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        actorRole: "department_manager",
        action: "PRIMARY_OWNER_ACCEPTED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        requestId: input.requestId,
        occurredAt,
      });
      return after;
    });
  }

  function getTaskLinkByNodeId(nodeId: string): QualityTaskLink | null {
    const row = db.prepare("SELECT * FROM quality_task_links WHERE node_id = ?")
      .get(nodeId) as DatabaseRow | undefined;
    return row ? taskLinkFromRow(row) : null;
  }

  function createTaskLink(input: Omit<QualityTaskLink, "createdAt">): QualityTaskLink {
    const existing = getTaskLinkByNodeId(input.nodeId);
    if (existing) {
      if (
        existing.taskId !== input.taskId
        || existing.subtaskId !== input.subtaskId
        || existing.integrationKey !== input.integrationKey
      ) throw new Error("quality task link conflict");
      return existing;
    }
    if (!getAssignmentNode(input.nodeId)) throw new Error("quality assignment node not found");
    const occurredAt = now();
    db.prepare(`
      INSERT INTO quality_task_links(node_id, task_id, subtask_id, integration_key, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.nodeId, input.taskId, input.subtaskId, input.integrationKey, occurredAt);
    return getTaskLinkByNodeId(input.nodeId)!;
  }

  function getAssignmentNodeBySubtaskId(subtaskId: string): QualityAssignmentNode | null {
    const row = db.prepare(`
      SELECT n.* FROM quality_task_links l
      JOIN quality_assignment_nodes n ON n.node_id = l.node_id
      WHERE l.subtask_id = ?
    `).get(subtaskId) as DatabaseRow | undefined;
    return row ? assignmentNodeFromRow(row) : null;
  }

  function appendNodeReview(
    input: Omit<QualityNodeReview, "reviewId" | "createdAt"> & { reviewId?: string },
  ): QualityNodeReview {
    const existing = db.prepare("SELECT * FROM quality_node_reviews WHERE request_id = ?")
      .get(input.requestId) as DatabaseRow | undefined;
    if (existing) return nodeReviewFromRow(existing);
    if (!getAssignmentNode(input.nodeId)) throw new Error("quality assignment node not found");
    const reviewId = input.reviewId ?? id();
    const occurredAt = now();
    db.prepare(`
      INSERT INTO quality_node_reviews (
        review_id, event_id, node_id, reviewer_user_id, decision, reason,
        evidence_version, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId,
      input.eventId,
      input.nodeId,
      input.reviewerUserId,
      input.decision,
      input.reason,
      input.evidenceVersion,
      input.requestId,
      occurredAt,
    );
    return nodeReviewFromRow(db.prepare("SELECT * FROM quality_node_reviews WHERE review_id = ?")
      .get(reviewId) as DatabaseRow);
  }

  function listNodeReviews(nodeId: string): QualityNodeReview[] {
    return (db.prepare(`
      SELECT * FROM quality_node_reviews WHERE node_id = ? ORDER BY created_at, review_id
    `).all(nodeId) as DatabaseRow[]).map(nodeReviewFromRow);
  }

  return {
    createDraft,
    getEvent,
    updateDraft,
    linkSourceToEvent,
    listAuditEvents,
    createAssignmentNode,
    getAssignmentNode,
    listDirectChildren,
    listAncestors,
    updateAssignmentNode,
    setPrimaryNode,
    createTaskLink,
    getTaskLinkByNodeId,
    getAssignmentNodeBySubtaskId,
    appendNodeReview,
    listNodeReviews,
    close: () => db.close(),
  };
}
