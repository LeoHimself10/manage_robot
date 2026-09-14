import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getQualityPlanningContextsBySubtaskIds,
  listQualityFormalSubtasks,
  qualityEmployeeTaskStage,
  reconcileQualityPlanningPublication,
} from "../../src/quality/analysis/quality-formal-task-projection";
import {
  getManagerQualityReviewContextsBySubtaskIds,
  getQualityContextBySubtaskIds,
} from "../../src/quality/assignments/quality-task-context";
import { createQualityAssignmentService } from "../../src/quality/assignments/quality-assignment-service";
import { createQualityEvidenceService } from "../../src/quality/evidence/quality-evidence-service";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityEventPerspectiveProjector } from "../../src/quality/presentation/quality-event-perspective";
import { createQualityReviewService } from "../../src/quality/reviews/quality-review-service";

import { resolveQualityManagerTaskStageFromDb } from "../../src/quality/presentation/quality-manager-task-stage";

const NOW = "2026-08-28T01:00:00.000Z";

describe("quality formal-task projection", () => {
  let tempDir = "";
  let dbPath = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quality-formal-projection-"));
    dbPath = join(tempDir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    createQualityStore(dbPath).close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`INSERT INTO quality_events(
      id,event_no,status,title,problem_status,created_by,version,created_at,updated_at
    ) VALUES('event-1','QE-PROJECTION-001','PENDING_ASSIGNMENT','质量任务投影测试',
      '只验证质量模块读取原任务状态','quality-user',1,?,?)`).run(NOW, NOW);
    db.prepare(`INSERT INTO quality_analysis_handoffs(
      handoff_id,event_id,analysis_version,integration_key,primary_department_id,
      primary_department_name,primary_manager_user_id,task_package_json,plan_id,
      thread_id,status,created_at
    ) VALUES('handoff-1','event-1',1,'quality-node:event-1','dept-1','研发中心',
      'manager-1','{}','plan-1','thread-1','PENDING_PLANNING',?)`).run(NOW);
    db.exec(`
      CREATE TABLE tasks(
        task_id TEXT PRIMARY KEY,task_no TEXT NOT NULL,plan_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,description TEXT,status TEXT NOT NULL,initiator_user_id TEXT NOT NULL,
        initiator_department TEXT NOT NULL,manager_user_id TEXT NOT NULL,manager_group_id TEXT,
        source_trace_id TEXT,published_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE subtasks(
        subtask_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,source_task_key TEXT NOT NULL,
        title TEXT NOT NULL,objective TEXT,deliverables TEXT,completion_criteria TEXT,due_at TEXT,
        feedback_frequency TEXT,assignee_user_id TEXT NOT NULL,status TEXT NOT NULL,progress_note TEXT,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
        UNIQUE(task_id,source_task_key)
      );
      CREATE TABLE task_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,subtask_id TEXT,
        event_type TEXT NOT NULL,actor_user_id TEXT NOT NULL,note TEXT,payload_json TEXT,
        occurred_at TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT INTO tasks(
      task_id,task_no,plan_id,title,status,initiator_user_id,initiator_department,
      manager_user_id,published_at,created_at,updated_at
    ) VALUES('task:plan-1','TASK-001','plan-1','原任务系统正式任务','ASSIGNED',
      'manager-1','研发中心','manager-1',?,?,?)`).run(NOW, NOW, NOW);
    db.prepare(`INSERT INTO subtasks(
      subtask_id,task_id,source_task_key,title,objective,deliverables,completion_criteria,
      assignee_user_id,status,due_at,progress_note,created_at,updated_at
    ) VALUES('subtask-1','task:plan-1','task_1','完成问题核验','提交原因和验证结论',
      '原因分析报告','包含复现记录、根因和验证结果','employee-1','ASSIGNED',
      '2026-09-30T08:00:00.000Z','已完成现场信息收集',?,?)`).run(NOW, NOW);
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
    }
  });

  it("keeps employee acceptance links and live formal status when responsibility nodes exist", () => {
    vi.stubEnv("QUALITY_PILOT_TEST_MODE", "1");
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE subtasks SET assignee_user_id='QUALITY_SIM_EMPLOYEE_1'").run();
    reconcileQualityPlanningPublication({eventId:"event-1",integrationKey:"quality-node:event-1",planId:"plan-1",formalTaskId:"task:plan-1",actorUserId:"manager-1",publishedAt:NOW,dbPath});
    const projector = createQualityEventPerspectiveProjector(dbPath);
    const read = () => projector.getEventDetail({viewerUserId:"QUALITY_SIM_EMPLOYEE_1",eventId:"event-1"});
    expect(read()?.viewModel.branch).toEqual(expect.arrayContaining([expect.objectContaining({subtaskId:"subtask-1",formalStatus:"ASSIGNED",taskUrl:"/workbench/employee?view=new",formalProjection:true})]));
    db.prepare("UPDATE subtasks SET status='IN_PROGRESS'").run();
    expect(read()?.viewModel.branch).toEqual(expect.arrayContaining([expect.objectContaining({formalStatus:"IN_PROGRESS",taskUrl:"/workbench/employee?view=current",statusLabel:"执行中"})]));
    expect(projector.getEventDetail({viewerUserId:"QUALITY_SIM_EMPLOYEE_2",eventId:"event-1"})).toBeNull();
    projector.close(); db.close();
  });

  it("shows pending planning only to its receiving manager before task publication", () => {
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_analysis_handoffs SET plan_id='unpublished-plan' WHERE handoff_id='handoff-1'").run();
    expect(resolveQualityManagerTaskStageFromDb({db,eventId:"event-1",eventStatus:"PENDING_ASSIGNMENT",managerUserId:"manager-1"})).toBe("DELEGATE");
    expect(resolveQualityManagerTaskStageFromDb({db,eventId:"event-1",eventStatus:"PENDING_ASSIGNMENT",managerUserId:"other"})).toBeNull();
    db.close();
  });

  it("exposes the return reason only to the assigned employee on returned work", () => {
    reconcileQualityPlanningPublication({eventId:"event-1",integrationKey:"quality-node:event-1",planId:"plan-1",formalTaskId:"task:plan-1",actorUserId:"manager-1",publishedAt:NOW,dbPath});
    const db = new DatabaseSync(dbPath);
    const row=db.prepare("SELECT node_id FROM quality_task_links WHERE subtask_id='subtask-1'").get() as {node_id:string};
    db.prepare("UPDATE quality_assignment_nodes SET status='RETURNED' WHERE node_id=?").run(row.node_id);
    db.prepare("INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,request_id,created_at) VALUES('r-return','event-1',?,'manager-1','RETURN','补充验证记录','request-return',?)").run(row.node_id,NOW);
    expect(getQualityContextBySubtaskIds(["subtask-1"],"employee-1",dbPath).get("subtask-1")?.reviewReason).toBe("补充验证记录");
    expect(getQualityContextBySubtaskIds(["subtask-1"],"other",dbPath).size).toBe(0);
    db.prepare("UPDATE quality_assignment_nodes SET status='APPROVED' WHERE node_id=?").run(row.node_id);
    expect(getQualityContextBySubtaskIds(["subtask-1"],"employee-1",dbPath).get("subtask-1")?.reviewReason).toBe("");
    db.close();
  });

  it("links an exact published handoff idempotently without changing the formal task state", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`INSERT INTO subtasks(
      subtask_id,task_id,source_task_key,title,objective,assignee_user_id,status,due_at,
      created_at,updated_at
    ) VALUES('subtask-2','task:plan-1','task_2','完成复测','提交复测记录',
      'employee-2','ASSIGNED','2026-09-30T08:00:00.000Z',?,?)`).run(NOW, NOW);
    setup.close();
    const first = reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });
    const repeated = reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });

    expect(first).toEqual({ matched: true, eventStatusChanged: true });
    expect(repeated).toEqual({ matched: true, eventStatusChanged: false });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    expect(db.prepare("SELECT status,formal_task_id FROM quality_analysis_handoffs WHERE handoff_id='handoff-1'").get())
      .toEqual({ status: "PUBLISHED", formal_task_id: "task:plan-1" });
    expect(db.prepare("SELECT status,version FROM quality_events WHERE id='event-1'").get())
      .toEqual({ status: "PENDING_ACCEPTANCE", version: 2 });
    const primary = db.prepare(`SELECT node_id,status,assignee_user_id,is_primary
      FROM quality_assignment_nodes WHERE event_id='event-1' AND parent_node_id IS NULL`).get() as {
      node_id: string;
      status: string;
      assignee_user_id: string;
      is_primary: number;
    };
    expect(primary).toMatchObject({ status: "IN_PROGRESS", assignee_user_id: "manager-1", is_primary: 1 });
    expect(db.prepare("SELECT primary_node_id FROM quality_events WHERE id='event-1'").get())
      .toEqual({ primary_node_id: primary.node_id });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM quality_assignment_nodes
      WHERE event_id='event-1' AND parent_node_id=?`).get(primary.node_id)).toEqual({ count: 2 });
    expect(db.prepare(`SELECT task_id,COUNT(*) AS count FROM quality_task_links
      GROUP BY task_id`).get()).toEqual({ task_id: "task:plan-1", count: 2 });
    expect(db.prepare("SELECT status FROM tasks WHERE task_id='task:plan-1'").get())
      .toEqual({ status: "ASSIGNED" });
    expect(db.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "ASSIGNED" });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM quality_audit_events
      WHERE event_id='event-1' AND action='QUALITY_FORMAL_TASK_PUBLISHED'`).get())
      .toEqual({ count: 1 });
    db.close();

    expect(getQualityContextBySubtaskIds(["subtask-1"], "employee-1", dbPath).get("subtask-1"))
      .toMatchObject({ eventId: "event-1", nodeStatus: "PENDING_ACCEPTANCE", requiresEvidence: true });
  });

  it("keeps linked formal subtasks authoritative when a legacy event has no planning handoff", () => {
    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });

    // A current publication has both a handoff and node links, but must still
    // project each formal subtask exactly once.
    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })).toHaveLength(1);

    const legacy = new DatabaseSync(dbPath);
    legacy.prepare(`UPDATE quality_assignment_nodes SET status='CANCELLED'
      WHERE node_id=(SELECT node_id FROM quality_task_links WHERE subtask_id='subtask-1')`).run();
    legacy.close();
    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })).toEqual([]);

    const restoredLegacy = new DatabaseSync(dbPath);
    restoredLegacy.prepare("DELETE FROM quality_analysis_handoffs WHERE event_id='event-1'").run();
    restoredLegacy.prepare("UPDATE subtasks SET status='DONE',completed_at=?,updated_at=? WHERE subtask_id='subtask-1'")
      .run(NOW, NOW);
    restoredLegacy.prepare(`UPDATE quality_assignment_nodes
      SET status='PENDING_PARENT_REVIEW',submitted_at=?,updated_at=?
      WHERE node_id=(SELECT node_id FROM quality_task_links WHERE subtask_id='subtask-1')`)
      .run(NOW, NOW);
    restoredLegacy.close();

    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        taskId: "task:plan-1",
        taskNo: "TASK-001",
        subtaskId: "subtask-1",
        assigneeUserId: "employee-1",
        managerUserId: "manager-1",
        status: "DONE",
      }),
    ]);
    expect(listQualityFormalSubtasks({
      eventId: "event-1",
      assigneeUserId: "employee-outside-event",
      dbPath,
    })).toEqual([]);
  });

  it("renders a link-only legacy manager review from the formal task without reopening quality-page actions", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`UPDATE quality_events
      SET is_test=1,created_by='QUALITY_TEST_AFTERSALES_001'
      WHERE id='event-1'`).run();
    setup.prepare(`UPDATE quality_analysis_handoffs
      SET primary_manager_user_id='QUALITY_TEST_MANAGER_001'
      WHERE event_id='event-1'`).run();
    setup.prepare(`UPDATE tasks
      SET manager_user_id='QUALITY_TEST_MANAGER_001'
      WHERE task_id='task:plan-1'`).run();
    setup.prepare(`UPDATE subtasks
      SET assignee_user_id='QUALITY_TEST_EMPLOYEE_003'
      WHERE subtask_id='subtask-1'`).run();
    setup.close();

    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "QUALITY_TEST_MANAGER_001",
      publishedAt: NOW,
      dbPath,
    });

    const legacy = new DatabaseSync(dbPath);
    legacy.prepare("DELETE FROM quality_analysis_handoffs WHERE event_id='event-1'").run();
    legacy.prepare("UPDATE quality_events SET status='IN_PROGRESS' WHERE id='event-1'").run();
    legacy.prepare(`UPDATE subtasks
      SET status='DONE',completed_at=?,updated_at=?
      WHERE subtask_id='subtask-1'`).run(NOW, NOW);
    legacy.prepare(`UPDATE quality_assignment_nodes
      SET status='PENDING_PARENT_REVIEW',submitted_at=?,updated_at=?
      WHERE node_id=(SELECT node_id FROM quality_task_links WHERE subtask_id='subtask-1')`)
      .run(NOW, NOW);
    legacy.close();

    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "quality-admin-local");
    const projector = createQualityEventPerspectiveProjector(dbPath);
    const detail = projector.getEventDetail({
      viewerUserId: "quality-admin-local",
      testActorRef: "manager-1",
      eventId: "event-1",
    });
    projector.close();

    expect(detail?.viewModel).toMatchObject({
      perspective: "manager",
      formalTaskProjection: true,
      allowedActions: [],
      event: {
        managerStages: ["REVIEW"],
        assignmentItems: [expect.objectContaining({
          actionRef: "subtask-1",
          assigneeName: "测试员工3",
          managerStage: "REVIEW",
          statusLabel: "已提交，待我验收",
          reviewStatusLabel: "待主管验收",
          taskNo: "TASK-001",
          taskUrl: expect.stringContaining("/workbench/manager/task?"),
          formalProjection: true,
        })],
      },
    });
  });

  it("does not let a cancelled task link restore manager or employee visibility", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`UPDATE quality_events
      SET is_test=1,created_by='QUALITY_TEST_AFTERSALES_001'
      WHERE id='event-1'`).run();
    setup.prepare(`UPDATE quality_analysis_handoffs
      SET primary_manager_user_id='QUALITY_TEST_MANAGER_001'
      WHERE event_id='event-1'`).run();
    setup.prepare(`UPDATE tasks
      SET manager_user_id='QUALITY_TEST_MANAGER_001'
      WHERE task_id='task:plan-1'`).run();
    setup.prepare(`UPDATE subtasks
      SET assignee_user_id='QUALITY_TEST_EMPLOYEE_001'
      WHERE subtask_id='subtask-1'`).run();
    setup.close();

    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "QUALITY_TEST_MANAGER_001",
      publishedAt: NOW,
      dbPath,
    });

    const cancelled = new DatabaseSync(dbPath);
    cancelled.prepare("DELETE FROM quality_analysis_handoffs WHERE event_id='event-1'").run();
    cancelled.prepare("UPDATE quality_events SET status='IN_PROGRESS' WHERE id='event-1'").run();
    cancelled.prepare(`UPDATE quality_assignment_nodes
      SET status='CANCELLED',updated_at=? WHERE event_id='event-1'`).run(NOW);
    cancelled.close();

    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })).toEqual([]);

    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "quality-admin-local");
    const projector = createQualityEventPerspectiveProjector(dbPath);
    expect(projector.getEventDetail({
      viewerUserId: "quality-admin-local",
      testActorRef: "manager-1",
      eventId: "event-1",
    })).toBeNull();
    expect(projector.getEventDetail({
      viewerUserId: "quality-admin-local",
      testActorRef: "employee-1",
      eventId: "event-1",
    })).toBeNull();
    projector.close();
  });

  it("keeps link-only formal projections isolated to the linked quality event", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare("DELETE FROM quality_analysis_handoffs WHERE event_id='event-1'").run();
    setup.prepare(`INSERT INTO quality_events(
      id,event_no,status,title,problem_status,created_by,version,created_at,updated_at
    ) VALUES('event-2','QE-PROJECTION-002','IN_PROGRESS','另一质量事件',
      '验证任务关联不会跨事件泄漏','quality-user',1,?,?)`).run(NOW, NOW);
    setup.prepare(`INSERT INTO quality_assignment_nodes(
      node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
      department_name,is_primary,status,due_at,requirement,version,created_by,
      request_id,accepted_at,submitted_at,created_at,updated_at
    ) VALUES('event-2-node','event-2',NULL,0,'employee-1','EMPLOYEE',
      '研发中心',0,'IN_PROGRESS','2026-09-30T08:00:00.000Z','完成另一事件核验',
      1,'manager-1','event-2-node-request',?,NULL,?,?)`).run(NOW, NOW, NOW);
    setup.prepare(`INSERT INTO quality_task_links(
      node_id,task_id,subtask_id,integration_key,created_at
    ) VALUES('event-2-node','task:plan-1','subtask-1','quality-node:event-2-node',?)`)
      .run(NOW);
    setup.close();

    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })).toEqual([]);
    expect(listQualityFormalSubtasks({ eventId: "event-2", dbPath })).toEqual([
      expect.objectContaining({
        eventId: "event-2",
        eventNo: "QE-PROJECTION-002",
        taskId: "task:plan-1",
        subtaskId: "subtask-1",
      }),
    ]);
  });

  it("merges partial task links with a handoff without duplicating a formal subtask", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`INSERT INTO subtasks(
      subtask_id,task_id,source_task_key,title,objective,assignee_user_id,status,due_at,
      created_at,updated_at
    ) VALUES('subtask-2','task:plan-1','task_2','完成复测验证','提交复测结论',
      'employee-2','ASSIGNED','2026-09-30T08:00:00.000Z',?,?)`).run(NOW, NOW);
    setup.prepare(`INSERT INTO quality_assignment_nodes(
      node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
      department_name,is_primary,status,due_at,requirement,version,created_by,
      request_id,accepted_at,submitted_at,created_at,updated_at
    ) VALUES('partially-linked-node','event-1',NULL,0,'employee-1','EMPLOYEE',
      '研发中心',0,'PENDING_ACCEPTANCE','2026-09-30T08:00:00.000Z','完成问题核验',
      1,'manager-1','partial-link-request',NULL,NULL,?,?)`).run(NOW, NOW);
    setup.prepare(`INSERT INTO quality_task_links(
      node_id,task_id,subtask_id,integration_key,created_at
    ) VALUES('partially-linked-node','task:plan-1','subtask-1',
      'quality-node:partially-linked-node',?)`).run(NOW);
    setup.close();

    const projected = listQualityFormalSubtasks({ eventId: "event-1", dbPath });
    expect(projected.map((item) => item.subtaskId)).toEqual(["subtask-1", "subtask-2"]);
    expect(new Set(projected.map((item) => item.subtaskId)).size).toBe(2);
    expect(projected.find((item) => item.subtaskId === "subtask-1")?.integrationKey)
      .toBe("quality-node:partially-linked-node");
    expect(projected.find((item) => item.subtaskId === "subtask-2")?.integrationKey)
      .toBe("quality-node:event-1");
  });

  it("advances a formal-task event only after every employee node is approved", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`INSERT INTO subtasks(
      subtask_id,task_id,source_task_key,title,objective,assignee_user_id,status,due_at,
      created_at,updated_at
    ) VALUES('subtask-2','task:plan-1','task_2','完成复测验证','提交复测结论',
      'employee-2','ASSIGNED','2026-09-30T08:00:00.000Z',?,?)`).run(NOW, NOW);
    setup.close();

    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });

    const ready = new DatabaseSync(dbPath);
    ready.prepare("UPDATE quality_events SET status='IN_PROGRESS' WHERE id='event-1'").run();
    ready.prepare("UPDATE subtasks SET status='DONE',completed_at=?,updated_at=? WHERE task_id='task:plan-1'")
      .run(NOW, NOW);
    ready.prepare(`UPDATE quality_assignment_nodes
      SET status='PENDING_PARENT_REVIEW',submitted_at=?,updated_at=?
      WHERE event_id='event-1' AND is_primary=0`).run(NOW, NOW);
    const children = ready.prepare(`SELECT n.node_id,n.version,l.subtask_id
      FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id
      WHERE n.event_id='event-1'
      ORDER BY l.subtask_id`).all() as Array<{
        node_id: string;
        version: number;
        subtask_id: string;
      }>;
    ready.close();
    expect(children.map((item) => item.subtask_id)).toEqual(["subtask-1", "subtask-2"]);

    const review = createQualityReviewService({ dbPath, now: () => NOW });
    review.reviewDirectChild({
      childNodeId: children[0]!.node_id,
      actorUserId: "manager-1",
      decision: "APPROVE",
      expectedVersion: children[0]!.version,
      requestId: "00000000-0000-4000-8000-000000000021",
    });
    expect(review.getEvent("event-1").status).toBe("IN_PROGRESS");

    review.reviewDirectChild({
      childNodeId: children[1]!.node_id,
      actorUserId: "manager-1",
      decision: "APPROVE",
      expectedVersion: children[1]!.version,
      requestId: "00000000-0000-4000-8000-000000000022",
    });
    expect(review.getEvent("event-1").status).toBe("PENDING_PRIMARY_REVIEW");
    review.close();
  });

  it("reuses an existing accepted manager root when formal task publication happens later", () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`INSERT INTO quality_assignment_nodes(
      node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,
      is_primary,status,due_at,requirement,version,created_by,request_id,accepted_at,
      submitted_at,created_at,updated_at
    ) VALUES('legacy-manager-root','event-1',NULL,0,'manager-1','MANAGER','研发中心',
      1,'IN_PROGRESS','2026-09-30T08:00:00.000Z','主管已承接',1,'quality-user',
      'legacy-manager-root-request',?,NULL,?,?)`).run(NOW, NOW, NOW);
    setup.prepare("UPDATE quality_events SET primary_node_id='legacy-manager-root' WHERE id='event-1'").run();
    setup.close();

    expect(reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    })).toEqual({ matched: true, eventStatusChanged: true });

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare("SELECT primary_node_id FROM quality_events WHERE id='event-1'").get())
      .toEqual({ primary_node_id: "legacy-manager-root" });
    expect(verify.prepare(`SELECT parent_node_id,status FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id WHERE l.subtask_id='subtask-1'`).get())
      .toEqual({ parent_node_id: "legacy-manager-root", status: "PENDING_ACCEPTANCE" });
    verify.close();
  });

  it("reads employee status and context from the original formal subtask only", () => {
    const assigned = listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-1", dbPath });
    expect(assigned).toEqual([expect.objectContaining({
      eventId: "event-1",
      taskNo: "TASK-001",
      subtaskId: "subtask-1",
      status: "ASSIGNED",
      deliverables: "原因分析报告",
      completionCriteria: "包含复现记录、根因和验证结果",
      progressNote: "已完成现场信息收集",
      updatedAt: NOW,
    })]);
    expect(qualityEmployeeTaskStage(assigned[0]!.status)).toBe("ASSIGNED");
    expect(listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-2", dbPath }))
      .toEqual([]);

    const context = getQualityPlanningContextsBySubtaskIds(["subtask-1"], "employee-1", dbPath)
      .get("subtask-1");
    expect(context).toMatchObject({
      source: "quality_planning_handoff",
      eventNo: "QE-PROJECTION-001",
      taskNo: "TASK-001",
      status: "ASSIGNED",
      requiresEvidence: false,
      taskUrl: "/workbench/employee/task?taskNo=TASK-001&fromView=new",
    });

    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE subtasks SET status='IN_PROGRESS' WHERE subtask_id='subtask-1'").run();
    db.close();
    const active = listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-1", dbPath });
    expect(qualityEmployeeTaskStage(active[0]!.status)).toBe("ACTIVE");

    const waitingDb = new DatabaseSync(dbPath);
    waitingDb.prepare("UPDATE subtasks SET status='ASSIGNED' WHERE subtask_id='subtask-1'").run();
    waitingDb.prepare(`INSERT INTO task_events(
      task_id,subtask_id,event_type,actor_user_id,note,occurred_at
    ) VALUES('task:plan-1','subtask-1','SUBTASK_CHANGES_REQUESTED','employee-1','需要调整截止时间',?)`).run(NOW);
    waitingDb.close();
    const waiting = listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-1", dbPath });
    expect(waiting[0]?.openDeclineKind).toBe("changes");
    expect(waiting[0]?.openDeclineReason).toBe("需要调整截止时间");
    expect(qualityEmployeeTaskStage(waiting[0]!.status, waiting[0]!.openDeclineKind))
      .toBe("WAITING_MANAGER");
    expect(getQualityPlanningContextsBySubtaskIds(["subtask-1"], "employee-1", dbPath)
      .get("subtask-1")?.taskUrl).toContain("fromView=new");
  });

  it("migrates the old one-task-per-node link constraint for a shared formal task", () => {
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      PRAGMA foreign_keys=OFF;
      DROP TABLE quality_task_links;
      CREATE TABLE quality_task_links (
        node_id TEXT PRIMARY KEY REFERENCES quality_assignment_nodes(node_id),
        task_id TEXT NOT NULL UNIQUE,
        subtask_id TEXT NOT NULL UNIQUE,
        integration_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    createQualityStore(dbPath).close();
    const migrated = new DatabaseSync(dbPath, { readOnly: true });
    const uniqueColumns = (migrated.prepare("PRAGMA index_list(quality_task_links)").all() as Array<{
      name: string;
      unique: number;
    }>).filter((index) => index.unique === 1).map((index) =>
      (migrated.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{ name: string }>)
        .map((column) => column.name).join(","),
    );
    migrated.close();
    expect(uniqueColumns).not.toContain("task_id");
    expect(uniqueColumns).toEqual(expect.arrayContaining(["node_id", "subtask_id", "integration_key"]));
  });

  it("keeps the employee accept and completion state in the formal subtask, then records manager review", async () => {
    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });
    const readNode = () => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        return db.prepare(`SELECT n.node_id,n.version,n.status
          FROM quality_assignment_nodes n
          JOIN quality_task_links l ON l.node_id=n.node_id
          WHERE l.subtask_id='subtask-1'`).get() as { node_id: string; version: number; status: string };
      } finally {
        db.close();
      }
    };

    const assignment = createQualityAssignmentService({ dbPath, now: () => NOW });
    const beforeAccept = readNode();
    const accepted = await assignment.acceptNode({
      nodeId: beforeAccept.node_id,
      actorUserId: "employee-1",
      expectedVersion: beforeAccept.version,
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    assignment.close();
    expect(accepted.node.status).toBe("IN_PROGRESS");

    let verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "IN_PROGRESS" });
    expect(verify.prepare("SELECT status FROM quality_events WHERE id='event-1'").get())
      .toEqual({ status: "IN_PROGRESS" });
    verify.close();

    const evidence = createQualityEvidenceService({
      dbPath,
      rootDir: join(tempDir, "evidence"),
      now: () => NOW,
    });
    evidence.uploadEvidence({
      nodeId: beforeAccept.node_id,
      actorUserId: "employee-1",
      originalName: "verification.txt",
      mimeType: "text/plain",
      summary: "已完成原因核验并附复测结论",
      buffer: Buffer.from("verified"),
      requestId: "00000000-0000-4000-8000-000000000002",
    });
    const completed = evidence.submitCompletion({
      nodeId: beforeAccept.node_id,
      actorUserId: "employee-1",
      expectedVersion: accepted.node.version,
      requestId: "00000000-0000-4000-8000-000000000003",
    });
    evidence.close();
    expect(completed.node.status).toBe("PENDING_PARENT_REVIEW");

    verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "DONE" });
    verify.close();

    expect(getManagerQualityReviewContextsBySubtaskIds(
      ["subtask-1"],
      "manager-1",
      dbPath,
    ).get("subtask-1")).toMatchObject({
      taskId: "task:plan-1",
      taskNo: "TASK-001",
      eventId: "event-1",
      eventNo: "QE-PROJECTION-001",
      nodeStatus: "PENDING_PARENT_REVIEW",
      canReview: true,
      reviewDecision: null,
      evidence: [expect.objectContaining({
        originalName: "verification.txt",
        summary: "已完成原因核验并附复测结论",
      })],
    });
    expect(getManagerQualityReviewContextsBySubtaskIds(
      ["subtask-1"],
      "another-manager",
      dbPath,
    ).size).toBe(0);

    const review = createQualityReviewService({ dbPath, now: () => NOW });
    const approved = review.reviewDirectChild({
      childNodeId: beforeAccept.node_id,
      actorUserId: "manager-1",
      decision: "APPROVE",
      expectedVersion: completed.node.version,
      requestId: "00000000-0000-4000-8000-000000000004",
    });
    review.close();
    expect(approved.status).toBe("APPROVED");
    expect(getManagerQualityReviewContextsBySubtaskIds(
      ["subtask-1"],
      "manager-1",
      dbPath,
    ).get("subtask-1")).toMatchObject({
      canReview: false,
      reviewDecision: "APPROVE",
    });

    verify = new DatabaseSync(dbPath, { readOnly: true });
    const primary = verify.prepare(`SELECT node_id,version FROM quality_assignment_nodes
      WHERE event_id='event-1' AND is_primary=1`).get() as { node_id: string; version: number };
    verify.close();
    const aggregate = createQualityEvidenceService({
      dbPath,
      rootDir: join(tempDir, "evidence"),
      now: () => NOW,
    });
    const aggregated = aggregate.submitCompletion({
      nodeId: primary.node_id,
      actorUserId: "manager-1",
      expectedVersion: primary.version,
      requestId: "00000000-0000-4000-8000-000000000005",
    });
    aggregate.close();
    expect(aggregated.node.status).toBe("PENDING_PARENT_REVIEW");

    verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare(`SELECT decision,reviewer_user_id FROM quality_node_reviews
      WHERE node_id=?`).get(beforeAccept.node_id)).toEqual({
      decision: "APPROVE",
      reviewer_user_id: "manager-1",
    });
    expect(verify.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "DONE" });
    expect(verify.prepare("SELECT status FROM quality_events WHERE id='event-1'").get())
      .toEqual({ status: "PENDING_PRIMARY_REVIEW" });
    verify.close();
  });

  it("syncs an admin-operated linked test acceptance into the formal task and test audit", async () => {
    const setup = new DatabaseSync(dbPath);
    setup.prepare(`UPDATE quality_events SET is_test=1,created_by='QUALITY_TEST_SPECIALIST_001'
      WHERE id='event-1'`).run();
    setup.prepare(`UPDATE quality_analysis_handoffs
      SET primary_manager_user_id='QUALITY_TEST_MANAGER_001' WHERE event_id='event-1'`).run();
    setup.prepare(`UPDATE tasks SET manager_user_id='QUALITY_TEST_MANAGER_001'
      WHERE task_id='task:plan-1'`).run();
    setup.prepare(`UPDATE subtasks SET assignee_user_id='QUALITY_TEST_EMPLOYEE_001'
      WHERE subtask_id='subtask-1'`).run();
    setup.close();

    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "QUALITY_TEST_MANAGER_001",
      publishedAt: NOW,
      dbPath,
    });

    const before = new DatabaseSync(dbPath, { readOnly: true });
    const node = before.prepare(`SELECT n.node_id,n.version
      FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id
      WHERE l.subtask_id='subtask-1'`).get() as { node_id: string; version: number };
    before.close();

    const assignment = createQualityAssignmentService({ dbPath, now: () => NOW });
    const accepted = await assignment.acceptNode({
      nodeId: node.node_id,
      actorUserId: "QUALITY_TEST_EMPLOYEE_001",
      actualAdminUserId: "quality-admin-local",
      expectedVersion: node.version,
      requestId: "00000000-0000-4000-8000-000000000091",
    });
    assignment.close();
    expect(accepted.node.status).toBe("IN_PROGRESS");

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "IN_PROGRESS" });
    expect(verify.prepare("SELECT status FROM tasks WHERE task_id='task:plan-1'").get())
      .toEqual({ status: "IN_PROGRESS" });
    expect(verify.prepare(`SELECT status,accepted_at FROM quality_assignment_nodes
      WHERE node_id=?`).get(node.node_id)).toEqual({ status: "IN_PROGRESS", accepted_at: NOW });
    const acceptedEvent = verify.prepare(`SELECT event_type,actor_user_id,occurred_at FROM task_events
      WHERE subtask_id='subtask-1' AND event_type='SUBTASK_ACCEPTED'`).get() as {
      event_type: string;
      actor_user_id: string;
      occurred_at: string;
    };
    expect(acceptedEvent).toMatchObject({
      event_type: "SUBTASK_ACCEPTED",
      actor_user_id: "QUALITY_TEST_EMPLOYEE_001",
    });
    expect(Number.isFinite(Date.parse(acceptedEvent.occurred_at))).toBe(true);
    expect(verify.prepare(`SELECT test_actor_user_id,actual_admin_user_id,action
      FROM quality_test_action_audit WHERE event_id='event-1'`).get()).toEqual({
      test_actor_user_id: "QUALITY_TEST_EMPLOYEE_001",
      actual_admin_user_id: "quality-admin-local",
      action: "QUALITY_NODE_ACCEPTED",
    });
    verify.close();

    expect(listQualityFormalSubtasks({ eventId: "event-1", dbPath })[0]).toMatchObject({
      status: "IN_PROGRESS",
      acceptedAt: acceptedEvent.occurred_at,
    });

    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "quality-admin-local");
    const projector = createQualityEventPerspectiveProjector(dbPath);
    const tong = projector.getEventDetail({
      eventId: "event-1",
      viewerUserId: "quality-admin-local",
      testActorRef: "quality-management",
    });
    expect(tong?.viewModel).toMatchObject({
      perspective: "quality_management",
      formalTaskProjection: true,
      qualityAssignmentItems: [expect.objectContaining({
        assigneeName: "测试员工1",
        itemTitle: "完成问题核验",
        statusLabel: "执行中",
        acceptedAt: acceptedEvent.occurred_at,
        taskNo: "TASK-001",
      })],
    });
    projector.close();
  });

  it("returns a quality-linked formal subtask to employee execution with the review reason", () => {
    reconcileQualityPlanningPublication({
      eventId: "event-1",
      integrationKey: "quality-node:event-1",
      planId: "plan-1",
      formalTaskId: "task:plan-1",
      actorUserId: "manager-1",
      publishedAt: NOW,
      dbPath,
    });
    const setup = new DatabaseSync(dbPath);
    const child = setup.prepare(`SELECT n.node_id,n.version
      FROM quality_assignment_nodes n
      JOIN quality_task_links l ON l.node_id=n.node_id
      WHERE l.subtask_id='subtask-1'`).get() as { node_id: string; version: number };
    setup.prepare(`UPDATE quality_assignment_nodes
      SET status='PENDING_PARENT_REVIEW',submitted_at=?,updated_at=? WHERE node_id=?`)
      .run(NOW, NOW, child.node_id);
    setup.prepare("UPDATE subtasks SET status='DONE',completed_at=?,updated_at=? WHERE subtask_id='subtask-1'")
      .run(NOW, NOW);
    setup.prepare(`INSERT INTO quality_evidence(
      evidence_id,event_id,node_id,evidence_version,storage_key,original_name,mime_type,
      summary,size_bytes,sha256,uploaded_by,request_id,created_at
    ) VALUES('return-evidence','event-1',?,1,'return/evidence.txt','复测记录.txt','text/plain',
      '证据待补充',8,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'employee-1','return-evidence-request',?)`).run(child.node_id, NOW);
    setup.close();

    const review = createQualityReviewService({ dbPath, now: () => NOW });
    const returned = review.reviewDirectChild({
      childNodeId: child.node_id,
      actorUserId: "manager-1",
      decision: "RETURN",
      reason: "复测过程缺少原始日志，请补充后重新提交",
      expectedVersion: child.version,
      requestId: "00000000-0000-4000-8000-000000000011",
    });
    review.close();
    expect(returned.status).toBe("RETURNED");

    const verify = new DatabaseSync(dbPath, { readOnly: true });
    expect(verify.prepare("SELECT status FROM subtasks WHERE subtask_id='subtask-1'").get())
      .toEqual({ status: "IN_PROGRESS" });
    expect(verify.prepare(`SELECT decision,reason FROM quality_node_reviews
      WHERE node_id=? ORDER BY created_at DESC LIMIT 1`).get(child.node_id)).toEqual({
      decision: "RETURN",
      reason: "复测过程缺少原始日志，请补充后重新提交",
    });
    expect(verify.prepare(`SELECT event_type,note FROM task_events
      WHERE subtask_id='subtask-1' ORDER BY id DESC LIMIT 1`).get()).toEqual({
      event_type: "SUBTASK_PROGRESS",
      note: "质量证据被直接上级退回：复测过程缺少原始日志，请补充后重新提交",
    });
    verify.close();
  });
});
