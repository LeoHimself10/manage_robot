import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QualityAnalysisInput,
  QualityAnalysisOutput,
} from "../../src/quality/analysis/quality-analysis-contracts";
import type { QualityAnalysisModelAdapter } from
  "../../src/quality/analysis/qwen-quality-analysis-model";
import type { AiOriginalAssessmentModelAdapter } from
  "../../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityEventPerspectiveProjector } from
  "../../src/quality/presentation/quality-event-perspective";
import { createQualityTestAiService } from
  "../../src/quality/testing/quality-test-ai-service";
import {
  buildValidAiSimulatedOutput,
  offlineModelResponse,
} from "./ai-original-assessment-test-fixtures";

const NOW = "2026-08-27T08:00:00.000Z";
let tempDir = "";
let dbPath = "";

function seed(): void {
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  const sourceKey = "quality-test-source:QT-AI-001";
  const snapshot = {
    sourceKey,
    feedbackAt: NOW,
    feedbackNo: "TEST-QT-AI-001",
    reporter: "测试反馈人",
    deviceModel: "测试设备型号",
    serialNo: "TEST-SN-001",
    catheterBatch: "TEST-BATCH-001",
    issueDescription: "测试影像偶发中断，需要AI研判并形成质量初析。",
    clinicianAware: "已知悉",
    impact: "仅影响隔离测试数据",
    confirmation: "隔离测试事实已确认",
  };
  db.prepare(`
    INSERT INTO quality_source_rows(
      source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
      normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,last_seen_at,
      source_updated_at,synced_at,version
    ) VALUES(?,'QUALITY_TEST_ISOLATED','隔离测试数据',9001,'ACTIVE',1,?, ?,?,NULL,?,?,?,?,1)
  `).run(sourceKey, "a".repeat(64), JSON.stringify(snapshot), JSON.stringify(snapshot), NOW, NOW, NOW, NOW);
  db.prepare(`
    INSERT INTO quality_events(
      id,event_no,is_test,status,title,problem_status,feedback_at,feedback_name,
      device_model,device_serial,initial_category,impact,urgency,created_by,
      submitted_by,submitted_at,version,created_at,updated_at
    ) VALUES('test-ai-event','QT-AI-001',1,'PENDING_ANALYSIS','测试AI双阶段',?,?,'测试反馈人',
      '测试设备型号','TEST-SN-001','成像与光学表现／无法成像或成像中断',
      '仅影响隔离测试数据','MEDIUM','QUALITY_TEST_AFTERSALES_001',
      'QUALITY_TEST_AFTERSALES_001',?,2,?,?)
  `).run(snapshot.issueDescription, NOW, NOW, NOW, NOW);
  db.prepare(`
    INSERT INTO quality_event_source_links(
      id,event_id,source_key,source_version,source_state_at_link,
      source_snapshot_json,linked_by,linked_at
    ) VALUES('test-ai-link','test-ai-event',?,1,'ACTIVE',?,
      'QUALITY_TEST_AFTERSALES_001',?)
  `).run(sourceKey, JSON.stringify(snapshot), NOW);
  db.prepare(`
    INSERT INTO quality_source_assessments(
      source_key,source_version,handling_recommendation,primary_category_code,
      secondary_category_code,category_mode,risk_level,conclusion,adoption_mode,
      change_reason,reviewed_by,version,created_at,updated_at
    ) VALUES(?,1,'QUALITY_ANOMALY','IMAGING_OPTICS','IMAGE_NONE_INTERRUPTED',
      'STANDARD','MEDIUM','测试主管确认进入质量流程','MANUAL',NULL,
      'QUALITY_TEST_AFTERSALES_001',1,?,?)
  `).run(sourceKey, NOW, NOW);
  db.close();
}

function originalModel(fail = false): AiOriginalAssessmentModelAdapter {
  return {
    async generate({ input }) {
      if (fail) throw new Error("offline original model failure");
      return offlineModelResponse(buildValidAiSimulatedOutput(input));
    },
  };
}

