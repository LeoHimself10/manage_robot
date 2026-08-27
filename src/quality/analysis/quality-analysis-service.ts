import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import {
  conversationPlanSessionStore,
  createSideThreadSession,
  deleteSideThreadSession,
} from "../../web/conversation-thread-resolver";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from
  "../ai-original-assessment/historical-feedback-taxonomy-v0";
import { createQualityStore } from "../infra/quality-store";
import { enqueueQualityNotification } from "../notifications/quality-notification-outbox";
import {
  QUALITY_ANALYSIS_INPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
  QUALITY_ANALYSIS_MODEL_CONFIG_ID,
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_PROMPT_VERSION,
  QUALITY_ANALYSIS_RULE_VERSION,
  qualityAnalysisInputSchema,
  qualityDeliverableSchema,
  saveQualityAnalysisDraftSchema,
  type QualityAnalysisDraftContent,
  type QualityAnalysisInput,
  type QualityAnalysisOutput,
  type QualityDeliverable,
  type SaveQualityAnalysisDraftInput,
} from "./quality-analysis-contracts";
import { createQualityDepartmentDirectory } from "./quality-department-directory";
import {
  loadQwenQualityAnalysisConfig,
  QualityAnalysisModelCallError,
  QwenQualityAnalysisModel,
  type QualityAnalysisModelAdapter,
} from "./qwen-quality-analysis-model";
import { validateQualityAnalysisOutput } from "./validate-quality-analysis";

type DatabaseRow = Record<string, unknown>;

export class QualityAnalysisError extends Error {
  constructor(
    public readonly code:
      | "MODEL_NOT_CONFIGURED"
      | "MODEL_CALL_FAILED"
      | "MODEL_TIMEOUT"
      | "MODEL_OUTPUT_INVALID"
      | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "QualityAnalysisError";
  }
}

export interface QualityAnalysisAttemptView {
  attemptId: string;
  eventId: string;
  attemptNo: number;
  requestId: string;
  status: "GENERATING" | "SUCCEEDED" | "FAILED";
  schemaVersion: string;
  promptVersion: string;
  modelConfigId: string;
  modelName: string | null;
  inputVersion: string;
  input: QualityAnalysisInput;
  output: QualityAnalysisOutput | null;
  failureCode: string | null;
  failureReason: string | null;
  validationIssues: Array<{ path: string; message: string }>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return fallback;
  }
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function safeFailure(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 1_000);
}

function attemptFromRow(row: DatabaseRow): QualityAnalysisAttemptView {
  return {
    attemptId: String(row.attempt_id),
    eventId: String(row.event_id),
    attemptNo: Number(row.attempt_no),
    requestId: String(row.request_id),
    status: String(row.status) as QualityAnalysisAttemptView["status"],
    schemaVersion: String(row.schema_version),
    promptVersion: String(row.prompt_version),
    modelConfigId: String(row.model_config_id),
    modelName: nullable(row.model_name),
    inputVersion: String(row.input_version),
    input: parseJson(row.input_json, {}) as QualityAnalysisInput,
    output: row.output_json == null
      ? null
      : parseJson(row.output_json, null) as QualityAnalysisOutput | null,
    failureCode: nullable(row.failure_code),
    failureReason: nullable(row.failure_reason),
    validationIssues: parseJson(row.validation_issues_json, []),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    totalTokens: Number(row.total_tokens),
    durationMs: Number(row.duration_ms),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    completedAt: nullable(row.completed_at),
  };
}

