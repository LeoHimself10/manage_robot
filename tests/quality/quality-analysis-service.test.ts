import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";
import {
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  type QualityAnalysisInput,
  type QualityAnalysisOutput,
} from "../../src/quality/analysis/quality-analysis-contracts";
import {
  createQualityAnalysisService,
  QualityAnalysisError,
} from "../../src/quality/analysis/quality-analysis-service";
import type { QualityAnalysisModelAdapter } from
  "../../src/quality/analysis/qwen-quality-analysis-model";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import {
  createQualityEventQuery,
  hasQualityPlanningHandoff,
} from "../../src/quality/queries/quality-event-query";
import { resolveConversationThread } from "../../src/web/conversation-thread-resolver";

let dir = "";
let dbPath = "";

function seedEvent(eventId = "quality-event-1") {
  const db = new DatabaseSync(dbPath);
  db.prepare(`INSERT INTO quality_events(
    id,event_no,status,title,problem_status,occurred_at,impact,initial_category,urgency,
    created_by,submitted_by,submitted_at,version,created_at,updated_at
  ) VALUES(?,?,'PENDING_ANALYSIS',?,?,?,?,?,'HIGH','aftersales-1','aftersales-1',?,1,?,?)`).run(
    eventId,
    `QE-${eventId}`,
    "导管术中弯折导致操作暂停",
    "导管弯折，更换后恢复操作",
    "2026-08-24T01:00:00.000Z",
    "操作暂停十分钟",
    "导管产品／弯折抖动",
    "2026-08-24T02:00:00.000Z",
    "2026-08-24T02:00:00.000Z",
    "2026-08-24T02:00:00.000Z",
  );
  db.prepare(`INSERT INTO quality_event_reporting_snapshots(
    event_id,source_snapshots_json,ai_assessments_json,manager_assessments_json,frozen_by,frozen_at
  ) VALUES(?,?,?,?,?,?)`).run(
    eventId,
    JSON.stringify([{ sourceKey: "feedback:QA-1", issueDescription: "导管弯折导致操作暂停" }]),
    JSON.stringify([{
      sourceKey: "feedback:QA-1",
      assessment: {
        output: { provenance: { caseLibraryVersion: "historical-cases-v7" } },
        retrievedCases: [{ caseId: "case-7", summary: "既往同类弯折案例" }],
      },
    }]),
    JSON.stringify([{
      version: 1,
      categoryDisplayName: "导管产品／弯折抖动",
      conclusion: "主管确认属于质量异常。",
    }]),
    "aftersales-1",
    "2026-08-24T02:00:00.000Z",
  );
  db.prepare(`INSERT INTO quality_report_files(
    id,event_id,draft_version,storage_key,original_name,mime_type,description,size_bytes,
    sha256,status,uploaded_by,created_at,version
  ) VALUES('file-1',?,1,'storage-1','现场照片.jpg','image/jpeg','照片显示导管中段弯折',100,
    'hash-1','ACTIVE','aftersales-1','2026-08-24T01:30:00.000Z',1)`).run(eventId);
  db.close();
  return eventId;
}

function output(input: QualityAnalysisInput): QualityAnalysisOutput {
  return {
    schemaVersion: QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
    requestId: input.runMetadata.requestId,
    problemDirection: "导管弯折异常的材料、制造与使用条件调查",
    confirmedCategoryReference: input.ruleContext.confirmedCategoryReadOnly ?? "未分类",
    sourceFactSummary: ["现场记录导管弯折并导致操作暂停。"],
    confirmedFacts: ["更换导管后操作恢复。"],
    analysisBasis: [{
      statement: "正式通报冻结快照记载导管弯折。",
      sourceType: "SOURCE_SNAPSHOT",
      sourceReference: "feedback:QA-1",
    }],
    preliminaryConclusion: "当前只能确认弯折现象，根因尚需实物与批次调查。",
    causeHypotheses: ["材料性能偏差可能影响抗弯折能力。"],
    investigationDirections: ["核查留样、批次记录和导管实物。"],
    informationGaps: ["缺少退回实物检测结果。"],
    primaryDepartmentCandidates: [{
      departmentName: "质量部",
      recommendationReason: "负责质量调查闭环和证据审查。",
    }],
    collaboratingDepartmentNames: ["研发部"],
    handlingRequirements: ["完成根因调查并形成书面结论。"],
    deliverables: [{
      name: "质量调查报告",
      description: "覆盖实物、批次与原因调查。",
      acceptanceCriteria: "结论引用证据，所有信息缺口有明确处置。",
    }],
    suggestedTotalDueDays: 14,
  };
}

