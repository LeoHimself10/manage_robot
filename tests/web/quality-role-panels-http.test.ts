import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { handleQualityHttp } from "../../src/web/quality-http";

const NOW = "2026-08-27T08:00:00.000Z";

function request(method: string, body?: unknown): IncomingMessage {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
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
  return { res, ended, read: () => ({ status, body, payload: JSON.parse(body) as Record<string, any> }) };
}

async function call(path: string, method = "GET", body?: unknown, userId = "admin-1", role: "admin" | "manager" = "admin") {
  const capture = capturedResponse();
  handleQualityHttp({
    req: request(method, body),
    res: capture.res,
    url: new URL(`http://localhost${path}`),
    session: { userId, role },
  });
  await capture.ended;
  return capture.read();
}

describe("quality role-panel HTTP APIs", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quality-role-http-"));
    dbPath = join(tempDir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "aftersales-real");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-real");
    vi.stubEnv("QUALITY_EVENT_ROLE_PANELS_ENABLED", "1");
    vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED", "1");
    createWorkbenchFormalTaskStore().close();

    const store = createQualityStore(dbPath, { now: () => NOW });
    store.createDraft({
      eventId: "real-event",
      eventNo: "QE-REAL-HTTP",
      actorUserId: "aftersales-real",
      actorRole: "aftersales_manager",
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "真实事件",
      problemStatus: "真实业务事实",
    });
    store.createDraft({
      eventId: "test-event",
      eventNo: "QT-TEST-HTTP",
      actorUserId: "QUALITY_TEST_AFTERSALES_001",
      actorRole: "aftersales_manager",
      requestId: "22222222-2222-4222-8222-222222222222",
      title: "隔离测试事件",
      problemStatus: "隔离测试业务事实",
    });
    store.close();
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_events SET status='PENDING_ASSIGNMENT',version=2 WHERE id='real-event'").run();
    db.prepare("UPDATE quality_events SET is_test=1,status='PENDING_ASSIGNMENT',version=2 WHERE id='test-event'").run();
    db.prepare(`INSERT INTO quality_initial_analysis_versions(
      analysis_id,event_id,version,status,problem_direction,confirmed_category,
      source_summary,analysis_basis,initial_conclusion,information_gaps,
      suggested_department,processing_requirements,suggested_due_at,created_by,
      completed_by,completed_at,created_at,updated_at
    ) VALUES('analysis-test','test-event',1,'COMPLETED','测试方向','测试分类',
      '测试事实摘要','测试分析依据','测试初步结论','无','研发中心',
      '完成原因排查','2026-09-30T08:00:00.000Z','QUALITY_TEST_SPECIALIST_001',
      'QUALITY_TEST_SPECIALIST_001',?,?,?)`).run(NOW, NOW, NOW);
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("projects different fields and refuses every cross-scope detail read", async () => {
    const aftersales = await call("/api/workbench/quality/events/test-event?testActor=aftersales");
    const specialist = await call("/api/workbench/quality/events/test-event?testActor=quality-management");
    const manager = await call("/api/workbench/quality/events/test-event?testActor=manager-1");
    const testReadingReal = await call("/api/workbench/quality/events/real-event?testActor=aftersales");
    const realReadingTest = await call("/api/workbench/quality/events/test-event?perspective=aftersales");

    expect(aftersales.status).toBe(200);
    expect(aftersales.payload.data.viewModel).toHaveProperty("assessment");
    expect(specialist.status).toBe(200);
    expect(JSON.stringify(specialist.payload)).not.toContain("assessment");
    expect(manager.status).toBe(404);
    expect(testReadingReal.status).toBe(404);
    expect(realReadingTest.status).toBe(404);
    const safe = JSON.stringify(specialist.payload);
    expect(safe).not.toContain("source_snapshot_json");
    expect(safe).not.toContain("PENDING_ASSIGNMENT");
    expect(safe).not.toContain("actor_user_id");
  });

  it("ignores a real user's perspective parameter and forbids test actor impersonation", async () => {
    const forcedSpecialist = await call(
      "/api/workbench/quality/events/real-event?perspective=quality_management",
      "GET",
      undefined,
      "aftersales-real",
      "manager",
    );
    const forcedTest = await call(
      "/api/workbench/quality/events/test-event?testActor=aftersales",
      "GET",
      undefined,
      "aftersales-real",
      "manager",
    );
    expect(forcedSpecialist.status).toBe(200);
    expect(forcedSpecialist.payload.data.viewModel.perspective).toBe("aftersales");
    expect(forcedSpecialist.payload.data.viewModel).toHaveProperty("assessment");
    expect(forcedTest.status).toBe(403);
    expect(forcedTest.payload.error).toMatchObject({ errorCategory: "permission" });

    const adminWrite = await call(
      "/api/workbench/quality/events/real-event/assign-supervisor?perspective=quality_management",
      "POST",
      {
        candidateRef: "candidate:any",
        dueAt: "2026-09-30T08:00:00.000Z",
        taskRequirement: "不能由管理员代操作",
        expectedVersion: 2,
        requestId: "77777777-7777-4777-8777-777777777777",
      },
    );
    expect(adminWrite.status).toBe(403);
  });

  it("returns seven safe department groups and rejects array/made-up supervisor input", async () => {
    const options = await call(
      "/api/workbench/quality/events/test-event/supervisor-options?testActor=quality-management",
    );
    expect(options.status).toBe(200);
    expect(options.payload.data.departments).toHaveLength(7);
    expect(options.payload.data.departments.flatMap((item: any) => item.supervisors)
      .map((item: any) => item.displayName)).toEqual(["主管一（测试）", "主管二（测试）"]);
    expect(JSON.stringify(options.payload)).not.toContain("QUALITY_TEST_MANAGER_001");

    const multiple = await call(
      "/api/workbench/quality/events/test-event/assign-supervisor?testActor=quality-management",
      "POST",
      {
        candidateRef: options.payload.data.departments.flatMap((item: any) => item.supervisors)
          .map((item: any) => item.candidateRef),
        dueAt: "2026-09-30T08:00:00.000Z",
        taskRequirement: "完成原因排查",
        expectedVersion: 2,
        requestId: "33333333-3333-4333-8333-333333333333",
      },
    );
    expect(multiple.status).toBe(400);
    expect(multiple.payload.error).toMatchObject({ errorCategory: "validation" });
    expect(JSON.stringify(multiple.payload)).not.toContain("Zod");

    const madeUp = await call(
      "/api/workbench/quality/events/test-event/assign-supervisor?testActor=quality-management",
      "POST",
      {
        candidateRef: "014517256544",
        dueAt: "2026-09-30T08:00:00.000Z",
        taskRequirement: "完成原因排查",
        expectedVersion: 2,
        requestId: "44444444-4444-4444-8444-444444444444",
      },
    );
    expect(madeUp.status).toBe(409);
    expect(JSON.stringify(madeUp.payload)).not.toContain("014517256544");
  });

  it("assigns exactly one test manager, then preserves rejection history and returns to assignment", async () => {
    const options = await call(
      "/api/workbench/quality/events/test-event/supervisor-options?testActor=quality-management",
    );
    const candidate = options.payload.data.departments
      .flatMap((item: any) => item.supervisors)
      .find((item: any) => item.displayName === "主管一（测试）");
    const assigned = await call(
      "/api/workbench/quality/events/test-event/assign-supervisor?testActor=quality-management",
      "POST",
      {
        candidateRef: candidate.candidateRef,
        dueAt: "2026-09-30T08:00:00.000Z",
        taskRequirement: "完成原因排查",
        expectedVersion: 2,
        requestId: "55555555-5555-4555-8555-555555555555",
      },
    );
    expect(assigned.status).toBe(201);
    expect(assigned.payload.data.viewModel.supervisorAssignment).toMatchObject({
      assigned: true,
      supervisorName: "主管一（测试）",
      departmentName: "研发中心",
    });
    const manager = await call("/api/workbench/quality/events/test-event?testActor=manager-1");
    const node = manager.payload.data.viewModel.branch[0];
    const rejected = await call(
      "/api/workbench/quality/events/test-event/manager-action?testActor=manager-1",
      "POST",
      {
        action: "reject",
        actionRef: node.actionRef,
        expectedVersion: node.version,
        reason: "测试条件尚不完整",
        requestId: "66666666-6666-4666-8666-666666666666",
      },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.payload.data.viewModel.event.statusLabel).toBe("待主管选择");
    expect(JSON.stringify(rejected.payload)).not.toContain("PENDING_ASSIGNMENT");

    const db = new DatabaseSync(dbPath);
    const event = db.prepare("SELECT status FROM quality_events WHERE id='test-event'").get() as { status: string };
    const rejectedNode = db.prepare("SELECT status FROM quality_assignment_nodes WHERE event_id='test-event'").get() as { status: string };
    const testAudits = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_test_action_audit WHERE event_id='test-event' AND actual_admin_user_id='admin-1'")
      .get() as { count: number }).count);
    const links = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links").get() as { count: number }).count);
    db.close();
    expect(event.status).toBe("PENDING_ASSIGNMENT");
    expect(rejectedNode.status).toBe("REJECTED");
    expect(testAudits).toBe(2);
    expect(links).toBe(0);
  });
});