function initialOutput(input: QualityAnalysisInput): QualityAnalysisOutput {
  return {
    schemaVersion: "quality-analysis-output-v1",
    requestId: input.runMetadata.requestId,
    problemDirection: "影像中断的软硬件与操作条件联合调查",
    confirmedCategoryReference: input.ruleContext.confirmedCategoryReadOnly ?? "分类待确认",
    sourceFactSummary: ["测试影像偶发中断，需要AI研判并形成质量初析。"],
    confirmedFacts: ["当前仅确认测试事件中的影像中断现象。"],
    analysisBasis: [{
      statement: "隔离来源快照记录了影像中断现象。",
      sourceType: "SOURCE_SNAPSHOT",
      sourceReference: "quality-test-source:QT-AI-001",
    }],
    preliminaryConclusion: "根因尚待测试主管组织排查。",
    causeHypotheses: ["软件链路或连接稳定性可能影响成像。"],
    investigationDirections: ["复核日志、连接状态与复现记录。"],
    informationGaps: ["缺少复现日志。"],
    primaryDepartmentCandidates: [{
      departmentName: "研发中心",
      recommendationReason: "负责隔离测试中的原因排查与验证。",
    }],
    handlingRequirements: ["完成原因排查并上传验证证据。"],
    deliverables: [{
      name: "影像中断排查与验证报告",
      description: "记录事实、原因、措施和验证过程。",
      acceptanceCriteria: "结论有证据支持且验证结果可复核。",
    }],
    suggestedTotalDueDays: 14,
  };
}

