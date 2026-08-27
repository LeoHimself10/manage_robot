import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createQualityStore } from "../src/quality/infra/quality-store";

if (!process.argv.includes("--confirm")) {
  throw new Error("请显式传入 --confirm 后再准备隔离质量测试数据");
}
if (!["1", "true", "yes", "on"].includes(
  String(process.env.QUALITY_TEST_ACTORS_ENABLED ?? "").trim().toLowerCase(),
)) {
  throw new Error("QUALITY_TEST_ACTORS_ENABLED 未开启，拒绝准备测试数据");
}

const dbPath = resolveWorkbenchSqlitePath();
createQualityStore(dbPath).close();
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON");
db.exec("PRAGMA busy_timeout=8000");
const occurredAt = new Date().toISOString();

const events = [
  {
    id: "quality-test-event-assignment",
    eventNo: "QT-DEMO-001",
    status: "PENDING_ASSIGNMENT",
    title: "测试：影像显示偶发异常",
    problemStatus: "隔离测试事件，用于验证质量初析和主管单选流程。",
    primaryNodeId: null,
    departmentName: null,
    managerUserId: null,
    nodeStatus: null,
  },
  {
    id: "quality-test-event-manager-one",
    eventNo: "QT-DEMO-002",
    status: "PENDING_ACCEPTANCE",
    title: "测试：研发原因排查",
    problemStatus: "隔离测试事件，用于验证主管一承接或拒绝流程。",
    primaryNodeId: null,
    departmentName: "研发中心",
    managerUserId: "QUALITY_TEST_MANAGER_001",
    nodeStatus: "PENDING_ACCEPTANCE",
  },
  {
    id: "quality-test-event-manager-two",
    eventNo: "QT-DEMO-003",
    status: "PENDING_ACCEPTANCE",
    title: "测试：质量记录核验",
    problemStatus: "隔离测试事件，用于验证主管二的独立责任分支。",
    primaryNodeId: null,
    departmentName: "质量部",
    managerUserId: "QUALITY_TEST_MANAGER_002",
    nodeStatus: "PENDING_ACCEPTANCE",
  },
] as const;

db.exec("BEGIN IMMEDIATE");
try {
  for (const item of events) {
    db.prepare(`
      INSERT INTO quality_events(
        id,event_no,is_test,status,title,problem_status,urgency,created_by,
        submitted_by,submitted_at,primary_node_id,version,created_at,updated_at
      ) VALUES(?,?,1,?,?,?,'MEDIUM','QUALITY_TEST_AFTERSALES_001',
        'QUALITY_TEST_AFTERSALES_001',?,?,2,?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      item.id,
      item.eventNo,
      item.status,
      item.title,
      item.problemStatus,
      occurredAt,
      item.primaryNodeId,
      occurredAt,
      occurredAt,
    );
    db.prepare(`
      INSERT INTO quality_initial_analysis_versions(
        analysis_id,event_id,version,status,problem_direction,confirmed_category,
        source_summary,analysis_basis,initial_conclusion,information_gaps,
        suggested_department,processing_requirements,suggested_due_at,
        created_by,completed_by,completed_at,created_at,updated_at
      ) VALUES(?,?,1,'COMPLETED','测试问题方向','测试分类',?,
        '仅使用隔离测试事实','建议按测试流程核验','无',?,
        '完成原因核查并记录可验证结果','2026-09-30T10:00:00.000Z',
        'QUALITY_TEST_SPECIALIST_001','QUALITY_TEST_SPECIALIST_001',?,?,?)
      ON CONFLICT(analysis_id) DO NOTHING
    `).run(
      `analysis:${item.id}`,
      item.id,
      item.problemStatus,
      item.departmentName ?? "研发中心",
      occurredAt,
      occurredAt,
      occurredAt,
    );
    if (item.managerUserId && item.departmentName && item.nodeStatus) {
      const nodeId = `node:${item.id}`;
      db.prepare(`
        INSERT INTO quality_assignment_nodes(
          node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
          department_name,is_primary,status,due_at,requirement,version,
          created_by,request_id,created_at,updated_at
        ) VALUES(?,?,NULL,0,?,'MANAGER',?,0,?,
          '2026-09-30T10:00:00.000Z','完成隔离测试核验',1,
          'QUALITY_TEST_SPECIALIST_001',?,?,?)
        ON CONFLICT(node_id) DO NOTHING
      `).run(
        nodeId,
        item.id,
        item.managerUserId,
        item.departmentName,
        item.nodeStatus,
        item.managerUserId === "QUALITY_TEST_MANAGER_001"
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222",
        occurredAt,
        occurredAt,
      );
    }
    db.prepare(`
      INSERT INTO quality_audit_events(
        id,event_id,actor_user_id,actor_role,action,before_json,after_json,
        reason,request_id,occurred_at
      ) VALUES(?,?,?,'system','EVENT_SUBMITTED',NULL,NULL,
        '隔离测试数据种子',?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      `audit:${item.id}`,
      item.id,
      "QUALITY_TEST_AFTERSALES_001",
      item.managerUserId === "QUALITY_TEST_MANAGER_001"
        ? "33333333-3333-4333-8333-333333333333"
        : item.managerUserId === "QUALITY_TEST_MANAGER_002"
          ? "44444444-4444-4444-8444-444444444444"
          : "55555555-5555-4555-8555-555555555555",
      occurredAt,
    );
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_events WHERE is_test=1")
    .get() as { count?: number }).count ?? 0);
  db.close();
  process.stdout.write(`隔离质量测试事件已就绪：${count} 条\n`);
}
