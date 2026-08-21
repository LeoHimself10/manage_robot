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
});
