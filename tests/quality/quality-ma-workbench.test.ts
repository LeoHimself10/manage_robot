import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createMaWorkbenchService } from "../../src/quality/ma-workbench/service";
import { createQualitySourceAssessmentService } from "../../src/quality/reviews/quality-source-assessment-service";
import type { AiOriginalAssessmentOutput } from "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import type { MaAssessmentRequest } from "../../src/quality/ma-workbench/contracts";

const NOW = "2026-09-09T02:00:00.000Z";
const key = "feedback:MA-001";
let dir = ""; let path = ""; let service: ReturnType<typeof createMaWorkbenchService>;
const version = (value = 1) => ({ requestId: randomUUID(), expectedSourceVersion: value });
const assessment = (extra: Partial<MaAssessmentRequest> = {}): MaAssessmentRequest => ({ ...version(), expectedVersion: 0, categoryMode: "STANDARD", primaryCategoryCode: "CATHETER_PRODUCT", secondaryCategoryCode: "CATHETER_BEND_SHAKE", riskLevel: "HIGH", conclusion: "导管弯折，需要实物检查根因。", adoptionMode: "MANUAL", ...extra });
function sql(statement: string, ...params: (string | number)[]) { const db = new DatabaseSync(path); try { return db.prepare(statement).run(...params); } finally { db.close(); } }
function count(table: string) { const db = new DatabaseSync(path); try { return Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n); } finally { db.close(); } }
function output(): AiOriginalAssessmentOutput { return { schemaVersion: "ai-original-assessment-output-v0", requestId: "offline", handlingRecommendation: "ORDINARY", primaryCategoryCode: "CATHETER_PRODUCT", secondaryCategoryCode: "CATHETER_BEND_SHAKE", riskLevel: "LOW", reasoningBasis: [{ statement: "需要核对现场资料", citationIds: ["fact"] }], similarCases: [], missingInformation: [], uncertainties: [], citations: [{ citationId: "fact", sourceType: "FEEDBACK", sourceId: key, description: "现场反馈" }], provenance: { modelConfigId: "offline", promptVersion: "v0", categoryDictionaryVersion: "v0", caseLibraryVersion: "v0" } }; }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quality-ma-")); path = join(dir, "workbench.sqlite");
  vi.stubEnv("WORKBENCH_SQLITE_PATH", path); vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "ma,other");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "ma,other"); vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin");
  vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "tong"); vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "tong");
  createQualityStore(path).close();
  const normalized = { sourceKey: key, contentHash: "hash1", rowNumber: 2, feedbackNo: "MA-001", feedbackAt: NOW, reporter: "测试反馈人", issueDescription: "导管弯折", deviceModel: "OCT", serialNo: "SN001", catheterBatch: "B001", impact: "操作暂停", rawSnapshot: { 问题描述: "导管弯折", 设备序列号: "SN001" } };
  sql(`INSERT INTO quality_source_rows(source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,normalized_json,raw_snapshot_json,first_seen_at,last_seen_at,synced_at,version) VALUES(?,'sheet-1','客户端问题反馈记录表',2,'ACTIVE',1,'hash1',?,?,?, ?,?,1)`, key, JSON.stringify(normalized), JSON.stringify(normalized.rawSnapshot), NOW, NOW, NOW);
  service = createMaWorkbenchService({ dbPath: path });
});
afterEach(() => { service?.close(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("马荣鑫工作台持久化准入与研判", () => {
  it("全部来源可搜索；未准入不进入待我研判，也不能绕过AI或人工门禁", async () => {
    expect(service.list("ma", { q: "SN001" }).items).toHaveLength(1);
    expect(service.list("ma", { scope: "pending" }).items).toHaveLength(0);
    expect(service.get(key, "ma").canAdmit).toBe(true);
    expect(() => service.saveAssessment(key, "ma", assessment())).toThrow("确认进入质量事件");
    await expect(service.ai(key, "ma", version())).rejects.toThrow("确认进入质量事件");
    expect(() => service.submit(key, "ma", { ...version(), expectedAssessmentVersion: 1 })).toThrow("确认进入质量事件");
    expect(count("quality_events")).toBe(0);
  });
  it("准入幂等并持久化，准入及保存不通知、不标REPORTED、不提前建立正式事件", () => {
    const request = version(); service.admit(key, "ma", request); service.admit(key, "ma", request); service.admit(key, "ma", version());
    expect(service.get(key, "ma").admission?.version).toBe(1);
    expect(service.list("ma", { scope: "pending" }).items).toHaveLength(1);
    const input = assessment(); service.saveAssessment(key, "ma", input); service.saveAssessment(key, "ma", input);
    expect(service.get(key, "ma")).toMatchObject({ stage: "READY_TO_SUBMIT", assessment: { version: 1 }, canSubmit: true });
    expect(count("quality_source_assessment_audit")).toBe(1); expect(count("quality_events")).toBe(0);
    expect(count("quality_notification_outbox")).toBe(0); expect(count("quality_source_reviews")).toBe(0);
    service.close(); service = createMaWorkbenchService({ dbPath: path });
    expect(service.get(key, "ma").assessment?.version).toBe(1);
  });
  it("源版本变化阻断研判与推送，重新确认准入后仍须重新保存当前版本研判", () => {
    service.admit(key, "ma", version()); service.saveAssessment(key, "ma", assessment());
    sql("UPDATE quality_source_rows SET source_version=2,content_hash='hash2' WHERE source_key=?", key);
    expect(service.get(key, "ma")).toMatchObject({ sourceUpdatedSinceAdmission: true, sourceUpdatedSinceAssessment: true, canSubmit: false });
    expect(() => service.saveAssessment(key, "ma", assessment({ expectedSourceVersion: 2, expectedVersion: 1 }))).toThrow("重新确认");
    service.admit(key, "ma", version(2));
    expect(() => service.submit(key, "ma", { ...version(2), expectedAssessmentVersion: 1 })).toThrow("先保存");
    service.saveAssessment(key, "ma", assessment({ expectedSourceVersion: 2, expectedVersion: 1 }));
    expect(service.get(key, "ma").canSubmit).toBe(true);
    expect(service.get(key, "ma").assessmentHistory).toHaveLength(2);
  });
  it("只有明确推送才生成单一正式事件和通知，重复推送不重复，后续研判只读", () => {
    service.admit(key, "ma", version()); service.saveAssessment(key, "ma", assessment());
    const request = { ...version(), expectedAssessmentVersion: 1 };
    const result = service.submit(key, "ma", request);
    expect(result).toMatchObject({ stage: "IN_PROGRESS", event: { status: "PENDING_ANALYSIS" }, canAssess: false, canSubmit: false, downstream: { readonly: true } });
    const notificationCount = count("quality_notification_outbox");
    expect(notificationCount).toBeGreaterThan(0);
    expect(service.submit(key, "ma", request).event?.id).toBe(result.event?.id);
    expect(count("quality_events")).toBe(1); expect(count("quality_notification_outbox")).toBe(notificationCount);
    expect(count("quality_event_reporting_snapshots")).toBe(1);
    expect(() => service.saveAssessment(key, "ma", assessment({ expectedVersion: 1 }))).toThrow("只读");
    expect(service.list("ma", { scope: "pending" }).items).toHaveLength(0);
    expect(service.list("ma", { scope: "progress" }).items).toHaveLength(1);
  });
  it("其他主管不能接管本人准入，admin和普通员工没有隐式权限", () => {
    service.admit(key, "ma", version());
    expect(() => service.get(key, "other")).toThrow("无权查看");
    expect(() => service.admit(key, "other", version())).toThrow("无权查看");
    expect(service.list("other").items).toHaveLength(0);
    for (const actor of ["admin", "employee", "tong"]) expect(() => service.list(actor)).toThrow("无马荣鑫");
  });
  it("移除处理方式的接口仍固定质量事件方向，保留AI原快照并校验分类/风险修正原因", () => {
    service.admit(key, "ma", version());
    const original = createQualitySourceAssessmentService({ dbPath: path });
    const snapshot = original.getSourceSnapshot(key)!;
    original.saveAiAssessment({ sourceKey: key, sourceVersion: 1, requestId: "offline", sourceSnapshot: snapshot.normalizedFeedback, output: output(), retrievedCases: [], actorUserId: "ma" }); original.close();
    expect(() => service.saveAssessment(key, "ma", assessment({ adoptionMode: "DIRECT" }))).toThrow("修正原因");
    expect(() => service.saveAssessment(key, "ma", assessment({ riskLevel: "LOW", adoptionMode: "DIRECT" }))).toThrow("结论");
    expect(() => service.saveAssessment(key, "ma", assessment())).toThrow("重新人工判断须填写原因");
    service.saveAssessment(key, "ma", assessment({ adoptionMode: "MODIFIED", changeReason: "核对现场后确认影响操作" }));
    const result = service.get(key, "ma");
    expect(result.aiAssessment).not.toHaveProperty("handlingRecommendation");
    expect(result.assessment).not.toHaveProperty("handlingRecommendation");
    const stored = createQualitySourceAssessmentService({ dbPath: path });
    expect(stored.getAssessment(key)?.handlingRecommendation).toBe("QUALITY_ANOMALY");
    expect(stored.getLatestAiAssessment(key)?.output.handlingRecommendation).toBe("ORDINARY"); stored.close();
  });
  it("隐藏处理方式不参与采纳差异，AI普通建议的可见内容直接采纳无需隐藏字段修改理由", () => {
    service.admit(key, "ma", version());
    const original = createQualitySourceAssessmentService({ dbPath: path });
    const snapshot = original.getSourceSnapshot(key)!;
    original.saveAiAssessment({ sourceKey: key, sourceVersion: 1, requestId: "offline", sourceSnapshot: snapshot.normalizedFeedback, output: output(), retrievedCases: [], actorUserId: "ma" }); original.close();
    const result = service.saveAssessment(key, "ma", assessment({ adoptionMode: "DIRECT", riskLevel: "LOW", conclusion: "需要核对现场资料" }));
    expect(result.assessment).toMatchObject({ adoptionMode: "DIRECT", changeReason: null });
    expect(result.canSubmit).toBe(true);
  });
  it("旧研判、旧事件和测试来源不被批量自动准入", () => {
    sql("UPDATE quality_source_rows SET sheet_id='QUALITY_TEST_ISOLATED' WHERE source_key=?", key);
    expect(service.list("ma").items).toHaveLength(0); expect(count("quality_source_admissions")).toBe(0);
  });
  it("本人可实时查看原任务分配/进度，只读查询不写入正式任务或二次分配", () => {
    service.admit(key, "ma", version()); service.saveAssessment(key, "ma", assessment());
    const eventId = service.submit(key, "ma", { ...version(), expectedAssessmentVersion: 1 }).event!.id;
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE tasks(task_id TEXT PRIMARY KEY,task_no TEXT,plan_id TEXT,title TEXT,manager_user_id TEXT);
      CREATE TABLE subtasks(subtask_id TEXT PRIMARY KEY,task_id TEXT,title TEXT,objective TEXT,deliverables TEXT,completion_criteria TEXT,assignee_user_id TEXT,status TEXT,due_at TEXT,progress_note TEXT,created_at TEXT,updated_at TEXT,completed_at TEXT);
      INSERT INTO tasks VALUES('task-1','TASK-001','plan-1','导管验证','manager-rd');
      INSERT INTO subtasks VALUES('sub-1','task-1','完成复现','核对实物','复现报告','附验证数据','employee-rd','IN_PROGRESS','2026-09-30','已收到实物','2026-09-09','2026-09-09',NULL);`);
    db.prepare(`INSERT INTO quality_analysis_handoffs(handoff_id,event_id,analysis_version,integration_key,primary_department_id,primary_department_name,primary_manager_user_id,task_package_json,plan_id,thread_id,status,created_at)
      VALUES('handoff-1',?,1,'quality-node:handoff-1','rd','研发部','manager-rd','{}','plan-1','thread-1','PENDING_PLANNING',?)`).run(eventId, NOW);
    db.prepare(`INSERT INTO quality_analysis_versions(analysis_id,event_id,analysis_version,request_id,content_json,deliverables_json,diff_json,modification_reason,primary_department_id,primary_department_name,collaborator_departments_json,primary_manager_user_id,primary_manager_name,primary_manager_account_status,suggested_total_due_at,schema_version,rule_version,case_library_version,knowledge_version,edited_by,confirmed_by,confirmed_at,created_at)
      VALUES('analysis-1',?,1,'analysis-request','{"preliminaryConclusion":"先排查结构受力"}','[]','{}','核对后确认','rd','研发部','[]','manager-rd','研发主管','ACTIVE','2026-09-30','v1','r1','c1','k1','tong','tong',?,?)`).run(eventId, NOW, NOW);
    db.prepare(`INSERT INTO quality_assignment_nodes(node_id,event_id,depth,assignee_user_id,assignee_kind,department_name,status,due_at,requirement,created_by,request_id,created_at,updated_at)
      VALUES('node-1',?,0,'employee-rd','EMPLOYEE','研发部','IN_PROGRESS','2026-09-30','完成复现','manager-rd','node-request',?,?)`).run(eventId, NOW, NOW);
    db.prepare("INSERT INTO quality_task_links VALUES('node-1','task-1','sub-1','quality-node:node-1',?)").run(NOW);
    for (const evidenceVersion of [1, 2]) db.prepare(`INSERT INTO quality_evidence(evidence_id,event_id,node_id,evidence_version,storage_key,original_name,mime_type,summary,size_bytes,sha256,uploaded_by,created_at)
      VALUES(?,?,'node-1',?,?,?,'application/pdf','复现记录',10,'hash','employee-rd',?)`).run(`evidence-${evidenceVersion}`, eventId, evidenceVersion, `storage-${evidenceVersion}`, `复现V${evidenceVersion}.pdf`, NOW);
    db.prepare(`INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at)
      VALUES('review-1',?,'node-1','manager-rd','RETURN','补充边界条件',1,'review-request',?)`).run(eventId, NOW);
    db.close();
    let detail = service.get(key, "ma");
    expect(detail.downstream?.tasks).toHaveLength(1);
    expect(detail.downstream?.tasks[0]).toMatchObject({ subtaskId: "sub-1", status: "IN_PROGRESS", progressNote: "已收到实物", managerUserId: "manager-rd", assigneeUserId: "employee-rd", department: "研发部" });
    expect(detail.downstream?.analysisVersions[0]).toMatchObject({ version: 1, department: "研发部", content: { preliminaryConclusion: "先排查结构受力" } });
    expect(detail.downstream?.tasks[0]?.evidence.map(item => item.version)).toEqual([1, 2]);
    expect(detail.downstream?.tasks[0]?.reviews[0]).toMatchObject({ decision: "RETURN", reason: "补充边界条件" });
    sql("UPDATE subtasks SET status='DONE',progress_note='验证完成',completed_at=? WHERE subtask_id='sub-1'", NOW);
    detail = service.get(key, "ma");
    expect(detail.downstream?.tasks[0]).toMatchObject({ status: "DONE", progressNote: "验证完成", completedAt: NOW });
    expect(count("tasks")).toBe(1); expect(count("quality_assignment_nodes")).toBe(1); expect(count("quality_analysis_versions")).toBe(1);
    expect(() => service.get(key, "other")).toThrow("无权查看");
  });
});
