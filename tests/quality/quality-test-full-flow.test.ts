import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQualityAssignmentService } from "../../src/quality/assignments/quality-assignment-service";
import { createQualitySupervisorDirectory } from "../../src/quality/assignments/quality-supervisor-directory";
import { createQualityClosureService } from "../../src/quality/closure/quality-closure-service";
import { createQualityEvidenceService } from "../../src/quality/evidence/quality-evidence-service";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityReviewService } from "../../src/quality/reviews/quality-review-service";
import { createQualityTestAftersalesService } from
  "../../src/quality/testing/quality-test-aftersales-service";
import { createQualityTestAnalysisService } from
  "../../src/quality/testing/quality-test-analysis-service";

const dirs: string[] = [];
const NOW = "2026-08-27T08:00:00.000Z";
const DUE = "2026-09-27T08:00:00.000Z";
const admin = "admin-1";
const specialist = "QUALITY_TEST_SPECIALIST_001";
const manager = "QUALITY_TEST_MANAGER_001";
const employee = "QUALITY_TEST_EMPLOYEE_001";

function uuid(value: number): string {
  return `90000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "quality-test-full-flow-"));
  dirs.push(dir);
  vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "workbench.sqlite"));
  vi.stubEnv("QUALITY_EVIDENCE_DIR", join(dir, "evidence"));
  vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", admin);
  vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("isolated quality test full flow", () => {
  it("runs editable aftersales review and quality analysis through closure without formal tasks", async () => {
    const dbPath = process.env.WORKBENCH_SQLITE_PATH!;
    const store = createQualityStore(dbPath, { now: () => NOW });
    store.createDraft({
      eventId: "test-full-flow",
      eventNo: "QT-FULL-001",
      actorUserId: "QUALITY_TEST_AFTERSALES_001",
      actorRole: "aftersales_manager",
      requestId: "create-test-full-flow",
      title: "测试完整闭环",
      problemStatus: "仅使用测试身份完成全流程。",
    });
    store.close();
    const setup = new DatabaseSync(dbPath);
    setup.prepare("UPDATE quality_events SET is_test=1,status='PENDING_ANALYSIS',version=2 WHERE id=?")
      .run("test-full-flow");
    setup.close();

    const aftersales = createQualityTestAftersalesService({ dbPath, now: () => NOW });
    const reviewed = aftersales.update({
      eventId: "test-full-flow",
      testAftersalesUserId: "QUALITY_TEST_AFTERSALES_001",
      actualAdminUserId: admin,
      expectedVersion: 2,
      requestId: uuid(11),
      problemStatus: "测试来源事实已由马荣鑫（测试）完成人工修订。",
      initialCategory: "影像与光学／无图像或影像中断",
      urgency: "MEDIUM",
      supplement: "仅用于隔离测试",
      reason: "核对测试人工研判表单",
    });
    aftersales.close();
    expect(reviewed.eventVersion).toBe(3);

    const analysis = createQualityTestAnalysisService({ dbPath, now: () => NOW });
    const analyzed = analysis.complete({
      eventId: "test-full-flow",
      testSpecialistUserId: specialist,
      actualAdminUserId: admin,
      expectedVersion: reviewed.eventVersion,
      requestId: uuid(12),
      problemDirection: "影像异常原因核验",
      confirmedCategory: "影像与光学／无图像或影像中断",
      sourceFactSummary: "测试来源事实已确认",
      analysisBasis: "AI原始建议\n主管最终研判",
      preliminaryConclusion: "建议研发中心完成原因排查和验证",
      informationGaps: "复现记录待补充",
      handlingRequirements: "完成原因核查\n上传验证证据",
      suggestedDueAt: DUE,
      deliverableName: "原因排查与验证记录",
      deliverableDescription: "形成完整测试记录",
      acceptanceCriteria: "包含原因、措施和验证结果",
    });
    analysis.close();
    expect(analyzed).toMatchObject({ eventStatus: "PENDING_ASSIGNMENT", eventVersion: 4 });

    const directory = createQualitySupervisorDirectory({ dbPath, contacts: [] });
    const managerCandidate = directory.listGroups({ eventId: "test-full-flow", isTest: true })
      .flatMap((group) => group.supervisors)
      .find((candidate) => candidate.displayName === "测试主管")!;
    directory.close();

    let assignment = createQualityAssignmentService({ dbPath, now: () => NOW });
    const assigned = await assignment.assignSupervisor({
      eventId: "test-full-flow",
      specialistUserId: specialist,
      actualAdminUserId: admin,
      candidateRef: managerCandidate.candidateRef,
      dueAt: DUE,
      taskRequirement: "完成测试原因核验并逐级验收",
      expectedVersion: analyzed.eventVersion,
      requestId: uuid(1),
    });
    const rootNodeId = assigned.node.nodeId;
    await assignment.acceptNode({
      nodeId: rootNodeId,
      actorUserId: manager,
      actualAdminUserId: admin,
      expectedVersion: 1,
      requestId: uuid(2),
    });
    const resolver = createQualitySupervisorDirectory({ dbPath, contacts: [] });
    const employeeCandidate = resolver
      .listTestEmployees({ eventId: "test-full-flow", departmentName: "研发中心" })[0]!;
    const resolvedEmployee = resolver.resolveTestEmployee({
      eventId: "test-full-flow",
      departmentName: "研发中心",
      candidateRef: employeeCandidate.candidateRef,
    })!;
    resolver.close();
    const delegated = await assignment.delegateNode({
      parentNodeId: rootNodeId,
      actorUserId: manager,
      assigneeUserId: resolvedEmployee.userId,
      assigneeKind: "EMPLOYEE",
      departmentName: resolvedEmployee.departmentName,
      dueAt: DUE,
      requirement: "上传测试证据并提交完成",
      expectedVersion: 2,
      requestId: uuid(3),
      actualAdminUserId: admin,
    });
    const employeeNodeId = delegated.node.nodeId;
    await assignment.acceptNode({
      nodeId: employeeNodeId,
      actorUserId: employee,
      actualAdminUserId: admin,
      expectedVersion: 1,
      requestId: uuid(4),
    });
    assignment.close();

    const evidence = createQualityEvidenceService({ dbPath, rootDir: process.env.QUALITY_EVIDENCE_DIR!, now: () => NOW });
    evidence.uploadEvidence({
      nodeId: employeeNodeId,
      actorUserId: employee,
      actualAdminUserId: admin,
      originalName: "测试证据.txt",
      mimeType: "text/plain",
      summary: "测试核验完成",
      buffer: Buffer.from("isolated quality evidence", "utf8"),
      requestId: uuid(5),
    });
    evidence.submitCompletion({
      nodeId: employeeNodeId,
      actorUserId: employee,
      actualAdminUserId: admin,
      expectedVersion: 2,
      requestId: uuid(6),
    });
    evidence.close();

    let review = createQualityReviewService({ dbPath, now: () => NOW });
    review.reviewDirectChild({
      childNodeId: employeeNodeId,
      actorUserId: manager,
      actualAdminUserId: admin,
      decision: "APPROVE",
      expectedVersion: 3,
      requestId: uuid(7),
    });
    review.close();

    const managerEvidence = createQualityEvidenceService({ dbPath, rootDir: process.env.QUALITY_EVIDENCE_DIR!, now: () => NOW });
    managerEvidence.submitCompletion({
      nodeId: rootNodeId,
      actorUserId: manager,
      actualAdminUserId: admin,
      expectedVersion: 3,
      requestId: uuid(8),
    });
    managerEvidence.close();

    review = createQualityReviewService({ dbPath, now: () => NOW });
    const awaitingPrimary = review.getEvent("test-full-flow");
    expect(awaitingPrimary.status).toBe("PENDING_PRIMARY_REVIEW");
    review.primaryReview({
      eventId: "test-full-flow",
      primaryManagerUserId: manager,
      actualAdminUserId: admin,
      decision: "APPROVE",
      expectedVersion: awaitingPrimary.version,
      requestId: uuid(9),
    });
    review.close();

    const closure = createQualityClosureService({ dbPath, now: () => NOW });
    const awaitingQuality = closure.getEvent("test-full-flow");
    expect(awaitingQuality.status).toBe("PENDING_QUALITY_REVIEW");
    const closed = closure.closeEvent({
      eventId: "test-full-flow",
      specialistUserId: specialist,
      actualAdminUserId: admin,
      conclusion: "隔离测试完整闭环通过",
      expectedVersion: awaitingQuality.version,
      requestId: uuid(10),
    });
    closure.close();
    expect(closed.status).toBe("CLOSED");

    const verify = new DatabaseSync(dbPath);
    const taskTable = verify.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    const counts = {
      tasks: taskTable
        ? Number((verify.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count)
        : 0,
      links: Number((verify.prepare("SELECT COUNT(*) AS count FROM quality_task_links").get() as { count: number }).count),
      analyses: Number((verify.prepare("SELECT COUNT(*) AS count FROM quality_analysis_versions WHERE event_id='test-full-flow'").get() as { count: number }).count),
      handoffs: Number((verify.prepare("SELECT COUNT(*) AS count FROM quality_analysis_handoffs WHERE event_id='test-full-flow'").get() as { count: number }).count),
      testAudit: Number((verify.prepare("SELECT COUNT(*) AS count FROM quality_test_action_audit WHERE event_id='test-full-flow'").get() as { count: number }).count),
      unsafeNotices: Number((verify.prepare(`
        SELECT COUNT(*) AS count FROM quality_notification_outbox
        WHERE event_id='test-full-flow' AND (channel<>'TEST' OR recipient_user_id NOT LIKE 'QUALITY_TEST_%')
      `).get() as { count: number }).count),
    };
    verify.close();
    expect(counts).toEqual({
      tasks: 0,
      links: 0,
      analyses: 1,
      handoffs: 0,
      testAudit: 12,
      unsafeNotices: 0,
    });
  });
});
