import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiOriginalAssessmentOutput } from
  "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import { createQualityEventService } from
  "../../src/quality/events/quality-event-service";
import { createQualityAnalysisService } from
  "../../src/quality/analysis/quality-analysis-service";
import { createQualityEventQuery } from
  "../../src/quality/queries/quality-event-query";
import { createQualityReadStore } from "../../src/quality/infra/quality-read-store";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualitySourceAssessmentService } from
  "../../src/quality/reviews/quality-source-assessment-service";
import { createQualitySourceReviewService } from
  "../../src/quality/reviews/quality-source-review-service";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function setup(sourceKey = "feedback:DISPOSITION-1") {
  const dir = mkdtempSync(join(tmpdir(), "quality-disposition-reporting-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "quality.sqlite");
  createQualityStore(dbPath).close();
  const normalized = {
    sourceKey,
    rowNumber: 2,
    contentHash: "hash-v1",
    feedbackAt: "2026-08-23 10:30",
    feedbackNo: "DISPOSITION-1",
    reporter: "脱敏反馈人员",
    deviceModel: "OCT-M1",
    serialNo: "SN-DISPOSITION-1",
    catheterBatch: "BATCH-DISPOSITION-1",
    issueDescription: "导管术中弯折，操作暂停",
    clinicianAware: "可以感知",
    impact: "操作暂停并更换导管",
    confirmation: "已与反馈人员确认",
    owner: "",
    returned: "",
    category: "导管异常",
    status: "",
    solutionEngineer: "",
    solution: "",
    finalCause: "",
    customerFollowup: "",
    rawSnapshot: { 反馈单号: "DISPOSITION-1", 问题描述: "导管术中弯折，操作暂停" },
  };
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO quality_source_rows(
      source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
      normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,
      last_seen_at,source_updated_at,synced_at,version
    ) VALUES(?, 'sheet-disposition', '客户端问题反馈记录表', 2, 'ACTIVE', 1, ?, ?, ?,
      NULL, '2026-08-23T02:30:00.000Z', '2026-08-23T02:30:00.000Z', NULL,
      '2026-08-23T02:30:00.000Z', 1)
  `).run(
    sourceKey,
    normalized.contentHash,
    JSON.stringify(normalized),
    JSON.stringify(normalized.rawSnapshot),
  );
  db.close();
  return { dbPath, sourceKey, normalized };
}

function assessment(input: {
  handling: "ORDINARY" | "NEEDS_INFO" | "QUALITY_ANOMALY";
  expectedVersion?: number;
  adoptionMode?: "MANUAL" | "DIRECT" | "MODIFIED";
  requestId: string;
}) {
  return {
    handlingRecommendation: input.handling,
    categoryMode: "STANDARD" as const,
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    customPrimaryCategoryName: null,
    customSecondaryCategoryName: null,
    riskLevel: input.handling === "QUALITY_ANOMALY" ? "HIGH" as const : "LOW" as const,
    conclusion: input.handling === "QUALITY_ANOMALY"
      ? "主管确认该反馈属于质量异常，需要正式通报。"
      : "主管已完成正式判断。",
    adoptionMode: input.adoptionMode ?? "MANUAL" as const,
    changeReason: input.adoptionMode === "MODIFIED" ? "结合现场事实调整结论。" : null,
    expectedVersion: input.expectedVersion ?? 0,
    requestId: input.requestId,
  };
}

function aiOutput(requestId: string): AiOriginalAssessmentOutput {
  return {
    schemaVersion: "ai-original-assessment-output-v0",
    requestId,
    handlingRecommendation: "QUALITY_ANOMALY",
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    riskLevel: "HIGH",
    reasoningBasis: [{ statement: "来源记录导管弯折并导致操作暂停。", citationIds: ["feedback-1"] }],
    similarCases: [],
    missingInformation: [],
    uncertainties: [{ topic: "根因", reason: "需要质量初析确认。" }],
    citations: [{
      citationId: "feedback-1",
      sourceType: "FEEDBACK",
      sourceId: "feedback:DISPOSITION-1",
      description: "本次来源快照",
    }],
    provenance: {
      modelConfigId: "test-model",
      promptVersion: "ai-original-assessment-v0",
      categoryDictionaryVersion: "historical-feedback-taxonomy-v0",
      caseLibraryVersion: "test-cases",
    },
  };
}

describe("主管最终研判后的正式处置", () => {
  it("确认普通反馈并在重新加载后保留判断人、时间、研判快照和审计", () => {
    const seeded = setup();
    const assessments = createQualitySourceAssessmentService({
      dbPath: seeded.dbPath,
      now: () => "2026-08-24T01:00:00.000Z",
    });
    const saved = assessments.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "manager-1",
      assessment: assessment({
        handling: "ORDINARY",
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    assessments.close();
    const reviews = createQualitySourceReviewService({
      dbPath: seeded.dbPath,
      now: () => "2026-08-24T01:05:00.000Z",
    });
    reviews.reviewSource({
      actorUserId: "manager-1",
      sourceKey: seeded.sourceKey,
      decision: "ORDINARY",
      expectedVersion: 0,
      assessmentVersion: saved.version,
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    reviews.close();

    const reloaded = createQualitySourceReviewService({ dbPath: seeded.dbPath });
    expect(reloaded.get(seeded.sourceKey)).toMatchObject({
      status: "ORDINARY",
      decidedBy: "manager-1",
      decidedAt: "2026-08-24T01:05:00.000Z",
      assessmentVersion: 1,
      assessmentSnapshot: {
        handlingRecommendation: "ORDINARY",
        conclusion: "主管已完成正式判断。",
        version: 1,
      },
    });
    reloaded.close();
    const db = new DatabaseSync(seeded.dbPath, { readOnly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_events").get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT action FROM quality_source_review_audit WHERE source_key = ?
    `).get(seeded.sourceKey)).toEqual({ action: "FINAL_DISPOSITION_CONFIRMED" });
    db.close();
  });

  it("待补资料在来源更新后提示重新研判，并保留前后两次判断历史", () => {
    const seeded = setup();
    const assessments = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    const first = assessments.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "manager-1",
      assessment: assessment({
        handling: "NEEDS_INFO",
        requestId: "33333333-3333-4333-8333-333333333333",
      }),
    });
    const reviews = createQualitySourceReviewService({ dbPath: seeded.dbPath });
    const firstReview = reviews.reviewSource({
      actorUserId: "manager-1",
      sourceKey: seeded.sourceKey,
      decision: "NEEDS_INFO",
      note: "请补充实物照片和现场日志。",
      expectedVersion: 0,
      assessmentVersion: first.version,
      requestId: "44444444-4444-4444-8444-444444444444",
    });
    const db = new DatabaseSync(seeded.dbPath);
    const updated = { ...seeded.normalized, contentHash: "hash-v2", impact: "已补充：操作中断十分钟" };
    db.prepare(`
      UPDATE quality_source_rows SET state='UPDATED',source_version=2,content_hash=?,
        normalized_json=?,previous_snapshot_json=raw_snapshot_json,
        raw_snapshot_json=?,source_updated_at=?,version=version+1 WHERE source_key=?
    `).run(
      updated.contentHash,
      JSON.stringify(updated),
      JSON.stringify({ 反馈单号: "DISPOSITION-1", 现场影响: updated.impact }),
      "2026-08-24T02:00:00.000Z",
      seeded.sourceKey,
    );
    db.close();

    const readStore = createQualityReadStore(seeded.dbPath);
    expect(readStore.listSourceRows({ page: 1, pageSize: 10 }).rows[0]).toMatchObject({
      sourceUpdatedSinceAssessment: true,
      sourceUpdatedSinceDecision: true,
    });
    readStore.close();
    expect(() => reviews.reviewSource({
      actorUserId: "manager-1",
      sourceKey: seeded.sourceKey,
      decision: "NEEDS_INFO",
      note: "尝试无痕覆盖",
      expectedVersion: firstReview.version,
      assessmentVersion: first.version,
      requestId: "55555555-5555-4555-8555-555555555555",
    })).toThrow("来源资料已更新");

    const second = assessments.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "manager-1",
      assessment: assessment({
        handling: "NEEDS_INFO",
        expectedVersion: first.version,
        requestId: "66666666-6666-4666-8666-666666666666",
      }),
    });
    const secondReview = reviews.reviewSource({
      actorUserId: "manager-1",
      sourceKey: seeded.sourceKey,
      decision: "NEEDS_INFO",
      note: "照片已收到，仍需补充导管留样编号。",
      expectedVersion: firstReview.version,
      assessmentVersion: second.version,
      requestId: "77777777-7777-4777-8777-777777777777",
    });
    assessments.close();
    reviews.close();
    expect(secondReview).toMatchObject({
      status: "NEEDS_INFO",
      note: "照片已收到，仍需补充导管留样编号。",
      assessmentVersion: 2,
      version: 2,
    });
    const history = new DatabaseSync(seeded.dbPath, { readOnly: true });
    expect(history.prepare(`
      SELECT COUNT(*) AS count FROM quality_source_assessment_audit WHERE source_key=?
    `).get(seeded.sourceKey)).toEqual({ count: 2 });
    expect(history.prepare(`
      SELECT COUNT(*) AS count FROM quality_source_review_audit WHERE source_key=?
    `).get(seeded.sourceKey)).toEqual({ count: 2 });
    expect(history.prepare("SELECT COUNT(*) AS count FROM quality_events").get()).toEqual({ count: 0 });
    history.close();
  });
});