function normalizeList(items: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const value = raw.trim();
    const normalized = value.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
    if (!value || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function validateDeliverables(deliverables: QualityDeliverable[]): QualityDeliverable[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return deliverables.map((raw) => {
    const item = qualityDeliverableSchema.parse(raw);
    const nameKey = item.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
    if (ids.has(item.deliverableId)) throw new Error("必须成果编号重复");
    if (names.has(nameKey)) throw new Error("必须成果名称重复");
    ids.add(item.deliverableId);
    names.add(nameKey);
    return item;
  });
}

function selectedDeliverables(deliverables: QualityDeliverable[]): QualityDeliverable[] {
  const selected = deliverables.filter((item) => item.selected);
  if (selected.length === 0) throw new Error("必须至少选择一项必须成果");
  return selected;
}

function analysisDiff(
  attempt: QualityAnalysisAttemptView | null,
  content: QualityAnalysisDraftContent,
  deliverables: QualityDeliverable[],
  primaryDepartmentId: string,
): Record<string, unknown> {
  if (!attempt?.output) {
    return {
      mode: "MANUAL",
      fields: Object.keys(content),
      deliverableIds: selectedDeliverables(deliverables).map((item) => item.deliverableId),
      primaryDepartmentId,
    };
  }
  const output = attempt.output;
  const original: Record<string, unknown> = {
    problemDirection: output.problemDirection,
    confirmedCategoryReference: output.confirmedCategoryReference,
    sourceFactSummary: output.sourceFactSummary,
    confirmedFacts: output.confirmedFacts,
    analysisBasis: output.analysisBasis.map((item) => item.statement),
    preliminaryConclusion: output.preliminaryConclusion,
    causeHypotheses: output.causeHypotheses,
    investigationDirections: output.investigationDirections,
    informationGaps: output.informationGaps,
    handlingRequirements: output.handlingRequirements,
  };
  const fields: Record<string, { ai: unknown; human: unknown }> = {};
  for (const [key, human] of Object.entries(content)) {
    if (JSON.stringify(original[key]) !== JSON.stringify(human)) {
      fields[key] = { ai: original[key], human };
    }
  }
  return {
    mode: "AI_ASSISTED",
    fields,
    deliverables: selectedDeliverables(deliverables).map((item) => ({
      deliverableId: item.deliverableId,
      name: item.name,
      source: item.source,
      selected: item.selected,
    })),
    primaryDepartmentId,
  };
}

export function createQualityAnalysisService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
  env?: Record<string, string | undefined>;
  model?: QualityAnalysisModelAdapter;
  testMode?: {
    actorUserId: string;
    departmentCandidates: Array<{ departmentId: string; departmentName: string }>;
    reportingContext?: QualityAnalysisInput["frozenReportingContext"];
  };
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function testModeAllowed(eventId: string, actorUserId: string): boolean {
    if (!deps?.testMode || deps.testMode.actorUserId !== actorUserId) return false;
    const event = getEvent(eventId);
    return Number(event.is_test ?? 0) === 1;
  }

  function requireQualityManagement(eventId: string, actorUserId: string): void {
    if (!resolveQualityCapabilities(actorUserId).canAnalyzeQuality
      && !testModeAllowed(eventId, actorUserId)) {
      throw new QualityAnalysisError("FORBIDDEN", "需要显式quality_management能力才能处理质量初析");
    }
  }

  function getEvent(eventId: string): DatabaseRow {
    const row = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(eventId) as DatabaseRow | undefined;
    if (!row) throw new Error("quality event not found");
    return row;
  }

  function getAttempt(attemptId: string): QualityAnalysisAttemptView | null {
    const row = db.prepare("SELECT * FROM quality_analysis_attempts WHERE attempt_id=?")
      .get(attemptId) as DatabaseRow | undefined;
    return row ? attemptFromRow(row) : null;
  }

  function listAttempts(eventId: string): QualityAnalysisAttemptView[] {
    return (db.prepare(`SELECT * FROM quality_analysis_attempts
      WHERE event_id=? ORDER BY attempt_no DESC`).all(eventId) as DatabaseRow[])
      .map(attemptFromRow);
  }

  function appendAudit(input: {
    eventId: string;
    actorUserId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    requestId: string;
    occurredAt: string;
  }): void {
    db.prepare(`INSERT INTO quality_audit_events(
      id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
    ) VALUES(?,?,?,'quality_specialist',?,?,?,?,?,?)`).run(
      id(), input.eventId, input.actorUserId, input.action,
      input.before == null ? null : JSON.stringify(input.before),
      input.after == null ? null : JSON.stringify(input.after),
      input.reason ?? null, input.requestId, input.occurredAt,
    );
  }

  function reportingContext(eventId: string): {
    sourceSnapshots: Array<Record<string, unknown>>;
    aiOriginalAssessments: Array<Record<string, unknown>>;
    managerAssessments: Array<Record<string, unknown>>;
    frozenAt: string | null;
  } {
    const row = db.prepare("SELECT * FROM quality_event_reporting_snapshots WHERE event_id=?")
      .get(eventId) as DatabaseRow | undefined;
    if (!row) return { sourceSnapshots: [], aiOriginalAssessments: [], managerAssessments: [], frozenAt: null };
    return {
      sourceSnapshots: parseJson(row.source_snapshots_json, []),
      aiOriginalAssessments: parseJson(row.ai_assessments_json, []),
      managerAssessments: parseJson(row.manager_assessments_json, []),
      frozenAt: nullable(row.frozen_at),
    };
  }

  function prepareInput(eventId: string, requestId: string, actorUserId: string): QualityAnalysisInput {
    const event = getEvent(eventId);
    if (!["PENDING_ANALYSIS", "PENDING_ASSIGNMENT"].includes(String(event.status))) {
      throw new Error("当前事件不在可初析状态");
    }
    const testMode = testModeAllowed(eventId, actorUserId);
    const reporting = testMode && deps?.testMode?.reportingContext
      ? deps.testMode.reportingContext
      : reportingContext(eventId);
    const departments = testMode
      ? deps!.testMode!.departmentCandidates
      : (() => {
          const directory = createQualityDepartmentDirectory(dbPath);
          try { return directory.listAssignableDepartments(); } finally { directory.close(); }
        })();
    if (departments.length === 0) throw new Error("系统中没有已配置唯一有效主管的主责部门");
    const attachments = (db.prepare(`SELECT original_name,mime_type,description,created_at
      FROM quality_report_files WHERE event_id=? AND status='ACTIVE' ORDER BY created_at,id`)
      .all(eventId) as DatabaseRow[]).map((row) => ({
        fileName: String(row.original_name),
        mimeType: String(row.mime_type),
        uploadedAt: String(row.created_at),
        humanDescription: String(row.description ?? ""),
        contentInspected: false as const,
      }));
    const manager = reporting.managerAssessments[0] ?? {};
    const confirmedCategory = String(
      manager.categoryDisplayName ?? event.initial_category ?? "",
    ).trim() || null;
    const cases: Array<Record<string, unknown>> = [];
    for (const item of reporting.aiOriginalAssessments) {
      const assessment = item.assessment as Record<string, unknown> | null | undefined;
      const retrieved = assessment?.retrievedCases;
      if (Array.isArray(retrieved)) {
        for (const candidate of retrieved) {
          if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
            cases.push(candidate as Record<string, unknown>);
          }
        }
      }
    }
    const latestVersion = db.prepare(`SELECT COALESCE(MAX(analysis_version),0) AS version
      FROM quality_analysis_versions WHERE event_id=?`).get(eventId) as DatabaseRow;
    const requestedAt = now();
    return qualityAnalysisInputSchema.parse({
      schemaVersion: QUALITY_ANALYSIS_INPUT_SCHEMA_VERSION,
      inputVersion: `quality-event:${eventId}:event-v${event.version}:analysis-v${Number(latestVersion.version)}`,
      event: {
        qualityEventId: eventId,
        eventNo: String(event.event_no),
        title: String(event.title),
        problemStatus: String(event.problem_status),
        occurredAt: nullable(event.occurred_at),
        impact: nullable(event.impact),
        riskLevel: nullable(event.urgency),
        confirmedCategory,
        eventVersion: Number(event.version),
      },
      frozenReportingContext: reporting,
      similarHistoricalCases: cases.slice(0, 20),
      attachments,
      departmentCandidates: departments.map(({ departmentId, departmentName }) => ({ departmentId, departmentName })),
      ruleContext: {
        version: QUALITY_ANALYSIS_RULE_VERSION,
        confirmedCategoryReadOnly: confirmedCategory,
        factHypothesisSeparationRequired: true,
      },
      productKnowledge: {
        version: QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
        statements: HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.map((category) =>
          `${category.primaryLabel}：${category.primaryDefinition}`,
        ),
      },
      runMetadata: {
        requestId,
        promptVersion: QUALITY_ANALYSIS_PROMPT_VERSION,
        modelConfigId: QUALITY_ANALYSIS_MODEL_CONFIG_ID,
        requestedBy: actorUserId,
        requestedAt,
      },
    });
  }

  async function generate(input: {
    eventId: string;
    actorUserId: string;
    requestId: string;
  }): Promise<QualityAnalysisAttemptView> {
    requireQualityManagement(input.eventId, input.actorUserId);
    const repeated = db.prepare(`SELECT * FROM quality_analysis_attempts
      WHERE event_id=? AND request_id=?`).get(input.eventId, input.requestId) as DatabaseRow | undefined;
    if (repeated) return attemptFromRow(repeated);
    const prepared = prepareInput(input.eventId, input.requestId, input.actorUserId);
    const attemptId = id();
    const createdAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const next = db.prepare(`SELECT COALESCE(MAX(attempt_no),0)+1 AS attempt_no
        FROM quality_analysis_attempts WHERE event_id=?`).get(input.eventId) as DatabaseRow;
      db.prepare(`INSERT INTO quality_analysis_attempts(
        attempt_id,event_id,attempt_no,request_id,status,schema_version,prompt_version,
        model_config_id,input_version,input_json,created_by,created_at
      ) VALUES(?,?,?,?,'GENERATING',?,?,?,?,?,?,?)`).run(
        attemptId, input.eventId, Number(next.attempt_no), input.requestId,
        QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION, QUALITY_ANALYSIS_PROMPT_VERSION,
        QUALITY_ANALYSIS_MODEL_CONFIG_ID, prepared.inputVersion, JSON.stringify(prepared),
        input.actorUserId, createdAt,
      );
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "QUALITY_ANALYSIS_AI_STARTED",
        after: { attemptId, inputVersion: prepared.inputVersion },
        requestId: input.requestId,
        occurredAt: createdAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    let model = deps?.model;
    if (!model) {
      const config = loadQwenQualityAnalysisConfig(deps?.env ?? process.env);
      if (!config) {
        const completedAt = now();
        db.prepare(`UPDATE quality_analysis_attempts SET status='FAILED',failure_code=?,failure_reason=?,completed_at=?
          WHERE attempt_id=? AND status='GENERATING'`).run(
          "MODEL_NOT_CONFIGURED", "项目默认Qwen模型未配置", completedAt, attemptId,
        );
        appendAudit({
          eventId: input.eventId,
          actorUserId: input.actorUserId,
          action: "QUALITY_ANALYSIS_AI_FAILED",
          after: { attemptId, code: "MODEL_NOT_CONFIGURED" },
          requestId: input.requestId,
          occurredAt: completedAt,
        });
        throw new QualityAnalysisError("MODEL_NOT_CONFIGURED", "项目默认Qwen模型未配置，可继续人工填写初析");
      }
      model = new QwenQualityAnalysisModel(config);
    }

    const started = Date.now();
    try {
      const response = await model.generate(prepared);
      const validation = validateQualityAnalysisOutput(prepared, response.payload);
      const completedAt = now();
      if (!validation.ok) {
        db.prepare(`UPDATE quality_analysis_attempts SET status='FAILED',model_name=?,raw_content=?,
          failure_code='MODEL_OUTPUT_INVALID',failure_reason=?,validation_issues_json=?,duration_ms=?,completed_at=?
          WHERE attempt_id=? AND status='GENERATING'`).run(
          response.trace.model, response.rawContent.slice(0, 100_000),
          "模型返回未通过严格Schema与业务校验", JSON.stringify(validation.issues),
          Date.now() - started, completedAt, attemptId,
        );
        appendAudit({
          eventId: input.eventId,
          actorUserId: input.actorUserId,
          action: "QUALITY_ANALYSIS_AI_FAILED",
          after: { attemptId, code: "MODEL_OUTPUT_INVALID", validationIssues: validation.issues },
          requestId: input.requestId,
          occurredAt: completedAt,
        });
        throw new QualityAnalysisError("MODEL_OUTPUT_INVALID", "AI返回未通过严格校验，可重试或继续人工填写");
      }
      const usage = response.trace.tokenUsage;
      db.prepare(`UPDATE quality_analysis_attempts SET status='SUCCEEDED',model_name=?,output_json=?,raw_content=?,
        prompt_tokens=?,completion_tokens=?,total_tokens=?,duration_ms=?,completed_at=?
        WHERE attempt_id=? AND status='GENERATING'`).run(
        response.trace.model, JSON.stringify(validation.output), response.rawContent.slice(0, 100_000),
        usage.promptTokens, usage.completionTokens, usage.totalTokens,
        response.trace.latencyMs || Date.now() - started, completedAt, attemptId,
      );
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "QUALITY_ANALYSIS_AI_SUCCEEDED",
        after: { attemptId, model: response.trace.model, tokenUsage: usage },
        requestId: input.requestId,
        occurredAt: completedAt,
      });
      return getAttempt(attemptId)!;
    } catch (error) {
      if (error instanceof QualityAnalysisError) throw error;
      const completedAt = now();
      const reason = safeFailure(error);
      const modelError = error instanceof QualityAnalysisModelCallError ? error : null;
      const failureCode = modelError?.code ?? "MODEL_CALL_FAILED";
      const durationMs = modelError?.durationMs ?? Date.now() - started;
      db.prepare(`UPDATE quality_analysis_attempts SET status='FAILED',model_name=?,failure_code=?,
        failure_reason=?,duration_ms=?,completed_at=? WHERE attempt_id=? AND status='GENERATING'`)
        .run(modelError?.model ?? null, failureCode, reason, durationMs, completedAt, attemptId);
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "QUALITY_ANALYSIS_AI_FAILED",
        after: { attemptId, code: failureCode, model: modelError?.model ?? null, durationMs, reason },
        requestId: input.requestId,
        occurredAt: completedAt,
      });
      throw new QualityAnalysisError(
        failureCode,
        failureCode === "MODEL_TIMEOUT"
          ? "AI质量初析未在时限内返回，可重试或继续人工填写"
          : "AI质量初析调用失败，可重试或继续人工填写",
      );
    }
  }

  function readDraft(eventId: string): Record<string, unknown> | null {
    const row = db.prepare("SELECT * FROM quality_analysis_drafts WHERE event_id=?")
      .get(eventId) as DatabaseRow | undefined;
    if (!row) return null;
    return {
      eventId,
      baseAttemptId: nullable(row.base_attempt_id),
      content: parseJson(row.content_json, {}),
      deliverables: parseJson(row.deliverables_json, []),
      primaryDepartmentId: nullable(row.primary_department_id),
      collaboratorDepartmentIds: parseJson(row.collaborator_department_ids_json, []),
      modificationReason: String(row.modification_reason ?? ""),
      createdBy: String(row.created_by),
      updatedBy: String(row.updated_by),
      version: Number(row.version),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  function saveDraft(input: {
    eventId: string;
    actorUserId: string;
    draft: SaveQualityAnalysisDraftInput;
  }): Record<string, unknown> {
    requireQualityManagement(input.eventId, input.actorUserId);
    const draft = saveQualityAnalysisDraftSchema.parse(input.draft);
    const event = getEvent(input.eventId);
    if (!["PENDING_ANALYSIS", "PENDING_ASSIGNMENT"].includes(String(event.status))) {
      throw new Error("当前事件不可保存质量初析草稿");
    }
    if (draft.baseAttemptId) {
      const attempt = getAttempt(draft.baseAttemptId);
      if (!attempt || attempt.eventId !== input.eventId || attempt.status !== "SUCCEEDED") {
        throw new Error("AI初析原稿不存在或不可用");
      }
    }
    const deliverables = validateDeliverables(draft.deliverables);
    const directory = createQualityDepartmentDirectory(dbPath);
    const departments = directory.listAssignableDepartments();
    directory.close();
    const departmentIds = new Set(departments.map((item) => item.departmentId));
    if (draft.primaryDepartmentId && !departmentIds.has(draft.primaryDepartmentId)) {
      throw new Error("主责部门不存在");
    }
    // Collaboration is decided later in the existing task planner. Quality
    // analysis only recommends one primary department.
    const collaborators: string[] = [];
    const occurredAt = now();
    const current = readDraft(input.eventId);
    if (Number(current?.version ?? 0) !== draft.expectedVersion) throw new Error("version conflict");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!current) {
        db.prepare(`INSERT INTO quality_analysis_drafts(
          event_id,base_attempt_id,content_json,deliverables_json,primary_department_id,
          collaborator_department_ids_json,modification_reason,created_by,updated_by,version,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`).run(
          input.eventId, draft.baseAttemptId ?? null, JSON.stringify(draft.content),
          JSON.stringify(deliverables), draft.primaryDepartmentId,
          JSON.stringify(collaborators), draft.modificationReason,
          input.actorUserId, input.actorUserId, occurredAt, occurredAt,
        );
      } else {
        const updated = db.prepare(`UPDATE quality_analysis_drafts SET
          base_attempt_id=?,content_json=?,deliverables_json=?,primary_department_id=?,
          collaborator_department_ids_json=?,modification_reason=?,updated_by=?,version=version+1,updated_at=?
          WHERE event_id=? AND version=?`).run(
          draft.baseAttemptId ?? null, JSON.stringify(draft.content), JSON.stringify(deliverables),
          draft.primaryDepartmentId, JSON.stringify(collaborators), draft.modificationReason,
          input.actorUserId, occurredAt, input.eventId, draft.expectedVersion,
        );
        if (Number(updated.changes) !== 1) throw new Error("version conflict");
      }
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "QUALITY_ANALYSIS_DRAFT_SAVED",
        before: current,
        after: { version: draft.expectedVersion + 1, baseAttemptId: draft.baseAttemptId ?? null },
        reason: draft.modificationReason || null,
        requestId: draft.requestId,
        occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return readDraft(input.eventId)!;
  }

  function versionFromRow(row: DatabaseRow): Record<string, unknown> {
    return {
      analysisId: String(row.analysis_id),
      eventId: String(row.event_id),
      analysisVersion: Number(row.analysis_version),
      requestId: String(row.request_id),
      baseAttemptId: nullable(row.base_attempt_id),
      content: parseJson(row.content_json, {}),
      deliverables: parseJson(row.deliverables_json, []),
      diff: parseJson(row.diff_json, {}),
      modificationReason: String(row.modification_reason),
      primaryDepartmentId: String(row.primary_department_id),
      primaryDepartmentName: String(row.primary_department_name),
      collaboratorDepartments: parseJson(row.collaborator_departments_json, []),
      primaryManagerUserId: String(row.primary_manager_user_id),
      primaryManagerName: String(row.primary_manager_name),
      primaryManagerAccountStatus: String(row.primary_manager_account_status),
      suggestedTotalDueAt: String(row.suggested_total_due_at),
      schemaVersion: String(row.schema_version),
      promptVersion: nullable(row.prompt_version),
      modelConfigId: nullable(row.model_config_id),
      inputVersion: nullable(row.input_version),
      ruleVersion: String(row.rule_version),
      caseLibraryVersion: String(row.case_library_version),
      knowledgeVersion: String(row.knowledge_version),
      generatedBy: nullable(row.generated_by),
      editedBy: String(row.edited_by),
      confirmedBy: String(row.confirmed_by),
      confirmedAt: String(row.confirmed_at),
    };
  }

  function listVersions(eventId: string): Array<Record<string, unknown>> {
    return (db.prepare(`SELECT * FROM quality_analysis_versions WHERE event_id=?
      ORDER BY analysis_version DESC`).all(eventId) as DatabaseRow[]).map(versionFromRow);
  }

  function buildTaskPackage(input: {
    event: DatabaseRow;
    analysisVersion: number;
    content: QualityAnalysisDraftContent;
    deliverables: QualityDeliverable[];
    primaryDepartmentId: string;
    primaryDepartmentName: string;
    managerUserId: string;
    managerName: string;
    confirmedBy: string;
    confirmedAt: string;
  }): Record<string, unknown> {
    const reporting = reportingContext(String(input.event.id));
    const attachments = (db.prepare(`SELECT original_name,mime_type,description,created_at
      FROM quality_report_files WHERE event_id=? AND status='ACTIVE' ORDER BY created_at,id`)
      .all(String(input.event.id)) as DatabaseRow[]).map((row) => ({
        fileName: String(row.original_name),
        mimeType: String(row.mime_type),
        uploadedAt: String(row.created_at),
        humanDescription: String(row.description ?? ""),
      }));
    return {
      schemaVersion: "quality-task-package-v1",
      qualityEventId: String(input.event.id),
      eventNo: String(input.event.event_no),
      eventTitle: String(input.event.title),
      publicFactSummary: input.content.sourceFactSummary,
      confirmedCategory: input.content.confirmedCategoryReference,
      formalQualityAnalysis: input.content,
      problemDirection: input.content.problemDirection,
      analysisBasis: input.content.analysisBasis,
      preliminaryConclusion: input.content.preliminaryConclusion,
      informationGaps: input.content.informationGaps,
      primaryDepartment: { departmentId: input.primaryDepartmentId, departmentName: input.primaryDepartmentName },
      handlingRequirements: input.content.handlingRequirements,
      requiredDeliverables: selectedDeliverables(input.deliverables),
      suggestedTotalDueAt: input.content.suggestedTotalDueAt,
      attachments,
      reportingSnapshotFrozenAt: reporting.frozenAt,
      analysisVersion: input.analysisVersion,
      audit: { confirmedBy: input.confirmedBy, confirmedAt: input.confirmedAt },
      firstResponsibleManager: { userId: input.managerUserId, name: input.managerName },
    };
  }

  function stagePlanningThread(input: {
    managerUserId: string;
    eventTitle: string;
    eventNo: string;
    package: Record<string, unknown>;
    integrationKey: string;
  }) {
    const side = createSideThreadSession(input.managerUserId);
    const deliverables = input.package.requiredDeliverables as QualityDeliverable[];
    const dueAt = String(input.package.suggestedTotalDueAt);
    const lines = (value: unknown): string[] => Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : String(value ?? "").trim() ? [String(value).trim()] : [];
    const bullets = (value: unknown, empty = "无"): string => {
      const items = lines(value);
      return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
    };
    const tasks = deliverables.map((deliverable, index) => ({
      id: `task_${index + 1}`,
      title: deliverable.name,
      objective: deliverable.description,
      deliverables: [deliverable.name],
      completionCriteria: [deliverable.acceptanceCriteria],
      timeNode: { dueAt },
      qualityDeliverableIds: [deliverable.deliverableId],
      qualityEventId: input.package.qualityEventId,
    }));
    const primaryDepartment = input.package.primaryDepartment as {
      departmentName?: unknown;
    } | undefined;
    const description = [
      `# 质量事件任务草稿｜${input.eventNo}`,
      "",
      `**事件标题：** ${input.eventTitle}`,
      `**建议主责部门：** ${String(primaryDepartment?.departmentName ?? "待确认")}`,
      `**建议总期限：** ${dueAt}`,
      "",
      "## 来源事实摘要",
      bullets(input.package.publicFactSummary, "尚未提供"),
      "",
      "## 质量初析",
      `- 问题方向：${String(input.package.problemDirection ?? "待确认")}`,
      `- 人工确认分类：${String(input.package.confirmedCategory ?? "待确认")}`,
      `- 初步结论：${String(input.package.preliminaryConclusion ?? "待确认")}`,
      "",
      "## 分析依据",
      bullets(input.package.analysisBasis, "尚未提供"),
      "",
      "## 信息缺口",
      bullets(input.package.informationGaps),
      "",
      "## 处理要求",
      bullets(input.package.handlingRequirements, "尚未提供"),
      "",
      "## 主管下一步",
      "请在原智能规划助手中核对并完善任务拆解、具体负责人、各项期限和协同关系；发布前必须覆盖下方全部必选成果。正式负责人和执行人仅以原任务系统发布结果为准。",
    ].join("\n");
    const displayContent = [
      `## 已接收质量事件 ${input.eventNo}`,
      "",
      `质量专员已完成正式初析，并建议由 **${String(primaryDepartment?.departmentName ?? "待确认部门")}** 进入任务规划。`,
      "",
      `- 事件：${input.eventTitle}`,
      `- 建议总期限：${dueAt}`,
      `- 必须成果：${deliverables.map((item) => item.name).join("、")}`,
      "",
      "我已把来源事实、质量初析、处理要求和必须成果写入草稿。请打开草稿表格补充具体负责人和必要的分解项，确认覆盖完整后再按原流程发布。",
    ].join("\n");
    const staged = {
      ...side,
      threadLabel: `质量事件 ${input.eventNo}`.slice(0, 40),
      latestDraft: {
        title: `${input.eventNo} ${input.eventTitle}`.slice(0, 200),
        description,
        summary: description,
        tasks,
        qualityTaskPackage: input.package,
        qualityHandoff: {
          integrationKey: input.integrationKey,
          qualityEventId: input.package.qualityEventId,
          analysisVersion: input.package.analysisVersion,
          requiredDeliverableIds: deliverables.map((item) => item.deliverableId),
        },
      },
      conversationHistory: [{
        role: "assistant",
        content: displayContent,
        displayContent,
        at: now(),
      }],
      knownFacts: [
        `qualityEventId:${String(input.package.qualityEventId)}`,
        `qualityAnalysisVersion:${String(input.package.analysisVersion)}`,
        `qualityIntegrationKey:${input.integrationKey}`,
      ],
    };
    conversationPlanSessionStore.save(staged);
    return staged;
  }

  function confirm(input: {
    eventId: string;
    actorUserId: string;
    expectedDraftVersion: number;
    expectedEventVersion: number;
    requestId: string;
    modificationReason: string;
  }): { version: Record<string, unknown>; handoff: Record<string, unknown> } {
    requireQualityManagement(input.eventId, input.actorUserId);
    const repeated = db.prepare(`SELECT * FROM quality_analysis_versions WHERE request_id=?`)
      .get(input.requestId) as DatabaseRow | undefined;
    if (repeated) {
      const handoff = db.prepare(`SELECT * FROM quality_analysis_handoffs
        WHERE event_id=? AND analysis_version=?`).get(
        input.eventId, Number(repeated.analysis_version),
      ) as DatabaseRow;
      return { version: versionFromRow(repeated), handoff: handoffView(handoff) };
    }
    const event = getEvent(input.eventId);
    if (Number(event.version) !== input.expectedEventVersion) throw new Error("version conflict");
    if (!["PENDING_ANALYSIS", "PENDING_ASSIGNMENT"].includes(String(event.status))) {
      throw new Error("当前事件不可确认质量初析");
    }
    const rawDraft = db.prepare("SELECT * FROM quality_analysis_drafts WHERE event_id=?")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!rawDraft) throw new Error("质量初析草稿不存在");
    if (Number(rawDraft.version) !== input.expectedDraftVersion) throw new Error("version conflict");
    const content = parseJson(rawDraft.content_json, {}) as QualityAnalysisDraftContent;
    const deliverables = validateDeliverables(parseJson(rawDraft.deliverables_json, []));
    selectedDeliverables(deliverables);
    const primaryDepartmentId = String(rawDraft.primary_department_id ?? "").trim();
    if (!primaryDepartmentId) throw new Error("必须选择一个主责部门");
    const directory = createQualityDepartmentDirectory(dbPath);
    const manager = directory.resolveManager(primaryDepartmentId);
    directory.close();
    if (manager.status !== "READY" || !manager.department || !manager.managerUserId || !manager.managerName) {
      throw new Error(manager.message);
    }
    const baseAttempt = rawDraft.base_attempt_id == null
      ? null
      : getAttempt(String(rawDraft.base_attempt_id));
    if (baseAttempt && baseAttempt.status !== "SUCCEEDED") throw new Error("AI初析原稿不可用");
    const nextRow = db.prepare(`SELECT COALESCE(MAX(analysis_version),0)+1 AS version
      FROM quality_analysis_versions WHERE event_id=?`).get(input.eventId) as DatabaseRow;
    const analysisVersion = Number(nextRow.version);
    const occurredAt = now();
    const integrationKey = `quality-analysis:${input.eventId}:v${analysisVersion}`;
    const taskPackage = buildTaskPackage({
      event,
      analysisVersion,
      content,
      deliverables,
      primaryDepartmentId,
      primaryDepartmentName: manager.department.departmentName,
      managerUserId: manager.managerUserId,
      managerName: manager.managerName,
      confirmedBy: input.actorUserId,
      confirmedAt: occurredAt,
    });
    const planning = stagePlanningThread({
      managerUserId: manager.managerUserId,
      eventTitle: String(event.title),
      eventNo: String(event.event_no),
      package: taskPackage,
      integrationKey,
    });
    const analysisId = id();
    const handoffId = id();
    const diff = analysisDiff(baseAttempt, content, deliverables, primaryDepartmentId);
    const frozenAiAssessment = baseAttempt?.input.frozenReportingContext.aiOriginalAssessments
      .map((item) => item.assessment)
      .find((item) => item && typeof item === "object" && !Array.isArray(item)) as
      Record<string, unknown> | undefined;
    const frozenAiOutput = frozenAiAssessment?.output && typeof frozenAiAssessment.output === "object"
      && !Array.isArray(frozenAiAssessment.output)
      ? frozenAiAssessment.output as Record<string, unknown>
      : undefined;
    const frozenAiProvenance = frozenAiOutput?.provenance && typeof frozenAiOutput.provenance === "object"
      && !Array.isArray(frozenAiOutput.provenance)
      ? frozenAiOutput.provenance as Record<string, unknown>
      : undefined;
    const caseVersion = String(
      frozenAiProvenance?.caseLibraryVersion ?? "frozen-reporting-cases",
    ).slice(0, 200);
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`INSERT INTO quality_analysis_versions(
        analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,deliverables_json,diff_json,
        modification_reason,primary_department_id,primary_department_name,collaborator_departments_json,
        primary_manager_user_id,primary_manager_name,primary_manager_account_status,suggested_total_due_at,
        schema_version,prompt_version,model_config_id,input_version,rule_version,case_library_version,
        knowledge_version,generated_by,edited_by,confirmed_by,confirmed_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        analysisId, input.eventId, analysisVersion, input.requestId,
        baseAttempt?.attemptId ?? null, JSON.stringify(content), JSON.stringify(deliverables),
        JSON.stringify(diff), input.modificationReason.trim(), primaryDepartmentId,
        manager.department.departmentName, JSON.stringify([]), manager.managerUserId,
        manager.managerName, "ACTIVE", content.suggestedTotalDueAt,
        QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION, baseAttempt?.promptVersion ?? null,
        baseAttempt?.modelConfigId ?? null, baseAttempt?.inputVersion ?? null,
        QUALITY_ANALYSIS_RULE_VERSION, caseVersion, QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
        baseAttempt?.createdBy ?? null, String(rawDraft.updated_by), input.actorUserId, occurredAt, occurredAt,
      );
      db.prepare(`INSERT INTO quality_analysis_handoffs(
        handoff_id,event_id,analysis_version,integration_key,primary_department_id,
        primary_department_name,primary_manager_user_id,task_package_json,plan_id,thread_id,status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING_PLANNING',?)`).run(
        handoffId, input.eventId, analysisVersion, integrationKey, primaryDepartmentId,
        manager.department.departmentName, manager.managerUserId, JSON.stringify(taskPackage),
        planning.planId, planning.threadId ?? null, occurredAt,
      );
      const updated = db.prepare(`UPDATE quality_events SET status='PENDING_ASSIGNMENT',
        original_primary_department_id=?,overall_due_at=?,version=version+1,updated_at=?
        WHERE id=? AND version=? AND status IN ('PENDING_ANALYSIS','PENDING_ASSIGNMENT')`).run(
        primaryDepartmentId, content.suggestedTotalDueAt, occurredAt,
        input.eventId, input.expectedEventVersion,
      );
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.actorUserId,
        action: "QUALITY_ANALYSIS_CONFIRMED",
        before: { eventVersion: input.expectedEventVersion, draftVersion: input.expectedDraftVersion },
        after: { analysisVersion, integrationKey, primaryManagerUserId: manager.managerUserId },
        reason: input.modificationReason.trim(),
        requestId: input.requestId,
        occurredAt,
      });
      enqueueQualityNotification(db, {
        eventId: input.eventId,
        action: "QUALITY_ANALYSIS_HANDOFF",
        recipientUserId: manager.managerUserId,
        subject: `质量任务包待规划：${String(event.event_no)}`,
        markdown: `### ${String(event.title)}\n\n正式质量初析 V${analysisVersion} 已确认，请打开现有任务规划系统拆解、分配并发布任务。`,
        detailUrl: `${String(process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(String(planning.threadId))}&openDraftEditor=1`,
        dedupeKey: integrationKey,
      }, occurredAt);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      deleteSideThreadSession(manager.managerUserId, String(planning.threadId));
      throw error;
    }
    const savedVersion = db.prepare("SELECT * FROM quality_analysis_versions WHERE analysis_id=?")
      .get(analysisId) as DatabaseRow;
    const savedHandoff = db.prepare("SELECT * FROM quality_analysis_handoffs WHERE handoff_id=?")
      .get(handoffId) as DatabaseRow;
    return { version: versionFromRow(savedVersion), handoff: handoffView(savedHandoff) };
  }

  function handoffView(row: DatabaseRow): Record<string, unknown> {
    return {
      handoffId: String(row.handoff_id),
      eventId: String(row.event_id),
      analysisVersion: Number(row.analysis_version),
      integrationKey: String(row.integration_key),
      primaryDepartmentId: String(row.primary_department_id),
      primaryDepartmentName: String(row.primary_department_name),
      primaryManagerUserId: String(row.primary_manager_user_id),
      taskPackage: parseJson(row.task_package_json, {}),
      planId: String(row.plan_id),
      threadId: String(row.thread_id),
      status: String(row.status),
      formalTaskId: nullable(row.formal_task_id),
      formalTaskNo: nullable(row.formal_task_no),
      formalTaskTitle: nullable(row.formal_task_title),
      createdAt: String(row.created_at),
      planningUrl: `/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(String(row.thread_id))}&openDraftEditor=1`,
    };
  }

  function reconcilePublishedHandoff(eventId: string): boolean {
    const hasFormalTasks = db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='tasks'",
    ).get() as DatabaseRow | undefined;
    if (!hasFormalTasks) return false;
    db.prepare(`UPDATE quality_analysis_handoffs
      SET status='PUBLISHED',
          formal_task_id=(SELECT t.task_id FROM tasks t WHERE t.plan_id=quality_analysis_handoffs.plan_id),
          published_at=COALESCE(
            published_at,
            (SELECT t.published_at FROM tasks t WHERE t.plan_id=quality_analysis_handoffs.plan_id)
          )
      WHERE event_id=?
        AND EXISTS (SELECT 1 FROM tasks t WHERE t.plan_id=quality_analysis_handoffs.plan_id)`)
      .run(eventId);
    return true;
  }

  function workspace(input: { eventId: string; viewerUserId: string }): Record<string, unknown> {
    const event = getEvent(input.eventId);
    const caps = resolveQualityCapabilities(input.viewerUserId);
    const latestVersion = db.prepare(`SELECT * FROM quality_analysis_versions
      WHERE event_id=? ORDER BY analysis_version DESC LIMIT 1`).get(input.eventId) as DatabaseRow | undefined;
    const canView = caps.baseRole === "admin"
      || caps.canAnalyzeQuality
      || (caps.canReportQuality && String(event.created_by) === input.viewerUserId)
      || (latestVersion && String(latestVersion.primary_manager_user_id) === input.viewerUserId);
    if (!canView) throw new Error("quality analysis forbidden");
    const directory = createQualityDepartmentDirectory(dbPath);
    const departments = directory.listAssignableDepartments();
    const rawDraft = readDraft(input.eventId);
    const managerResolution = rawDraft?.primaryDepartmentId
      ? directory.resolveManager(String(rawDraft.primaryDepartmentId))
      : null;
    directory.close();
    // Formal task SQLite remains authoritative. This idempotent read-side
    // reconciliation only records the quality-context association after the
    // existing planner has actually published a task for the handoff planId.
    const hasFormalTasks = reconcilePublishedHandoff(input.eventId);
    const handoffSql = hasFormalTasks
      ? `SELECT h.*, t.task_no AS formal_task_no, t.title AS formal_task_title
          FROM quality_analysis_handoffs h
          LEFT JOIN tasks t ON t.task_id=h.formal_task_id
          WHERE h.event_id=? ORDER BY h.analysis_version DESC`
      : `SELECT h.*, NULL AS formal_task_no, NULL AS formal_task_title
          FROM quality_analysis_handoffs h
          WHERE h.event_id=? ORDER BY h.analysis_version DESC`;
    const handoffs = (db.prepare(handoffSql).all(input.eventId) as DatabaseRow[]).map(handoffView);
    const files = (db.prepare(`SELECT id,original_name,mime_type,description,uploaded_by,created_at
      FROM quality_report_files WHERE event_id=? AND status='ACTIVE' ORDER BY created_at,id`)
      .all(input.eventId) as DatabaseRow[]).map((row) => ({
        fileId: String(row.id),
        fileName: String(row.original_name),
        mimeType: String(row.mime_type),
        humanDescription: String(row.description ?? ""),
        uploadedBy: String(row.uploaded_by),
        uploadedAt: String(row.created_at),
      }));
    return {
      event: {
        eventId: String(event.id),
        eventNo: String(event.event_no),
        title: String(event.title),
        status: String(event.status),
        version: Number(event.version),
        createdBy: String(event.created_by),
      },
      canEdit: caps.canAnalyzeQuality,
      isBusinessReadOnly: caps.isBusinessReadOnly || !caps.canAnalyzeQuality,
      attempts: listAttempts(input.eventId),
      draft: rawDraft,
      versions: listVersions(input.eventId),
      handoffs,
      departments,
      managerResolution,
      attachments: files,
      modelConfigured: Boolean(loadQwenQualityAnalysisConfig(deps?.env ?? process.env)),
    };
  }

  return {
    prepareInput,
    generate,
    getAttempt,
    listAttempts,
    readDraft,
    saveDraft,
    listVersions,
    confirm,
    workspace,
    close: () => db.close(),
  };
}
