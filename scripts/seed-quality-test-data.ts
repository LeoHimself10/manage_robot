import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createQualityStore } from "../src/quality/infra/quality-store";

if (!process.argv.includes("--confirm")) throw new Error("请显式传入 --confirm 后再准备隔离质量测试数据");
if (!["1", "true", "yes", "on"].includes(String(process.env.QUALITY_TEST_ACTORS_ENABLED ?? "").trim().toLowerCase())) {
  throw new Error("QUALITY_TEST_ACTORS_ENABLED 未开启，拒绝准备测试数据");
}

const dbPath = resolveWorkbenchSqlitePath();
createQualityStore(dbPath).close();
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON");
db.exec("PRAGMA busy_timeout=8000");
const occurredAt = new Date().toISOString();
const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

type NodeSeed = {
  key: string;
  parentKey?: string;
  assigneeUserId: string;
  assigneeKind: "MANAGER" | "EMPLOYEE";
  departmentName: "研发中心" | "质量部";
  status: "PENDING_ACCEPTANCE" | "IN_PROGRESS" | "PENDING_PARENT_REVIEW" | "APPROVED";
  evidence?: boolean;
};
type EventSeed = {
  id: string;
  eventNo: string;
  status: "PENDING_ASSIGNMENT" | "PENDING_ACCEPTANCE" | "IN_PROGRESS" | "PENDING_PRIMARY_REVIEW" | "PENDING_QUALITY_REVIEW" | "CLOSED";
  title: string;
  purpose: string;
  analysis: boolean;
  nodes: NodeSeed[];
};

