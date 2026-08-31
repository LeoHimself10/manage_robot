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
import { getQualityContextBySubtaskIds } from "../../src/quality/assignments/quality-task-context";
import { createQualityAssignmentService } from "../../src/quality/assignments/quality-assignment-service";
import { createQualityEvidenceService } from "../../src/quality/evidence/quality-evidence-service";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityReviewService } from "../../src/quality/reviews/quality-review-service";

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
      subtask_id,task_id,source_task_key,title,objective,assignee_user_id,status,due_at,
      created_at,updated_at
    ) VALUES('subtask-1','task:plan-1','task_1','完成问题核验','提交原因和验证结论',
      'employee-1','ASSIGNED','2026-09-30T08:00:00.000Z',?,?)`).run(NOW, NOW);
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

  it("reads employee status and context from the original formal subtask only", () => {
    const assigned = listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-1", dbPath });
    expect(assigned).toEqual([expect.objectContaining({
      eventId: "event-1",
      taskNo: "TASK-001",
      subtaskId: "subtask-1",
      status: "ASSIGNED",
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
      task_id,subtask_id,event_type,actor_user_id,occurred_at
    ) VALUES('task:plan-1','subtask-1','SUBTASK_CHANGES_REQUESTED','employee-1',?)`).run(NOW);
    waitingDb.close();
    const waiting = listQualityFormalSubtasks({ eventId: "event-1", assigneeUserId: "employee-1", dbPath });
    expect(waiting[0]?.openDeclineKind).toBe("changes");
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
});
