import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import {
  createQualitySourceReviewService,
} from "../../src/quality/reviews/quality-source-review-service";
import { createQualityReviewQuery } from "../../src/quality/queries/quality-review-query";
import { createQualityEventService } from "../../src/quality/events/quality-event-service";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "quality-source-review-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "quality.sqlite");
  createQualityStore(dbPath).close();
  return dbPath;
}

function seedSource(dbPath: string, input: {
  sourceKey: string;
  feedbackAt: string;
  feedbackNo?: string;
  issueDescription: string;
  deviceModel?: string;
  category?: string;
  contentHash?: string;
  rowNumber?: number;
}) {
  const now = "2026-07-14T08:00:00.000Z";
  const normalized = {
    sourceKey: input.sourceKey,
    rowNumber: input.rowNumber ?? 2,
    contentHash: input.contentHash ?? `hash:${input.sourceKey}`,
    feedbackAt: input.feedbackAt,
    feedbackNo: input.feedbackNo ?? "",
    reporter: "测试人员",
    deviceModel: input.deviceModel ?? "Mobile",
    serialNo: "SN-1",
    catheterBatch: "BATCH-1",
    issueDescription: input.issueDescription,
    clinicianAware: "",
    impact: "",
    confirmation: "",
    owner: "",
    returned: "",
    category: input.category ?? "图像异常",
    status: "",
    solutionEngineer: "",
    solution: "",
    finalCause: "",
    customerFollowup: "",
    rawSnapshot: { 问题描述: input.issueDescription },
  };
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO quality_source_rows(
      source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
      normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,last_seen_at,
      source_updated_at,synced_at,version
    ) VALUES(?, 'sheet-1', '客户端问题反馈记录表', ?, 'ACTIVE', 1, ?, ?, ?, NULL, ?, ?, NULL, ?, 1)
  `).run(
    input.sourceKey,
    input.rowNumber ?? 2,
    normalized.contentHash,
    JSON.stringify(normalized),
    JSON.stringify(normalized.rawSnapshot),
    now,
    now,
    now,
  );
  db.close();
}

describe("quality source review", () => {
  it("records an ordinary decision and enqueues the matching DingTalk value", () => {
    const dbPath = setup();
    seedSource(dbPath, {
      sourceKey: "feedback:FB-1",
      feedbackAt: "2026-07-01",
      feedbackNo: "FB-1",
      issueDescription: "普通使用咨询",
    });
    const service = createQualitySourceReviewService({
      dbPath,
      now: () => "2026-07-14T09:00:00.000Z",
      id: () => randomUUID(),
    });

    const result = service.reviewSource({
      actorUserId: "after-1",
      sourceKey: "feedback:FB-1",
      decision: "ORDINARY",
      note: "",
      expectedVersion: 0,
      requestId: "req-ordinary-1",
    });
    service.close();

    expect(result).toMatchObject({
      sourceKey: "feedback:FB-1",
      status: "ORDINARY",
      note: null,
      decidedBy: "after-1",
      version: 1,
    });
    const db = new DatabaseSync(dbPath);
    expect(db.prepare(`SELECT desired_value,status,review_version FROM quality_source_writeback_outbox`).get())
      .toEqual({ desired_value: "普通反馈", status: "PENDING", review_version: 1 });
    db.close();
  });

  it("allows ordinary and needs-info decisions to be revised but locks reported sources", () => {
    const dbPath = setup();
    seedSource(dbPath, {
      sourceKey: "feedback:FB-2",
      feedbackAt: "2026-06-01",
      feedbackNo: "FB-2",
      issueDescription: "信息不完整",
    });
    const service = createQualitySourceReviewService({ dbPath, now: () => "2026-07-14T09:00:00.000Z" });
    service.reviewSource({
      actorUserId: "after-1", sourceKey: "feedback:FB-2", decision: "ORDINARY",
      expectedVersion: 0, requestId: "req-1",
    });
    const revised = service.reviewSource({
      actorUserId: "after-1", sourceKey: "feedback:FB-2", decision: "NEEDS_INFO",
      note: "", expectedVersion: 1, requestId: "req-2",
    });
    expect(revised).toMatchObject({ status: "NEEDS_INFO", version: 2, note: null });

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO quality_events(
        id,event_no,status,title,problem_status,created_by,version,created_at,updated_at
      ) VALUES('event-1','QE-1','PENDING_ASSIGNMENT','测试事件','测试现状','after-1',1,?,?)
    `).run("2026-07-14T09:00:00.000Z", "2026-07-14T09:00:00.000Z");
    db.prepare(`UPDATE quality_source_reviews SET status='REPORTED',event_id='event-1',version=3 WHERE source_key=?`)
      .run("feedback:FB-2");
    db.close();
    expect(() => service.reviewSource({
      actorUserId: "after-1", sourceKey: "feedback:FB-2", decision: "ORDINARY",
      expectedVersion: 3, requestId: "req-3",
    })).toThrow("已进入质量流程");
    service.close();
  });

  it("lists only parseable feedback from the last six months and prioritizes risk", () => {
    const dbPath = setup();
    seedSource(dbPath, { sourceKey: "feedback:high", feedbackAt: "2026-07-01", issueDescription: "术中无法成像" });
    seedSource(dbPath, { sourceKey: "feedback:plain", feedbackAt: "2026-06-01", issueDescription: "普通反馈", rowNumber: 3 });
    seedSource(dbPath, { sourceKey: "feedback:boundary", feedbackAt: "2026-01-14", issueDescription: "六个月边界", rowNumber: 4 });
    seedSource(dbPath, { sourceKey: "feedback:old", feedbackAt: "2026-01-13", issueDescription: "边界外记录", rowNumber: 5 });
    seedSource(dbPath, { sourceKey: "feedback:invalid", feedbackAt: "待确认", issueDescription: "无日期", rowNumber: 6 });
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      INSERT INTO quality_candidates(
        id,candidate_type,status,score,rule_codes_json,source_keys_json,explanation_json,
        detected_at,version,created_at,updated_at
      ) VALUES('candidate-high','ANOMALY','OPEN',NULL,?,?,?,'2026-07-01T00:00:00.000Z',1,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z')
    `).run(
      JSON.stringify(["HIGH_RISK_KEYWORD"]),
      JSON.stringify(["feedback:high"]),
      JSON.stringify({ decision: { triggers: [{ code: "HIGH_RISK_KEYWORD", label: "包含高风险词", facts: { keywords: "无法成像" } }] } }),
    );
    db.close();

    const query = createQualityReviewQuery({ dbPath, now: () => new Date("2026-07-14T00:00:00.000Z") });
    const result = query.list({ scope: "UNREVIEWED", page: 1, pageSize: 50 });
    query.close();

    expect(result.items.map((item) => item.sourceKey)).toEqual(["feedback:high", "feedback:plain", "feedback:boundary"]);
    expect(result.items[0]).toMatchObject({
      risk: { highRisk: true, repeat: false },
      review: { status: "UNREVIEWED", version: 0 },
    });
    expect(result.pagination.total).toBe(3);
  });

  it("flags needs-info feedback when its source content changes", () => {
    const dbPath = setup();
    seedSource(dbPath, {
      sourceKey: "feedback:FB-3",
      feedbackAt: "2026-07-01",
      feedbackNo: "FB-3",
      issueDescription: "缺少影响说明",
      contentHash: "hash-before",
    });
    const service = createQualitySourceReviewService({ dbPath, now: () => "2026-07-02T00:00:00.000Z" });
    service.reviewSource({
      actorUserId: "after-1", sourceKey: "feedback:FB-3", decision: "NEEDS_INFO",
      expectedVersion: 0, requestId: "req-needs-info",
    });
    service.close();
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE quality_source_rows SET content_hash='hash-after' WHERE source_key=?`).run("feedback:FB-3");
    db.close();

    const query = createQualityReviewQuery({ dbPath, now: () => new Date("2026-07-14T00:00:00.000Z") });
    const result = query.list({ scope: "NEEDS_INFO" });
    query.close();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sourceUpdatedSinceDecision).toBe(true);
  });

  it("marks linked sources reported only when the quality event is submitted", () => {
    const dbPath = setup();
    seedSource(dbPath, {
      sourceKey: "feedback:FB-4",
      feedbackAt: "2026-07-01",
      feedbackNo: "FB-4",
      issueDescription: "术中图像异常",
    });
    const service = createQualityEventService({
      dbPath,
      now: () => "2026-07-14T09:00:00.000Z",
    });
    const actor = { userId: "after-1", role: "aftersales_manager" as const };
    const draft = service.createDraftFromSources({
      actor,
      sourceKeys: ["feedback:FB-4"],
      requestId: "3f06a930-82f5-46fe-9096-b99a2fbd5fb5",
      overrides: { title: "FB-4 图像异常", currentSituation: "术中图像异常", urgency: "HIGH" },
    }).event;
    const before = new DatabaseSync(dbPath);
    expect(before.prepare("SELECT status FROM quality_source_reviews WHERE source_key=?").get("feedback:FB-4"))
      .toBeUndefined();
    before.close();

    service.submitDraft({
      actor,
      eventId: draft.eventId,
      expectedVersion: draft.version,
      requestId: "162cc7f2-aaed-4512-9199-a8b28b01af08",
    });
    service.close();

    const after = new DatabaseSync(dbPath);
    expect(after.prepare("SELECT status,event_id FROM quality_source_reviews WHERE source_key=?").get("feedback:FB-4"))
      .toEqual({ status: "REPORTED", event_id: draft.eventId });
    expect(after.prepare("SELECT desired_value FROM quality_source_writeback_outbox WHERE source_key=?").get("feedback:FB-4"))
      .toEqual({ desired_value: "已进入后续流程" });
    after.close();
  });
});
