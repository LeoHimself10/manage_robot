import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import type { QualityEventRecord } from "../domain/quality-types";

type DatabaseRow = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function eventFromRow(row: DatabaseRow): QualityEventRecord {
  return {
    eventId: String(row.id),
    eventNo: String(row.event_no),
    isTest: Number(row.is_test ?? 0) === 1,
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

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function createQualityReadStore(dbPath = resolveWorkbenchSqlitePath()) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");

  function syncState() {
    const row = db.prepare(`
      SELECT source_id, status, last_started_at, last_succeeded_at,
             last_failed_at, last_error, version, updated_at
      FROM quality_source_sync_state
      WHERE source_id = 'dingtalk-client-feedback'
    `).get() as DatabaseRow | undefined;
    return row ? {
      sourceId: String(row.source_id),
      status: String(row.status),
      lastStartedAt: nullableString(row.last_started_at),
      lastSucceededAt: nullableString(row.last_succeeded_at),
      lastFailedAt: nullableString(row.last_failed_at),
      lastError: nullableString(row.last_error),
      version: Number(row.version),
      updatedAt: String(row.updated_at),
      usingLastSuccessfulData: String(row.status) === "FAILED" && row.last_succeeded_at != null,
    } : null;
  }

  function listSourceRows(input: { q?: string; page?: number; pageSize?: number; reported?: boolean }) {
    const query = String(input.q ?? "").trim().toLocaleLowerCase("zh-CN");
    const page = positiveInt(input.page, 1, 1_000_000);
    const pageSize = positiveInt(input.pageSize, 50, 200);
    const rawRows = db.prepare(`
      SELECT r.*, e.id AS reported_event_id, e.event_no AS reported_event_no,
             e.status AS reported_event_status
      FROM quality_source_rows r
      LEFT JOIN quality_event_source_links l ON l.source_key = r.source_key
      LEFT JOIN quality_events e ON e.id = l.event_id AND e.is_test = 0 AND e.deleted_at IS NULL
      WHERE r.state <> 'DELETED'
      ORDER BY r.row_number DESC, r.source_key
    `).all() as DatabaseRow[];
    const filtered = rawRows.filter((row) => {
      if (input.reported === true && row.reported_event_id == null) return false;
      if (input.reported === false && row.reported_event_id != null) return false;
      if (!query) return true;
      const normalized = parseObject(row.normalized_json);
      return [
        normalized.feedbackNo,
        normalized.deviceModel,
        normalized.serialNo,
        normalized.catheterBatch,
        normalized.issueDescription,
        normalized.category,
      ].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query));
    });
    const start = (page - 1) * pageSize;
    return {
      rows: filtered.slice(start, start + pageSize).map((row) => {
        const normalized = parseObject(row.normalized_json);
        return {
          sourceKey: String(row.source_key),
          sheetName: String(row.sheet_name),
          rowNumber: Number(row.row_number),
          state: String(row.state),
          sourceVersion: Number(row.source_version),
          syncedAt: String(row.synced_at),
          ...normalized,
          rawSnapshot: parseObject(row.raw_snapshot_json),
          reportedEvent: row.reported_event_id == null ? null : {
            eventId: String(row.reported_event_id),
            eventNo: String(row.reported_event_no),
            status: String(row.reported_event_status),
          },
        };
      }),
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        pageCount: Math.ceil(filtered.length / pageSize),
      },
      sync: syncState(),
    };
  }

  function listCandidates(input?: { page?: number; pageSize?: number; status?: string }) {
    const page = positiveInt(input?.page, 1, 1_000_000);
    const pageSize = positiveInt(input?.pageSize, 50, 200);
    const status = String(input?.status ?? "OPEN").trim().toUpperCase();
    const rows = db.prepare(`
      SELECT * FROM quality_candidates
      WHERE (? = '' OR status = ?)
      ORDER BY detected_at DESC, id
    `).all(status, status) as DatabaseRow[];
    const start = (page - 1) * pageSize;
    const candidateRows = rows.slice(start, start + pageSize);
    const candidateSourceKeys = [...new Set(candidateRows.flatMap((row) =>
      parseArray(row.source_keys_json).map((sourceKey) => String(sourceKey)).filter(Boolean),
    ))];
    const sourceRowsByKey = new Map<string, {
      sourceKey: string;
      rowNumber: number;
      feedbackNo?: string;
      deviceModel?: string;
      category?: string;
      issueDescription?: string;
    }>();
    if (candidateSourceKeys.length > 0) {
      const placeholders = candidateSourceKeys.map(() => "?").join(",");
      const sourceRows = db.prepare(`
        SELECT source_key, row_number, normalized_json
        FROM quality_source_rows
        WHERE source_key IN (${placeholders})
      `).all(...candidateSourceKeys) as DatabaseRow[];
      sourceRows.forEach((row) => {
        const normalized = parseObject(row.normalized_json);
        sourceRowsByKey.set(String(row.source_key), {
          sourceKey: String(row.source_key),
          rowNumber: Number(row.row_number),
          feedbackNo: nullableString(normalized.feedbackNo) ?? undefined,
          deviceModel: nullableString(normalized.deviceModel) ?? undefined,
          category: nullableString(normalized.category) ?? undefined,
          issueDescription: nullableString(normalized.issueDescription) ?? undefined,
        });
      });
    }
    return {
      candidates: candidateRows.map((row) => ({
        id: String(row.id),
        candidateType: String(row.candidate_type),
        status: String(row.status),
        score: row.score == null ? null : Number(row.score),
        ruleCodes: parseArray(row.rule_codes_json),
        sourceKeys: parseArray(row.source_keys_json),
        sourceRows: parseArray(row.source_keys_json)
          .map((sourceKey) => sourceRowsByKey.get(String(sourceKey)))
          .filter((sourceRow): sourceRow is NonNullable<typeof sourceRow> => sourceRow != null),
        explanation: parseObject(row.explanation_json),
        detectedAt: String(row.detected_at),
        decisionReason: nullableString(row.decision_reason),
        version: Number(row.version),
      })),
      pagination: { page, pageSize, total: rows.length, pageCount: Math.ceil(rows.length / pageSize) },
    };
  }

  function listEvents(input: {
    actorUserId: string;
    isQualitySpecialist: boolean;
    page?: number;
    pageSize?: number;
    includeDrafts?: boolean;
  }) {
    const page = positiveInt(input.page, 1, 1_000_000);
    const pageSize = positiveInt(input.pageSize, 50, 200);
    const rows = (input.isQualitySpecialist
      ? db.prepare(`
          SELECT * FROM quality_events
          WHERE deleted_at IS NULL AND is_test = 0 AND status <> 'DRAFT'
          ORDER BY updated_at DESC, id
        `).all()
      : db.prepare(`
          SELECT * FROM quality_events
          WHERE deleted_at IS NULL AND is_test = 0 AND created_by = ?
            AND (? = 1 OR status <> 'DRAFT')
          ORDER BY updated_at DESC, id
        `).all(input.actorUserId, input.includeDrafts === false ? 0 : 1)) as DatabaseRow[];
    const start = (page - 1) * pageSize;
    return {
      events: rows.slice(start, start + pageSize).map(eventFromRow),
      pagination: { page, pageSize, total: rows.length, pageCount: Math.ceil(rows.length / pageSize) },
    };
  }

  function getEventDetail(input: {
    eventId: string;
    actorUserId: string;
    isQualitySpecialist: boolean;
  }) {
    const row = db.prepare("SELECT * FROM quality_events WHERE id = ? AND is_test = 0 AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!row) return null;
    const event = eventFromRow(row);
    const visible = event.createdBy === input.actorUserId
      || (input.isQualitySpecialist && event.status !== "DRAFT");
    if (!visible) return null;
    const sourceSnapshots = (db.prepare(`
      SELECT source_key, source_snapshot_json, source_version, source_state_at_link, linked_at
      FROM quality_event_source_links WHERE event_id = ? ORDER BY linked_at, rowid
    `).all(input.eventId) as DatabaseRow[]).map((source) => ({
      sourceKey: String(source.source_key),
      sourceVersion: Number(source.source_version),
      sourceState: String(source.source_state_at_link),
      linkedAt: String(source.linked_at),
      snapshot: parseObject(source.source_snapshot_json),
    }));
    const supplements = (db.prepare(`
      SELECT id, kind, content, reason, created_by, created_at, version
      FROM quality_event_supplements WHERE event_id = ? ORDER BY created_at, rowid
    `).all(input.eventId) as DatabaseRow[]).map((item) => ({
      id: String(item.id),
      kind: String(item.kind),
      content: String(item.content),
      reason: nullableString(item.reason),
      createdBy: String(item.created_by),
      createdAt: String(item.created_at),
      version: Number(item.version),
    }));
    const files = (db.prepare(`
      SELECT id, original_name, mime_type, size_bytes, sha256, uploaded_by, created_at
      FROM quality_report_files
      WHERE event_id = ? AND status = 'ACTIVE' ORDER BY created_at, rowid
    `).all(input.eventId) as DatabaseRow[]).map((file) => ({
      id: String(file.id),
      originalName: String(file.original_name),
      mimeType: String(file.mime_type),
      sizeBytes: Number(file.size_bytes),
      sha256: String(file.sha256),
      uploadedBy: String(file.uploaded_by),
      createdAt: String(file.created_at),
    }));
    return { event, sourceSnapshots, supplements, files };
  }

  function listManagerAssignmentNodes(userId: string) {
    const hasPlanningTable = Boolean(db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_planning_sessions'
    `).get());
    const rows = db.prepare(`
      SELECT n.*, e.event_no, e.title AS event_title, e.problem_status, e.status AS event_status,
             e.version AS event_version,
             e.overall_due_at, e.primary_node_id,
             parent.assignee_user_id AS parent_assignee_user_id,
             primary_node.assignee_user_id AS primary_assignee_user_id,
             l.task_id, l.subtask_id,
             root_task.manager_user_id AS specialist_user_id,
             root_task.plan_id AS formal_plan_id,
             ${hasPlanningTable ? "CASE WHEN EXISTS (SELECT 1 FROM quality_planning_sessions qp WHERE qp.event_id=n.event_id) THEN 1 ELSE 0 END" : "0"} AS planning_v2
      FROM quality_assignment_nodes n
      JOIN quality_events e ON e.id = n.event_id AND e.deleted_at IS NULL
      LEFT JOIN quality_assignment_nodes parent ON parent.node_id = n.parent_node_id
      LEFT JOIN quality_assignment_nodes primary_node ON primary_node.node_id = e.primary_node_id
      LEFT JOIN quality_task_links l ON l.node_id = n.node_id
      LEFT JOIN quality_assignment_nodes root_node
        ON root_node.node_id = COALESCE(e.primary_node_id, (
          SELECT r.node_id FROM quality_assignment_nodes r
          WHERE r.event_id = e.id AND r.parent_node_id IS NULL
          ORDER BY r.created_at LIMIT 1
        ))
      LEFT JOIN quality_task_links root_link ON root_link.node_id = root_node.node_id
      LEFT JOIN tasks root_task ON root_task.task_id = root_link.task_id
      WHERE n.assignee_user_id = ? AND n.assignee_kind = 'MANAGER'
        AND n.status NOT IN ('REJECTED','CANCELLED')
      ORDER BY CASE n.status WHEN 'PENDING_ACCEPTANCE' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END,
               n.updated_at DESC
    `).all(userId) as DatabaseRow[];
    return rows.map((row) => {
      const reviewChildren = (db.prepare(`
        SELECT c.*, COALESCE(ev.evidence_count,0) AS evidence_count
        FROM quality_assignment_nodes c
        LEFT JOIN (
          SELECT node_id,COUNT(*) AS evidence_count FROM quality_evidence GROUP BY node_id
        ) ev ON ev.node_id = c.node_id
        WHERE c.parent_node_id = ? AND c.status = 'PENDING_PARENT_REVIEW'
        ORDER BY c.submitted_at,c.created_at,c.node_id
      `).all(String(row.node_id)) as DatabaseRow[]).map((child) => ({
        ...assignmentNodeFromReadRow(child),
        evidenceCount: Number(child.evidence_count),
        evidence: (db.prepare(`
          SELECT evidence_id,evidence_version,original_name,mime_type,summary,size_bytes,uploaded_by,created_at
          FROM quality_evidence WHERE node_id = ? ORDER BY evidence_version,created_at,evidence_id
        `).all(String(child.node_id)) as DatabaseRow[]).map((item) => ({
          evidenceId: String(item.evidence_id), evidenceVersion: Number(item.evidence_version), originalName: String(item.original_name),
          mimeType: String(item.mime_type), summary: String(item.summary ?? ""), sizeBytes: Number(item.size_bytes),
          uploadedBy: String(item.uploaded_by), createdAt: String(item.created_at),
        })),
      }));
      return {
        ...assignmentNodeFromReadRow(row),
        eventNo: String(row.event_no),
        eventTitle: String(row.event_title),
        eventSummary: String(row.problem_status),
        eventStatus: String(row.event_status),
        eventVersion: Number(row.event_version),
        overallDueAt: nullableString(row.overall_due_at),
        primaryNodeId: nullableString(row.primary_node_id),
        primaryAssigneeUserId: nullableString(row.primary_assignee_user_id),
        parentAssigneeUserId: nullableString(row.parent_assignee_user_id),
        specialistUserId: nullableString(row.specialist_user_id),
        taskId: nullableString(row.task_id),
        subtaskId: nullableString(row.subtask_id),
        formalPlanId: nullableString(row.formal_plan_id),
        planningV2: Number(row.planning_v2) === 1,
        reviewChildren,
      };
    });
  }

  return {
    syncState,
    listSourceRows,
    listCandidates,
    listEvents,
    getEventDetail,
    listManagerAssignmentNodes,
    close: () => db.close(),
  };
}

function assignmentNodeFromReadRow(row: DatabaseRow) {
  return {
    nodeId: String(row.node_id),
    eventId: String(row.event_id),
    parentNodeId: nullableString(row.parent_node_id),
    depth: Number(row.depth),
    assigneeUserId: String(row.assignee_user_id),
    assigneeKind: String(row.assignee_kind),
    departmentName: String(row.department_name),
    isPrimary: Number(row.is_primary) === 1,
    status: String(row.status),
    dueAt: String(row.due_at),
    requirement: String(row.requirement),
    version: Number(row.version),
    acceptedAt: nullableString(row.accepted_at),
    submittedAt: nullableString(row.submitted_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function hasQualityAssignmentNodesForUser(
  userId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): boolean {
  if (!userId.trim() || !existsSync(dbPath)) return false;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const table = db.prepare(`
      SELECT 1 AS found FROM sqlite_master
      WHERE type = 'table' AND name = 'quality_assignment_nodes'
    `).get();
    if (!table) return false;
    return Boolean(db.prepare(`
      SELECT 1 AS found FROM quality_assignment_nodes
      WHERE assignee_user_id = ? AND assignee_kind = 'MANAGER'
        AND status NOT IN ('REJECTED','CANCELLED') LIMIT 1
    `).get(userId));
  } catch {
    return false;
  } finally {
    db.close();
  }
}