const managerOne = "QUALITY_TEST_MANAGER_001";
const managerTwo = "QUALITY_TEST_MANAGER_002";
const employeeOne = "QUALITY_TEST_EMPLOYEE_001";
const employeeTwo = "QUALITY_TEST_EMPLOYEE_002";
const employeeThree = "QUALITY_TEST_EMPLOYEE_003";
const events: EventSeed[] = [
  { id: "quality-test-event-analysis", eventNo: "QT-DEMO-000", status: "PENDING_ASSIGNMENT", title: "测试：等待填写质量初析", purpose: "从质量初析开始完整演练，不连接任何真实人员。", analysis: false, nodes: [] },
  { id: "quality-test-event-assignment", eventNo: "QT-DEMO-001", status: "PENDING_ASSIGNMENT", title: "测试：影像显示偶发异常", purpose: "用于选择一名测试主管并从头推进完整闭环。", analysis: true, nodes: [] },
  { id: "quality-test-event-manager-one", eventNo: "QT-DEMO-002", status: "PENDING_ACCEPTANCE", title: "测试：研发原因排查", purpose: "用于主管一接受或拒绝承接。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "PENDING_ACCEPTANCE" }] },
  { id: "quality-test-event-manager-two", eventNo: "QT-DEMO-003", status: "PENDING_ACCEPTANCE", title: "测试：质量记录核验", purpose: "用于主管二接受或拒绝承接。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerTwo, assigneeKind: "MANAGER", departmentName: "质量部", status: "PENDING_ACCEPTANCE" }] },
  { id: "quality-test-event-delegate", eventNo: "QT-DEMO-004", status: "IN_PROGRESS", title: "测试：等待主管分配员工", purpose: "主管一可选择研发中心测试员工继续分配。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "IN_PROGRESS" }] },
  { id: "quality-test-event-employee-accept", eventNo: "QT-DEMO-005", status: "IN_PROGRESS", title: "测试：员工一待承接", purpose: "员工一可接受或拒绝测试任务。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "IN_PROGRESS" }, { key: "employee", parentKey: "root", assigneeUserId: employeeOne, assigneeKind: "EMPLOYEE", departmentName: "研发中心", status: "PENDING_ACCEPTANCE" }] },
  { id: "quality-test-event-evidence", eventNo: "QT-DEMO-006", status: "IN_PROGRESS", title: "测试：员工二提交证据", purpose: "员工二可生成测试证据并提交完成。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "IN_PROGRESS" }, { key: "employee", parentKey: "root", assigneeUserId: employeeTwo, assigneeKind: "EMPLOYEE", departmentName: "研发中心", status: "IN_PROGRESS" }] },
  { id: "quality-test-event-child-review", eventNo: "QT-DEMO-007", status: "IN_PROGRESS", title: "测试：主管验收员工证据", purpose: "主管一可通过或退回员工一的提交。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "IN_PROGRESS" }, { key: "employee", parentKey: "root", assigneeUserId: employeeOne, assigneeKind: "EMPLOYEE", departmentName: "研发中心", status: "PENDING_PARENT_REVIEW", evidence: true }] },
  { id: "quality-test-event-primary-review", eventNo: "QT-DEMO-008", status: "PENDING_PRIMARY_REVIEW", title: "测试：原主责整体验收", purpose: "主管一可执行整体验收并送质量终验。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "PENDING_PARENT_REVIEW" }, { key: "employee", parentKey: "root", assigneeUserId: employeeTwo, assigneeKind: "EMPLOYEE", departmentName: "研发中心", status: "APPROVED", evidence: true }] },
  { id: "quality-test-event-quality-review", eventNo: "QT-DEMO-009", status: "PENDING_QUALITY_REVIEW", title: "测试：质量终验待关闭", purpose: "佟成（测试）可关闭或退回指定节点。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerOne, assigneeKind: "MANAGER", departmentName: "研发中心", status: "APPROVED" }, { key: "employee", parentKey: "root", assigneeUserId: employeeOne, assigneeKind: "EMPLOYEE", departmentName: "研发中心", status: "APPROVED", evidence: true }] },
  { id: "quality-test-event-closed", eventNo: "QT-DEMO-010", status: "CLOSED", title: "测试：已关闭事件重开", purpose: "佟成（测试）可选择节点重开，历史证据保留。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerTwo, assigneeKind: "MANAGER", departmentName: "质量部", status: "APPROVED" }, { key: "employee", parentKey: "root", assigneeUserId: employeeThree, assigneeKind: "EMPLOYEE", departmentName: "质量部", status: "APPROVED", evidence: true }] },
  { id: "quality-test-event-employee-three", eventNo: "QT-DEMO-011", status: "IN_PROGRESS", title: "测试：员工三待承接", purpose: "员工三可在质量部测试分支完成承接、证据和提交。", analysis: true, nodes: [{ key: "root", assigneeUserId: managerTwo, assigneeKind: "MANAGER", departmentName: "质量部", status: "IN_PROGRESS" }, { key: "employee", parentKey: "root", assigneeUserId: employeeThree, assigneeKind: "EMPLOYEE", departmentName: "质量部", status: "PENDING_ACCEPTANCE" }] },
];

function nodeId(eventId: string, key: string): string {
  return `quality-test-node-${createHash("sha256").update(`${eventId}|${key}`).digest("hex").slice(0, 20)}`;
}

db.exec("BEGIN IMMEDIATE");
try {
  for (const item of events) {
    const root = item.nodes.find((node) => !node.parentKey);
    const rootId = root && root.status !== "PENDING_ACCEPTANCE" ? nodeId(item.id, root.key) : null;
    db.prepare(`
      INSERT INTO quality_events(
        id,event_no,is_test,status,title,problem_status,occurred_at,feedback_at,
        feedback_name,device_model,device_serial,initial_category,impact,urgency,
        created_by,submitted_by,submitted_at,original_primary_department_id,
        overall_due_at,primary_node_id,version,created_at,updated_at
      ) VALUES(?,?,1,?,?,?,?,?,'测试反馈人','测试设备型号','TEST-SN-001','测试分类',
        '仅影响隔离测试数据','MEDIUM','QUALITY_TEST_AFTERSALES_001',
        'QUALITY_TEST_AFTERSALES_001',?,?,?,?,3,?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(item.id, item.eventNo, item.status, item.title, item.purpose, occurredAt, occurredAt,
      occurredAt, rootId ? root?.departmentName : null, dueAt, rootId, occurredAt, occurredAt);
    db.prepare(`
      INSERT INTO quality_event_source_links(
        id,event_id,source_key,source_version,source_state_at_link,source_snapshot_json,linked_by,linked_at
      ) VALUES(?,?,?,1,'ACTIVE',?,'QUALITY_TEST_AFTERSALES_001',?)
      ON CONFLICT(id) DO NOTHING
    `).run(`source-link:${item.id}`, item.id, `quality-test-source:${item.eventNo}`, JSON.stringify({
      反馈单号: `TEST-${item.eventNo}`, 反馈人: "测试反馈人", 设备型号: "测试设备型号",
      设备序列号: "TEST-SN-001", 问题描述: item.purpose,
    }), occurredAt);
    if (item.analysis) {
      db.prepare(`
        INSERT INTO quality_initial_analysis_versions(
          analysis_id,event_id,version,status,problem_direction,confirmed_category,
          source_summary,analysis_basis,initial_conclusion,information_gaps,
          suggested_department,processing_requirements,suggested_due_at,
          created_by,completed_by,completed_at,created_at,updated_at
        ) VALUES(?,?,1,'COMPLETED','测试问题方向','测试分类',?,
          '基于隔离测试事实进行核验','建议按测试流程逐级承接和验收','无',?,
          '完成原因核查、上传证据并逐级验收',?,
          'QUALITY_TEST_SPECIALIST_001','QUALITY_TEST_SPECIALIST_001',?,?,?)
        ON CONFLICT(analysis_id) DO NOTHING
      `).run(`analysis:${item.id}`, item.id, item.purpose, root?.departmentName ?? "研发中心",
        dueAt, occurredAt, occurredAt, occurredAt);
    }
    const existingNodeCount = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM quality_assignment_nodes WHERE event_id=?",
    ).get(item.id) as { count?: number }).count ?? 0);
    for (const [index, node] of (existingNodeCount > 0 ? [] : item.nodes).entries()) {
      const id = nodeId(item.id, node.key);
      const parentId = node.parentKey ? nodeId(item.id, node.parentKey) : null;
      const ordinal = Number(item.eventNo.slice(-3)) * 10 + index + 1;
      db.prepare(`
        INSERT INTO quality_assignment_nodes(
          node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
          department_name,is_primary,status,due_at,requirement,version,
          created_by,request_id,accepted_at,submitted_at,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,'QUALITY_TEST_SPECIALIST_001',?,?,?,?,?)
        ON CONFLICT(node_id) DO NOTHING
      `).run(id, item.id, parentId, parentId ? 1 : 0, node.assigneeUserId, node.assigneeKind,
        node.departmentName, !parentId && node.status !== "PENDING_ACCEPTANCE" ? 1 : 0,
        node.status, dueAt, `完成 ${item.eventNo} 的隔离测试核验`,
        `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
        node.status === "PENDING_ACCEPTANCE" ? null : occurredAt,
        node.status === "PENDING_PARENT_REVIEW" || node.status === "APPROVED" ? occurredAt : null,
        occurredAt, occurredAt);
      if (node.evidence) {
        const content = Buffer.from(`${item.eventNo} 隔离测试证据`, "utf8");
        db.prepare(`
          INSERT INTO quality_evidence(
            evidence_id,event_id,node_id,evidence_version,storage_key,original_name,
            mime_type,summary,size_bytes,sha256,uploaded_by,request_id,created_at
          ) VALUES(?,?,?,1,?,'隔离测试证据.txt','text/plain','已完成测试核验',?,?,?,?,?)
          ON CONFLICT(evidence_id) DO NOTHING
        `).run(`evidence:${item.id}:${node.key}`, item.id, id, `seed:${item.id}:${node.key}`,
          content.byteLength, createHash("sha256").update(content).digest("hex"), node.assigneeUserId,
          `10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`, occurredAt);
      }
    }
    db.prepare(`
      INSERT INTO quality_audit_events(
        id,event_id,actor_user_id,actor_role,action,before_json,after_json,
        reason,request_id,occurred_at
      ) VALUES(?,?,?,'system','EVENT_SUBMITTED',NULL,NULL,'隔离测试数据种子',?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(`audit:${item.id}`, item.id, "QUALITY_TEST_AFTERSALES_001",
      `20000000-0000-4000-8000-${String(Number(item.eventNo.slice(-3)) + 1).padStart(12, "0")}`, occurredAt);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_events WHERE is_test=1")
    .get() as { count?: number }).count ?? 0);
  db.close();
  process.stdout.write(`隔离质量测试事件已就绪：${count} 条；测试员工：3 名\n`);
}
