import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../src/infra/plan-session-store";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityPlanningService } from "../../src/quality/planning/quality-planning-service";
import { createQualityEventQuery } from "../../src/quality/queries/quality-event-query";

describe("quality planning v2", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quality-planning-v2-"));
    dbPath = join(tempDir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-user");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "");
    createWorkbenchFormalTaskStore().close();
    const quality = createQualityStore(dbPath, {
      now: () => "2026-08-25T08:00:00.000Z",
      id: () => "audit-id",
    });
    quality.createDraft({
      eventId: "event-1",
      eventNo: "QE-20260825-001",
      actorUserId: "manager-1",
      actorRole: "aftersales_manager",
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "导管批次异常",
      problemStatus: "同批次出现阻力异常，需要完成排查和纠正措施验证。",
    });
    quality.close();
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE quality_events SET status='PENDING_ASSIGNMENT',version=2,submitted_by='manager-1',submitted_at=? WHERE id='event-1'`)
      .run("2026-08-25T08:05:00.000Z");
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("versions analysis, creates a dedicated handoff, and binds one formal task idempotently", () => {
    const service = createQualityPlanningService({
      dbPath,
      now: () => "2026-08-25T09:00:00.000Z",
      id: (() => { let n = 0; return () => `quality-id-${++n}`; })(),
    });
    const draft = service.saveAnalysisDraft({
      eventId: "event-1",
      actorUserId: "quality-user",
      expectedEventVersion: 2,
      fields: {
        problemDirection: "制造过程",
        confirmedCategory: "批次一致性",
        sourceSummary: "同批次两次出现阻力异常",
        analysisBasis: "来源记录和批次信息一致",
        initialConclusion: "需要隔离批次并复核工艺",
        informationGaps: "缺少留样复测数据",
        suggestedDepartment: "质量部 / 制造部",
        processingRequirements: "隔离涉事批次并完成清点\n复核生产记录并提交根因分析\n完成纠正措施验证",
        suggestedDueAt: "2026-08-30T10:00:00.000Z",
      },
    });
    const completed = service.completeAnalysis({
      eventId: "event-1",
      analysisId: draft.analysisId,
      actorUserId: "quality-user",
    });
    expect(completed.status).toBe("COMPLETED");

    let createdSession: PlanSession | undefined;
    const planningResult = service.createOrResumePlanningSession({
      eventId: "event-1",
      managerUserId: "manager-1",
      expectedEventVersion: 2,
      requestId: "22222222-2222-4222-8222-222222222222",
      createThread: (options) => {
        const session: PlanSession = {
          chatKeyHash: "quality-thread-hash",
          threadId: "quality-thread-1",
          threadKind: "side",
          threadLabel: options.threadLabel,
          planId: "quality-plan-1",
          senderStaffId: "manager-1",
          sourceContext: options.sourceContext,
          latestDraft: options.latestDraft,
          knownFacts: [],
          conversationHistory: [],
          createdAt: "2026-08-25T09:00:00.000Z",
          updatedAt: "2026-08-25T09:00:00.000Z",
        };
        createdSession = session;
        return session;
      },
      saveThread: (session) => { createdSession = session; },
    });
    expect(planningResult.created).toBe(true);
    expect(createdSession?.sourceContext?.kind).toBe("quality_event");
    expect((createdSession?.latestDraft as { tasks?: unknown[] }).tasks).toHaveLength(3);

    createdSession!.latestAssignment = {
      planId: "quality-plan-1",
      requireFullCoverage: true,
      assignments: [
        { taskId: "task_1", primary: { userId: "employee-1", displayName: "员工一" } },
        { taskId: "task_2", primary: { userId: "employee-2", displayName: "员工二" } },
        { taskId: "task_3", primary: { userId: "employee-1", displayName: "员工一" } },
      ],
    };
    const formal = createWorkbenchFormalTaskStore();
    const published = formal.publishFromSession({
      planId: "quality-plan-1",
      session: createdSession!,
      managerUserId: "manager-1",
      initiatorDepartment: "售后部",
      actorUserId: "manager-1",
    });
    formal.close();

    const firstBind = service.bindPublishedTask({
      session: createdSession!,
      publishResult: { ok: true, task: published.task, subtasks: published.subtasks },
    });
    const secondBind = service.bindPublishedTask({
      session: createdSession!,
      publishResult: { ok: true, task: published.task, subtasks: published.subtasks },
    });
    expect(firstBind).toMatchObject({ bound: true, bindingStatus: "BOUND", taskId: published.task.taskId });
    expect(secondBind).toMatchObject({ bound: true, bindingStatus: "BOUND" });
    expect(createdSession!.sourceContext!.bindingStatus).toBe("BOUND");
    service.close();

    const db = new DatabaseSync(dbPath);
    expect((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links WHERE task_id=?")
      .get(published.task.taskId) as { count: number }).count).toBe(4);
    expect((db.prepare("SELECT status FROM quality_events WHERE id='event-1'").get() as { status: string }).status)
      .toBe("PENDING_ACCEPTANCE");
    expect((db.prepare("SELECT binding_status FROM quality_planning_sessions WHERE event_id='event-1'").get() as { binding_status: string }).binding_status)
      .toBe("BOUND");
    const projectedSubtaskId = published.subtasks[0]!.subtaskId;
    db.prepare("UPDATE subtasks SET assignee_user_id='employee-reassigned',due_at='2026-08-29T12:00:00.000Z' WHERE subtask_id=?")
      .run(projectedSubtaskId);
    db.close();

    const query = createQualityEventQuery(dbPath);
    const detail = query.getEventDetail({ eventId: "event-1", viewerUserId: "quality-user" });
    expect(detail?.assignmentTree).toHaveLength(4);
    expect(detail?.assignmentTree.filter((node) => node.subtaskId)).toHaveLength(3);
    expect(detail?.assignmentTree.find((node) => node.subtaskId === projectedSubtaskId)).toMatchObject({
      assigneeUserId: "employee-reassigned",
      dueAt: "2026-08-29T12:00:00.000Z",
    });
    query.close();
  });

  it("migrates the legacy one-task-per-node link constraint without dropping rows", () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      PRAGMA foreign_keys=OFF;
      ALTER TABLE quality_task_links RENAME TO quality_task_links_current;
      CREATE TABLE quality_task_links (
        node_id TEXT PRIMARY KEY REFERENCES quality_assignment_nodes(node_id),
        task_id TEXT NOT NULL UNIQUE,
        subtask_id TEXT NOT NULL UNIQUE,
        integration_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      DROP TABLE quality_task_links_current;
      PRAGMA foreign_keys=ON;
    `);
    db.close();

    createQualityStore(dbPath).close();
    const migrated = new DatabaseSync(dbPath);
    const sql = String((migrated.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_task_links'")
      .get() as { sql: string }).sql);
    expect(sql).not.toMatch(/task_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    expect(sql).toMatch(/subtask_id\s+TEXT\s+UNIQUE/i);
    migrated.close();
  });

  it("keeps the production AI analysis table separate from quality initial-analysis versions", () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE quality_analysis_versions (
        analysis_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        analysis_version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO quality_analysis_versions(
        analysis_id,event_id,analysis_version,content_json,created_at
      ) VALUES('legacy-ai-1','event-1',7,'{"kind":"ai_snapshot"}','2026-08-25T07:00:00.000Z');
    `);
    db.close();

    createQualityStore(dbPath).close();
    const migrated = new DatabaseSync(dbPath);
    const legacyColumns = (migrated.prepare("PRAGMA table_info(quality_analysis_versions)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(legacyColumns).toContain("analysis_version");
    expect(legacyColumns).not.toContain("version");
    expect(migrated.prepare("SELECT content_json FROM quality_analysis_versions WHERE analysis_id='legacy-ai-1'").get())
      .toMatchObject({ content_json: '{"kind":"ai_snapshot"}' });
    expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quality_initial_analysis_versions'").get())
      .toMatchObject({ name: "quality_initial_analysis_versions" });
    migrated.close();
  });
});