describe("质量异常通报与事件创建", () => {
  it("正式提交只创建一个事件，并把主管最终研判、待办事件和通知推给质量专员", () => {
    const seeded = setup();
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-specialist-1");
    const assessments = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    const source = assessments.getSourceSnapshot(seeded.sourceKey)!;
    const originalAi = assessments.saveAiAssessment({
      sourceKey: seeded.sourceKey,
      sourceVersion: source.sourceVersion,
      requestId: "88888888-8888-4888-8888-888888888888",
      sourceSnapshot: source.normalizedFeedback,
      output: aiOutput("88888888-8888-4888-8888-888888888888"),
      retrievedCases: [{ caseId: "CASE-1", title: "历史弯折案例" }],
      actorUserId: "manager-1",
    });
    const finalAssessment = assessments.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "manager-1",
      assessment: assessment({
        handling: "QUALITY_ANOMALY",
        adoptionMode: "MODIFIED",
        requestId: "99999999-9999-4999-8999-999999999999",
      }),
    });
    assessments.close();
    expect(finalAssessment.aiAssessmentId).toBe(originalAi.assessmentId);

    const actor = { userId: "manager-1", role: "aftersales_manager" as const };
    const events = createQualityEventService({
      dbPath: seeded.dbPath,
      now: () => "2026-08-24T03:00:00.000Z",
    });
    const created = events.createDraftFromAssessment({
      actor,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceKey: seeded.sourceKey,
      expectedAssessmentVersion: finalAssessment.version,
    });
    expect(created.created).toBe(true);
    expect(created.event).toMatchObject({
      status: "DRAFT",
      deviceModel: "OCT-M1",
      deviceSerial: "SN-DISPOSITION-1",
      catheterBatch: "BATCH-DISPOSITION-1",
      impact: "操作暂停并更换导管",
      initialCategory: "导管本体／弯折、扭曲与旋转异常",
      urgency: "HIGH",
    });
    expect(created.event.problemStatus).toContain("主管确认该反馈属于质量异常");

    const savedDraft = events.updateDraft({
      actor,
      eventId: created.event.eventId,
      expectedVersion: created.event.version,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      patch: { notes: "主管复核后的正式通报草稿。" },
    });
    expect(events.getDraftForCreator({ actor, eventId: savedDraft.eventId })).toMatchObject({
      supplement: "主管复核后的正式通报草稿。",
      version: savedDraft.version,
    });

    const revisedAssessments = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    const latestAssessment = revisedAssessments.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "manager-1",
      assessment: assessment({
        handling: "QUALITY_ANOMALY",
        adoptionMode: "MODIFIED",
        expectedVersion: finalAssessment.version,
        requestId: "abababab-abab-4bab-8bab-abababababab",
      }),
    });
    revisedAssessments.close();
    expect(() => events.submitDraft({
      actor,
      eventId: savedDraft.eventId,
      expectedVersion: savedDraft.version,
      requestId: "acacacac-acac-4cac-8cac-acacacacacac",
    })).toThrow("主管最终研判已更新");
    expect(events.createDraftFromAssessment({
      actor,
      requestId: "adadadad-adad-4dad-8dad-adadadadadad",
      sourceKey: seeded.sourceKey,
      expectedAssessmentVersion: latestAssessment.version,
    })).toMatchObject({ created: false, event: { eventId: savedDraft.eventId } });

    const submitted = events.submitDraft({
      actor,
      eventId: savedDraft.eventId,
      expectedVersion: savedDraft.version,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    const retried = events.submitDraft({
      actor,
      eventId: savedDraft.eventId,
      expectedVersion: savedDraft.version,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    const duplicate = events.createDraftFromAssessment({
      actor,
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sourceKey: seeded.sourceKey,
      expectedAssessmentVersion: latestAssessment.version,
    });
    events.close();
    expect(submitted).toMatchObject({ status: "PENDING_ANALYSIS", eventId: savedDraft.eventId });
    expect(retried).toMatchObject({ status: "PENDING_ANALYSIS", eventId: savedDraft.eventId });
    expect(duplicate).toMatchObject({ created: false, event: { eventId: savedDraft.eventId } });

    const db = new DatabaseSync(seeded.dbPath, { readOnly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_events WHERE deleted_at IS NULL").get())
      .toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT status,event_id,assessment_version FROM quality_source_reviews WHERE source_key=?
    `).get(seeded.sourceKey)).toEqual({
      status: "REPORTED",
      event_id: savedDraft.eventId,
      assessment_version: latestAssessment.version,
    });
    const frozen = db.prepare(`
      SELECT * FROM quality_event_reporting_snapshots WHERE event_id=?
    `).get(savedDraft.eventId) as Record<string, unknown>;
    const sources = JSON.parse(String(frozen.source_snapshots_json)) as Array<Record<string, unknown>>;
    const ai = JSON.parse(String(frozen.ai_assessments_json)) as Array<Record<string, unknown>>;
    const managers = JSON.parse(String(frozen.manager_assessments_json)) as Array<Record<string, unknown>>;
    expect(sources[0]).toMatchObject({
      sourceKey: seeded.sourceKey,
      sourceVersion: 1,
      rawSnapshot: { 反馈单号: "DISPOSITION-1" },
    });
    expect(ai[0]).toMatchObject({
      sourceKey: seeded.sourceKey,
      assessment: {
        assessmentId: originalAi.assessmentId,
        output: { handlingRecommendation: "QUALITY_ANOMALY" },
      },
    });
    expect(managers[0]).toMatchObject({
      sourceKey: seeded.sourceKey,
      version: latestAssessment.version,
      handlingRecommendation: "QUALITY_ANOMALY",
      categoryDisplayName: "导管本体／弯折、扭曲与旋转异常",
      riskLevel: "HIGH",
      conclusion: "主管确认该反馈属于质量异常，需要正式通报。",
      changeReason: "结合现场事实调整结论。",
    });
    expect(db.prepare(`
      SELECT action,recipient_user_id,subject,status
      FROM quality_notification_outbox WHERE event_id=?
    `).get(savedDraft.eventId)).toEqual({
      action: "EVENT_SUBMITTED",
      recipient_user_id: "quality-specialist-1",
      subject: "有新的质量异常待质量初析",
      status: "PENDING",
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM quality_audit_events
      WHERE event_id=? AND action IN ('REPORTING_SNAPSHOTS_FROZEN','REPORT_SUBMITTED')
    `).get(savedDraft.eventId)).toEqual({ count: 2 });
    db.close();

    const query = createQualityEventQuery(seeded.dbPath);
    expect(query.listEvents({ viewerUserId: "quality-specialist-1" })).toEqual([
      expect.objectContaining({
        eventId: savedDraft.eventId,
        status: "PENDING_ANALYSIS",
        initialCategory: "导管本体／弯折、扭曲与旋转异常",
        urgency: "HIGH",
      }),
    ]);
    expect(query.getEventDetail({
      eventId: savedDraft.eventId,
      viewerUserId: "quality-specialist-1",
    })).toMatchObject({
      reportingSnapshots: {
        managerAssessments: [expect.objectContaining({
          version: latestAssessment.version,
          conclusion: "主管确认该反馈属于质量异常，需要正式通报。",
        })],
      },
    });
    query.close();

    const analysis = createQualityAnalysisService({ dbPath: seeded.dbPath });
    expect(analysis.workspace({
      eventId: savedDraft.eventId,
      viewerUserId: "quality-specialist-1",
    })).toMatchObject({
      event: { eventId: savedDraft.eventId, status: "PENDING_ANALYSIS" },
      canEdit: true,
      isBusinessReadOnly: false,
    });
    analysis.close();
  });

  it("安全迁移生产旧状态约束并保留既有事件", () => {
    const dir = mkdtempSync(join(tmpdir(), "quality-analysis-status-migration-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "quality.sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE quality_events (
        id TEXT PRIMARY KEY,event_no TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN (
          'DRAFT','PENDING_ASSIGNMENT','PENDING_ACCEPTANCE','IN_PROGRESS',
          'PENDING_PRIMARY_REVIEW','PENDING_QUALITY_REVIEW','CLOSED'
        )),
        title TEXT NOT NULL,problem_status TEXT NOT NULL,occurred_at TEXT,
        feedback_at TEXT,feedback_user_id TEXT,feedback_name TEXT,device_model TEXT,
        device_serial TEXT,catheter_batch TEXT,clinician_aware TEXT,impact TEXT,
        initial_category TEXT,urgency TEXT,supplement TEXT,created_by TEXT NOT NULL,
        submitted_by TEXT,submitted_at TEXT,original_primary_department_id TEXT,
        overall_due_at TEXT,primary_node_id TEXT,version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
      );
      INSERT INTO quality_events(
        id,event_no,status,title,problem_status,created_by,version,created_at,updated_at
      ) VALUES(
        'legacy-event','QE-LEGACY','PENDING_ASSIGNMENT','既有质量事件','既有情况',
        'manager-legacy',2,'2026-08-20T00:00:00.000Z','2026-08-21T00:00:00.000Z'
      );
    `);
    legacy.close();

    const migrated = createQualityStore(dbPath);
    expect(migrated.getEvent("legacy-event")).toMatchObject({
      eventNo: "QE-LEGACY",
      status: "PENDING_ASSIGNMENT",
      version: 2,
    });
    migrated.close();
    const verified = new DatabaseSync(dbPath);
    verified.prepare(`
      INSERT INTO quality_events(
        id,event_no,status,title,problem_status,created_by,version,created_at,updated_at
      ) VALUES('analysis-event','QE-ANALYSIS','PENDING_ANALYSIS','新事件','待初析',
        'manager-1',1,'2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z')
    `).run();
    expect(verified.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    verified.close();
  });
});
