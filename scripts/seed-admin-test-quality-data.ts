import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from
  "../src/infra/workbench-formal-task-store";
import { createQualityTaskBridge } from
  "../src/quality/assignments/quality-task-bridge";
import { createQualityStore } from "../src/quality/infra/quality-store";
import { isAdminTestSystemEnabled } from "../src/testing/admin-test-actors";

if (!isAdminTestSystemEnabled()) {
  console.log("[admin-test-system] disabled; no isolated quality data seeded");
  process.exit(0);
}

const statusPlan = [
  "PENDING_ANALYSIS",
  "PENDING_ASSIGNMENT",
  "PENDING_ACCEPTANCE",
  "PENDING_ACCEPTANCE",
  "IN_PROGRESS",
  "IN_PROGRESS",
  "IN_PROGRESS",
  "IN_PROGRESS",
  "PENDING_PRIMARY_REVIEW",
  "PENDING_QUALITY_REVIEW",
  "CLOSED",
  "IN_PROGRESS",
  "DRAFT",
  "PENDING_ANALYSIS",
  "PENDING_ASSIGNMENT",
  "PENDING_ACCEPTANCE",
  "IN_PROGRESS",
  "PENDING_PRIMARY_REVIEW",
  "PENDING_QUALITY_REVIEW",
  "CLOSED",
  "PENDING_ANALYSIS",
  "PENDING_ASSIGNMENT",
  "PENDING_ACCEPTANCE",
  "IN_PROGRESS",
  "PENDING_PRIMARY_REVIEW",
  "PENDING_QUALITY_REVIEW",
  "CLOSED",
  "DRAFT",
  "PENDING_ACCEPTANCE",
  "IN_PROGRESS",
] as const;

type PlannedStatus = (typeof statusPlan)[number];

const titles = [
  "测试：等待填写质量初析",
  "测试：任务规划待确认",
  "测试：测试主管待承接",
  "测试：测试员工1待承接",
  "测试：测试员工1处理中",
  "测试：测试员工2处理中",
  "测试：测试员工3处理中",
  "测试：测试主管协同处理中",
  "测试：等待原主责整体验收",
  "测试：等待质量终验",
  "测试：闭环记录已完成",
  "测试：多人协同任务进行中",
  "测试：通报草稿待补充",
  "测试：第二条质量初析待填写",
  "测试：第二条任务规划待确认",
  "测试：第二条测试主管待承接",
  "测试：原因排查进行中",
  "测试：第二条等待原主责验收",
  "测试：第二条等待质量终验",
  "测试：第二条闭环记录",
  "测试：批次记录待初析",
  "测试：验证方案待分配",
  "测试：测试主管承接演练",
  "测试：测试员工协同处理中",
  "测试：措施验证待主管确认",
  "测试：证据包待质量终验",
  "测试：历史事件关闭状态",
  "测试：第二份通报草稿",
  "测试：测试主管拒绝与重派",
  "测试：测试员工进度更新",
] as const;

const dbPath = resolveWorkbenchSqlitePath();
createQualityStore(dbPath).close();
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON");
db.exec("PRAGMA busy_timeout=8000");

const now = new Date();
const createdAt = now.toISOString();
const dueAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

function eventId(index: number): string {
  return `quality-test-event-extra-${String(index).padStart(3, "0")}`;
}

function eventNo(index: number): string {
  return `QT-DEMO-${String(index).padStart(3, "0")}`;
}

function nodeId(index: number, suffix: "root" | "employee"): string {
  return `quality-test-extra-node-${String(index).padStart(3, "0")}-${suffix}`;
}