function initialModel(fail = false): QualityAnalysisModelAdapter {
  return {
    async generate(input) {
      if (fail) throw new Error("offline initial model failure");
      const payload = initialOutput(input);
      return {
        payload,
        rawContent: JSON.stringify(payload),
        trace: {
          model: "qwen-quality-test",
          tokenUsage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
          latencyMs: 20,
        },
        timing: {},
        messages: [],
      } as never;
    },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "quality-test-ai-"));
  dbPath = join(tempDir, "workbench.sqlite");
  vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
  seed();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quality test AI service", () => {
  it("labels a seeded fallback as not yet generated by the AI model", () => {
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO quality_source_ai_assessments(
        id,source_key,source_version,request_id,source_snapshot_json,output_json,
        retrieved_cases_json,created_by,created_at
      ) VALUES('fixture-ai','quality-test-source:QT-AI-001',1,
        'fixture-request','{}',?,'[]','QUALITY_TEST_AFTERSALES_001',?)
    `).run(JSON.stringify({
      handlingRecommendation: "QUALITY_ANOMALY",
      primaryCategoryCode: "IMAGING_OPTICS",
      secondaryCategoryCode: "IMAGE_NONE_INTERRUPTED",
      riskLevel: "MEDIUM",
      provenance: { modelConfigId: "quality-test-fixture" },
    }), NOW);
    db.close();

    const projector = createQualityEventPerspectiveProjector(dbPath);
    const view = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "aftersales",
      eventId: "test-ai-event",
    })!;
    expect((view.viewModel.assessment as any).originalSuggestion).toMatchObject({
      generationSource: "FIXTURE",
      generationLabel: "预置测试建议（尚未调用AI）",
    });
    projector.close();
  });

  it("does not invoke or persist either model merely by opening both test perspectives", () => {
    const projector = createQualityEventPerspectiveProjector(dbPath);
    const aftersales = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "aftersales",
      eventId: "test-ai-event",
    })!;
    const specialist = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "quality-management",
      eventId: "test-ai-event",
    })!;
    expect(aftersales.viewModel.allowedActions).toContain("generate-original-ai");
    expect((aftersales.viewModel.assessment as any).originalSuggestion).toMatchObject({
      generationSource: "NONE",
      generationLabel: "尚未生成",
    });
    expect(specialist.viewModel.allowedActions).toContain("generate-analysis-ai");
    expect(specialist.viewModel.testAnalysisDraft).toMatchObject({ generationSource: "FIXTURE" });
    projector.close();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_source_ai_assessments")
      .get() as { count: number }).count)).toBe(0);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_attempts")
      .get() as { count: number }).count)).toBe(0);
    db.close();
  });

  it("runs both real model adapters only on click and keeps all output isolated", async () => {
    const service = createQualityTestAiService({
      dbPath,
      now: () => NOW,
      originalModel: originalModel(),
      analysisModel: initialModel(),
    });
    const original = await service.generateOriginal({
      eventId: "test-ai-event",
      testAftersalesUserId: "QUALITY_TEST_AFTERSALES_001",
      actualAdminUserId: "admin-1",
      expectedVersion: 2,
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    const initial = await service.generateInitialAnalysis({
      eventId: "test-ai-event",
      testSpecialistUserId: "QUALITY_TEST_SPECIALIST_001",
      actualAdminUserId: "admin-1",
      expectedVersion: 2,
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    service.close();

    expect(original.output.provenance.modelConfigId).not.toBe("quality-test-fixture");
    expect(initial.status).toBe("SUCCEEDED");
    expect(initial.output?.problemDirection).toContain("影像中断");
    const projector = createQualityEventPerspectiveProjector(dbPath);
    const aftersales = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "aftersales",
      eventId: "test-ai-event",
    })!;
    const specialist = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "quality-management",
      eventId: "test-ai-event",
    })!;
    expect((aftersales.viewModel.assessment as any).originalSuggestion).toMatchObject({
      generationSource: "MODEL",
      generationLabel: "AI模型生成",
    });
    expect(specialist.viewModel.testAnalysisDraft).toMatchObject({
      generationSource: "MODEL",
      generationLabel: "AI模型生成",
      problemDirection: "影像中断的软硬件与操作条件联合调查",
      deliverableName: "影像中断排查与验证报告",
    });
    projector.close();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_source_ai_assessments")
      .get() as { count: number }).count)).toBe(1);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_attempts WHERE status='SUCCEEDED'")
      .get() as { count: number }).count)).toBe(1);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_test_action_audit")
      .get() as { count: number }).count)).toBe(2);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_notification_outbox")
      .get() as { count: number }).count)).toBe(0);
    expect((db.prepare("SELECT status,version FROM quality_events WHERE id='test-ai-event'")
      .get() as { status: string; version: number })).toEqual({ status: "PENDING_ANALYSIS", version: 2 });
    expect(JSON.stringify(initial.input.frozenReportingContext.aiOriginalAssessments))
      .toContain(original.aiAssessmentId);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_event_reporting_snapshots")
      .get() as { count: number }).count)).toBe(0);
    db.close();
  });

  it("persists AI failures without changing the event or sending notifications", async () => {
    const service = createQualityTestAiService({
      dbPath,
      originalModel: originalModel(true),
      analysisModel: initialModel(true),
    });
    await expect(service.generateOriginal({
      eventId: "test-ai-event",
      testAftersalesUserId: "QUALITY_TEST_AFTERSALES_001",
      actualAdminUserId: "admin-1",
      expectedVersion: 2,
      requestId: "33333333-3333-4333-8333-333333333333",
    })).rejects.toThrow("AI原始研判模型调用失败");
    await expect(service.generateInitialAnalysis({
      eventId: "test-ai-event",
      testSpecialistUserId: "QUALITY_TEST_SPECIALIST_001",
      actualAdminUserId: "admin-1",
      expectedVersion: 2,
      requestId: "44444444-4444-4444-8444-444444444444",
    })).rejects.toThrow("AI质量初析调用失败");
    service.close();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect((db.prepare("SELECT status,version FROM quality_events WHERE id='test-ai-event'")
      .get() as { status: string; version: number })).toEqual({ status: "PENDING_ANALYSIS", version: 2 });
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_attempts WHERE status='FAILED'")
      .get() as { count: number }).count)).toBe(1);
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_notification_outbox")
      .get() as { count: number }).count)).toBe(0);
    db.close();
  });

  it("rejects real events and the wrong test actor before any model call", async () => {
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_events SET is_test=0 WHERE id='test-ai-event'").run();
    db.close();
    const service = createQualityTestAiService({ dbPath, originalModel: originalModel() });
    await expect(service.generateOriginal({
      eventId: "test-ai-event",
      testAftersalesUserId: "QUALITY_TEST_AFTERSALES_001",
      actualAdminUserId: "admin-1",
      expectedVersion: 2,
      requestId: "55555555-5555-4555-8555-555555555555",
    })).rejects.toThrow("测试身份不能处理真实事件");
    service.close();
  });
});
