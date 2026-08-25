import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityPlanningService } from "../../src/quality/planning/quality-planning-service";
import { handleQualityHttp, isQualityApiPath } from "../../src/web/quality-http";

function request(method: string, body?: unknown): IncomingMessage {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
  } as IncomingMessage;
}

function capturedResponse() {
  let status = 200;
  let body = "";
  let resolve!: () => void;
  const ended = new Promise<void>((done) => { resolve = done; });
  const res = {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { body = chunk ?? ""; resolve(); },
  } as ServerResponse;
  return { res, ended, read: () => ({ status, body }) };
}

async function call(path: string, method: string, userId: string, body?: unknown) {
  const capture = capturedResponse();
  handleQualityHttp({
    req: request(method, body),
    res: capture.res,
    url: new URL(`http://localhost${path}`),
    session: { userId, role: "manager" },
  });
  await capture.ended;
  return capture.read();
}

describe("quality planning HTTP", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quality-planning-http-"));
    dbPath = join(tempDir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    vi.stubEnv("PLAN_SESSION_DIR", join(tempDir, "sessions"));
    vi.stubEnv("QUALITY_TASK_PLANNING_V2_ENABLED", "1");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "manager-1");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-user");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "");
    createWorkbenchFormalTaskStore().close();
    const quality = createQualityStore(dbPath);
    quality.createDraft({
      eventId: "event-http",
      eventNo: "QE-HTTP-001",
      actorUserId: "manager-1",
      actorRole: "aftersales_manager",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "HTTP 质量事件",
      problemStatus: "来源事实摘要",
    });
    quality.close();
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_events SET status='PENDING_ASSIGNMENT',version=2 WHERE id='event-http'").run();
    db.close();
    const planning = createQualityPlanningService({ dbPath });
    const draft = planning.saveAnalysisDraft({
      eventId: "event-http",
      actorUserId: "quality-user",
      expectedEventVersion: 2,
      fields: {
        problemDirection: "制造",
        confirmedCategory: "一致性",
        sourceSummary: "来源事实摘要",
        analysisBasis: "批次记录",
        initialConclusion: "需排查",
        informationGaps: "无",
        suggestedDepartment: "质量部",
        processingRequirements: "完成原因分析",
        suggestedDueAt: "2026-08-30T10:00:00.000Z",
      },
    });
    planning.completeAnalysis({ eventId: "event-http", analysisId: draft.analysisId, actorUserId: "quality-user" });
    planning.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers v2 endpoints and only lets an actual manager create the allocation session", async () => {
    expect(isQualityApiPath("/api/workbench/quality/events/event-http/analysis")).toBe(true);
    expect(isQualityApiPath("/api/workbench/quality/events/event-http/planning-session")).toBe(true);

    const denied = await call(
      "/api/workbench/quality/events/event-http/planning-session",
      "POST",
      "quality-user",
      { expectedEventVersion: 2, requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    );
    expect(denied.status).toBe(403);

    const created = await call(
      "/api/workbench/quality/events/event-http/planning-session",
      "POST",
      "manager-1",
      { expectedEventVersion: 2, requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    );
    expect(created.status).toBe(201);
    const payload = JSON.parse(created.body);
    expect(payload.data.chatUrl).toContain("/workbench/manager/chat?thread=side&threadId=");
    expect(payload.data.planning.bindingStatus).toBe("DRAFT");
  });
});