function requestId(index: number, offset: number): string {
  return `${String(offset).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function rootNodeStatus(status: PlannedStatus): string | null {
  if (status === "PENDING_ACCEPTANCE") return "PENDING_ACCEPTANCE";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "PENDING_PRIMARY_REVIEW") return "PENDING_PARENT_REVIEW";
  if (status === "PENDING_QUALITY_REVIEW" || status === "CLOSED") return "APPROVED";
  return null;
}

function employeeUserId(index: number): string {
  return `QUALITY_TEST_EMPLOYEE_00${(index % 3) + 1}`;
}

function employeeNodeStatus(status: PlannedStatus, index: number): string | null {
  if (status === "IN_PROGRESS") {
    return ["PENDING_ACCEPTANCE", "IN_PROGRESS", "RETURNED", "PENDING_PARENT_REVIEW"][index % 4]!;
  }
  if (["PENDING_PRIMARY_REVIEW", "PENDING_QUALITY_REVIEW", "CLOSED"].includes(status)) {
    return "APPROVED";
  }
  return null;
}

const statusesRequiringConfirmedAnalysis = new Set<PlannedStatus>([
  "PENDING_ASSIGNMENT",
  "PENDING_ACCEPTANCE",
  "IN_PROGRESS",
  "PENDING_PRIMARY_REVIEW",
  "PENDING_QUALITY_REVIEW",
  "CLOSED",
]);

function hasSelectedDeliverable(value: unknown): boolean {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) && parsed.some((item) =>
      item && typeof item === "object"
      && String((item as Record<string, unknown>).name ?? "").trim()
      && (item as Record<string, unknown>).selected !== false,
    );
  } catch {
    return false;
  }
}

function ensureConfirmedAnalysis(index: number, status: PlannedStatus): void {
  if (!statusesRequiringConfirmedAnalysis.has(status)) return;
  const no = eventNo(index);
  const event = db.prepare(`
    SELECT id,overall_due_at
    FROM quality_events
    WHERE event_no=? AND is_test=1
    LIMIT 1
  `).get(no) as { id: string; overall_due_at: string | null } | undefined;
  if (!event) throw new Error(`隔离测试事件不存在：${no}`);
  const latest = db.prepare(`
    SELECT analysis_version,deliverables_json
    FROM quality_analysis_versions
    WHERE event_id=?
    ORDER BY analysis_version DESC
    LIMIT 1
  `).get(event.id) as { analysis_version: number; deliverables_json: string } | undefined;
  if (latest && hasSelectedDeliverable(latest.deliverables_json)) return;

  const analysisVersion = Number(latest?.analysis_version ?? 0) + 1;
  const contentJson = JSON.stringify({
    problemDirection: "隔离测试质量问题核验",
    confirmedCategoryReference: "隔离测试分类",
    sourceFactSummary: [`${no} 来源事实已确认，仅用于隔离测试`],
    analysisBasis: ["来源快照已确认", "主管人工研判已完成"],
    preliminaryConclusion: `${no} 已完成质量初析，建议研发中心完成原因排查与验证`,
    informationGaps: [],
    handlingRequirements: [
      `完成 ${no} 的原因排查、措施制定与验证`,
      "上传可复核的过程记录和验证证据",
    ],
  });
  const deliverablesJson = JSON.stringify([{
    name: "原因排查与验证记录",
    description: `提交 ${no} 的原因、措施、验证过程和结果`,
    acceptanceCriteria: "包含事实依据、原因结论、处理措施、验证结果和必要证据",
    selected: true,
  }]);
  db.prepare(`
    INSERT INTO quality_analysis_versions(
      analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,
      deliverables_json,diff_json,modification_reason,primary_department_id,
      primary_department_name,collaborator_departments_json,primary_manager_user_id,
      primary_manager_name,primary_manager_account_status,suggested_total_due_at,
      schema_version,prompt_version,model_config_id,input_version,rule_version,
      case_library_version,knowledge_version,generated_by,edited_by,confirmed_by,
      confirmed_at,created_at
    ) VALUES(?,?,?,?,NULL,?,?,?,'补齐隔离测试流程前置数据',
      'QUALITY_TEST_DEPT_RND','研发中心（测试）','[]','QUALITY_TEST_MANAGER_001',
      '测试主管','active',?,'quality-analysis-output-v1','admin-test-quality-seed-v1',
      NULL,1,'rules-test-v1','cases-test-v1','knowledge-test-v1',NULL,
      'QUALITY_TEST_SPECIALIST_001','QUALITY_TEST_SPECIALIST_001',?,?)
  `).run(
    `quality-test-seed-analysis:${event.id}:v${analysisVersion}`,
    event.id,
    analysisVersion,
    requestId(index, 34000000 + analysisVersion),
    contentJson,
    deliverablesJson,
    JSON.stringify({ seedRepair: true }),
    event.overall_due_at ?? dueAt,
    createdAt,
    createdAt,
  );
}

let transactionOpen = true;
db.exec("BEGIN IMMEDIATE");
try {
  // Real workbook synchronization must never own isolated test rows. Older
  // deployments did mark them deleted, so repair only that presentation state
  // on startup without rewriting reviews, event progress, or task progress.
  db.prepare(`
    UPDATE quality_source_rows
    SET state='ACTIVE', last_seen_at=?, synced_at=?
    WHERE sheet_id='QUALITY_TEST_ISOLATED'
      AND source_key LIKE 'quality-test-source:QT-DEMO-%'
      AND state='DELETED'
  `).run(createdAt, createdAt);

  for (const [offset, status] of statusPlan.entries()) {
    const index = offset;
    const id = eventId(index);
    const no = eventNo(index);
    const existing = db.prepare(`
      SELECT 1
      FROM quality_events
      WHERE event_no=? AND is_test=1
      LIMIT 1
    `).get(no);
    if (existing) continue;
    const sourceKey = `quality-test-source:${no}`;
    const issue = `${titles[offset]}；仅用于隔离测试系统，不关联真实客户、员工或钉钉接收人。`;
    const snapshot = {
      feedbackNo: `TEST-${no}`,
      feedbackAt: createdAt,
      reporter: "测试反馈人",
      deviceModel: `测试设备-${(index % 4) + 1}`,
      serialNo: `TEST-SN-${String(index).padStart(3, "0")}`,
      catheterBatch: `TEST-BATCH-${(index % 6) + 1}`,
      issueDescription: issue,
      clinicianAware: "隔离测试",
      impact: "仅影响隔离测试数据",
      confirmation: "模拟事实已确认",
    };
    const snapshotJson = JSON.stringify(snapshot);
    const contentHash = createHash("sha256").update(snapshotJson).digest("hex");
    db.prepare(`
      INSERT INTO quality_source_rows(
        source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
        normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,last_seen_at,
        source_updated_at,synced_at,version
      ) VALUES(?,'QUALITY_TEST_ISOLATED','隔离测试数据',?,'ACTIVE',1,?,?,?,NULL,?,?,?,?,1)
      ON CONFLICT(source_key) DO NOTHING
    `).run(
      sourceKey,
      10000 + index,
      contentHash,
      snapshotJson,
      snapshotJson,
      createdAt,
      createdAt,
      createdAt,
      createdAt,
    );

    const rootStatus = rootNodeStatus(status);
    const primaryNodeId = rootStatus && rootStatus !== "PENDING_ACCEPTANCE"
      ? nodeId(index, "root")
      : null;
    db.prepare(`
      INSERT INTO quality_events(
        id,event_no,is_test,status,title,problem_status,occurred_at,feedback_at,
        feedback_name,device_model,device_serial,initial_category,impact,urgency,
        created_by,submitted_by,submitted_at,original_primary_department_id,
        overall_due_at,primary_node_id,version,created_at,updated_at
      ) VALUES(?,?,1,?,?,?,?,?,'测试反馈人',?,?,
        '隔离测试分类','仅影响隔离测试数据','MEDIUM','QUALITY_TEST_AFTERSALES_001',
        ?,?,'QUALITY_TEST_DEPT_RND',?,?,1,?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      id,
      no,
      status,
      titles[offset],
      issue,
      createdAt,
      createdAt,
      snapshot.deviceModel,
      snapshot.serialNo,
      status === "DRAFT" ? null : "QUALITY_TEST_AFTERSALES_001",
      status === "DRAFT" ? null : createdAt,
      dueAt,
      primaryNodeId,
      createdAt,
      createdAt,
    );

    db.prepare(`
      INSERT INTO quality_event_source_links(
        id,event_id,source_key,source_version,source_state_at_link,
        source_snapshot_json,linked_by,linked_at
      ) VALUES(?,?,?,1,'ACTIVE',?,'QUALITY_TEST_AFTERSALES_001',?)
      ON CONFLICT(id) DO NOTHING
    `).run(`source-link:${id}`, id, sourceKey, snapshotJson, createdAt);

    if (status !== "DRAFT") {
      db.prepare(`
        INSERT INTO quality_source_reviews(
          source_key,status,note,decided_by,decided_at,source_content_hash,
          assessment_version,assessment_snapshot_json,event_id,version,created_at,updated_at
        ) VALUES(?,'REPORTED','隔离测试模拟通报','QUALITY_TEST_AFTERSALES_001',
          ?,?,NULL,NULL,?,1,?,?)
        ON CONFLICT(source_key) DO NOTHING
      `).run(sourceKey, createdAt, contentHash, id, createdAt, createdAt);
    }

    if (rootStatus) {
      const root = nodeId(index, "root");
      db.prepare(`
        INSERT INTO quality_assignment_nodes(
          node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
          department_name,is_primary,status,due_at,requirement,version,created_by,
          request_id,accepted_at,submitted_at,created_at,updated_at
        ) VALUES(?,?,NULL,0,'QUALITY_TEST_MANAGER_001','MANAGER','研发中心（测试）',
          ?,?,?,?,1,'QUALITY_TEST_SPECIALIST_001',?,?,?,?,?)
        ON CONFLICT(node_id) DO NOTHING
      `).run(
        root,
        id,
        rootStatus === "PENDING_ACCEPTANCE" ? 0 : 1,
        rootStatus,
        dueAt,
        `测试主管完成 ${no} 的隔离测试核验`,
        requestId(index, 30000000),
        rootStatus === "PENDING_ACCEPTANCE" ? null : createdAt,
        rootStatus === "PENDING_PARENT_REVIEW" || rootStatus === "APPROVED" ? createdAt : null,
        createdAt,
        createdAt,
      );

      const childStatus = employeeNodeStatus(status, index);
      if (childStatus) {
        const child = nodeId(index, "employee");
        const childAssigneeUserId = employeeUserId(index);
        db.prepare(`
          INSERT INTO quality_assignment_nodes(
            node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
            department_name,is_primary,status,due_at,requirement,version,created_by,
            request_id,accepted_at,submitted_at,created_at,updated_at
          ) VALUES(?,?,?,1,?,'EMPLOYEE','研发中心（测试）',
            0,?,?,'测试员工完成验证并提交证据',1,
            'QUALITY_TEST_MANAGER_001',?,?,?,?,?)
          ON CONFLICT(node_id) DO NOTHING
        `).run(
          child,
          id,
          root,
          childAssigneeUserId,
          childStatus,
          dueAt,
          requestId(index, 31000000),
          childStatus === "PENDING_ACCEPTANCE" ? null : createdAt,
          ["PENDING_PARENT_REVIEW", "APPROVED"].includes(childStatus) ? createdAt : null,
          createdAt,
          createdAt,
        );
        if (["PENDING_PARENT_REVIEW", "APPROVED"].includes(childStatus)) {
          const evidenceText = `${no} 隔离测试证据`;
          db.prepare(`
            INSERT INTO quality_evidence(
              evidence_id,event_id,node_id,evidence_version,storage_key,original_name,
              mime_type,summary,size_bytes,sha256,uploaded_by,request_id,created_at
            ) VALUES(?,?,?,1,?,'隔离测试证据.txt','text/plain','模拟验证已完成',
              ?,?,?,?,?)
            ON CONFLICT(evidence_id) DO NOTHING
          `).run(
            `evidence:${id}:employee`,
            id,
            child,
            `seed:${id}:employee`,
            Buffer.byteLength(evidenceText),
            createHash("sha256").update(evidenceText).digest("hex"),
            childAssigneeUserId,
            requestId(index, 32000000),
            createdAt,
          );
        }
      }
    }

    db.prepare(`
      INSERT INTO quality_audit_events(
        id,event_id,actor_user_id,actor_role,action,before_json,after_json,
        reason,request_id,occurred_at
      ) VALUES(?,?,'QUALITY_TEST_AFTERSALES_001','system','EVENT_SUBMITTED',
        NULL,NULL,'隔离测试模拟数据',?,?)
      ON CONFLICT(id) DO NOTHING
    `).run(`audit:${id}`, id, requestId(index, 33000000), createdAt);
  }
  for (const [index, status] of statusPlan.entries()) {
    ensureConfirmedAnalysis(index, status);
  }
  db.exec("COMMIT");
  transactionOpen = false;

  const bridge = createQualityTaskBridge(createWorkbenchFormalTaskStore());
  const employeeNodes = db.prepare(`
    SELECT n.node_id,n.status AS node_status,n.assignee_user_id,n.due_at,
           n.requirement,n.request_id,e.event_no,e.title,e.problem_status,
           p.assignee_user_id AS parent_assignee_user_id
    FROM quality_assignment_nodes n
    JOIN quality_events e ON e.id=n.event_id AND e.is_test=1
    JOIN quality_assignment_nodes p ON p.node_id=n.parent_node_id
    WHERE n.assignee_kind='EMPLOYEE'
    ORDER BY n.node_id
  `).all() as Array<Record<string, unknown>>;
  for (const node of employeeNodes) {
    const formal = bridge.createNodeTask({
      nodeId: String(node.node_id),
      eventNo: String(node.event_no),
      eventTitle: String(node.title),
      eventSummary: String(node.problem_status),
      requirement: String(node.requirement),
      initiatorUserId: "QUALITY_TEST_SPECIALIST_001",
      managerUserId: "QUALITY_TEST_MANAGER_001",
      assigneeUserId: String(node.assignee_user_id),
      dueAt: String(node.due_at),
      requestId: String(node.request_id),
      parentAssigneeUserId: String(node.parent_assignee_user_id),
    });
    db.prepare(`
      INSERT INTO quality_task_links(node_id,task_id,subtask_id,integration_key,created_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(node_id) DO NOTHING
    `).run(
      node.node_id,
      formal.task.taskId,
      formal.subtask.subtaskId,
      formal.integrationKey,
      createdAt,
    );
    if (!formal.alreadyCreated) {
      const nodeStatus = String(node.node_status);
      const formalStatus = nodeStatus === "PENDING_ACCEPTANCE"
        ? "ASSIGNED"
        : ["PENDING_PARENT_REVIEW", "APPROVED"].includes(nodeStatus)
          ? "DONE"
          : "IN_PROGRESS";
      db.prepare(`
        UPDATE subtasks
        SET status=?,progress_note=?,updated_at=?,completed_at=?
        WHERE subtask_id=?
      `).run(
        formalStatus,
        formalStatus === "DONE" ? "隔离测试：已提交主管验收" : "隔离测试任务",
        createdAt,
        formalStatus === "DONE" ? createdAt : null,
        formal.subtask.subtaskId,
      );
      db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE task_id=?").run(
        formalStatus,
        createdAt,
        formal.task.taskId,
      );
    }
  }
} catch (error) {
  if (transactionOpen) db.exec("ROLLBACK");
  throw error;
} finally {
  const rows = db.prepare(`
    SELECT status,COUNT(*) AS count
    FROM quality_events
    WHERE is_test=1
    GROUP BY status
    ORDER BY status
  `).all() as Array<{ status: string; count: number }>;
  const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
  const requiredStatuses = new Set<PlannedStatus>([
    "DRAFT",
    "PENDING_ANALYSIS",
    "PENDING_ASSIGNMENT",
    "PENDING_ACCEPTANCE",
    "IN_PROGRESS",
    "PENDING_PRIMARY_REVIEW",
    "PENDING_QUALITY_REVIEW",
    "CLOSED",
  ]);
  for (const row of rows) requiredStatuses.delete(row.status as PlannedStatus);
  db.close();
  if (total < 30) throw new Error(`隔离测试事件不足 30 条，当前 ${total} 条`);
  if (requiredStatuses.size > 0) {
    throw new Error(`隔离测试事件缺少状态：${[...requiredStatuses].join(",")}`);
  }
  console.log(`[admin-test-system] isolated quality events ready: ${total}; ${JSON.stringify(rows)}`);
}
