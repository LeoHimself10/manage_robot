import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { listQualitySpecialistUserIds } from "../../security/quality-capabilities";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";
import { markLinkedSourcesReported } from "../reviews/quality-source-review-service";
import {
  qualityAssessmentCategoryDisplayName,
  type QualityAssessmentCategoryMode,
} from "../reviews/quality-source-assessment-service";
import type {
  QualityAuditActorRole,
  QualityAuditEvent,
  QualityEventRecord,
} from "../domain/quality-types";
import {
  qualityDraftFieldsSchema,
  qualityDraftPatchSchema,
  type QualityDraftFields,
  type QualityDraftPatchInput,
} from "./quality-event-schema";

export interface QualityEventActor {
  userId: string;
  role: QualityAuditActorRole;
}

export interface QualityDraftCreationResult {
  created: boolean;
  event: QualityEventRecord;
}

export interface QualityEventService {
  createDraftFromSources(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKeys: string[];
    overrides?: Partial<QualityDraftFields>;
  }): QualityDraftCreationResult;
  createDraftFromAssessment(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKey: string;
    expectedAssessmentVersion: number;
    overrides?: Partial<QualityDraftFields>;
  }): QualityDraftCreationResult;
  createManualDraft(input: {
    actor: QualityEventActor;
    requestId: string;
    draft: QualityDraftFields;
    similarEventIds?: string[];
    independentReason?: string;
  }): QualityDraftCreationResult;
  createRelatedIndependentDraft(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKeys: string[];
    draft: QualityDraftFields;
    relatedEventId: string;
    reason: string;
  }): QualityDraftCreationResult;
  getDraftForCreator(input: { actor: QualityEventActor; eventId: string }): QualityEventRecord;
  updateDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    patch: QualityDraftPatchInput;
    reason?: string;
  }): QualityEventRecord;
  deleteDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    reason: string;
  }): void;
  submitDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
  }): QualityEventRecord;
  dismissCandidate(input: {
    actor: QualityEventActor;
    candidateId: string;
    expectedVersion: number;
    reason: string;
  }): void;
  addSourcesToDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    sourceKeys: string[];
  }): QualityEventRecord;
  addSourceToActiveEvent(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    sourceKeys: string[];
    reason: string;
  }): QualityEventRecord;
  addSupplement(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    content: string;
  }): { event: QualityEventRecord; supplement: { id: string; content: string; createdAt: string } };
  correctSubmittedReport(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    reason: string;
    patch: QualityDraftPatchInput;
  }): QualityEventRecord;
  listSourceLinks(eventId: string): Array<{ sourceKey: string; snapshot: Record<string, unknown> }>;
  listRelations(eventId: string): Array<{ relatedEventId: string | null; relatedSourceKey: string | null; reason: string | null }>;
  listAuditEvents(eventId: string): QualityAuditEvent[];
  close(): void;
}

type DatabaseRow = Record<string, unknown>;

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

function parseNullableObject(value: unknown): Record<string, unknown> | null {
  return value == null ? null : parseObject(value);
}

