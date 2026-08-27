import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import {
  QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_RULE_VERSION,
} from "../analysis/quality-analysis-contracts";
import { createQualityStore } from "../infra/quality-store";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "./quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

export interface CompleteQualityTestAnalysisInput {
  eventId: string;
  testSpecialistUserId: string;
  actualAdminUserId: string;
  expectedVersion: number;
  requestId: string;
  problemDirection: string;
  confirmedCategory: string;
  sourceFactSummary: string;
  analysisBasis: string;
  preliminaryConclusion: string;
  informationGaps?: string;
  handlingRequirements: string;
  suggestedDueAt: string;
  deliverableName: string;
  deliverableDescription: string;
  acceptanceCriteria: string;
}

function splitItems(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredText(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

export function createQualityTestAnalysisService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function complete(input: CompleteQualityTestAnalysisInput) {
    if (input.testSpecialistUserId !== "QUALITY_TEST_SPECIALIST_001") {
      throw new Error("只有佟成（测试）可以完成测试质量初析");
    }
    const eventBoundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({
      event: eventBoundary,
      actorUserId: input.testSpecialistUserId,
    });
    if (!eventBoundary.isTest) throw new Error("真实质量事件不能使用测试初析动作");

    const repeated = db.prepare(`
      SELECT analysis_id,analysis_version FROM quality_analysis_versions WHERE request_id=?
    `).get(input.requestId) as DatabaseRow | undefined;
    if (repeated) {
      const current = db.prepare("SELECT status,version FROM quality_events WHERE id=?")
        .get(input.eventId) as DatabaseRow;
      return {
        analysisId: String(repeated.analysis_id),
        analysisVersion: Number(repeated.analysis_version),
        eventStatus: String(current.status),
        eventVersion: Number(current.version),
      };
    }

    const event = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    if (Number(event.version) !== input.expectedVersion) throw new Error("version conflict");
    if (String(event.status) !== "PENDING_ANALYSIS") throw new Error("当前事件不在待质量初析状态");

    const suggestedDueAt = requiredText(input.suggestedDueAt, "建议总期限");
    if (!Number.isFinite(Date.parse(suggestedDueAt))) throw new Error("建议总期限格式无效");
    const occurredAt = now();
    const analysisVersion = Number((db.prepare(`
      SELECT COALESCE(MAX(analysis_version),0)+1 AS version
      FROM quality_analysis_versions WHERE event_id=?
    `).get(input.eventId) as DatabaseRow).version);
    const analysisId = id();
    const content = {
      problemDirection: requiredText(input.problemDirection, "问题方向"),
      confirmedCategoryReference: requiredText(input.confirmedCategory, "人工确认分类"),
      sourceFactSummary: splitItems(requiredText(input.sourceFactSummary, "来源事实摘要")),
      confirmedFacts: splitItems(input.sourceFactSummary),
      analysisBasis: splitItems(requiredText(input.analysisBasis, "分析依据")),
      preliminaryConclusion: requiredText(input.preliminaryConclusion, "初步结论"),
      causeHypotheses: ["测试流程中的模拟原因待验证"],
      investigationDirections: ["复核测试记录", "形成原因、措施与验证证据"],
      informationGaps: splitItems(input.informationGaps),
      handlingRequirements: splitItems(requiredText(input.handlingRequirements, "处理要求")),
      suggestedTotalDueAt: suggestedDueAt,
    };
    const deliverables = [{
      deliverableId: `quality-test-deliverable:${input.eventId}:${analysisVersion}`,
      name: requiredText(input.deliverableName, "成果名称"),
      description: requiredText(input.deliverableDescription, "成果说明"),
      acceptanceCriteria: requiredText(input.acceptanceCriteria, "验收标准"),
      source: "AI_SUGGESTED",
      selected: true,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }];

    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`
        INSERT INTO quality_analysis_versions(
          analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,
          deliverables_json,diff_json,modification_reason,primary_department_id,
          primary_department_name,collaborator_departments_json,primary_manager_user_id,
          primary_manager_name,primary_manager_account_status,suggested_total_due_at,
          schema_version,prompt_version,model_config_id,input_version,rule_version,
          case_library_version,knowledge_version,generated_by,edited_by,confirmed_by,
          confirmed_at,created_at
        ) VALUES(?,?,?,?,NULL,?,?,?,?,?,'研发中心','[]','QUALITY_TEST_MANAGER_001',
          '测试主管','ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        analysisId,
        input.eventId,
        analysisVersion,
        input.requestId,
        JSON.stringify(content),
        JSON.stringify(deliverables),
        JSON.stringify({ mode: "TEST_INITIAL_ANALYSIS" }),
        "佟成（测试）确认AI质量初析建议",
        "quality-test-department",
        suggestedDueAt,
        QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
        "quality-test-initial-analysis-v1",
        "quality-test-deterministic",
        `quality-test-event:${input.eventId}:v${input.expectedVersion}`,
        QUALITY_ANALYSIS_RULE_VERSION,
        "quality-test-case-library",
        QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
        input.testSpecialistUserId,
        input.testSpecialistUserId,
        input.testSpecialistUserId,
        occurredAt,
        occurredAt,
      );
      const updated = db.prepare(`
        UPDATE quality_events
        SET status='PENDING_ASSIGNMENT',original_primary_department_id='quality-test-department',
            overall_due_at=?,version=version+1,updated_at=?
        WHERE id=? AND is_test=1 AND version=? AND status='PENDING_ANALYSIS'
      `).run(suggestedDueAt, occurredAt, input.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        INSERT INTO quality_audit_events(
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,
          reason,request_id,occurred_at
        ) VALUES(?,?,?,'quality_specialist','QUALITY_ANALYSIS_CONFIRMED',?,?,?, ?,?)
      `).run(
        id(),
        input.eventId,
        input.testSpecialistUserId,
        JSON.stringify({ eventVersion: input.expectedVersion }),
        JSON.stringify({ analysisVersion, nextStatus: "PENDING_ASSIGNMENT" }),
        "隔离测试质量初析确认",
        input.requestId,
        occurredAt,
      );
      appendQualityTestActionAudit(db, {
        eventId: input.eventId,
        testActorUserId: input.testSpecialistUserId,
        actualAdminUserId: input.actualAdminUserId,
        action: "COMPLETE_INITIAL_ANALYSIS",
        requestId: input.requestId,
        occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    }

    return {
      analysisId,
      analysisVersion,
      eventStatus: "PENDING_ASSIGNMENT",
      eventVersion: input.expectedVersion + 1,
    };
  }

  return { complete, close: () => db.close() };
}
