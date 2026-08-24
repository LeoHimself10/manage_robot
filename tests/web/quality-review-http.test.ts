import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import {
  handleQualityHttp,
  isQualityApiPath,
  isQualityPagePath,
} from "../../src/web/quality-http";

let tempDir = "";

function req(method: string, body?: unknown): IncomingMessage {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
  } as IncomingMessage;
}

function response() {
  let status = 200;
  let body = "";
  let done!: () => void;
  const ended = new Promise<void>((resolve) => { done = resolve; });
  const res = {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { body = chunk ?? ""; done(); },
  } as ServerResponse;
  return { res, ended, read: () => ({ status, body }) };
}

function seedSource(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  const normalized = {
    sourceKey: "feedback:FB-HTTP", rowNumber: 2, contentHash: "hash-http",
    feedbackAt: "2026-07-01", feedbackNo: "FB-HTTP", reporter: "客户",
    deviceModel: "Model-A", serialNo: "SN-HTTP", catheterBatch: "B-HTTP",
    issueDescription: "偶发图像异常", clinicianAware: "", impact: "", confirmation: "",
    owner: "", returned: "", category: "图像", status: "", solutionEngineer: "",
    solution: "", finalCause: "", customerFollowup: "", rawSnapshot: { 问题描述: "偶发图像异常" },
  };
  db.prepare(`INSERT INTO quality_source_rows(
    source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
    normalized_json,raw_snapshot_json,first_seen_at,last_seen_at,synced_at,version
  ) VALUES(?, 'sheet', '客户端问题反馈记录表', 2, 'ACTIVE', 1, ?, ?, ?, ?, ?, ?, 1)`).run(
    normalized.sourceKey, normalized.contentHash, JSON.stringify(normalized),
    JSON.stringify(normalized.rawSnapshot), "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z",
  );
  db.close();
}

async function call(path: string, method: string, userId: string, body?: unknown) {
  const captured = response();
  const handled = handleQualityHttp({
    req: req(method, body), res: captured.res, url: new URL(`http://localhost${path}`),
    session: { userId, role: "manager" },
  });
  await captured.ended;
  return { handled, ...captured.read() };
}

