import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualitySourceReviewService } from "../../src/quality/reviews/quality-source-review-service";
import {
  createDingTalkQualitySourceWriter,
  createQualitySourceWritebackOutbox,
} from "../../src/quality/source/quality-source-writeback";
import { createQualitySourceWritebackRuntime } from "../../src/quality/source/quality-source-writeback-runtime";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "quality-writeback-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "quality.sqlite");
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  const normalized = {
    sourceKey: "feedback:FB-1", rowNumber: 2, contentHash: "hash-1",
    feedbackAt: "2026-07-01", feedbackNo: "FB-1", reporter: "测试人员",
    deviceModel: "Mobile", serialNo: "SN-1", catheterBatch: "B-1",
    issueDescription: "术中图像异常", clinicianAware: "", impact: "", confirmation: "",
    owner: "", returned: "", category: "图像异常", status: "", solutionEngineer: "",
    solution: "", finalCause: "", customerFollowup: "", rawSnapshot: {},
  };
  db.prepare(`
    INSERT INTO quality_source_rows(
      source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
      normalized_json,raw_snapshot_json,first_seen_at,last_seen_at,synced_at,version
    ) VALUES('feedback:FB-1','sheet-1','客户端问题反馈记录表',2,'ACTIVE',1,'hash-1',?,'{}',?,?,?,1)
  `).run(JSON.stringify(normalized), "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.close();
  return dbPath;
}

describe("quality source writeback outbox", () => {
  it("supersedes an older review and sends only the newest desired value", async () => {
    const dbPath = setup();
    const review = createQualitySourceReviewService({ dbPath, now: () => "2026-07-14T00:00:00.000Z" });
    review.reviewSource({ actorUserId: "after", sourceKey: "feedback:FB-1", decision: "ORDINARY", expectedVersion: 0, requestId: "req-1" });
    review.reviewSource({ actorUserId: "after", sourceKey: "feedback:FB-1", decision: "NEEDS_INFO", expectedVersion: 1, requestId: "req-2" });
    review.close();
    const sent: string[] = [];
    const outbox = createQualitySourceWritebackOutbox({ dbPath, now: () => new Date("2026-07-14T00:00:00.000Z") });

    const first = await outbox.processNext(async ({ desiredValue }) => { sent.push(desiredValue); });
    const second = await outbox.processNext(async ({ desiredValue }) => { sent.push(desiredValue); });
    outbox.close();

    expect(first?.status).toBe("SUPERSEDED");
    expect(second?.status).toBe("SENT");
    expect(sent).toEqual(["待补资料"]);
  });

  it("records a DingTalk 403 for retry without rolling back the local review", async () => {
    const dbPath = setup();
    const review = createQualitySourceReviewService({ dbPath, now: () => "2026-07-14T00:00:00.000Z" });
    review.reviewSource({ actorUserId: "after", sourceKey: "feedback:FB-1", decision: "ORDINARY", expectedVersion: 0, requestId: "req-1" });
    review.close();
    let current = new Date("2026-07-14T00:00:00.000Z");
    const outbox = createQualitySourceWritebackOutbox({ dbPath, now: () => current });
    const failed = await outbox.processNext(async () => {
      throw new Error("DingTalk HTTP 403 access_token=secret forbidden");
    });
    current = new Date("2026-07-14T00:02:00.000Z");
    const sent = await outbox.processNext(async () => undefined);
    outbox.close();

    expect(failed).toMatchObject({ status: "RETRY", attemptCount: 1 });
    expect(failed?.lastError).toContain("403");
    expect(failed?.lastError).not.toContain("secret");
    expect(sent?.status).toBe("SENT");
    const db = new DatabaseSync(dbPath);
    expect(db.prepare(`SELECT status FROM quality_source_reviews WHERE source_key='feedback:FB-1'`).get())
      .toEqual({ status: "ORDINARY" });
    db.close();
  });
});

