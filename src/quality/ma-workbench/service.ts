import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import { createQualityStore } from "../infra/quality-store";
import { createQualitySourceAssessmentService, saveQualitySourceAssessmentSchema, type QualitySourceAssessmentRecord } from "../reviews/quality-source-assessment-service";
import { runQualitySourceAiAssessment } from "../reviews/quality-source-ai-assessment-service";
import { createQualityEventService } from "../events/quality-event-service";
import { createQualityEventQuery } from "../queries/quality-event-query";
import { listQualityFormalSubtasksFromDb, qualityFormalTaskStatusLabel } from "../analysis/quality-formal-task-projection";
import { qualityActionLabel, qualityStatusLabel } from "../presentation/quality-display-labels";
import type { MaAiAssessment, MaAssessment, MaAssessmentRequest, MaAttachment, MaDownstream, MaFeedback, MaFeedbackDetail, MaFeedbackList, MaScope, MaSubmitRequest, MaVersionRequest } from "./contracts";
import { getQualityOaReadiness, getQualityOaSourceHistory } from "../oa/quality-oa-source";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  try { const parsed: unknown = JSON.parse(String(value ?? "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {}; } catch { return {}; }
};
const array = (value: unknown): unknown[] => { try { const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const nullable = (value: unknown): string | null => value == null || String(value).trim() === "" ? null : String(value);
export class MaWorkbenchError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "NOT_ADMITTED" | "VERSION_CONFLICT" | "ALREADY_SUBMITTED" | "INVALID_ASSESSMENT", message: string) { super(message); }
}
export const maVersionRequestSchema = z.object({ requestId: z.string().uuid(), expectedSourceVersion: z.number().int().positive() }).strict();
export const maAssessmentRequestSchema = maVersionRequestSchema.extend({
  expectedVersion: z.number().int().nonnegative(), categoryMode: z.enum(["STANDARD", "CUSTOM_SECONDARY", "CUSTOM_FULL"]).optional(),
  primaryCategoryCode: z.string().nullable().optional(), secondaryCategoryCode: z.string().nullable().optional(),
  customPrimaryCategoryName: z.string().nullable().optional(), customSecondaryCategoryName: z.string().nullable().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]), conclusion: z.string().trim().min(1).max(10000),
  adoptionMode: z.enum(["MANUAL", "DIRECT", "MODIFIED"]), changeReason: z.string().max(2000).nullable().optional(),
}).strict();
export const maSubmitRequestSchema = maVersionRequestSchema.extend({ expectedAssessmentVersion: z.number().int().positive() }).strict();

function assessmentView(value: QualitySourceAssessmentRecord | Row): MaAssessment {
  return {
    version: Number(value.version), sourceVersion: Number(value.sourceVersion), categoryMode: value.categoryMode as MaAssessment["categoryMode"],
    primaryCategoryCode: nullable(value.primaryCategoryCode), secondaryCategoryCode: nullable(value.secondaryCategoryCode),
    customPrimaryCategoryName: nullable(value.customPrimaryCategoryName), customSecondaryCategoryName: nullable(value.customSecondaryCategoryName),
    categoryDisplayName: String(value.categoryDisplayName ?? ""), riskLevel: value.riskLevel as MaAssessment["riskLevel"],
    conclusion: String(value.conclusion ?? ""), adoptionMode: value.adoptionMode as MaAssessment["adoptionMode"],
    changeReason: nullable(value.changeReason), reviewedBy: String(value.reviewedBy ?? ""), updatedAt: String(value.updatedAt ?? ""),
  };
}
function aiView(row: Row): MaAiAssessment {
  const output = object(row.output_json);
  return {
    id: String(row.id), sourceVersion: Number(row.source_version), createdAt: String(row.created_at),
    primaryCategoryCode: String(output.primaryCategoryCode ?? ""), secondaryCategoryCode: String(output.secondaryCategoryCode ?? ""),
    riskLevel: output.riskLevel as MaAiAssessment["riskLevel"], reasoningBasis: array(output.reasoningBasis) as MaAiAssessment["reasoningBasis"],
    similarCases: array(output.similarCases).map(object), missingInformation: array(output.missingInformation),
    uncertainties: array(output.uncertainties), provenance: object(output.provenance),
  };
}