describe("quality review HTTP", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quality-review-http-"));
    const dbPath = join(tempDir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "after-1");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "specialist-1");
    vi.stubEnv("QUALITY_SOURCE_WRITEBACK_ENABLED", "0");
    createQualityStore(dbPath).close();
    seedSource(dbPath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers the review page and APIs and denies a specialist", async () => {
    expect(isQualityPagePath("/workbench/quality/review")).toBe(true);
    expect(isQualityApiPath("/api/workbench/quality/review-queue")).toBe(true);
    expect(isQualityApiPath("/api/workbench/quality/source/feedback%3AFB-HTTP/review")).toBe(true);
    expect(isQualityApiPath(
      "/api/workbench/quality/assessments/feedback%3AFB-HTTP/disposition",
    )).toBe(true);

    const denied = await call("/api/workbench/quality/review-queue", "GET", "specialist-1");
    expect(denied.status).toBe(403);
  });

  it("lists and reviews a source with optimistic locking", async () => {
    const listed = await call("/api/workbench/quality/review-queue?scope=UNREVIEWED", "GET", "after-1");
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.body).data.items[0].sourceKey).toBe("feedback:FB-HTTP");

    const requestId = "92eb62d8-c946-40ab-8bf0-a5e56e8394a8";
    const reviewed = await call(
      "/api/workbench/quality/source/feedback%3AFB-HTTP/review", "POST", "after-1",
      { decision: "NEEDS_INFO", note: "请补充现场日志", expectedVersion: 0, requestId },
    );
    expect(reviewed.status).toBe(200);
    expect(JSON.parse(reviewed.body).data.review).toMatchObject({ status: "NEEDS_INFO", version: 1 });

    const conflict = await call(
      "/api/workbench/quality/source/feedback%3AFB-HTTP/review", "POST", "after-1",
      { decision: "ORDINARY", expectedVersion: 0, requestId: "f6f32489-b4b9-48ac-9150-354cd36b2441" },
    );
    expect(conflict.status).toBe(409);
  });

  it("requires backend supervisor permission and reloads a formal ordinary disposition", async () => {
    const saveBody = {
      handlingRecommendation: "ORDINARY",
      categoryMode: "STANDARD",
      primaryCategoryCode: "CATHETER_PRODUCT",
      secondaryCategoryCode: "CATHETER_BEND_SHAKE",
      customPrimaryCategoryName: null,
      customSecondaryCategoryName: null,
      riskLevel: "LOW",
      conclusion: "主管确认属于普通反馈。",
      adoptionMode: "MANUAL",
      changeReason: null,
      expectedVersion: 0,
      requestId: "11111111-1111-4111-8111-111111111111",
    };
    const saved = await call(
      "/api/workbench/quality/assessments/feedback%3AFB-HTTP",
      "PUT",
      "after-1",
      saveBody,
    );
    expect(saved.status).toBe(200);
    const assessmentVersion = JSON.parse(saved.body).data.assessment.version as number;
    const dispositionPath =
      "/api/workbench/quality/assessments/feedback%3AFB-HTTP/disposition";
    const denied = await call(dispositionPath, "POST", "specialist-1", {
      expectedAssessmentVersion: assessmentVersion,
      expectedReviewVersion: 0,
      requestId: "22222222-2222-4222-8222-222222222222",
    });
    expect(denied.status).toBe(403);

    const disposed = await call(dispositionPath, "POST", "after-1", {
      expectedAssessmentVersion: assessmentVersion,
      expectedReviewVersion: 0,
      requestId: "33333333-3333-4333-8333-333333333333",
      note: "普通反馈正式确认。",
    });
    expect(disposed.status).toBe(200);
    expect(JSON.parse(disposed.body).data.review).toMatchObject({
      status: "ORDINARY",
      decidedBy: "after-1",
      assessmentVersion,
    });

    const reloaded = await call(
      "/api/workbench/quality/assessments/feedback%3AFB-HTTP",
      "GET",
      "after-1",
    );
    expect(JSON.parse(reloaded.body).data.review).toMatchObject({
      status: "ORDINARY",
      note: "普通反馈正式确认。",
      assessmentVersion,
    });
  });

  it("creates and idempotently submits one anomaly event in pending analysis", async () => {
    const saved = await call(
      "/api/workbench/quality/assessments/feedback%3AFB-HTTP",
      "PUT",
      "after-1",
      {
        handlingRecommendation: "QUALITY_ANOMALY",
        categoryMode: "STANDARD",
        primaryCategoryCode: "CATHETER_PRODUCT",
        secondaryCategoryCode: "CATHETER_BEND_SHAKE",
        customPrimaryCategoryName: null,
        customSecondaryCategoryName: null,
        riskLevel: "HIGH",
        conclusion: "主管确认需要通报质量异常。",
        adoptionMode: "MANUAL",
        changeReason: null,
        expectedVersion: 0,
        requestId: "44444444-4444-4444-8444-444444444444",
      },
    );
    const assessmentVersion = JSON.parse(saved.body).data.assessment.version as number;
    const draft = await call(
      "/api/workbench/quality/events/drafts",
      "POST",
      "after-1",
      {
        sourceKeys: ["feedback:FB-HTTP"],
        assessmentVersion,
        requestId: "55555555-5555-4555-8555-555555555555",
      },
    );
    expect(draft.status).toBe(201);
    const draftEvent = JSON.parse(draft.body).data.event as {
      eventId: string;
      version: number;
      status: string;
      deviceModel: string;
    };
    expect(draftEvent).toMatchObject({ status: "DRAFT", deviceModel: "Model-A" });

    const submitPath = `/api/workbench/quality/events/${encodeURIComponent(draftEvent.eventId)}/submit`;
    const submitBody = {
      expectedVersion: draftEvent.version,
      requestId: "66666666-6666-4666-8666-666666666666",
    };
    const submitted = await call(submitPath, "POST", "after-1", submitBody);
    const retried = await call(submitPath, "POST", "after-1", submitBody);
    expect(submitted.status).toBe(200);
    expect(retried.status).toBe(200);
    expect(JSON.parse(submitted.body).data.event).toMatchObject({
      eventId: draftEvent.eventId,
      status: "PENDING_ANALYSIS",
    });
    expect(JSON.parse(retried.body).data.event).toMatchObject({
      eventId: draftEvent.eventId,
      status: "PENDING_ANALYSIS",
    });

    const dbPath = join(tempDir, "workbench.sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_events").get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM quality_event_reporting_snapshots
    `).get()).toEqual({ count: 1 });
    db.close();
  });
});