function managerAssessmentSnapshot(row: DatabaseRow): Record<string, unknown> {
  const categoryFields = {
    categoryMode: String(row.category_mode ?? "STANDARD") as QualityAssessmentCategoryMode,
    primaryCategoryCode: nullableString(row.primary_category_code),
    secondaryCategoryCode: nullableString(row.secondary_category_code),
    customPrimaryCategoryName: nullableString(row.custom_primary_category_name),
    customSecondaryCategoryName: nullableString(row.custom_secondary_category_name),
  };
  return {
    sourceKey: String(row.source_key),
    sourceVersion: Number(row.source_version),
    handlingRecommendation: String(row.handling_recommendation),
    ...categoryFields,
    categoryDisplayName: qualityAssessmentCategoryDisplayName(categoryFields),
    riskLevel: String(row.risk_level),
    conclusion: String(row.conclusion),
    adoptionMode: String(row.adoption_mode),
    changeReason: nullableString(row.change_reason),
    aiAssessmentId: nullableString(row.ai_assessment_id),
    reviewedBy: String(row.reviewed_by),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function aiAssessmentSnapshot(row: DatabaseRow | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    assessmentId: String(row.id),
    sourceKey: String(row.source_key),
    sourceVersion: Number(row.source_version),
    requestId: String(row.request_id),
    sourceSnapshot: parseObject(row.source_snapshot_json),
    output: parseObject(row.output_json),
    retrievedCases: JSON.parse(String(row.retrieved_cases_json ?? "[]")) as unknown,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

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

function requireAftersales(actor: QualityEventActor): void {
  if (actor.role !== "aftersales_manager") throw new Error("quality action forbidden");
}

function optional(value: string | null): string | undefined {
  return value ?? undefined;
}

function draftFieldsFromEvent(event: QualityEventRecord): QualityDraftFields {
  return {
    title: event.title,
    currentSituation: event.problemStatus,
    occurredAt: optional(event.occurredAt),
    reporter: optional(event.feedbackName),
    reporterUserId: optional(event.feedbackUserId),
    deviceModel: optional(event.deviceModel),
    serialNo: optional(event.deviceSerial),
    catheterBatch: optional(event.catheterBatch),
    clinicianAware: optional(event.clinicianAware),
    impact: optional(event.impact),
    category: optional(event.initialCategory),
    urgency: event.urgency ?? "MEDIUM",
    notes: optional(event.supplement),
  };
}

function defaultEventNo(now: string): string {
  const day = now.slice(0, 10).replace(/-/g, "");
  return `QE-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createQualityEventService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
  eventNo?: () => string;
}): QualityEventService {
  const db = new DatabaseSync(deps?.dbPath ?? resolveWorkbenchSqlitePath());
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;
  const eventNo = deps?.eventNo ?? (() => defaultEventNo(now()));

  function assertRequestId(requestId: string): void {
    z.string().uuid().parse(requestId);
  }

  function rawEvent(eventId: string): DatabaseRow | undefined {
    return db.prepare("SELECT * FROM quality_events WHERE id = ?").get(eventId) as
      | DatabaseRow
      | undefined;
  }

  function visibleEvent(eventId: string): QualityEventRecord | null {
    const row = db.prepare(
      "SELECT * FROM quality_events WHERE id = ? AND deleted_at IS NULL",
    ).get(eventId) as DatabaseRow | undefined;
    return row ? eventFromRow(row) : null;
  }

  function ownedDraft(actor: QualityEventActor, eventId: string): QualityEventRecord {
    const row = db.prepare(`
      SELECT * FROM quality_events
      WHERE id = ? AND status = 'DRAFT' AND created_by = ? AND deleted_at IS NULL
    `).get(eventId, actor.userId) as DatabaseRow | undefined;
    if (!row) throw new Error("draft not found");
    return eventFromRow(row);
  }

  function appendAudit(input: {
    eventId: string;
    actor: QualityEventActor;
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
      input.actor.userId,
      input.actor.role,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.reason ?? null,
      input.requestId,
      input.occurredAt,
    );
  }

  function sourceRows(sourceKeys: string[]): DatabaseRow[] {
    const uniqueKeys = [...new Set(sourceKeys.map((key) => key.trim()).filter(Boolean))];
    if (uniqueKeys.length === 0) throw new Error("at least one source is required");
    const placeholders = uniqueKeys.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT * FROM quality_source_rows WHERE source_key IN (${placeholders})
    `).all(...uniqueKeys) as DatabaseRow[];
    if (rows.length !== uniqueKeys.length) throw new Error("quality source not found");
    const byKey = new Map(rows.map((row) => [String(row.source_key), row]));
    return uniqueKeys.map((key) => byKey.get(key)!);
  }

  function duplicateEvent(sourceKeys: string[]): QualityEventRecord | null {
    if (sourceKeys.length === 0) return null;
    const placeholders = sourceKeys.map(() => "?").join(",");
    const row = db.prepare(`
      SELECT e.* FROM quality_event_source_links l
      JOIN quality_events e ON e.id = l.event_id
      WHERE l.source_key IN (${placeholders}) AND e.deleted_at IS NULL
      ORDER BY l.linked_at LIMIT 1
    `).get(...sourceKeys) as DatabaseRow | undefined;
    return row ? eventFromRow(row) : null;
  }

  function insertSourceLinks(
    eventId: string,
    actor: QualityEventActor,
    rows: DatabaseRow[],
    occurredAt: string,
  ): void {
    for (const row of rows) {
      db.prepare(`
        INSERT INTO quality_event_source_links (
          id, event_id, source_key, source_version, source_state_at_link,
          source_snapshot_json, linked_by, linked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id(),
        eventId,
        String(row.source_key),
        Number(row.source_version),
        String(row.state),
        String(row.raw_snapshot_json),
        actor.userId,
        occurredAt,
      );
    }
  }

  function insertRelations(
    eventId: string,
    relatedEventIds: string[],
    actor: QualityEventActor,
    reason: string,
    occurredAt: string,
  ): void {
    for (const relatedEventId of [...new Set(relatedEventIds)]) {
      if (!visibleEvent(relatedEventId)) throw new Error("related event not found");
      db.prepare(`
        INSERT INTO quality_event_relations (
          id, event_id, relation_type, related_event_id, related_source_key,
          relation_snapshot_json, created_by, created_at
        ) VALUES (?, ?, 'SIMILAR_EVENT', ?, NULL, ?, ?, ?)
      `).run(
        id(),
        eventId,
        relatedEventId,
        JSON.stringify({ reason }),
        actor.userId,
        occurredAt,
      );
    }
  }

  function insertDraft(input: {
    actor: QualityEventActor;
    requestId: string;
    draft: QualityDraftFields;
    sourceRows?: DatabaseRow[];
    reportingAssessment?: { sourceKey: string; version: number };
    relatedEventIds?: string[];
    independentReason?: string;
  }): QualityDraftCreationResult {
    requireAftersales(input.actor);
    assertRequestId(input.requestId);
    const draft = qualityDraftFieldsSchema.parse(input.draft);
    const sources = input.sourceRows ?? [];
    const sourceKeys = sources.map((row) => String(row.source_key));
    const duplicate = duplicateEvent(sourceKeys);
    if (duplicate) return { created: false, event: duplicate };
    const occurredAt = now();
    const newEventId = id();

    try {
      return transaction(db, () => {
        db.prepare(`
        INSERT INTO quality_events (
          id, event_no, status, title, problem_status, occurred_at, feedback_at,
          feedback_user_id, feedback_name, device_model, device_serial, catheter_batch,
          clinician_aware, impact, initial_category, urgency, supplement, created_by,
          version, created_at, updated_at
        ) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          newEventId,
          eventNo(),
          draft.title,
          draft.currentSituation,
          draft.occurredAt ?? null,
          draft.occurredAt ?? null,
          draft.reporterUserId ?? null,
          draft.reporter ?? null,
          draft.deviceModel ?? null,
          draft.serialNo ?? null,
          draft.catheterBatch ?? null,
          draft.clinicianAware ?? null,
          draft.impact ?? null,
          draft.category ?? null,
          draft.urgency,
          draft.notes ?? null,
          input.actor.userId,
          occurredAt,
          occurredAt,
        );
        insertSourceLinks(newEventId, input.actor, sources, occurredAt);
        if (input.reportingAssessment) {
          db.prepare(`
            INSERT INTO quality_event_reporting_context (
              event_id, source_key, assessment_version, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            newEventId,
            input.reportingAssessment.sourceKey,
            input.reportingAssessment.version,
            input.actor.userId,
            occurredAt,
          );
        }
        if ((input.relatedEventIds?.length ?? 0) > 0) {
          insertRelations(
            newEventId,
            input.relatedEventIds!,
            input.actor,
            input.independentReason!,
            occurredAt,
          );
        }
        const event = visibleEvent(newEventId)!;
        appendAudit({
          eventId: newEventId,
          actor: input.actor,
          action: "DRAFT_CREATED",
          before: null,
          after: event as unknown as Record<string, unknown>,
          reason: input.independentReason,
          requestId: input.requestId,
          occurredAt,
        });
        return { created: true, event };
      });
    } catch (error) {
      if (error instanceof Error && /quality_event_source_links\.source_key/.test(error.message)) {
        const existing = duplicateEvent(sourceKeys);
        if (existing) return { created: false, event: existing };
      }
      throw error;
    }
  }

  function finalAssessmentForReporting(
    sourceRow: DatabaseRow,
    expectedVersion: number,
  ): DatabaseRow {
    const sourceKey = String(sourceRow.source_key);
    const assessment = db.prepare(`
      SELECT * FROM quality_source_assessments WHERE source_key = ?
    `).get(sourceKey) as DatabaseRow | undefined;
    if (!assessment || Number(assessment.version) !== expectedVersion) {
      throw new Error("version conflict");
    }
    if (String(assessment.handling_recommendation) !== "QUALITY_ANOMALY") {
      throw new Error("只有主管最终研判为质量异常时才可创建通报草稿");
    }
    if (Number(assessment.source_version) !== Number(sourceRow.source_version)) {
      throw new Error("来源资料已更新，请重新研判后再通报");
    }
    return assessment;
  }

  function createDraftFromAssessment(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKey: string;
    expectedAssessmentVersion: number;
    overrides?: Partial<QualityDraftFields>;
  }): QualityDraftCreationResult {
    const source = sourceRows([input.sourceKey])[0]!;
    const assessment = finalAssessmentForReporting(
      source,
      input.expectedAssessmentVersion,
    );
    const normalized = parseObject(source.normalized_json);
    const snapshot = managerAssessmentSnapshot(assessment);
    const category = String(snapshot.categoryDisplayName ?? "").trim();
    const conclusion = String(snapshot.conclusion ?? "").trim();
    const issue = String(normalized.issueDescription ?? "").trim();
    const feedbackNo = String(normalized.feedbackNo ?? "").trim();
    const risk = String(assessment.risk_level);
    const prefilled: QualityDraftFields = {
      title: `【${category || "待分类"}】${feedbackNo || issue || "质量异常"}`.slice(0, 200),
      currentSituation: [conclusion, issue && `来源反馈：${issue}`]
        .filter(Boolean).join("\n\n"),
      occurredAt: String(normalized.feedbackAt ?? "") || undefined,
      reporter: String(normalized.reporter ?? "") || undefined,
      deviceModel: String(normalized.deviceModel ?? "") || undefined,
      serialNo: String(normalized.serialNo ?? "") || undefined,
      catheterBatch: String(normalized.catheterBatch ?? "") || undefined,
      clinicianAware: String(normalized.clinicianAware ?? "") || undefined,
      impact: String(normalized.impact ?? "") || undefined,
      category: category || undefined,
      urgency: risk === "HIGH" ? "HIGH" : risk === "LOW" ? "LOW" : "MEDIUM",
      notes: assessment.change_reason == null
        ? undefined
        : `主管修改原因：${String(assessment.change_reason)}`,
    };
    const result = insertDraft({
      actor: input.actor,
      requestId: input.requestId,
      sourceRows: [source],
      reportingAssessment: {
        sourceKey: input.sourceKey,
        version: input.expectedAssessmentVersion,
      },
      draft: qualityDraftFieldsSchema.parse({ ...prefilled, ...input.overrides }),
    });
    if (!result.created && result.event.status === "DRAFT"
      && result.event.createdBy === input.actor.userId) {
      db.prepare(`
        INSERT INTO quality_event_reporting_context (
          event_id, source_key, assessment_version, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          source_key=excluded.source_key,
          assessment_version=excluded.assessment_version,
          created_by=excluded.created_by,
          created_at=excluded.created_at
      `).run(
        result.event.eventId,
        input.sourceKey,
        input.expectedAssessmentVersion,
        input.actor.userId,
        now(),
      );
    }
    return result;
  }

  function createDraftFromSources(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKeys: string[];
    overrides?: Partial<QualityDraftFields>;
  }): QualityDraftCreationResult {
    const sources = sourceRows(input.sourceKeys);
    const first = parseObject(sources[0]!.normalized_json);
    const issue = String(first.issueDescription ?? "").trim();
    const savedAssessment = db.prepare(`
      SELECT primary_category_code, secondary_category_code, category_mode,
             custom_primary_category_name, custom_secondary_category_name
      FROM quality_source_assessments
      WHERE source_key = ?
    `).get(String(sources[0]!.source_key)) as DatabaseRow | undefined;
    const category = savedAssessment
      ? qualityAssessmentCategoryDisplayName({
          categoryMode: String(
            savedAssessment.category_mode ?? "STANDARD",
          ) as QualityAssessmentCategoryMode,
          primaryCategoryCode: nullableString(savedAssessment.primary_category_code),
          secondaryCategoryCode: nullableString(savedAssessment.secondary_category_code),
          customPrimaryCategoryName: nullableString(
            savedAssessment.custom_primary_category_name,
          ),
          customSecondaryCategoryName: nullableString(
            savedAssessment.custom_secondary_category_name,
          ),
        })
      : String(first.category ?? "").trim();
    const prefilled: QualityDraftFields = {
      title: `【${category || "待分类"}】${issue || "质量异常"}`.slice(0, 200),
      currentSituation: issue || "来源记录待售后主管补充问题现状",
      occurredAt: String(first.feedbackAt ?? "") || undefined,
      reporter: String(first.reporter ?? "") || undefined,
      deviceModel: String(first.deviceModel ?? "") || undefined,
      serialNo: String(first.serialNo ?? "") || undefined,
      catheterBatch: String(first.catheterBatch ?? "") || undefined,
      clinicianAware: String(first.clinicianAware ?? "") || undefined,
      impact: String(first.impact ?? "") || undefined,
      category: category || undefined,
      urgency: "MEDIUM",
    };
    return insertDraft({
      actor: input.actor,
      requestId: input.requestId,
      sourceRows: sources,
      draft: qualityDraftFieldsSchema.parse({ ...prefilled, ...input.overrides }),
    });
  }

  function createManualDraft(input: {
    actor: QualityEventActor;
    requestId: string;
    draft: QualityDraftFields;
    similarEventIds?: string[];
    independentReason?: string;
  }): QualityDraftCreationResult {
    if ((input.similarEventIds?.length ?? 0) > 0 && !input.independentReason?.trim()) {
      throw new Error("independent creation reason is required");
    }
    return insertDraft({
      actor: input.actor,
      requestId: input.requestId,
      draft: input.draft,
      relatedEventIds: input.similarEventIds,
      independentReason: input.independentReason?.trim(),
    });
  }

  function createRelatedIndependentDraft(input: {
    actor: QualityEventActor;
    requestId: string;
    sourceKeys: string[];
    draft: QualityDraftFields;
    relatedEventId: string;
    reason: string;
  }): QualityDraftCreationResult {
    if (!input.reason.trim()) throw new Error("independent creation reason is required");
    return insertDraft({
      actor: input.actor,
      requestId: input.requestId,
      draft: input.draft,
      sourceRows: sourceRows(input.sourceKeys),
      relatedEventIds: [input.relatedEventId],
      independentReason: input.reason.trim(),
    });
  }

  function updateEventFields(
    event: QualityEventRecord,
    patch: QualityDraftPatchInput,
    occurredAt: string,
  ): QualityEventRecord {
    const parsedPatch = qualityDraftPatchSchema.parse(patch);
    const merged = qualityDraftFieldsSchema.parse({ ...draftFieldsFromEvent(event), ...parsedPatch });
    const result = db.prepare(`
      UPDATE quality_events SET
        title = ?, problem_status = ?, occurred_at = ?, feedback_at = ?,
        feedback_user_id = ?, feedback_name = ?, device_model = ?, device_serial = ?,
        catheter_batch = ?, clinician_aware = ?, impact = ?, initial_category = ?,
        urgency = ?, supplement = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ? AND deleted_at IS NULL
    `).run(
      merged.title,
      merged.currentSituation,
      merged.occurredAt ?? null,
      merged.occurredAt ?? null,
      merged.reporterUserId ?? null,
      merged.reporter ?? null,
      merged.deviceModel ?? null,
      merged.serialNo ?? null,
      merged.catheterBatch ?? null,
      merged.clinicianAware ?? null,
      merged.impact ?? null,
      merged.category ?? null,
      merged.urgency,
      merged.notes ?? null,
      occurredAt,
      event.eventId,
      event.version,
    );
    if (Number(result.changes) !== 1) throw new Error("version conflict");
    return visibleEvent(event.eventId)!;
  }

  function updateDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    patch: QualityDraftPatchInput;
    reason?: string;
  }): QualityEventRecord {
    requireAftersales(input.actor);
    assertRequestId(input.requestId);
    const before = ownedDraft(input.actor, input.eventId);
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const occurredAt = now();
    return transaction(db, () => {
      const after = updateEventFields(before, input.patch, occurredAt);
      appendAudit({
        eventId: before.eventId,
        actor: input.actor,
        action: "DRAFT_UPDATED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        reason: input.reason,
        requestId: input.requestId,
        occurredAt,
      });
      return after;
    });
  }

  function deleteDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    reason: string;
  }): void {
    requireAftersales(input.actor);
    assertRequestId(input.requestId);
    if (!input.reason.trim()) throw new Error("delete reason is required");
    const before = ownedDraft(input.actor, input.eventId);
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const occurredAt = now();
    transaction(db, () => {
      const result = db.prepare(`
        UPDATE quality_events SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND status = 'DRAFT' AND deleted_at IS NULL
      `).run(occurredAt, occurredAt, input.eventId, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("version conflict");
      db.prepare("DELETE FROM quality_event_reporting_context WHERE event_id = ?")
        .run(input.eventId);
      db.prepare("DELETE FROM quality_event_source_links WHERE event_id = ?").run(input.eventId);
      const after = eventFromRow(rawEvent(input.eventId)!);
      appendAudit({
        eventId: input.eventId,
        actor: input.actor,
        action: "DRAFT_DELETED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        reason: input.reason.trim(),
        requestId: input.requestId,
        occurredAt,
      });
    });
  }

  function freezeReportingSnapshots(input: {
    eventId: string;
    actor: QualityEventActor;
    requestId: string;
    occurredAt: string;
  }): void {
    const links = db.prepare(`
      SELECT l.source_key,l.source_version AS linked_source_version,
             r.source_version,r.state,r.raw_snapshot_json,r.normalized_json
      FROM quality_event_source_links l
      JOIN quality_source_rows r ON r.source_key = l.source_key
      WHERE l.event_id = ? ORDER BY l.linked_at,l.id
    `).all(input.eventId) as DatabaseRow[];
    const context = db.prepare(`
      SELECT * FROM quality_event_reporting_context WHERE event_id = ?
    `).get(input.eventId) as DatabaseRow | undefined;
    const sourceSnapshots: Array<Record<string, unknown>> = [];
    const aiAssessments: Array<Record<string, unknown>> = [];
    const managerAssessments: Array<Record<string, unknown>> = [];

    for (const link of links) {
      const sourceKey = String(link.source_key);
      const assessment = db.prepare(`
        SELECT * FROM quality_source_assessments WHERE source_key = ?
      `).get(sourceKey) as DatabaseRow | undefined;
      const contracted = context && String(context.source_key) === sourceKey;
      if (contracted) {
        if (!assessment) throw new Error("正式通报缺少主管最终研判");
        if (String(assessment.handling_recommendation) !== "QUALITY_ANOMALY") {
          throw new Error("只有主管最终研判为质量异常时才可正式通报");
        }
        if (Number(context.assessment_version) !== Number(assessment.version)) {
          throw new Error("主管最终研判已更新，请重新打开通报草稿后再提交");
        }
        if (Number(assessment.source_version) !== Number(link.source_version)) {
          throw new Error("来源资料已更新，请重新研判后再通报");
        }
      }
      db.prepare(`
        UPDATE quality_event_source_links SET
          source_version = ?, source_state_at_link = ?, source_snapshot_json = ?
        WHERE event_id = ? AND source_key = ?
      `).run(
        Number(link.source_version), String(link.state), String(link.raw_snapshot_json),
        input.eventId, sourceKey,
      );
      sourceSnapshots.push({
        sourceKey,
        sourceVersion: Number(link.source_version),
        sourceState: String(link.state),
        rawSnapshot: parseObject(link.raw_snapshot_json),
        normalizedSnapshot: parseObject(link.normalized_json),
      });
      if (!assessment) {
        aiAssessments.push({ sourceKey, assessment: null });
        continue;
      }
      const managerSnapshot = managerAssessmentSnapshot(assessment);
      managerAssessments.push(managerSnapshot);
      const aiRow = assessment.ai_assessment_id == null
        ? db.prepare(`
            SELECT * FROM quality_source_ai_assessments
            WHERE source_key = ? AND source_version = ?
            ORDER BY created_at DESC,rowid DESC LIMIT 1
          `).get(sourceKey, Number(assessment.source_version)) as DatabaseRow | undefined
        : db.prepare(`
            SELECT * FROM quality_source_ai_assessments WHERE id = ?
          `).get(String(assessment.ai_assessment_id)) as DatabaseRow | undefined;
      aiAssessments.push({ sourceKey, assessment: aiAssessmentSnapshot(aiRow) });
    }

    db.prepare(`
      INSERT INTO quality_event_reporting_snapshots (
        event_id,source_snapshots_json,ai_assessments_json,
        manager_assessments_json,frozen_by,frozen_at
      ) VALUES (?,?,?,?,?,?)
    `).run(
      input.eventId,
      JSON.stringify(sourceSnapshots),
      JSON.stringify(aiAssessments),
      JSON.stringify(managerAssessments),
      input.actor.userId,
      input.occurredAt,
    );
    appendAudit({
      eventId: input.eventId,
      actor: input.actor,
      action: "REPORTING_SNAPSHOTS_FROZEN",
      before: null,
      after: {
        sourceSnapshotCount: sourceSnapshots.length,
        aiSnapshotCount: aiAssessments.filter((item) => item.assessment != null).length,
        managerAssessmentCount: managerAssessments.length,
      },
      requestId: input.requestId,
      occurredAt: input.occurredAt,
    });
  }

  function submitDraft(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
  }): QualityEventRecord {
    requireAftersales(input.actor);
    assertRequestId(input.requestId);
    const current = visibleEvent(input.eventId);
    if (current && current.createdBy === input.actor.userId && current.status !== "DRAFT") {
      return current;
    }
    const before = ownedDraft(input.actor, input.eventId);
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    qualityDraftFieldsSchema.parse(draftFieldsFromEvent(before));
    const occurredAt = now();
    return transaction(db, () => {
      freezeReportingSnapshots({
        eventId: input.eventId,
        actor: input.actor,
        requestId: input.requestId,
        occurredAt,
      });
      const result = db.prepare(`
        UPDATE quality_events SET
          status = 'PENDING_ANALYSIS', submitted_by = ?, submitted_at = ?,
          version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'DRAFT' AND created_by = ?
          AND version = ? AND deleted_at IS NULL
      `).run(
        input.actor.userId,
        occurredAt,
        occurredAt,
        input.eventId,
        input.actor.userId,
        input.expectedVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("version conflict");
      const after = visibleEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actor: input.actor,
        action: "REPORT_SUBMITTED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        requestId: input.requestId,
        occurredAt,
      });
      enqueueQualityActionNotifications(db, {
        eventId: after.eventId, eventNo: after.eventNo, action: "EVENT_SUBMITTED", actionId: input.requestId,
        context: { qualitySpecialistUserIds: listQualitySpecialistUserIds() }, subject: "有新的质量异常待质量初析",
        summary: `${after.title}：${after.problemStatus}`, occurredAt,
      });
      markLinkedSourcesReported({
        db,
        eventId: after.eventId,
        actorUserId: input.actor.userId,
        requestId: input.requestId,
        occurredAt,
      });
      return after;
    });
  }

  function dismissCandidate(input: {
    actor: QualityEventActor;
    candidateId: string;
    expectedVersion: number;
    reason: string;
  }): void {
    requireAftersales(input.actor);
    if (!input.reason.trim()) throw new Error("candidate decision reason is required");
    const occurredAt = now();
    transaction(db, () => {
      const current = db.prepare(
        "SELECT * FROM quality_candidates WHERE id = ? AND status = 'OPEN'",
      ).get(input.candidateId) as DatabaseRow | undefined;
      if (!current) throw new Error("candidate not found");
      if (Number(current.version) !== input.expectedVersion) throw new Error("version conflict");
      const explanation = parseObject(current.explanation_json);
      const decisions = Array.isArray(explanation.decisions) ? [...explanation.decisions] : [];
      decisions.push({
        action: "DISMISSED",
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        reason: input.reason.trim(),
        occurredAt,
      });
      db.prepare(`
        UPDATE quality_candidates SET
          status = 'DISMISSED', decided_by = ?, decided_at = ?, decision_reason = ?,
          explanation_json = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'OPEN' AND version = ?
      `).run(
        input.actor.userId,
        occurredAt,
        input.reason.trim(),
        JSON.stringify({ ...explanation, decisions }),
        occurredAt,
        input.candidateId,
        input.expectedVersion,
      );
    });
  }

  function attachSources(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    sourceKeys: string[];
    allowDraft: boolean;
    reason?: string;
  }): QualityEventRecord {
    assertRequestId(input.requestId);
    const before = visibleEvent(input.eventId);
    if (!before || before.createdBy !== input.actor.userId) throw new Error("event not found");
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    if (input.allowDraft ? before.status !== "DRAFT" : ["DRAFT", "CLOSED"].includes(before.status)) {
      throw new Error("event state does not allow adding sources");
    }
    const sources = sourceRows(input.sourceKeys);
    const existing = duplicateEvent(sources.map((row) => String(row.source_key)));
    if (existing) throw new Error(`source already reported:${existing.eventId}`);
    const occurredAt = now();
    return transaction(db, () => {
      insertSourceLinks(input.eventId, input.actor, sources, occurredAt);
      const result = db.prepare(`
        UPDATE quality_events SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL
      `).run(occurredAt, input.eventId, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("version conflict");
      const after = visibleEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actor: input.actor,
        action: "SOURCES_ADDED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        reason: input.reason,
        requestId: input.requestId,
        occurredAt,
      });
      return after;
    });
  }

  function addSupplement(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    content: string;
  }): { event: QualityEventRecord; supplement: { id: string; content: string; createdAt: string } } {
    assertRequestId(input.requestId);
    const content = input.content.trim();
    if (!content || content.length > 10000) throw new Error("supplement content is invalid");
    const before = visibleEvent(input.eventId);
    if (!before || before.status === "DRAFT") throw new Error("event not found");
    if (before.status === "CLOSED") throw new Error("已关闭质量事件只读");
    if (before.createdBy !== input.actor.userId && input.actor.role !== "quality_specialist") {
      throw new Error("event not found");
    }
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const occurredAt = now();
    const supplementId = id();
    return transaction(db, () => {
      db.prepare(`
        INSERT INTO quality_event_supplements (
          id, event_id, kind, content, before_json, after_json, reason,
          created_by, created_at, version
        ) VALUES (?, ?, 'SUPPLEMENT', ?, NULL, NULL, NULL, ?, ?, 1)
      `).run(supplementId, input.eventId, content, input.actor.userId, occurredAt);
      const result = db.prepare(`
        UPDATE quality_events SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL
      `).run(occurredAt, input.eventId, input.expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("version conflict");
      const after = visibleEvent(input.eventId)!;
      appendAudit({
        eventId: input.eventId,
        actor: input.actor,
        action: "SUPPLEMENT_ADDED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        requestId: input.requestId,
        occurredAt,
      });
      return { event: after, supplement: { id: supplementId, content, createdAt: occurredAt } };
    });
  }

  function correctSubmittedReport(input: {
    actor: QualityEventActor;
    eventId: string;
    expectedVersion: number;
    requestId: string;
    reason: string;
    patch: QualityDraftPatchInput;
  }): QualityEventRecord {
    requireAftersales(input.actor);
    assertRequestId(input.requestId);
    if (!input.reason.trim()) throw new Error("correction reason is required");
    const before = visibleEvent(input.eventId);
    if (!before || before.status === "DRAFT" || before.createdBy !== input.actor.userId) {
      throw new Error("event not found");
    }
    if (before.status === "CLOSED") throw new Error("已关闭质量事件只读");
    if (before.version !== input.expectedVersion) throw new Error("version conflict");
    const occurredAt = now();
    return transaction(db, () => {
      const after = updateEventFields(before, input.patch, occurredAt);
      db.prepare(`
        INSERT INTO quality_event_supplements (
          id, event_id, kind, content, before_json, after_json, reason,
          created_by, created_at, version
        ) VALUES (?, ?, 'CORRECTION', ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id(),
        input.eventId,
        input.reason.trim(),
        JSON.stringify(before),
        JSON.stringify(after),
        input.reason.trim(),
        input.actor.userId,
        occurredAt,
      );
      appendAudit({
        eventId: input.eventId,
        actor: input.actor,
        action: "REPORT_CORRECTED",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        reason: input.reason.trim(),
        requestId: input.requestId,
        occurredAt,
      });
      return after;
    });
  }

  function listSourceLinks(eventId: string) {
    return (db.prepare(`
      SELECT source_key, source_snapshot_json
      FROM quality_event_source_links WHERE event_id = ? ORDER BY linked_at, rowid
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      sourceKey: String(row.source_key),
      snapshot: parseObject(row.source_snapshot_json),
    }));
  }

  function listRelations(eventId: string) {
    return (db.prepare(`
      SELECT related_event_id, related_source_key, relation_snapshot_json
      FROM quality_event_relations WHERE event_id = ? ORDER BY created_at, rowid
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      relatedEventId: nullableString(row.related_event_id),
      relatedSourceKey: nullableString(row.related_source_key),
      reason: nullableString(parseObject(row.relation_snapshot_json).reason),
    }));
  }

  function listAuditEvents(eventId: string): QualityAuditEvent[] {
    return (db.prepare(`
      SELECT * FROM quality_audit_events WHERE event_id = ? ORDER BY occurred_at, rowid
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      id: String(row.id),
      eventId: String(row.event_id),
      actorUserId: String(row.actor_user_id),
      actorRole: String(row.actor_role) as QualityAuditActorRole,
      action: String(row.action),
      before: parseNullableObject(row.before_json),
      after: parseNullableObject(row.after_json),
      reason: nullableString(row.reason),
      requestId: String(row.request_id),
      occurredAt: String(row.occurred_at),
    }));
  }

  return {
    createDraftFromSources,
    createDraftFromAssessment,
    createManualDraft,
    createRelatedIndependentDraft,
    getDraftForCreator: ({ actor, eventId }) => ownedDraft(actor, eventId),
    updateDraft,
    deleteDraft,
    submitDraft,
    dismissCandidate,
    addSourcesToDraft: (input) => attachSources({ ...input, allowDraft: true }),
    addSourceToActiveEvent: (input) => attachSources({ ...input, allowDraft: false }),
    addSupplement,
    correctSubmittedReport,
    listSourceLinks,
    listRelations,
    listAuditEvents,
    close: () => db.close(),
  };
}
