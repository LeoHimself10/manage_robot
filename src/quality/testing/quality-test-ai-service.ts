import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityAnalysisService } from "../analysis/quality-analysis-service";
import type { QualityAnalysisInput } from "../analysis/quality-analysis-contracts";
import type { QualityAnalysisModelAdapter } from
  "../analysis/qwen-quality-analysis-model";
import type { AiOriginalAssessmentModelAdapter } from
  "../ai-original-assessment/qwen-ai-original-assessment-model";
import type { HistoricalFeedbackCaseRetriever } from
  "../ai-original-assessment/historical-feedback-case-retriever";
import { createQualityStore } from "../infra/quality-store";
import { runQualitySourceAiAssessment } from
  "../reviews/quality-source-ai-assessment-service";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "./quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

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

export function createQualityTestAiService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
  env?: Record<string, string | undefined>;
  originalModel?: AiOriginalAssessmentModelAdapter;
  originalCaseRetriever?: HistoricalFeedbackCaseRetriever;
  analysisModel?: QualityAnalysisModelAdapter;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function eventForAction(input: {
    eventId: string;
    testActorUserId: string;
    expectedVersion: number;
  }): DatabaseRow {
    const boundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({ event: boundary, actorUserId: input.testActorUserId });
    if (!boundary.isTest) throw new Error("真实质量事件不能使用测试AI动作");
    const event = db.prepare(
      "SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL",
    ).get(input.eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    if (String(event.status) !== "PENDING_ANALYSIS") {
      throw new Error("只有待质量初析的测试事件可以运行AI");
    }
    if (Number(event.version) !== input.expectedVersion) throw new Error("version conflict");
    return event;
  }

  function appendEventAudit(input: {
    eventId: string;
    actorUserId: string;
    action: string;
    requestId: string;
    after: Record<string, unknown>;
    occurredAt: string;
  }): void {
    db.prepare(`
      INSERT INTO quality_audit_events(
        id,event_id,actor_user_id,actor_role,action,before_json,after_json,
        reason,request_id,occurred_at
      ) VALUES(?,?,?,'quality_test_actor',?,NULL,?,NULL,?,?)
    `).run(
      id(), input.eventId, input.actorUserId, input.action,
      JSON.stringify(input.after), input.requestId, input.occurredAt,
    );
  }

  function testReportingContext(eventId: string): QualityAnalysisInput["frozenReportingContext"] {
    const links = db.prepare(`
      SELECT link.source_key,link.source_version,link.source_state_at_link,
             link.source_snapshot_json,source.normalized_json,source.raw_snapshot_json,
             source.source_version AS current_source_version,
             source.state AS current_source_state
      FROM quality_event_source_links link
      LEFT JOIN quality_source_rows source ON source.source_key=link.source_key
      WHERE link.event_id=? ORDER BY link.linked_at,link.id
    `).all(eventId) as DatabaseRow[];
    const sourceSnapshots = links.map((link) => ({
      sourceKey: String(link.source_key),
      sourceVersion: Number(link.current_source_version ?? link.source_version),
      sourceState: String(link.current_source_state ?? link.source_state_at_link),
      rawSnapshot: parseObject(link.raw_snapshot_json ?? link.source_snapshot_json),
      normalizedSnapshot: parseObject(link.normalized_json ?? link.source_snapshot_json),
    }));
    const aiAssessments = links.map((link) => {
      const row = db.prepare(`
        SELECT * FROM quality_source_ai_assessments
        WHERE source_key=? ORDER BY created_at DESC,rowid DESC LIMIT 1
      `).get(String(link.source_key)) as DatabaseRow | undefined;
      return {
        sourceKey: String(link.source_key),
        assessment: row ? {
          assessmentId: String(row.id),
          sourceKey: String(row.source_key),
          sourceVersion: Number(row.source_version),
          requestId: String(row.request_id),
          sourceSnapshot: parseObject(row.source_snapshot_json),
          output: parseObject(row.output_json),
          retrievedCases: parseArray(row.retrieved_cases_json),
          createdBy: String(row.created_by),
          createdAt: String(row.created_at),
        } : null,
      };
    });
    const managerAssessments = links.flatMap((link) => {
      const row = db.prepare(
        "SELECT * FROM quality_source_assessments WHERE source_key=?",
      ).get(String(link.source_key)) as DatabaseRow | undefined;
      if (!row) return [];
      return [{
        sourceKey: String(row.source_key),
        sourceVersion: Number(row.source_version),
        handlingRecommendation: String(row.handling_recommendation),
        primaryCategoryCode: String(row.primary_category_code),
        secondaryCategoryCode: String(row.secondary_category_code),
        riskLevel: String(row.risk_level),
        conclusion: String(row.conclusion),
        adoptionMode: String(row.adoption_mode),
        changeReason: row.change_reason == null ? null : String(row.change_reason),
        reviewedBy: String(row.reviewed_by),
        version: Number(row.version),
        updatedAt: String(row.updated_at),
      }];
    });
    return {
      sourceSnapshots,
      aiOriginalAssessments: aiAssessments,
      managerAssessments,
      frozenAt: now(),
    };
  }

  async function generateOriginal(input: {
    eventId: string;
    testAftersalesUserId: string;
    actualAdminUserId: string;
    expectedVersion: number;
    requestId: string;
  }) {
    if (input.testAftersalesUserId !== "QUALITY_TEST_AFTERSALES_001") {
      throw new Error("只有马荣鑫（测试）可以运行测试AI原始研判");
    }
    eventForAction({
      eventId: input.eventId,
      testActorUserId: input.testAftersalesUserId,
      expectedVersion: input.expectedVersion,
    });
    const link = db.prepare(`
      SELECT source_key FROM quality_event_source_links
      WHERE event_id=? ORDER BY linked_at DESC LIMIT 1
    `).get(input.eventId) as DatabaseRow | undefined;
    if (!link) throw new Error("测试事件缺少隔离来源快照");
    const result = await runQualitySourceAiAssessment({
      sourceKey: String(link.source_key),
      dbPath,
      requestId: input.requestId,
      actorUserId: input.testAftersalesUserId,
      env: deps?.env,
      model: deps?.originalModel,
      caseRetriever: deps?.originalCaseRetriever,
    });
    const occurredAt = now();
    appendEventAudit({
      eventId: input.eventId,
      actorUserId: input.testAftersalesUserId,
      action: "TEST_AI_ORIGINAL_ASSESSMENT_GENERATED",
      requestId: input.requestId,
      after: {
        aiAssessmentId: result.aiAssessmentId,
        sourceVersion: result.sourceVersion,
        modelConfigId: result.output.provenance.modelConfigId,
      },
      occurredAt,
    });
    appendQualityTestActionAudit(db, {
      eventId: input.eventId,
      testActorUserId: input.testAftersalesUserId,
      actualAdminUserId: input.actualAdminUserId,
      action: "GENERATE_AI_ORIGINAL_ASSESSMENT",
      requestId: input.requestId,
      occurredAt,
    });
    return result;
  }

  async function generateInitialAnalysis(input: {
    eventId: string;
    testSpecialistUserId: string;
    actualAdminUserId: string;
    expectedVersion: number;
    requestId: string;
  }) {
    if (input.testSpecialistUserId !== "QUALITY_TEST_SPECIALIST_001") {
      throw new Error("只有佟成（测试）可以运行测试AI质量初析");
    }
    eventForAction({
      eventId: input.eventId,
      testActorUserId: input.testSpecialistUserId,
      expectedVersion: input.expectedVersion,
    });
    const reportingContext = testReportingContext(input.eventId);
    const analysis = createQualityAnalysisService({
      dbPath,
      env: deps?.env,
      model: deps?.analysisModel,
      testMode: {
        actorUserId: input.testSpecialistUserId,
        departmentCandidates: [{
          departmentId: "quality-test-department",
          departmentName: "研发中心",
        }],
        reportingContext,
      },
    });
    let attempt;
    try {
      attempt = await analysis.generate({
        eventId: input.eventId,
        actorUserId: input.testSpecialistUserId,
        requestId: input.requestId,
      });
    } finally {
      analysis.close();
    }
    const occurredAt = now();
    appendQualityTestActionAudit(db, {
      eventId: input.eventId,
      testActorUserId: input.testSpecialistUserId,
      actualAdminUserId: input.actualAdminUserId,
      action: "GENERATE_AI_INITIAL_ANALYSIS",
      requestId: input.requestId,
      occurredAt,
    });
    return attempt;
  }

  return {
    generateOriginal,
    generateInitialAnalysis,
    close: () => db.close(),
  };
}