export function createMaWorkbenchService(deps: {
  dbPath?: string; now?: () => string;
  listAttachments?: (dbPath: string, sourceKey: string) => MaAttachment[];
  runAi?: typeof runQualitySourceAiAssessment;
} = {}) {
  const dbPath = deps.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
  db.exec(`CREATE TABLE IF NOT EXISTS quality_source_admissions (
    source_key TEXT PRIMARY KEY REFERENCES quality_source_rows(source_key),
    admitted_by TEXT NOT NULL, admitted_at TEXT NOT NULL,
    source_version INTEGER NOT NULL, source_content_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, request_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS quality_source_admission_audit (
    source_key TEXT NOT NULL, actor_user_id TEXT NOT NULL, source_version INTEGER NOT NULL,
    request_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
    PRIMARY KEY(source_key,request_id)
  );`);
  const now = deps.now ?? (() => new Date().toISOString());
  const assessments = createQualitySourceAssessmentService({ dbPath });
  const people = createPeopleDirectoryStore(dbPath);
  const name = (userId: unknown) => people.getContact(String(userId ?? ""))?.name?.trim() || String(userId ?? "相关人员");
  const hasTable = (table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  const rows = (sql: string, ...params: string[]): Row[] => db.prepare(sql).all(...params) as Row[];
  function authorize(actor: string): void {
    if (!resolveQualityCapabilities(actor).canReportQuality) throw new MaWorkbenchError("FORBIDDEN", "无马荣鑫工作台业务权限");
  }
  function admission(key: string): Row | undefined { return db.prepare("SELECT * FROM quality_source_admissions WHERE source_key=?").get(key) as Row | undefined; }
  function source(key: string, actor: string): Row {
    authorize(actor);
    const row = db.prepare("SELECT * FROM quality_source_rows WHERE source_key=? AND state<>'DELETED' AND sheet_id<>'QUALITY_TEST_ISOLATED'").get(key) as Row | undefined;
    if (!row) throw new MaWorkbenchError("NOT_FOUND", "反馈不存在或无权查看");
    const event = assessments.getLinkedEvent(key);
    if (event) {
      const owner = db.prepare("SELECT created_by,is_test FROM quality_events WHERE id=? AND deleted_at IS NULL").get(event.eventId) as Row | undefined;
      if (!owner || Number(owner.is_test) === 1 || String(owner.created_by) !== actor) throw new MaWorkbenchError("NOT_FOUND", "反馈不存在或无权查看");
    }
    const admitted = admission(key);
    if (admitted && admitted.admitted_by !== actor) throw new MaWorkbenchError("NOT_FOUND", "反馈不存在或无权查看");
    return row;
  }
  function requireAdmission(key: string, actor: string, expectedSourceVersion: number): Row {
    const row = source(key, actor);
    const admitted = admission(key);
    if (!admitted) throw new MaWorkbenchError("NOT_ADMITTED", "请先在全部反馈中确认进入质量事件");
    if (Number(row.source_version) !== expectedSourceVersion || Number(admitted.source_version) !== expectedSourceVersion) {
      throw new MaWorkbenchError("VERSION_CONFLICT", "来源资料已更新，请核对原始资料后重新确认进入质量事件");
    }
    const event = assessments.getLinkedEvent(key);
    if (event && event.status !== "DRAFT") throw new MaWorkbenchError("ALREADY_SUBMITTED", "已推送质量初析，研判记录只读");
    return row;
  }
  function attachments(key: string): MaAttachment[] { return deps.listAttachments?.(dbPath, key) ?? []; }
  function summary(row: Row, includeAttachments = true): MaFeedback {
    const key = String(row.source_key);
    const normalized = object(row.normalized_json);
    const admitted = admission(key);
    const saved = assessments.getAssessment(key);
    const linked = assessments.getLinkedEvent(key);
    const submitted = linked != null && linked.status !== "DRAFT";
    const assessmentCurrent = saved != null && saved.sourceVersion === Number(row.source_version);
    const stage = submitted ? linked.status === "CLOSED" ? "CLOSED" : "IN_PROGRESS"
      : admitted ? assessmentCurrent ? "READY_TO_SUBMIT" : "PENDING_ASSESSMENT" : "AVAILABLE";
    const type = normalized.sourceType === "DINGTALK_OA" || key.startsWith("oa:") ? "DINGTALK_OA" : "WORKBOOK";
    return {
      sourceKey: key, feedbackNo: String(normalized.feedbackNo ?? key), title: String(normalized.issueDescription ?? "未填写问题描述"),
      reporter: String(normalized.reporter ?? ""), submittedAt: String(normalized.feedbackAt ?? ""),
      sourceType: type, sourceVersion: Number(row.source_version), sourceState: String(row.state),
      oaStatus: nullable(normalized.oaStatus), oaUrl: nullable(normalized.oaUrl), stage,
      stageLabel: submitted ? qualityStatusLabel(linked.status) : { AVAILABLE: "尚未进入质量事件", PENDING_ASSESSMENT: "待我研判", READY_TO_SUBMIT: "研判已保存，待推送" }[stage as "AVAILABLE" | "PENDING_ASSESSMENT" | "READY_TO_SUBMIT"],
      deviceModel: String(normalized.deviceModel ?? ""), serialNo: String(normalized.serialNo ?? ""), catheterBatch: String(normalized.catheterBatch ?? ""),
      riskLevel: saved?.riskLevel ?? null,
      admission: admitted ? { admittedBy: String(admitted.admitted_by), admittedAt: String(admitted.admitted_at), sourceVersion: Number(admitted.source_version), version: Number(admitted.version) } : null,
      event: submitted ? { id: linked.eventId, eventNo: linked.eventNo, status: linked.status } : null,
      attachmentCount: includeAttachments ? attachments(key).length : 0, updatedAt: String(row.updated_at ?? row.synced_at),
      canAdmit: !submitted && (!admitted || Number(admitted.source_version) !== Number(row.source_version)),
    };
  }
  function list(actor: string, input: { scope?: MaScope; q?: string; page?: number; pageSize?: number } = {}): MaFeedbackList {
    authorize(actor);
    const q = String(input.q ?? "").trim().toLocaleLowerCase("zh-CN");
    const all = rows("SELECT * FROM quality_source_rows WHERE state<>'DELETED' AND sheet_id<>'QUALITY_TEST_ISOLATED' ORDER BY synced_at DESC,row_number DESC,source_key")
      .flatMap(row => { try { source(String(row.source_key), actor); return [summary(row, false)]; } catch (error) { if (error instanceof MaWorkbenchError && error.code === "NOT_FOUND") return []; throw error; } });
    const matches = (item: MaFeedback, scope: MaScope) => scope === "all" || scope === "pending" && ["PENDING_ASSESSMENT", "READY_TO_SUBMIT"].includes(item.stage) || scope === "progress" && item.stage === "IN_PROGRESS" || scope === "closed" && item.stage === "CLOSED";
    const counts = Object.fromEntries((["all", "pending", "progress", "closed"] as MaScope[]).map(scope => [scope, all.filter(item => matches(item, scope)).length])) as Record<MaScope, number>;
    const filtered = all.filter(item => matches(item, input.scope ?? "all") && (!q || [item.feedbackNo, item.title, item.event?.eventNo, item.reporter, item.deviceModel, item.serialNo, item.catheterBatch].some(value => String(value ?? "").toLocaleLowerCase("zh-CN").includes(q))));
    const page = Math.max(1, Math.trunc(input.page ?? 1)); const pageSize = Math.max(1, Math.min(200, Math.trunc(input.pageSize ?? 20)));
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(item => ({ ...item, attachmentCount: attachments(item.sourceKey).length })), counts, pagination: { page, pageSize, total: filtered.length, pageCount: Math.ceil(filtered.length / pageSize) }, integration: getQualityOaReadiness() };
  }
  function downstream(eventId: string, actor: string): MaDownstream {
    const query = createQualityEventQuery(dbPath);
    let detail: ReturnType<typeof query.getEventDetail>;
    try { detail = query.getEventDetail({ eventId, viewerUserId: actor }); } finally { query.close(); }
    if (!detail || detail.event.createdBy !== actor) throw new MaWorkbenchError("NOT_FOUND", "质量事件不存在或无权查看");
    const evidence = detail.evidence.map(item => ({ id: String(item.evidenceId), name: String(item.originalName), mimeType: String(item.mimeType), sizeBytes: Number(item.sizeBytes), category: "处理证据", downloadUrl: `/api/workbench/quality/evidence/${encodeURIComponent(String(item.evidenceId))}`, status: "AVAILABLE", version: Number(item.evidenceVersion), nodeId: String(item.nodeId), uploader: name(item.uploadedBy), createdAt: String(item.createdAt), summary: String(item.summary ?? "") }));
    const reviews = detail.reviews.map(item => ({ nodeId: String(item.nodeId), reviewer: name(item.reviewerUserId), decision: String(item.decision), reason: String(item.reason ?? ""), createdAt: String(item.createdAt) }));
    const versions = hasTable("quality_analysis_versions") ? rows("SELECT * FROM quality_analysis_versions WHERE event_id=? ORDER BY analysis_version DESC", eventId) : [];
    const handoffs = hasTable("quality_analysis_handoffs") ? rows("SELECT * FROM quality_analysis_handoffs WHERE event_id=? ORDER BY analysis_version DESC", eventId) : [];
    const formalTasks = listQualityFormalSubtasksFromDb(db, { eventId });
    return {
      readonly: true,
      analysisVersions: versions.map(row => ({ version: Number(row.analysis_version), confirmedAt: String(row.confirmed_at), confirmedBy: name(row.confirmed_by), department: String(row.primary_department_name ?? ""), manager: name(row.primary_manager_user_id), content: object(row.content_json), deliverables: array(row.deliverables_json), dueAt: nullable(row.suggested_total_due_at) })),
      handoffs: handoffs.map(row => ({ version: Number(row.analysis_version), department: String(row.primary_department_name ?? ""), manager: name(row.primary_manager_user_id), status: String(row.status), createdAt: String(row.created_at), publishedAt: nullable(row.published_at) })),
      tasks: formalTasks.map(item => {
        const node = detail!.assignmentTree.find(node => node.subtaskId === item.subtaskId);
        return { taskId: item.taskId, taskNo: item.taskNo, subtaskId: item.subtaskId, title: item.subtaskTitle, objective: item.objective, deliverables: item.deliverables, completionCriteria: item.completionCriteria, assignee: name(item.assigneeUserId), assigneeUserId: item.assigneeUserId, manager: name(item.managerUserId), managerUserId: item.managerUserId, department: String(node?.departmentName ?? handoffs[0]?.primary_department_name ?? ""), status: item.status, statusLabel: qualityFormalTaskStatusLabel(item.status, item.openDeclineKind), dueAt: item.dueAt, progressNote: item.progressNote, acceptedAt: item.acceptedAt, completedAt: item.completedAt, evidence: evidence.filter(ev => ev.nodeId === node?.nodeId), reviews: reviews.filter(review => review.nodeId === node?.nodeId) };
      }), evidence, reviews,
      timeline: detail.publicAudit.map((item, index) => ({ id: `${eventId}:${index}`, action: item.action === "REPORT_SUBMITTED" ? "研判已推送质量初析" : item.action === "REPORTING_SNAPSHOTS_FROZEN" ? "保存正式通报来源与研判快照" : qualityActionLabel(item.action), actor: name(item.actorUserId), at: String(item.occurredAt), reason: nullable(item.reason) })),
    };
  }
  function get(key: string, actor: string): MaFeedbackDetail {
    const row = source(key, actor); const base = summary(row); const saved = assessments.getAssessment(key);
    const history = rows("SELECT * FROM quality_source_assessment_audit WHERE source_key=? ORDER BY occurred_at DESC,rowid DESC", key).map(row => { const value = assessmentView(object(row.after_json)); return { ...value, reviewedBy: name(value.reviewedBy) }; });
    const aiHistory = rows("SELECT * FROM quality_source_ai_assessments WHERE source_key=? ORDER BY created_at DESC,rowid DESC", key).map(aiView);
    const currentAi = aiHistory.find(item => item.sourceVersion === base.sourceVersion) ?? null;
    const admittedCurrent = base.admission != null && base.admission.sourceVersion === base.sourceVersion;
    const raw = object(row.raw_snapshot_json);
    return { ...base, rawFields: Object.entries(raw).map(([label, value]) => ({ label, value: typeof value === "string" ? value : JSON.stringify(value) })),
      attachments: attachments(key), assessment: saved ? { ...assessmentView(saved), reviewedBy: name(saved.reviewedBy) } : null, aiAssessment: currentAi,
      assessmentHistory: history, aiHistory, sourceUpdatedSinceAdmission: base.admission != null && !admittedCurrent,
      sourceUpdatedSinceAssessment: saved != null && saved.sourceVersion !== base.sourceVersion,
      canAssess: admittedCurrent && !base.event,
      canSubmit: admittedCurrent && !base.event && saved?.sourceVersion === base.sourceVersion,
      downstream: base.event ? downstream(base.event.id, actor) : null,
      oaHistory: base.sourceType === "DINGTALK_OA" ? getQualityOaSourceHistory(dbPath, key) : undefined,
    };
  }
  function admit(key: string, actor: string, input: MaVersionRequest): MaFeedbackDetail {
    maVersionRequestSchema.parse(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = source(key, actor);
      if (Number(row.source_version) !== input.expectedSourceVersion) throw new MaWorkbenchError("VERSION_CONFLICT", "来源资料已更新，请刷新后核对");
      const event = assessments.getLinkedEvent(key);
      if (event && event.status !== "DRAFT") throw new MaWorkbenchError("ALREADY_SUBMITTED", "该反馈已进入后续质量流程");
      const repeated = db.prepare("SELECT 1 FROM quality_source_admission_audit WHERE source_key=? AND request_id=?").get(key, input.requestId);
      if (!repeated) {
        const timestamp = now();
        db.prepare(`INSERT INTO quality_source_admissions(source_key,admitted_by,admitted_at,source_version,source_content_hash,version,request_id,updated_at)
          VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(source_key) DO UPDATE SET source_version=excluded.source_version,source_content_hash=excluded.source_content_hash,version=quality_source_admissions.version+1,request_id=excluded.request_id,updated_at=excluded.updated_at
          WHERE quality_source_admissions.source_version<>excluded.source_version`).run(key, actor, timestamp, input.expectedSourceVersion, String(row.content_hash), input.requestId, timestamp);
        db.prepare("INSERT INTO quality_source_admission_audit(source_key,actor_user_id,source_version,request_id,occurred_at) VALUES(?,?,?,?,?)").run(key, actor, input.expectedSourceVersion, input.requestId, timestamp);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return get(key, actor);
  }
  async function ai(key: string, actor: string, input: MaVersionRequest): Promise<MaFeedbackDetail> {
    maVersionRequestSchema.parse(input); requireAdmission(key, actor, input.expectedSourceVersion);
    await (deps.runAi ?? runQualitySourceAiAssessment)({ sourceKey: key, actorUserId: actor, requestId: input.requestId, dbPath });
    return get(key, actor);
  }
  function saveAssessment(key: string, actor: string, input: MaAssessmentRequest): MaFeedbackDetail {
    maAssessmentRequestSchema.parse(input); requireAdmission(key, actor, input.expectedSourceVersion);
    const { expectedSourceVersion: _, ...fields } = input;
    const payload = saveQualitySourceAssessmentSchema.parse({ ...fields, handlingRecommendation: "QUALITY_ANOMALY" });
    const original = assessments.getLatestAiAssessment(key, input.expectedSourceVersion);
    if (original && payload.adoptionMode === "MANUAL" && !payload.changeReason?.trim()) throw new MaWorkbenchError("INVALID_ASSESSMENT", "已有AI原始研判，重新人工判断须填写原因");
    if (original && payload.adoptionMode !== "MANUAL") {
      const aiConclusion = original.output.reasoningBasis.map(item => item.statement).join("\n");
      const changed = payload.categoryMode !== "STANDARD" || payload.primaryCategoryCode !== original.output.primaryCategoryCode || payload.secondaryCategoryCode !== original.output.secondaryCategoryCode || payload.riskLevel !== original.output.riskLevel || payload.conclusion !== aiConclusion;
      if (changed && (payload.adoptionMode !== "MODIFIED" || !payload.changeReason?.trim())) throw new MaWorkbenchError("INVALID_ASSESSMENT", "分类、风险或结论与AI原始研判不同，请选择修改后采纳并填写修正原因");
    }
    assessments.saveAssessment({ sourceKey: key, actorUserId: actor, assessment: payload });
    return get(key, actor);
  }
  function submit(key: string, actor: string, input: MaSubmitRequest): MaFeedbackDetail {
    maSubmitRequestSchema.parse(input);
    source(key, actor);
    const existing = assessments.getLinkedEvent(key);
    if (existing && existing.status !== "DRAFT") return get(key, actor);
    requireAdmission(key, actor, input.expectedSourceVersion);
    const current = assessments.getAssessment(key);
    if (!current || current.version !== input.expectedAssessmentVersion || current.sourceVersion !== input.expectedSourceVersion) throw new MaWorkbenchError("VERSION_CONFLICT", "请先保存当前来源版本的人工研判，再确认推送");
    const service = createQualityEventService({ dbPath });
    try {
      const result = service.createDraftFromAssessment({ actor: { userId: actor, role: "aftersales_manager" }, sourceKey: key, expectedAssessmentVersion: input.expectedAssessmentVersion, requestId: input.requestId });
      service.submitDraft({ actor: { userId: actor, role: "aftersales_manager" }, eventId: result.event.eventId, expectedVersion: result.event.version, requestId: input.requestId });
    } finally { service.close(); }
    return get(key, actor);
  }
  return { list, get, admit, ai, saveAssessment, submit, close: () => { people.close(); assessments.close(); db.close(); } };
}