function model(transform: (input: QualityAnalysisInput) => unknown = output): QualityAnalysisModelAdapter {
  return {
    async generate(input) {
      const payload = transform(input);
      return {
        payload,
        rawContent: JSON.stringify(payload),
        trace: {
          model: "qwen-test",
          tokenUsage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
          latencyMs: 25,
        },
        timing: {},
        messages: [],
      } as never;
    },
  };
}

function draftFromAttempt(attempt: Awaited<ReturnType<ReturnType<typeof createQualityAnalysisService>["generate"]>>) {
  const ai = attempt.output!;
  const stamp = "2026-08-24T03:00:00.000Z";
  return {
    expectedVersion: 0,
    requestId: "22222222-2222-4222-8222-222222222222",
    baseAttemptId: attempt.attemptId,
    content: {
      problemDirection: ai.problemDirection,
      confirmedCategoryReference: ai.confirmedCategoryReference,
      sourceFactSummary: ai.sourceFactSummary,
      confirmedFacts: ai.confirmedFacts,
      analysisBasis: ai.analysisBasis.map((item) => item.statement),
      preliminaryConclusion: ai.preliminaryConclusion,
      causeHypotheses: ai.causeHypotheses,
      investigationDirections: ai.investigationDirections,
      informationGaps: ai.informationGaps,
      handlingRequirements: ai.handlingRequirements,
      suggestedTotalDueAt: "2026-09-07",
    },
    primaryDepartmentId: "dept-quality",
    collaboratorDepartmentIds: ["dept-rd"],
    deliverables: ai.deliverables.map((item) => ({
      deliverableId: "deliverable-report",
      ...item,
      source: "AI_SUGGESTED" as const,
      selected: true,
      createdAt: stamp,
      updatedAt: stamp,
    })),
    modificationReason: "质量员工已核对冻结事实，并明确根因仍待调查。",
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quality-analysis-v1-"));
  dbPath = join(dir, "workbench.sqlite");
  vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
  vi.stubEnv("PLAN_SESSION_DIR", join(dir, "sessions"));
  vi.stubEnv("PLAN_SESSION_EVENTS_PATH", join(dir, "events.jsonl"));
  vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-employee");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "aftersales-1");
  vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "aftersales-1,quality-manager,rd-manager");
  vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
  createQualityStore(dbPath).close();
  const people = createPeopleDirectoryStore(dbPath);
  const contact = (userId: string, name: string, departmentId: string, departmentName: string, active = true) =>
    people.upsertContact({
      userId, name, departmentIds: [departmentId], departmentNames: [departmentName], active,
      isAdmin: false, isBoss: false, isSenior: false,
    });
  contact("quality-manager", "质量部主管", "dept-quality", "质量部");
  contact("quality-employee", "质量员工", "dept-quality", "质量部");
  contact("rd-manager", "研发部主管", "dept-rd", "研发部");
  contact("support-employee", "临床支持员工", "dept-support", "临床支持部");
  people.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("AI quality initial analysis V1", () => {
  it("builds model input only from saved snapshots, real departments and attachment descriptions", () => {
    const eventId = seedEvent();
    const service = createQualityAnalysisService({ dbPath, model: model() });
    const prepared = service.prepareInput(
      eventId,
      "11111111-1111-4111-8111-111111111111",
      "quality-employee",
    );
    expect(prepared.event.eventVersion).toBe(1);
    expect(prepared.ruleContext.confirmedCategoryReadOnly).toBe("导管产品／弯折抖动");
    expect(prepared.departmentCandidates).toEqual(expect.arrayContaining([
      { departmentId: "dept-quality", departmentName: "质量部" },
      { departmentId: "dept-rd", departmentName: "研发部" },
    ]));
    expect(prepared.attachments[0]).toMatchObject({
      fileName: "现场照片.jpg",
      humanDescription: "照片显示导管中段弯折",
      contentInspected: false,
    });
    service.close();
  });

  it("stores an idempotent immutable successful AI original with trace metadata", async () => {
    const eventId = seedEvent();
    const service = createQualityAnalysisService({ dbPath, model: model() });
    const requestId = "11111111-1111-4111-8111-111111111111";
    const first = await service.generate({ eventId, actorUserId: "quality-employee", requestId });
    const repeated = await service.generate({ eventId, actorUserId: "quality-employee", requestId });
    expect(first).toMatchObject({
      attemptNo: 1,
      status: "SUCCEEDED",
      modelName: "qwen-test",
      totalTokens: 200,
      durationMs: 25,
    });
    expect(repeated.attemptId).toBe(first.attemptId);
    expect(service.listAttempts(eventId)).toHaveLength(1);
    const db = new DatabaseSync(dbPath);
    expect(() => db.prepare("UPDATE quality_analysis_attempts SET output_json='{}' WHERE attempt_id=?")
      .run(first.attemptId)).toThrow(/immutable/);
    db.close();
    service.close();
  });

  it("preserves invalid AI output as a failed attempt and permits an independent manual draft", async () => {
    const eventId = seedEvent();
    const service = createQualityAnalysisService({ dbPath, model: model(() => ({ wrong: true })) });
    await expect(service.generate({
      eventId,
      actorUserId: "quality-employee",
      requestId: "11111111-1111-4111-8111-111111111111",
    })).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" } satisfies Partial<QualityAnalysisError>);
    expect(service.listAttempts(eventId)[0]).toMatchObject({
      status: "FAILED",
      failureCode: "MODEL_OUTPUT_INVALID",
    });
    const stamp = "2026-08-24T03:00:00.000Z";
    const saved = service.saveDraft({
      eventId,
      actorUserId: "quality-employee",
      draft: {
        expectedVersion: 0,
        requestId: "22222222-2222-4222-8222-222222222222",
        baseAttemptId: null,
        content: {
          problemDirection: "人工质量调查",
          confirmedCategoryReference: "导管产品／弯折抖动",
          sourceFactSummary: ["正式通报记录导管弯折。"],
          confirmedFacts: ["更换后操作恢复。"],
          analysisBasis: ["正式通报冻结快照"],
          preliminaryConclusion: "根因待调查。",
          causeHypotheses: [],
          investigationDirections: ["检查实物和批次记录。"],
          informationGaps: ["缺少实物检测。"],
          handlingRequirements: ["形成书面调查结论。"],
          suggestedTotalDueAt: "2026-09-07",
        },
        primaryDepartmentId: null,
        collaboratorDepartmentIds: [],
        deliverables: [{
          deliverableId: "manual-report",
          name: "人工调查报告",
          description: "记录调查过程。",
          acceptanceCriteria: "证据可追溯。",
          source: "HUMAN_CUSTOM",
          selected: true,
          createdAt: stamp,
          updatedAt: stamp,
        }],
        modificationReason: "AI失败后人工填写。",
      },
    });
    expect(saved).toMatchObject({ version: 1, baseAttemptId: null });
    service.close();
  });

  it("blocks missing manager, then creates idempotent V1/V2 handoffs and readonly views", async () => {
    const eventId = seedEvent();
    const service = createQualityAnalysisService({ dbPath, model: model() });
    const attempt = await service.generate({
      eventId,
      actorUserId: "quality-employee",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    const firstDraft = draftFromAttempt(attempt);
    firstDraft.primaryDepartmentId = "dept-support";
    service.saveDraft({ eventId, actorUserId: "quality-employee", draft: firstDraft });
    expect(() => service.confirm({
      eventId,
      actorUserId: "quality-employee",
      expectedDraftVersion: 1,
      expectedEventVersion: 1,
      requestId: "33333333-3333-4333-8333-333333333333",
      modificationReason: "确认初析。",
    })).toThrow(/尚未配置主管/);

    const corrected = { ...draftFromAttempt(attempt), expectedVersion: 1, requestId: "44444444-4444-4444-8444-444444444444" };
    service.saveDraft({ eventId, actorUserId: "quality-employee", draft: corrected });
    const confirmed = service.confirm({
      eventId,
      actorUserId: "quality-employee",
      expectedDraftVersion: 2,
      expectedEventVersion: 1,
      requestId: "55555555-5555-4555-8555-555555555555",
      modificationReason: "已复核AI建议并确认首责部门。",
    });
    expect(confirmed.version).toMatchObject({
      analysisVersion: 1,
      primaryDepartmentName: "质量部",
      primaryManagerUserId: "quality-manager",
      caseLibraryVersion: "historical-cases-v7",
    });
    expect(confirmed.handoff).toMatchObject({
      status: "PENDING_PLANNING",
      primaryManagerUserId: "quality-manager",
    });
    expect(String(confirmed.handoff.planningUrl)).toContain("/workbench/manager/chat?thread=side");
    expect(hasQualityPlanningHandoff("quality-manager", dbPath)).toBe(true);
    expect(hasQualityPlanningHandoff("rd-manager", dbPath)).toBe(false);
    const managerQuery = createQualityEventQuery(dbPath);
    expect(managerQuery.listEvents({ viewerUserId: "quality-manager" }))
      .toEqual([expect.objectContaining({ eventId, status: "PENDING_ASSIGNMENT" })]);
    expect(managerQuery.getEventDetail({ eventId, viewerUserId: "quality-manager" }))
      .toMatchObject({ event: { eventId }, allowedActions: [] });
    expect(managerQuery.getEventDetail({ eventId, viewerUserId: "rd-manager" })).toBeNull();
    managerQuery.close();
    const staged = resolveConversationThread("quality-manager", {
      threadKind: "side",
      threadId: String(confirmed.handoff.threadId),
    });
    expect(staged?.latestDraft).toMatchObject({
      title: expect.stringContaining(`QE-${eventId}`),
      qualityHandoff: { qualityEventId: eventId },
    });
    expect(String(staged?.latestDraft?.description)).toContain("# 质量事件任务草稿");
    expect(String(staged?.latestDraft?.description)).toContain("## 来源事实摘要");
    expect(String(staged?.latestDraft?.description)).toContain("## 主管下一步");
    expect(staged?.conversationHistory[0]?.displayContent).toContain("已接收质量事件");
    const repeated = service.confirm({
      eventId,
      actorUserId: "quality-employee",
      expectedDraftVersion: 2,
      expectedEventVersion: 1,
      requestId: "55555555-5555-4555-8555-555555555555",
      modificationReason: "已复核AI建议并确认首责部门。",
    });
    expect(repeated.version).toMatchObject({ analysisVersion: 1 });

    const v2Draft = { ...draftFromAttempt(attempt), expectedVersion: 2, requestId: "66666666-6666-4666-8666-666666666666" };
    v2Draft.content = { ...v2Draft.content, preliminaryConclusion: "V2：补充调查后仍需完成实物检测。" };
    v2Draft.modificationReason = "补充调查进展，形成V2。";
    service.saveDraft({ eventId, actorUserId: "quality-employee", draft: v2Draft });
    const v2 = service.confirm({
      eventId,
      actorUserId: "quality-employee",
      expectedDraftVersion: 3,
      expectedEventVersion: 2,
      requestId: "77777777-7777-4777-8777-777777777777",
      modificationReason: "补充调查进展，形成V2。",
    });
    expect(v2.version).toMatchObject({ analysisVersion: 2 });

    expect(service.workspace({ eventId, viewerUserId: "quality-employee" })).toMatchObject({
      canEdit: true,
      event: { status: "PENDING_ASSIGNMENT", version: 3 },
    });
    expect(service.workspace({ eventId, viewerUserId: "aftersales-1" })).toMatchObject({
      canEdit: false,
      isBusinessReadOnly: true,
    });
    expect(service.workspace({ eventId, viewerUserId: "admin-1" })).toMatchObject({
      canEdit: false,
      isBusinessReadOnly: true,
    });
    expect(service.workspace({ eventId, viewerUserId: "quality-manager" })).toMatchObject({
      canEdit: false,
      versions: expect.arrayContaining([expect.objectContaining({ analysisVersion: 2 })]),
    });

    const publishedDb = new DatabaseSync(dbPath);
    publishedDb.exec(`CREATE TABLE IF NOT EXISTS tasks(
      task_id TEXT PRIMARY KEY, task_no TEXT, plan_id TEXT NOT NULL UNIQUE,
      title TEXT, published_at TEXT NOT NULL
    )`);
    publishedDb.prepare("INSERT INTO tasks(task_id,task_no,plan_id,title,published_at) VALUES(?,?,?,?,?)").run(
      "formal-task-v2",
      "TASK-QUALITY-V2",
      String(v2.handoff.planId),
      "正式质量调查任务",
      "2026-08-24T05:00:00.000Z",
    );
    publishedDb.close();
    expect(service.workspace({ eventId, viewerUserId: "quality-manager" })).toMatchObject({
      handoffs: expect.arrayContaining([
        expect.objectContaining({
          analysisVersion: 2,
          status: "PUBLISHED",
          formalTaskId: "formal-task-v2",
          formalTaskNo: "TASK-QUALITY-V2",
          formalTaskTitle: "正式质量调查任务",
        }),
      ]),
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare("SELECT status,version FROM quality_events WHERE id=?").get(eventId))
      .toEqual({ status: "PENDING_ASSIGNMENT", version: 3 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_versions WHERE event_id=?").get(eventId))
      .toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_analysis_handoffs WHERE event_id=?").get(eventId))
      .toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM quality_notification_outbox WHERE event_id=? AND action='QUALITY_ANALYSIS_HANDOFF'").get(eventId))
      .toEqual({ count: 2 });
    db.close();
    service.close();
  });
});
