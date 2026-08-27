import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function capturedHtmlResponse() {
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

async function call(path: string, method = "GET", body?: unknown, userId = "admin-1", role: "admin" | "manager" | "employee" = "admin") {
  const target = new URL(`http://localhost${path}`);
  if (target.pathname.startsWith("/api/workbench/quality/events/")
    && (target.searchParams.has("testActor") || target.searchParams.has("perspective"))) {
    target.searchParams.set("projection", "1");
  }
  const capture = capturedResponse();
  handleQualityHttp({
    req: request(method, body),
    res: capture.res,
    url: target,
    session: { userId, role },
  });
  await capture.ended;
  return capture.read();
}

async function callPage(path: string, userId = "admin-1", role: "admin" | "manager" | "employee" = "admin") {
  const capture = capturedHtmlResponse();
  handleQualityHttp({
    req: request("GET"),
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
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "aftersales-real");
    vi.stubEnv("QUALITY_EVENT_ROLE_PANELS_ENABLED", "1");
    vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED", "1");
    vi.stubEnv("PLAN_SESSION_DIR", join(tempDir, "sessions"));
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
    store.createDraft({
      eventId: "test-analysis-event",
      eventNo: "QT-ANALYSIS-HTTP",
      actorUserId: "QUALITY_TEST_AFTERSALES_001",
      actorRole: "aftersales_manager",
      requestId: "29999999-9999-4999-8999-999999999999",
      title: "等待测试质量初析",
      problemStatus: "允许马荣鑫修订并由佟成完成质量初析",
    });
    store.close();
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_events SET status='PENDING_ASSIGNMENT',version=2 WHERE id='real-event'").run();
    db.prepare("UPDATE quality_events SET is_test=1,status='PENDING_ASSIGNMENT',version=2 WHERE id='test-event'").run();
    db.prepare("UPDATE quality_events SET is_test=1,status='PENDING_ANALYSIS',version=2,initial_category='测试分类',urgency='MEDIUM',overall_due_at='2026-09-30T08:00:00.000Z' WHERE id='test-analysis-event'").run();
    db.prepare(`INSERT INTO quality_analysis_versions(
      analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,
      deliverables_json,diff_json,modification_reason,primary_department_id,
      primary_department_name,collaborator_departments_json,primary_manager_user_id,
      primary_manager_name,primary_manager_account_status,suggested_total_due_at,
      schema_version,prompt_version,model_config_id,input_version,rule_version,
      case_library_version,knowledge_version,generated_by,edited_by,confirmed_by,
      confirmed_at,created_at
    ) VALUES('analysis-test','test-event',1,'request-analysis-test',NULL,?,?,'{}',
      '测试初析','dept-rd','研发中心','[]','QUALITY_TEST_MANAGER_001',
      '测试主管','active','2026-09-30T08:00:00.000Z',
      'quality-analysis-output-v1',NULL,NULL,NULL,'rules-v1','cases-v1','knowledge-v1',
      NULL,'QUALITY_TEST_SPECIALIST_001','QUALITY_TEST_SPECIALIST_001',?,?)`).run(
      JSON.stringify({
        problemDirection: "测试方向",
        confirmedCategoryReference: "测试分类",
        sourceFactSummary: ["测试事实摘要"],
        analysisBasis: ["测试分析依据"],
        preliminaryConclusion: "测试初步结论",
        informationGaps: [],
        handlingRequirements: ["完成原因排查"],
      }),
      JSON.stringify([{ name: "原因排查记录", selected: true }]),
      NOW,
      NOW,
    );
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("defaults administrators to the six test perspectives and hides the switch from ordinary users", async () => {
    const adminPage = await callPage("/workbench/quality");
    expect(adminPage.status).toBe(200);
    expect(adminPage.body).toContain('data-test-actor="aftersales"');
    expect(adminPage.body).toContain('aria-label="管理员隔离测试视角"');
    expect(adminPage.body).toContain("马荣鑫（测试）");
    expect(adminPage.body).toContain("佟成（测试）");
    expect(adminPage.body).toContain("测试员工1");
    expect(adminPage.body).toContain("测试员工2");
    expect(adminPage.body).toContain("测试员工3");
    expect(adminPage.body).toContain("测试主管");
    expect(adminPage.body).not.toContain("主管二（测试）");
    expect(adminPage.body).not.toContain("测试看板");
    expect(adminPage.body).not.toContain("切换到成员工作台");
    expect(adminPage.body).toContain('data-metric-role="overview"');
    expect(adminPage.body).toContain("待质量初析");
    expect(adminPage.body).toContain("待任务分配");
    expect(adminPage.body).toContain("待质量终验");
    expect(adminPage.body).not.toContain('data-quality-list="feedback"');

    const ordinaryPage = await callPage("/workbench/quality", "aftersales-real", "manager");
    expect(ordinaryPage.status).toBe(200);
    expect(ordinaryPage.body).not.toContain('aria-label="管理员隔离测试视角"');
    expect(ordinaryPage.body).not.toContain("测试员工1");
  });

  it("keeps a delegated test specialist in the isolated scope when the URL has no testActor parameter", async () => {
    const delegatedPage = await callPage(
      "/workbench/quality",
      "QUALITY_TEST_SPECIALIST_001",
      "employee",
    );
    expect(delegatedPage.status).toBe(200);
    expect(delegatedPage.body).toContain('data-test-actor="quality-management"');
    expect(delegatedPage.body).toContain('data-perspective="quality_management"');

    const options = await call(
      "/api/workbench/quality/events/test-event/supervisor-options",
      "GET",
      undefined,
      "QUALITY_TEST_SPECIALIST_001",
      "employee",
    );
    expect(options.status).toBe(200);
    expect(options.payload.data.departments).toHaveLength(1);
    expect(options.payload.data.departments[0].departmentName).toBe("测试主管");
    expect(options.payload.data.departments[0].supervisors.map((item: any) => item.displayName))
      .toEqual(["测试主管"]);

    const realEvent = await call(
      "/api/workbench/quality/events/real-event",
      "GET",
      undefined,
      "QUALITY_TEST_SPECIALIST_001",
      "employee",
    );
    expect(realEvent.status).toBe(404);
  });

  it("lets Ma Rongxin edit review fields and Tong Cheng complete initial analysis", async () => {
    const aftersales = await call(
      "/api/workbench/quality/events/test-analysis-event?testActor=aftersales",
    );
    expect(aftersales.status).toBe(200);
    expect(aftersales.payload.data.viewModel).toMatchObject({
      perspective: "aftersales",
      allowedActions: ["generate-original-ai", "update-aftersales"],
      assessment: {
        originalSuggestion: {
          generationSource: "NONE",
          generationLabel: "尚未生成",
        },
      },
      event: {
        attentionBucket: "TODO",
        attentionLabel: "待质量初析",
        statusLabel: "待质量初析",
      },
    });
    const reviewed = await call(
      "/api/workbench/quality/events/test-analysis-event/test-action?testActor=aftersales",
      "POST",
      {
        action: "update-aftersales",
        expectedVersion: 2,
        requestId: "31111111-1111-4111-8111-111111111111",
        problemStatus: "人工修订后的测试事实",
        initialCategory: "影像与光学／无图像或影像中断",
        urgency: "HIGH",
        supplement: "测试补充说明",
        reason: "核对人工研判输入",
      },
    );
    expect(reviewed.status).toBe(200);
    expect(reviewed.payload.data.viewModel.event).toMatchObject({
      currentSituation: "人工修订后的测试事实",
      urgencyCode: "HIGH",
      version: 3,
    });

    const specialist = await call(
      "/api/workbench/quality/events/test-analysis-event?testActor=quality-management",
    );
    expect(specialist.status).toBe(200);
    expect(specialist.payload.data.viewModel.allowedActions).toContain("generate-analysis-ai");
    expect(specialist.payload.data.viewModel.allowedActions).toContain("complete-analysis");
    expect(specialist.payload.data.viewModel.testAnalysisDraft).toMatchObject({
      generationSource: "FIXTURE",
      suggestedDepartment: "研发中心",
      deliverableName: "原因排查与验证记录",
    });
    const analyzed = await call(
      "/api/workbench/quality/events/test-analysis-event/test-action?testActor=quality-management",
      "POST",
      {
        action: "complete-analysis",
        expectedVersion: 3,
        requestId: "32222222-2222-4222-8222-222222222222",
        problemDirection: "影像异常原因核验",
        confirmedCategory: "影像与光学／无图像或影像中断",
        sourceFactSummary: "测试来源事实已确认",
        analysisBasis: "AI原始建议\n主管最终研判",
        preliminaryConclusion: "建议研发中心完成原因排查",
        informationGaps: "复现记录待补充",
        handlingRequirements: "完成原因核查\n上传验证证据",
        suggestedDueAt: "2026-09-30T08:00:00.000Z",
        deliverableName: "原因排查与验证记录",
        deliverableDescription: "形成完整测试记录",
        acceptanceCriteria: "包含原因、措施和验证结果",
      },
    );
    expect(analyzed.status).toBe(200);
    expect(analyzed.payload.data.viewModel).toMatchObject({
      perspective: "quality_management",
      allowedActions: ["assign-supervisor"],
      event: { statusLabel: "待任务分配", attentionBucket: "TODO", version: 4 },
    });

    const db = new DatabaseSync(dbPath);
    const auditCount = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM quality_test_action_audit
      WHERE event_id='test-analysis-event' AND actual_admin_user_id='admin-1'
    `).get() as { count: number }).count);
    const analyses = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM quality_analysis_versions
      WHERE event_id='test-analysis-event'
    `).get() as { count: number }).count);
    const handoffs = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM quality_analysis_handoffs
      WHERE event_id='test-analysis-event'
    `).get() as { count: number }).count);
    const unsafe = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM quality_notification_outbox
      WHERE event_id='test-analysis-event' AND channel<>'TEST'
    `).get() as { count: number }).count);
    db.close();
    expect({ auditCount, analyses, handoffs, unsafe })
      .toEqual({ auditCount: 2, analyses: 1, handoffs: 0, unsafe: 0 });
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

  it("server-projects real Ma Rongxin and Tong Cheng reads even when the client omits projection parameters", async () => {
    const aftersales = await call(
      "/api/workbench/quality/events/real-event",
      "GET",
      undefined,
      "aftersales-real",
      "manager",
    );
    const specialist = await call(
      "/api/workbench/quality/events/real-event",
      "GET",
      undefined,
      "quality-real",
      "manager",
    );

    expect(aftersales.status).toBe(200);
    expect(aftersales.payload.data).toEqual(expect.objectContaining({
      viewModel: expect.objectContaining({ perspective: "aftersales" }),
    }));
    expect(aftersales.payload.data.viewModel).toHaveProperty("assessment");
    expect(specialist.status).toBe(200);
    expect(specialist.payload.data.viewModel.perspective).toBe("quality_management");
    expect(JSON.stringify(specialist.payload)).not.toContain("assessment");
    expect(JSON.stringify(specialist.payload)).not.toContain("PENDING_ASSIGNMENT");
  });

  it("returns only the fixed test supervisor while keeping the real seven-department directory unchanged", async () => {
    const options = await call(
      "/api/workbench/quality/events/test-event/supervisor-options?testActor=quality-management",
    );
    expect(options.status).toBe(200);
    expect(options.payload.data.departments).toHaveLength(1);
    expect(options.payload.data.departments[0].departmentName).toBe("测试主管");
    expect(options.payload.data.departments.flatMap((item: any) => item.supervisors)
      .map((item: any) => item.displayName)).toEqual(["测试主管"]);
    expect(JSON.stringify(options.payload)).not.toContain("QUALITY_TEST_MANAGER_001");

    const realOptions = await call(
      "/api/workbench/quality/events/real-event/supervisor-options?perspective=quality_management",
    );
    expect(realOptions.status).toBe(200);
    expect(realOptions.payload.data.departments).toHaveLength(7);

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
      .find((item: any) => item.displayName === "测试主管");
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
      supervisorName: "测试主管",
      departmentName: "研发中心",
    });
    const manager = await call("/api/workbench/quality/events/test-event?testActor=manager-1");
    const node = manager.payload.data.viewModel.branch[0];
    const rejected = await call(
      "/api/workbench/quality/events/test-event/test-action?testActor=manager-1",
      "POST",
      {
        action: "reject",
        expectedVersion: node.version,
        reason: "测试条件尚不完整",
        requestId: "66666666-6666-4666-8666-666666666666",
      },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.payload.data).not.toHaveProperty("planningUrl");
    expect(rejected.payload.data.viewModel.event.statusLabel).toBe("待任务分配");
    expect(JSON.stringify(rejected.payload)).not.toContain("PENDING_ASSIGNMENT");

    const db = new DatabaseSync(dbPath);
    const event = db.prepare("SELECT status FROM quality_events WHERE id='test-event'").get() as { status: string };
    const rejectedNode = db.prepare("SELECT status FROM quality_assignment_nodes WHERE event_id='test-event'").get() as { status: string };
    const testAudits = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_test_action_audit WHERE event_id='test-event' AND actual_admin_user_id='admin-1'")
      .get() as { count: number }).count);
    const links = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links").get() as { count: number }).count);
    const returnedTo = (db.prepare(`
      SELECT recipient_user_id FROM quality_notification_outbox
      WHERE event_id='test-event' AND recipient_user_id='QUALITY_TEST_SPECIALIST_001'
      ORDER BY created_at DESC LIMIT 1
    `).get() as { recipient_user_id?: string } | undefined)?.recipient_user_id;
    db.close();
    expect(event.status).toBe("PENDING_ASSIGNMENT");
    expect(rejectedNode.status).toBe("REJECTED");
    expect(testAudits).toBe(2);
    expect(links).toBe(0);
    expect(returnedTo).toBe("QUALITY_TEST_SPECIALIST_001");
  });

  it("offers only same-department test employees and delegates without creating formal tasks", async () => {
    const options = await call(
      "/api/workbench/quality/events/test-event/supervisor-options?testActor=quality-management",
    );
    const managerCandidate = options.payload.data.departments
      .flatMap((item: any) => item.supervisors)
      .find((item: any) => item.displayName === "测试主管");
    await call(
      "/api/workbench/quality/events/test-event/assign-supervisor?testActor=quality-management",
      "POST",
      {
        candidateRef: managerCandidate.candidateRef,
        dueAt: "2026-09-30T08:00:00.000Z",
        taskRequirement: "完成原因排查",
        expectedVersion: 2,
        requestId: "81111111-1111-4111-8111-111111111111",
      },
    );
    const manager = await call("/api/workbench/quality/events/test-event?testActor=manager-1");
    const managerNode = manager.payload.data.viewModel.branch[0];
    const accepted = await call(
      "/api/workbench/quality/events/test-event/test-action?testActor=manager-1",
      "POST",
      {
        action: "accept",
        expectedVersion: managerNode.version,
        requestId: "82222222-2222-4222-8222-222222222222",
      },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.payload.data.planningUrl).toMatch(
      /^\/workbench\/manager\/chat\?thread=side&threadId=.+$/,
    );

    const planningFiles = readdirSync(join(tempDir, "sessions"));
    expect(planningFiles).toHaveLength(1);
    const planningSession = JSON.parse(readFileSync(join(tempDir, "sessions", planningFiles[0]!), "utf8")) as {
      senderStaffId?: string;
      threadKind?: string;
      latestDraft?: { qualityHandoff?: { qualityEventId?: string }; tasks?: unknown[] };
      conversationHistory?: Array<{ role?: string; content?: string }>;
    };
    expect(planningSession).toMatchObject({
      senderStaffId: "QUALITY_TEST_MANAGER_001",
      threadKind: "side",
      latestDraft: { qualityHandoff: { qualityEventId: "test-event" } },
    });
    expect(planningSession.latestDraft?.tasks).toHaveLength(1);
    expect(planningSession.conversationHistory?.map((item) => item.role)).toEqual(["assistant"]);

    const employees = await call(
      "/api/workbench/quality/events/test-event/test-employee-options?testActor=manager-1",
    );
    expect(employees.status).toBe(200);
    expect(employees.payload.data.employees.map((item: any) => item.displayName))
      .toEqual(["测试员工1", "测试员工2", "测试员工3"]);
    expect(JSON.stringify(employees.payload)).not.toContain("QUALITY_TEST_EMPLOYEE");

    const delegated = await call(
      "/api/workbench/quality/events/test-event/test-action?testActor=manager-1",
      "POST",
      {
        action: "delegate",
        candidateRef: employees.payload.data.employees[0].candidateRef,
        dueAt: "2026-09-30T08:00:00.000Z",
        requirement: "上传测试证据并提交完成",
        expectedVersion: accepted.payload.data.viewModel.branch[0].version,
        requestId: "83333333-3333-4333-8333-333333333333",
      },
    );
    expect(delegated.status).toBe(200);

    const employee = await call("/api/workbench/quality/events/test-event?testActor=employee-1");
    expect(employee.status).toBe(200);
    expect(employee.payload.data.viewModel.actorLabel).toBe("测试员工1");
    expect(employee.payload.data.viewModel.branch).toHaveLength(1);
    expect(employee.payload.data.viewModel.allowedActions).toEqual(["accept", "reject"]);

    const db = new DatabaseSync(dbPath);
    const handoffs = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_handoffs WHERE event_id='test-event'")
      .get() as { count: number }).count);
    const formalTasksTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    const formalTasks = formalTasksTable
      ? Number((db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count)
      : 0;
    const links = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links").get() as { count: number }).count);
    const taskTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    const tasks = taskTable
      ? Number((db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count)
      : 0;
    const unsafe = Number((db.prepare(`
      SELECT COUNT(*) AS count FROM quality_notification_outbox
      WHERE event_id='test-event' AND (channel<>'TEST' OR recipient_user_id NOT LIKE 'QUALITY_TEST_%')
    `).get() as { count: number }).count);
    db.close();
    expect({ handoffs, formalTasks }).toEqual({ handoffs: 1, formalTasks: 0 });
    expect({ links, tasks, unsafe }).toEqual({ links: 0, tasks: 0, unsafe: 0 });
  });
});
