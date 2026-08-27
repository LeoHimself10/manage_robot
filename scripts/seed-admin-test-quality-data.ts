import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
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

db.exec("BEGIN IMMEDIATE");
try {
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

      if (["PENDING_PRIMARY_REVIEW", "PENDING_QUALITY_REVIEW", "CLOSED"].includes(status)) {
        const child = nodeId(index, "employee");
        db.prepare(`
          INSERT INTO quality_assignment_nodes(
            node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
            department_name,is_primary,status,due_at,requirement,version,created_by,
            request_id,accepted_at,submitted_at,created_at,updated_at
          ) VALUES(?,?,?,1,'QUALITY_TEST_EMPLOYEE_001','EMPLOYEE','研发中心（测试）',
            0,'APPROVED',?,'测试员工1完成验证并提交证据',1,
            'QUALITY_TEST_MANAGER_001',?,?,?,?,?)
          ON CONFLICT(node_id) DO NOTHING
        `).run(
          child,
          id,
          root,
          dueAt,
          requestId(index, 31000000),
          createdAt,
          createdAt,
          createdAt,
          createdAt,
        );
        const evidenceText = `${no} 隔离测试证据`;
        db.prepare(`
          INSERT INTO quality_evidence(
            evidence_id,event_id,node_id,evidence_version,storage_key,original_name,
            mime_type,summary,size_bytes,sha256,uploaded_by,request_id,created_at
          ) VALUES(?,?,?,1,?,'隔离测试证据.txt','text/plain','模拟验证已完成',
            ?,?,'QUALITY_TEST_EMPLOYEE_001',?,?)
          ON CONFLICT(evidence_id) DO NOTHING
        `).run(
          `evidence:${id}:employee`,
          id,
          child,
          `seed:${id}:employee`,
          Buffer.byteLength(evidenceText),
          createHash("sha256").update(evidenceText).digest("hex"),
          requestId(index, 32000000),
          createdAt,
        );
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
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
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