describe("DingTalk quality source writer", () => {
  it("adds the status column, backfills recent rows, and locates a moved row by feedback number", async () => {
    const writes: Array<{ range: string; values: string[][] }> = [];
    const sheetRows = [
      ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "导管批次", "问题描述", "问题归类"],
      ["2025-01-01", "OLD-1", "甲", "Mobile", "SN-OLD", "B-OLD", "旧问题", "其他"],
      ["2026-06-01", "FB-2", "乙", "Mobile", "SN-2", "B-2", "近期问题", "图像异常"],
      ["2026-07-01", "FB-1", "测试人员", "Mobile", "SN-1", "B-1", "术中图像异常", "图像异常"],
    ];
    const client = {
      async listSheets() { return [{ id: "sheet-1", name: "客户端问题反馈记录表" }]; },
      async getSheetProperties() { return { id: "sheet-1", name: "客户端问题反馈记录表", lastNonEmptyRow: 3, lastNonEmptyColumn: 7 }; },
      async readSheetValues() { return sheetRows; },
      async writeSheetRangeValues(_a: string, _b: string, _c: unknown, _d: string, _e: string, range: string, values: string[][]) {
        writes.push({ range, values });
      },
    };
    const writer = createDingTalkQualitySourceWriter({
      client,
      env: {
        DINGTALK_CLIENT_ID: "app", DINGTALK_CLIENT_SECRET: "secret",
        QUALITY_SOURCE_WORKBOOK_ID: "workbook", QUALITY_SOURCE_OPERATOR_UNION_ID: "operator",
      },
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });

    const result = await writer.writeStatus({
      source: {
        sourceKey: "feedback:FB-1", rowNumber: 2, contentHash: "hash-1",
        feedbackAt: "2026-07-01", feedbackNo: "FB-1", reporter: "测试人员",
        deviceModel: "Mobile", serialNo: "SN-1", catheterBatch: "B-1",
        issueDescription: "术中图像异常", clinicianAware: "", impact: "", confirmation: "",
        owner: "", returned: "", category: "图像异常", status: "", solutionEngineer: "",
        solution: "", finalCause: "", customerFollowup: "", rawSnapshot: {},
      },
      desiredValue: "已进入后续流程",
    });

    expect(result).toMatchObject({ rowNumber: 4, column: "I", headerCreated: true, backfilled: 2 });
    expect(writes).toEqual([
      { range: "I1:I1", values: [["质量研判状态"]] },
      { range: "I3:I4", values: [["未研判"], ["未研判"]] },
      { range: "I4:I4", values: [["已进入后续流程"]] },
    ]);
  });

  it("preserves non-empty status cells and refuses ambiguous feedback numbers", async () => {
    const writes: Array<{ range: string; values: string[][] }> = [];
    const sheetRows = [
      ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "导管批次", "问题描述", "问题归类", "质量研判状态"],
      ["2026-07-01", "FB-DUP", "甲", "Mobile", "SN-1", "B-1", "问题一", "其他", "人工保留值"],
      ["2026-07-02", "FB-DUP", "乙", "Mobile", "SN-2", "B-2", "问题二", "其他", ""],
    ];
    const client = {
      async listSheets() { return [{ id: "sheet-1", name: "客户端问题反馈记录表" }]; },
      async getSheetProperties() { return { id: "sheet-1", name: "客户端问题反馈记录表", lastNonEmptyRow: 2, lastNonEmptyColumn: 8 }; },
      async readSheetValues() { return sheetRows; },
      async writeSheetRangeValues(_a: string, _b: string, _c: unknown, _d: string, _e: string, range: string, values: string[][]) {
        writes.push({ range, values });
      },
    };
    const writer = createDingTalkQualitySourceWriter({
      client,
      env: {
        DINGTALK_CLIENT_ID: "app", DINGTALK_CLIENT_SECRET: "secret",
        QUALITY_SOURCE_WORKBOOK_ID: "workbook", QUALITY_SOURCE_OPERATOR_UNION_ID: "operator",
      },
      now: () => new Date("2026-07-14T00:00:00.000Z"),
    });

    await expect(writer.writeStatus({
      source: {
        sourceKey: "feedback:FB-DUP", rowNumber: 2, contentHash: "hash",
        feedbackAt: "2026-07-01", feedbackNo: "FB-DUP", reporter: "甲",
        deviceModel: "Mobile", serialNo: "SN-1", catheterBatch: "B-1",
        issueDescription: "问题一", clinicianAware: "", impact: "", confirmation: "",
        owner: "", returned: "", category: "其他", status: "", solutionEngineer: "",
        solution: "", finalCause: "", customerFollowup: "", rawSnapshot: {},
      },
      desiredValue: "普通反馈",
    })).rejects.toThrow("反馈单号在钉钉原表中不唯一");
    expect(writes).toEqual([{ range: "I3:I3", values: [["未研判"]] }]);
  });
});

describe("quality source writeback runtime", () => {
  it("initializes the status column and drains pending writes in one scan", async () => {
    let initialized = 0;
    let processed = 0;
    const runtime = createQualitySourceWritebackRuntime({
      env: {
        DINGTALK_CLIENT_ID: "app", DINGTALK_CLIENT_SECRET: "secret",
        QUALITY_SOURCE_WORKBOOK_ID: "workbook", QUALITY_SOURCE_OPERATOR_UNION_ID: "operator",
      },
      writer: {
        async ensureStatusColumnAndBackfill() { initialized += 1; return { backfilled: 2 }; },
        async writeStatus() { return { rowNumber: 2, column: "I", headerCreated: false, backfilled: 0 }; },
      },
      outbox: {
        async processNext() {
          processed += 1;
          return processed === 1 ? { status: "SENT" } : null;
        },
        close() {},
      },
      log: () => undefined,
    });

    const result = await runtime.runOnce();
    runtime.stop();

    expect(result).toEqual({ skipped: false, backfilled: 2, processed: 1 });
    expect(initialized).toBe(1);
  });
});
