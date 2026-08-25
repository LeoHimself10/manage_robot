import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { PlanSession, QualityTaskSourceContext } from "../../infra/plan-session-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";

type DatabaseRow = Record<string, unknown>;

export interface QualityAnalysisFields {
  problemDirection: string;
  confirmedCategory: string;
  sourceSummary: string;
  analysisBasis: string;
  initialConclusion: string;
  informationGaps: string;
  suggestedDepartment: string;
  processingRequirements: string;
  suggestedDueAt: string;
}

export interface QualityAnalysisVersion extends QualityAnalysisFields {
  analysisId: string;
  eventId: string;
  version: number;
  status: "DRAFT" | "COMPLETED";
  createdBy: string;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityPlanningRecord {
  eventId: string;
  eventVersion: number;
  analysisVersionId: string;
  managerUserId: string;
  threadId: string;
  planId: string;
  sourceHash: string;
  handoffSnapshot: QualityTaskSourceContext["handoffSnapshot"];
  bindingStatus: QualityTaskSourceContext["bindingStatus"];
  taskId: string | null;
  requestId: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityPlanningPublishResult {
  bound: boolean;
  eventId: string;
  taskId: string | null;
  bindingStatus: "BOUND" | "REPAIR_REQUIRED";
  error?: string;
}

const ANALYSIS_FIELD_COLUMNS: Record<keyof QualityAnalysisFields, string> = {
  problemDirection: "problem_direction",
  confirmedCategory: "confirmed_category",
  sourceSummary: "source_summary",
  analysisBasis: "analysis_basis",
  initialConclusion: "initial_conclusion",
  informationGaps: "information_gaps",
  suggestedDepartment: "suggested_department",
  processingRequirements: "processing_requirements",
  suggestedDueAt: "suggested_due_at",
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
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

function analysisFromRow(row: DatabaseRow): QualityAnalysisVersion {
  return {
    analysisId: String(row.analysis_id),
    eventId: String(row.event_id),
    version: Number(row.version),
    status: String(row.status) as QualityAnalysisVersion["status"],
    problemDirection: String(row.problem_direction ?? ""),
    confirmedCategory: String(row.confirmed_category ?? ""),
    sourceSummary: String(row.source_summary ?? ""),
    analysisBasis: String(row.analysis_basis ?? ""),
    initialConclusion: String(row.initial_conclusion ?? ""),
    informationGaps: String(row.information_gaps ?? ""),
    suggestedDepartment: String(row.suggested_department ?? ""),
    processingRequirements: String(row.processing_requirements ?? ""),
    suggestedDueAt: String(row.suggested_due_at ?? ""),
    createdBy: String(row.created_by),
    completedBy: nullableText(row.completed_by),
    completedAt: nullableText(row.completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function planningFromRow(row: DatabaseRow): QualityPlanningRecord {
  const snapshot = parseObject(row.handoff_snapshot_json);
  return {
    eventId: String(row.event_id),
    eventVersion: Number(row.event_version),
    analysisVersionId: String(row.analysis_version_id),
    managerUserId: String(row.manager_user_id),
    threadId: String(row.thread_id),
    planId: String(row.plan_id),
    sourceHash: String(row.source_hash),
    handoffSnapshot: {
      title: String(snapshot.title ?? ""),
      publicSummary: String(snapshot.publicSummary ?? ""),
      analysisSummary: String(snapshot.analysisSummary ?? ""),
      suggestedDepartment: nullableText(snapshot.suggestedDepartment) ?? undefined,
      processingRequirements: String(snapshot.processingRequirements ?? ""),
      suggestedDueAt: nullableText(snapshot.suggestedDueAt) ?? undefined,
    },
    bindingStatus: String(row.binding_status) as QualityPlanningRecord["bindingStatus"],
    taskId: nullableText(row.task_id),
    requestId: String(row.request_id),
    lastError: nullableText(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicNodeId(kind: string, value: string): string {
  return `qnode_${createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 24)}`;
}

function cleanAnalysisFields(input: Partial<QualityAnalysisFields>): QualityAnalysisFields {
  const result = {} as QualityAnalysisFields;
  for (const key of Object.keys(ANALYSIS_FIELD_COLUMNS) as Array<keyof QualityAnalysisFields>) {
    const value = text(input[key]);
    if (value.length > 10_000) throw new Error(`${key} exceeded maximum length`);
    result[key] = value;
  }
  return result;
}

function requireCompleteAnalysis(fields: QualityAnalysisFields): void {
  const labels: Record<keyof QualityAnalysisFields, string> = {
    problemDirection: "问题方向",
    confirmedCategory: "人工确认分类",
    sourceSummary: "来源事实摘要",
    analysisBasis: "分析依据",
    initialConclusion: "初步结论",
    informationGaps: "信息缺口",
    suggestedDepartment: "建议责任部门",
    processingRequirements: "处理要求",
    suggestedDueAt: "建议总期限",
  };
  for (const key of Object.keys(labels) as Array<keyof QualityAnalysisFields>) {
    if (!fields[key]) throw new Error(`${labels[key]}必填`);
  }
  if (Number.isNaN(Date.parse(fields.suggestedDueAt))) throw new Error("建议总期限格式无效");
}

function splitRequirements(requirements: string): string[] {
  const lines = requirements
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, "").trim())
    .filter(Boolean);
  return (lines.length > 0 ? lines : [requirements.trim()]).slice(0, 12);
}

function createHandoff(input: {
  event: DatabaseRow;
  analysis: QualityAnalysisVersion;
}): {
  sourceContext: QualityTaskSourceContext;
  latestDraft: Record<string, unknown>;
  threadLabel: string;
} {
  const snapshot: QualityTaskSourceContext["handoffSnapshot"] = {
    title: String(input.event.title),
    publicSummary: String(input.event.problem_status),
    analysisSummary: [
      `问题方向：${input.analysis.problemDirection}`,
      `人工确认分类：${input.analysis.confirmedCategory}`,
      `初步结论：${input.analysis.initialConclusion}`,
      `分析依据：${input.analysis.analysisBasis}`,
      `信息缺口：${input.analysis.informationGaps}`,
    ].join("\n"),
    suggestedDepartment: input.analysis.suggestedDepartment,
    processingRequirements: input.analysis.processingRequirements,
    suggestedDueAt: input.analysis.suggestedDueAt,
  };
  const sourceHash = hashJson({
    eventId: String(input.event.id),
    eventVersion: Number(input.event.version),
    analysisId: input.analysis.analysisId,
    snapshot,
  });
  const sourceContext: QualityTaskSourceContext = {
    kind: "quality_event",
    eventId: String(input.event.id),
    eventNo: String(input.event.event_no),
    eventVersion: Number(input.event.version),
    analysisVersionId: input.analysis.analysisId,
    sourceHash,
    bindingStatus: "DRAFT",
    handoffSnapshot: snapshot,
  };
  const requirementItems = splitRequirements(input.analysis.processingRequirements);
  const latestDraft = {
    planId: "",
    title: `[${String(input.event.event_no)}] ${String(input.event.title)}`,
    description: [
      snapshot.publicSummary,
      snapshot.analysisSummary,
      `建议责任部门：${input.analysis.suggestedDepartment}`,
    ].filter(Boolean).join("\n\n"),
    summary: snapshot.publicSummary,
    tasks: requirementItems.map((requirement, index) => ({
      id: `task_${index + 1}`,
      title: requirement.slice(0, 120),
      objective: requirement,
      deliverables: ["处理记录", "可追溯证据"],
      completionCriteria: [`${requirement}，并提交可核验结果与证据`],
      actions: [requirement],
      timeNode: { dueAt: input.analysis.suggestedDueAt },
      dueAt: input.analysis.suggestedDueAt,
    })),
  };
  return {
    sourceContext,
    latestDraft,
    threadLabel: `${String(input.event.event_no)} · ${String(input.event.title)}`.slice(0, 60),
  };
}

function formalStatusToQuality(status: string): string {
  switch (status) {
    case "ASSIGNED": return "PENDING_ACCEPTANCE";
    case "DONE": return "PENDING_PARENT_REVIEW";
    case "REJECTED": return "REJECTED";
    case "STOPPED": return "CANCELLED";
    default: return "IN_PROGRESS";
  }
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export function isQualityTaskPlanningV2Enabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.QUALITY_TASK_PLANNING_V2_ENABLED ?? "0").trim().toLowerCase(),
  );
}

export function createQualityPlanningService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function getEvent(eventId: string): DatabaseRow {
    const row = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(eventId) as DatabaseRow | undefined;
    if (!row) throw new Error("quality event not found");
    return row;
  }

  function listAnalysisVersions(eventId: string): QualityAnalysisVersion[] {
    getEvent(eventId);
    return (db.prepare(`
      SELECT * FROM quality_analysis_versions WHERE event_id=? ORDER BY version DESC
    `).all(eventId) as DatabaseRow[]).map(analysisFromRow);
  }

  function getLatestAnalysis(eventId: string): QualityAnalysisVersion | null {
    const row = db.prepare(`
      SELECT * FROM quality_analysis_versions WHERE event_id=? ORDER BY version DESC LIMIT 1
    `).get(eventId) as DatabaseRow | undefined;
    return row ? analysisFromRow(row) : null;
  }

  function getPlanningRecord(eventId: string): QualityPlanningRecord | null {
    const row = db.prepare("SELECT * FROM quality_planning_sessions WHERE event_id=?")
      .get(eventId) as DatabaseRow | undefined;
    return row ? planningFromRow(row) : null;
  }

  function saveAnalysisDraft(input: {
    eventId: string;
    actorUserId: string;
    expectedEventVersion: number;
    fields: Partial<QualityAnalysisFields>;
  }): QualityAnalysisVersion {
    const event = getEvent(input.eventId);
    if (String(event.status) !== "PENDING_ASSIGNMENT") {
      throw new Error("质量事件当前不可修改初析");
    }
    if (Number(event.version) !== input.expectedEventVersion) throw new Error("version conflict");
    if (getPlanningRecord(input.eventId)) throw new Error("已进入任务分配，初析不可覆盖");
    const fields = cleanAnalysisFields(input.fields);
    const latest = getLatestAnalysis(input.eventId);
    const occurredAt = now();
    return withTransaction(db, () => {
      if (latest?.status === "DRAFT") {
        db.prepare(`
          UPDATE quality_analysis_versions SET
            problem_direction=?,confirmed_category=?,source_summary=?,analysis_basis=?,
            initial_conclusion=?,information_gaps=?,suggested_department=?,
            processing_requirements=?,suggested_due_at=?,updated_at=?
          WHERE analysis_id=? AND status='DRAFT'
        `).run(
          fields.problemDirection, fields.confirmedCategory, fields.sourceSummary,
          fields.analysisBasis, fields.initialConclusion, fields.informationGaps,
          fields.suggestedDepartment, fields.processingRequirements, fields.suggestedDueAt,
          occurredAt, latest.analysisId,
        );
        return analysisFromRow(db.prepare("SELECT * FROM quality_analysis_versions WHERE analysis_id=?")
          .get(latest.analysisId) as DatabaseRow);
      }
      const analysisId = id();
      const version = (latest?.version ?? 0) + 1;
      db.prepare(`
        INSERT INTO quality_analysis_versions(
          analysis_id,event_id,version,status,problem_direction,confirmed_category,
          source_summary,analysis_basis,initial_conclusion,information_gaps,
          suggested_department,processing_requirements,suggested_due_at,created_by,
          completed_by,completed_at,created_at,updated_at
        ) VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)
      `).run(
        analysisId, input.eventId, version, fields.problemDirection, fields.confirmedCategory,
        fields.sourceSummary, fields.analysisBasis, fields.initialConclusion, fields.informationGaps,
        fields.suggestedDepartment, fields.processingRequirements, fields.suggestedDueAt,
        input.actorUserId, occurredAt, occurredAt,
      );
      return analysisFromRow(db.prepare("SELECT * FROM quality_analysis_versions WHERE analysis_id=?")
        .get(analysisId) as DatabaseRow);
    });
  }

  function completeAnalysis(input: {
    eventId: string;
    analysisId: string;
    actorUserId: string;
  }): QualityAnalysisVersion {
    getEvent(input.eventId);
    const row = db.prepare("SELECT * FROM quality_analysis_versions WHERE analysis_id=? AND event_id=?")
      .get(input.analysisId, input.eventId) as DatabaseRow | undefined;
    if (!row) throw new Error("quality analysis not found");
    const analysis = analysisFromRow(row);
    if (analysis.status === "COMPLETED") return analysis;
    requireCompleteAnalysis(analysis);
    const occurredAt = now();
    db.prepare(`
      UPDATE quality_analysis_versions SET status='COMPLETED',completed_by=?,completed_at=?,updated_at=?
      WHERE analysis_id=? AND status='DRAFT'
    `).run(input.actorUserId, occurredAt, occurredAt, analysis.analysisId);
    return analysisFromRow(db.prepare("SELECT * FROM quality_analysis_versions WHERE analysis_id=?")
      .get(analysis.analysisId) as DatabaseRow);
  }

  function createOrResumePlanningSession(input: {
    eventId: string;
    managerUserId: string;
    expectedEventVersion: number;
    requestId: string;
    createThread: (options: {
      threadLabel: string;
      sourceContext: QualityTaskSourceContext;
      latestDraft: Record<string, unknown>;
    }) => PlanSession;
    saveThread?: (session: PlanSession) => void;
  }): { planning: QualityPlanningRecord; session: PlanSession; created: boolean } {
    const existing = getPlanningRecord(input.eventId);
    if (existing) {
      if (existing.managerUserId !== input.managerUserId) {
        throw new Error("该质量事件已由其他主管进入任务分配");
      }
      const synthetic = {
        threadId: existing.threadId,
        planId: existing.planId,
      } as PlanSession;
      return { planning: existing, session: synthetic, created: false };
    }
    const event = getEvent(input.eventId);
    if (String(event.status) !== "PENDING_ASSIGNMENT") throw new Error("质量事件当前不可进入任务分配");
    if (Number(event.version) !== input.expectedEventVersion) throw new Error("version conflict");
    const completedRow = db.prepare(`
      SELECT * FROM quality_analysis_versions
      WHERE event_id=? AND status='COMPLETED' ORDER BY version DESC LIMIT 1
    `).get(input.eventId) as DatabaseRow | undefined;
    if (!completedRow) throw new Error("请先完成质量初析");
    const analysis = analysisFromRow(completedRow);
    const handoff = createHandoff({ event, analysis });
    const session = input.createThread({
      threadLabel: handoff.threadLabel,
      sourceContext: handoff.sourceContext,
      latestDraft: { ...handoff.latestDraft },
    });
    const threadId = text(session.threadId);
    const planId = text(session.planId);
    if (!threadId || !planId) throw new Error("任务分配会话创建失败");
    session.latestDraft = {
      ...handoff.latestDraft,
      planId,
    } as PlanSession["latestDraft"];
    input.saveThread?.(session);
    const occurredAt = now();
    try {
      db.prepare(`
        INSERT INTO quality_planning_sessions(
          event_id,event_version,analysis_version_id,manager_user_id,thread_id,plan_id,
          source_hash,handoff_snapshot_json,binding_status,task_id,request_id,last_error,
          created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,'DRAFT',NULL,?,NULL,?,?)
      `).run(
        input.eventId, Number(event.version), analysis.analysisId, input.managerUserId,
        threadId, planId, handoff.sourceContext.sourceHash,
        JSON.stringify(handoff.sourceContext.handoffSnapshot), input.requestId,
        occurredAt, occurredAt,
      );
    } catch (error) {
      const raced = getPlanningRecord(input.eventId);
      if (raced && raced.managerUserId === input.managerUserId) {
        return { planning: raced, session: { threadId: raced.threadId, planId: raced.planId } as PlanSession, created: false };
      }
      throw error;
    }
    return { planning: getPlanningRecord(input.eventId)!, session, created: true };
  }

  function loadFormalTask(taskId: string): { task: DatabaseRow; subtasks: DatabaseRow[] } {
    const task = db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) as DatabaseRow | undefined;
    if (!task) throw new Error("formal task not found");
    const subtasks = db.prepare("SELECT * FROM subtasks WHERE task_id=? ORDER BY created_at,subtask_id")
      .all(taskId) as DatabaseRow[];
    if (subtasks.length === 0) throw new Error("formal subtasks not found");
    return { task, subtasks };
  }

  function bindRecord(record: QualityPlanningRecord, taskId: string): QualityPlanningPublishResult {
    const occurredAt = now();
    try {
      const { task, subtasks } = loadFormalTask(taskId);
      const event = getEvent(record.eventId);
      const snapshot = record.handoffSnapshot;
      const rootNodeId = deterministicNodeId("root", record.eventId);
      const overallDueAt = snapshot.suggestedDueAt
        ?? subtasks.map((item) => nullableText(item.due_at)).filter(Boolean).sort().at(-1)
        ?? occurredAt;
      withTransaction(db, () => {
        db.prepare(`UPDATE quality_planning_sessions SET binding_status='PUBLISHING',task_id=?,last_error=NULL,updated_at=? WHERE event_id=?`)
          .run(taskId, occurredAt, record.eventId);
        db.prepare(`
          INSERT OR IGNORE INTO quality_assignment_nodes(
            node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,
            is_primary,status,due_at,requirement,version,created_by,request_id,accepted_at,
            submitted_at,created_at,updated_at
          ) VALUES(?,?,NULL,0,?,'MANAGER',?,1,'IN_PROGRESS',?,?,1,?,?,?,NULL,?,?)
        `).run(
          rootNodeId, record.eventId, String(task.manager_user_id), snapshot.suggestedDepartment ?? "",
          overallDueAt, snapshot.processingRequirements, record.managerUserId,
          `quality-plan:${record.eventId}:root`, occurredAt, occurredAt, occurredAt,
        );
        db.prepare(`
          INSERT OR IGNORE INTO quality_task_links(node_id,task_id,subtask_id,integration_key,created_at)
          VALUES(?,?,NULL,?,?)
        `).run(rootNodeId, taskId, `quality-node:${rootNodeId}`, occurredAt);

        for (const subtask of subtasks) {
          const subtaskId = String(subtask.subtask_id);
          const nodeId = deterministicNodeId("subtask", subtaskId);
          const dueAt = nullableText(subtask.due_at) ?? overallDueAt;
          const requirement = nullableText(subtask.objective)
            ?? nullableText(subtask.completion_criteria)
            ?? String(subtask.title);
          db.prepare(`
            INSERT OR IGNORE INTO quality_assignment_nodes(
              node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,
              is_primary,status,due_at,requirement,version,created_by,request_id,accepted_at,
              submitted_at,created_at,updated_at
            ) VALUES(?,?,?,1,?,'EMPLOYEE',?,0,?,?,?,1,?,?,NULL,NULL,?,?)
          `).run(
            nodeId, record.eventId, rootNodeId, String(subtask.assignee_user_id),
            snapshot.suggestedDepartment ?? "", formalStatusToQuality(String(subtask.status)),
            dueAt, requirement, record.managerUserId,
            `quality-plan:${record.eventId}:${subtaskId}`, occurredAt, occurredAt,
          );
          db.prepare(`
            INSERT OR IGNORE INTO quality_task_links(node_id,task_id,subtask_id,integration_key,created_at)
            VALUES(?,?,?,?,?)
          `).run(nodeId, taskId, subtaskId, `quality-node:${nodeId}`, occurredAt);
        }

        const linkedCount = Number((db.prepare(`
          SELECT COUNT(*) AS count FROM quality_task_links l
          JOIN quality_assignment_nodes n ON n.node_id=l.node_id
          WHERE n.event_id=? AND l.task_id=?
        `).get(record.eventId, taskId) as DatabaseRow).count ?? 0);
        if (linkedCount !== subtasks.length + 1) throw new Error("quality task link coverage mismatch");

        if (String(event.status) === "PENDING_ASSIGNMENT") {
          const updated = db.prepare(`
            UPDATE quality_events SET status='PENDING_ACCEPTANCE',primary_node_id=?,overall_due_at=?,
              version=version+1,updated_at=? WHERE id=? AND status='PENDING_ASSIGNMENT'
          `).run(rootNodeId, overallDueAt, occurredAt, record.eventId);
          if (Number(updated.changes) !== 1) throw new Error("version conflict");
        } else if (!String(event.primary_node_id ?? "").trim()) {
          db.prepare("UPDATE quality_events SET primary_node_id=?,overall_due_at=COALESCE(overall_due_at,?),updated_at=? WHERE id=?")
            .run(rootNodeId, overallDueAt, occurredAt, record.eventId);
        }
        db.prepare(`
          INSERT INTO quality_audit_events(
            id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
          ) SELECT ?,?,?,?,?,?,?,NULL,?,?
          WHERE NOT EXISTS(SELECT 1 FROM quality_audit_events WHERE event_id=? AND request_id=?)
        `).run(
          id(), record.eventId, record.managerUserId, "department_manager", "FORMAL_TASK_BOUND",
          JSON.stringify({ status: event.status }),
          JSON.stringify({ taskId, taskNo: task.task_no, nodeId: rootNodeId }),
          `quality-bind:${record.eventId}:${taskId}`, occurredAt,
          record.eventId, `quality-bind:${record.eventId}:${taskId}`,
        );
        db.prepare(`
          UPDATE quality_planning_sessions SET binding_status='BOUND',task_id=?,last_error=NULL,updated_at=?
          WHERE event_id=?
        `).run(taskId, occurredAt, record.eventId);
      });
      return { bound: true, eventId: record.eventId, taskId, bindingStatus: "BOUND" };
    } catch (error) {
      const message = sanitizeError(error);
      db.prepare(`
        UPDATE quality_planning_sessions SET binding_status='REPAIR_REQUIRED',task_id=?,last_error=?,updated_at=?
        WHERE event_id=?
      `).run(taskId || null, message, occurredAt, record.eventId);
      return {
        bound: false,
        eventId: record.eventId,
        taskId: taskId || null,
        bindingStatus: "REPAIR_REQUIRED",
        error: message,
      };
    }
  }

  function bindPublishedTask(input: {
    session: PlanSession;
    publishResult: Record<string, unknown>;
  }): QualityPlanningPublishResult | null {
    const context = input.session.sourceContext;
    if (!context || context.kind !== "quality_event") return null;
    const record = getPlanningRecord(context.eventId);
    if (!record) {
      return {
        bound: false, eventId: context.eventId, taskId: null,
        bindingStatus: "REPAIR_REQUIRED", error: "quality planning record not found",
      };
    }
    const resultTask = input.publishResult.task as Record<string, unknown> | undefined;
    const taskId = text(resultTask?.taskId) || record.taskId || `task:${record.planId}`;
    const result = bindRecord(record, taskId);
    context.bindingStatus = result.bindingStatus;
    return result;
  }

  function repairBindings(limit = 20): QualityPlanningPublishResult[] {
    const rows = db.prepare(`
      SELECT * FROM quality_planning_sessions
      WHERE binding_status IN ('PUBLISHING','REPAIR_REQUIRED')
      ORDER BY updated_at LIMIT ?
    `).all(Math.max(1, Math.min(100, limit))) as DatabaseRow[];
    return rows.map((row) => {
      const record = planningFromRow(row);
      return bindRecord(record, record.taskId || `task:${record.planId}`);
    });
  }

  return {
    listAnalysisVersions,
    getLatestAnalysis,
    saveAnalysisDraft,
    completeAnalysis,
    getPlanningRecord,
    createOrResumePlanningSession,
    bindPublishedTask,
    repairBindings,
    close: () => db.close(),
  };
}

/**
 * 发布钩子必须 fail-open：正式任务已经写入后，质量关联故障只能进入补偿，
 * 不能让编排器误以为整次发布失败并重复创建任务。
 */
export function bindQualityPlanningPublishSafely(input: {
  session: PlanSession;
  publishResult: Record<string, unknown>;
}): QualityPlanningPublishResult | null {
  if (input.session.sourceContext?.kind !== "quality_event") return null;
  let service: ReturnType<typeof createQualityPlanningService> | undefined;
  try {
    service = createQualityPlanningService();
    return service.bindPublishedTask(input);
  } catch (error) {
    return {
      bound: false,
      eventId: input.session.sourceContext.eventId,
      taskId: nullableText((input.publishResult.task as Record<string, unknown> | undefined)?.taskId),
      bindingStatus: "REPAIR_REQUIRED",
      error: sanitizeError(error),
    };
  } finally {
    service?.close();
  }
}
