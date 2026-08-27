import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DingTalkContactRow } from "../../src/infra/people-directory-store";
import {
  QUALITY_SUPERVISOR_DEPARTMENTS,
  createQualitySupervisorDirectory,
} from "../../src/quality/assignments/quality-supervisor-directory";
import { reconcileQualityTaskBridges } from "../../src/quality/assignments/quality-bridge-reconciler";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityNotificationOutbox } from "../../src/quality/notifications/quality-notification-outbox";
import { createQualityNotificationScheduler } from "../../src/quality/notifications/quality-notification-scheduler";
import { createQualityEventPerspectiveProjector } from "../../src/quality/presentation/quality-event-perspective";
import { qualityStatusLabel } from "../../src/quality/presentation/quality-display-labels";
import { assertQualityActorBoundary } from "../../src/quality/testing/quality-test-boundary";

const dirs: string[] = [];
const NOW = "2026-08-27T08:00:00.000Z";

function temporaryDb(prefix = "quality-role-panels-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return join(dir, "workbench.sqlite");
}

function createEvent(dbPath: string, input: {
  id: string;
  eventNo: string;
  actorUserId: string;
  isTest?: boolean;
  status?: string;
}): void {
  const store = createQualityStore(dbPath, { now: () => NOW });
  store.createDraft({
    eventId: input.id,
    eventNo: input.eventNo,
    actorUserId: input.actorUserId,
    actorRole: "aftersales_manager",
    requestId: `request-create-${input.id}`,
    title: `事件 ${input.eventNo}`,
    problemStatus: "只展示业务事实，不展示原始快照。",
  });
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE quality_events SET is_test=?,status=?,version=2 WHERE id=?")
    .run(input.isTest ? 1 : 0, input.status ?? "PENDING_ASSIGNMENT", input.id);
  db.close();
}

function insertNode(dbPath: string, input: {
  eventId: string;
  nodeId: string;
  parentNodeId?: string;
  assigneeUserId: string;
  assigneeKind?: "MANAGER" | "EMPLOYEE";
  departmentName: string;
  status?: string;
}): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO quality_assignment_nodes(
      node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,
      department_name,is_primary,status,due_at,requirement,version,
      created_by,request_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,0,?,'2026-09-30T08:00:00.000Z','完成核验',1,?,?,?,?)
  `).run(
    input.nodeId,
    input.eventId,
    input.parentNodeId ?? null,
    input.parentNodeId ? 1 : 0,
    input.assigneeUserId,
    input.assigneeKind ?? "MANAGER",
    input.departmentName,
    input.status ?? "PENDING_ACCEPTANCE",
    "QUALITY_TEST_SPECIALIST_001",
    `request-node-${input.nodeId}`,
    NOW,
    NOW,
  );
  db.close();
}

function contact(input: Partial<DingTalkContactRow> & Pick<DingTalkContactRow, "userId" | "name">): DingTalkContactRow {
  return {
    userId: input.userId,
    name: input.name,
    departmentIds: input.departmentIds ?? ["dept-rd"],
    departmentNames: input.departmentNames ?? ["研发中心"],
    position: input.position,
    active: input.active ?? true,
    isAdmin: false,
    isBoss: false,
    isSenior: false,
    rawJson: input.rawJson ?? {},
    lastSyncedAt: NOW,
    deletedAt: input.deletedAt,
  };
}

beforeEach(() => {
  vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "aftersales-real");
  vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-real");
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("quality event scope migration", () => {
  it("adds is_test to an existing database and keeps old events real", () => {
    const dbPath = temporaryDb("quality-migration-");
    createEvent(dbPath, { id: "event-before-migration", eventNo: "QE-OLD-001", actorUserId: "aftersales-real" });
    const oldDb = new DatabaseSync(dbPath);
    oldDb.exec("DROP INDEX IF EXISTS idx_quality_events_scope_status_updated");
    oldDb.exec("ALTER TABLE quality_events DROP COLUMN is_test");
    oldDb.close();

    createQualityStore(dbPath).close();
    const migrated = new DatabaseSync(dbPath);
    const row = migrated.prepare("SELECT is_test FROM quality_events WHERE id='event-before-migration'")
      .get() as { is_test: number };
    const index = migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_quality_events_scope_status_updated'").get();
    migrated.close();

    expect(row.is_test).toBe(0);
    expect(index).toBeTruthy();
  });

  it("never reconciles test nodes into the formal task store", () => {
    const dbPath = temporaryDb("quality-test-bridge-");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    createEvent(dbPath, {
      id: "test-event",
      eventNo: "QT-NO-BRIDGE",
      actorUserId: "QUALITY_TEST_AFTERSALES_001",
      isTest: true,
      status: "PENDING_ACCEPTANCE",
    });
    insertNode(dbPath, {
      eventId: "test-event",
      nodeId: "test-node",
      assigneeUserId: "QUALITY_TEST_MANAGER_001",
      departmentName: "研发中心",
    });

    const result = reconcileQualityTaskBridges({ dbPath });
    const db = new DatabaseSync(dbPath);
    const taskTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    const tasks = taskTable
      ? Number((db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count)
      : 0;
    const links = Number((db.prepare("SELECT COUNT(*) AS count FROM quality_task_links").get() as { count: number }).count);
    db.close();
    expect(result.summary.total).toBe(0);
    expect(tasks).toBe(0);
    expect(links).toBe(0);
  });
});

describe("quality supervisor directory", () => {
  it("uses seven departments, confirmed leader markers and a stable Zhu Rui exclusion", () => {
    const route = {
      departments: QUALITY_SUPERVISOR_DEPARTMENTS.map((name) => ({
        name,
        departmentIds: name === "研发中心" ? ["dept-rd"] : [],
        departmentNames: [name],
      })),
      supplementalSupervisors: [],
      excludedUserIds: ["014517256544"],
    };
    const directory = createQualitySupervisorDirectory({
      contacts: [
        contact({ userId: "leader-1", name: "确认主管", rawJson: { dept_order_list: [{ dept_id: "dept-rd", leader: true }] } }),
        contact({ userId: "leader-top-level", name: "顶层标记主管", rawJson: { leader: true } }),
        contact({ userId: "title-only", name: "职位经理", position: "研发总监" }),
        contact({ userId: "014517256544", name: "姓名已变化", rawJson: { leader_in_dept: "[\"dept-rd\"]" } }),
        contact({ userId: "inactive", name: "停用主管", active: false, rawJson: { leader_in_dept: ["dept-rd"] } }),
        contact({ userId: "employee-rd", name: "研发员工" }),
        contact({ userId: "employee-quality", name: "质量员工", departmentIds: ["dept-quality"], departmentNames: ["质量部"] }),
      ],
      config: route,
    });

    const groups = directory.listGroups({ eventId: "event-1", isTest: false });
    const research = groups.find((item) => item.departmentName === "研发中心")!;
    expect(groups.map((item) => item.departmentName)).toEqual(QUALITY_SUPERVISOR_DEPARTMENTS);
    expect(research.supervisors.map((item) => item.displayName)).toEqual(["顶层标记主管", "确认主管"]);
    expect(JSON.stringify(groups)).not.toContain("leader-1");
    expect(() => directory.assertDepartmentEmployee({
      eventIsTest: false,
      managerDepartmentName: "研发中心",
      employeeUserId: "employee-quality",
    })).toThrow("只能向自己部门");
    expect(directory.assertDepartmentEmployee({
      eventIsTest: false,
      managerDepartmentName: "研发中心",
      employeeUserId: "employee-rd",
    }).name).toBe("研发员工");
    directory.close();
  });

  it("returns one test supervisor with all three test employees underneath", () => {
    const directory = createQualitySupervisorDirectory({ contacts: [] });
    const groups = directory.listGroups({ eventId: "test-event", isTest: true });
    const supervisors = groups.flatMap((item) => item.supervisors);
    expect(supervisors.map((item) => item.displayName)).toEqual(["测试主管"]);
    expect(supervisors.every((item) => item.candidateRef.startsWith("candidate:"))).toBe(true);
    expect(directory.assertDepartmentEmployee({
      eventIsTest: true,
      managerDepartmentName: "研发中心",
      employeeUserId: "QUALITY_TEST_EMPLOYEE_001",
    }).name).toBe("测试员工1");
    expect(directory.assertDepartmentEmployee({
      eventIsTest: true,
      managerDepartmentName: "研发中心",
      employeeUserId: "QUALITY_TEST_EMPLOYEE_003",
    }).name).toBe("测试员工3");
    expect(directory.listTestEmployees({ eventId: "test-event", departmentName: "研发中心" })
      .map((item) => item.displayName)).toEqual(["测试员工1", "测试员工2", "测试员工3"]);
    directory.close();
  });
});

describe("quality perspective projector", () => {
  it("never falls back to a raw unknown status or permits cross-scope actors", () => {
    expect(qualityStatusLabel("FUTURE_INTERNAL_STATE")).toBe("状态待确认");
    expect(qualityStatusLabel("FUTURE_INTERNAL_STATE")).not.toContain("FUTURE_INTERNAL_STATE");
    expect(() => assertQualityActorBoundary({
      event: { eventId: "test-event", isTest: true },
      actorUserId: "real-user",
    })).toThrow("测试事件只能由测试身份处理");
    expect(() => assertQualityActorBoundary({
      event: { eventId: "real-event", isTest: false },
      actorUserId: "QUALITY_TEST_SPECIALIST_001",
    })).toThrow("测试身份不能处理真实事件");
    expect(() => assertQualityActorBoundary({
      event: { eventId: "real-event", isTest: false },
      actorUserId: "QUALITY_TEST_EMPLOYEE_001",
    })).toThrow("测试身份不能处理真实事件");
  });

  it("hard-isolates real/test lists and omits assessment outside aftersales", () => {
    const dbPath = temporaryDb();
    createEvent(dbPath, { id: "real-event", eventNo: "QE-REAL-001", actorUserId: "aftersales-real" });
    createEvent(dbPath, {
      id: "test-event",
      eventNo: "QT-TEST-001",
      actorUserId: "QUALITY_TEST_AFTERSALES_001",
      isTest: true,
    });
    insertNode(dbPath, {
      eventId: "test-event",
      nodeId: "manager-one-node",
      assigneeUserId: "QUALITY_TEST_MANAGER_001",
      departmentName: "研发中心",
    });
    insertNode(dbPath, {
      eventId: "test-event",
      nodeId: "manager-one-child",
      parentNodeId: "manager-one-node",
      assigneeUserId: "QUALITY_TEST_EMPLOYEE_001",
      assigneeKind: "EMPLOYEE",
      departmentName: "研发中心",
    });
    insertNode(dbPath, {
      eventId: "test-event",
      nodeId: "manager-one-child-three",
      parentNodeId: "manager-one-node",
      assigneeUserId: "QUALITY_TEST_EMPLOYEE_003",
      assigneeKind: "EMPLOYEE",
      departmentName: "研发中心",
    });
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE quality_events SET status='PENDING_ACCEPTANCE' WHERE id='test-event'").run();
    db.prepare(`INSERT INTO quality_audit_events(
      id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
    ) VALUES('audit-unknown','test-event','QUALITY_TEST_MANAGER_001','manager','RAW_INTERNAL_ACTION',NULL,NULL,NULL,'request-audit',?)`).run(NOW);
    db.close();

    const projector = createQualityEventPerspectiveProjector(dbPath);
    const real = projector.listEvents({ viewerUserId: "admin-1", perspective: "dashboard" });
    const test = projector.listEvents({ viewerUserId: "admin-1", testActorRef: "aftersales" });
    expect(real.events.map((item) => item.eventNumber)).toEqual(["QE-REAL-001"]);
    expect(test.events.map((item) => item.eventNumber)).toEqual(["QT-TEST-001"]);

    const aftersales = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "aftersales",
      eventId: "test-event",
    })!;
    const specialist = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "quality-management",
      eventId: "test-event",
    })!;
    const manager = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "manager-1",
      eventId: "test-event",
    })!;
    const employee = projector.getEventDetail({
      viewerUserId: "admin-1",
      testActorRef: "employee-1",
      eventId: "test-event",
    })!;
    expect(aftersales.viewModel).toHaveProperty("assessment");
    expect(aftersales.viewModel).toMatchObject({
      allowedActions: ["update-aftersales"],
      event: { attentionBucket: "PROGRESS", attentionLabel: "处理中" },
    });
    expect(JSON.parse(JSON.stringify(specialist.viewModel))).not.toHaveProperty("assessment");
    expect(JSON.parse(JSON.stringify(manager.viewModel))).not.toHaveProperty("assessment");
    expect((manager.viewModel.branch as Array<{ actionRef: string }>).map((item) => item.actionRef))
      .toEqual(["manager-one-node", "manager-one-child", "manager-one-child-three"]);
    expect(manager.viewModel).toMatchObject({
      event: { attentionBucket: "TODO", attentionLabel: "待我处理" },
    });
    expect(JSON.stringify(manager.viewModel)).not.toContain("RAW_INTERNAL_ACTION");
    expect(JSON.stringify(manager.viewModel)).toContain("业务记录已更新");
    expect((employee.viewModel.branch as Array<{ actionRef: string }>).map((item) => item.actionRef))
      .toEqual(["manager-one-child"]);
    expect(JSON.stringify(employee.viewModel)).not.toContain("manager-one-node");
    projector.close();
  });
});

describe("quality notification hard boundary", () => {
  it("rejects every real/test recipient crossover before enqueue", () => {
    const dbPath = temporaryDb("quality-notification-boundary-");
    createEvent(dbPath, { id: "real-event", eventNo: "QE-NOTIFY-1", actorUserId: "aftersales-real" });
    createEvent(dbPath, { id: "test-event", eventNo: "QT-NOTIFY-1", actorUserId: "QUALITY_TEST_AFTERSALES_001", isTest: true });
    const outbox = createQualityNotificationOutbox({ dbPath });
    const base = { action: "ASSIGNED", subject: "主题", markdown: "内容", detailUrl: "/quality", dedupeKey: "one" };
    expect(() => outbox.enqueue({ ...base, eventId: "test-event", recipientUserId: "real-user" }))
      .toThrow("测试事件通知已被安全阻断");
    expect(() => outbox.enqueue({ ...base, eventId: "real-event", recipientUserId: "QUALITY_TEST_MANAGER_001", dedupeKey: "two" }))
      .toThrow("真实事件不能通知测试身份");
    expect(outbox.enqueue({ ...base, eventId: "test-event", recipientUserId: "QUALITY_TEST_MANAGER_001", dedupeKey: "three" }).channel)
      .toBe("TEST");
    outbox.close();
  });

  it("never invokes DingTalk for test notifications and security-blocks corrupted rows without retry", async () => {
    const dbPath = temporaryDb("quality-notification-scheduler-");
    createEvent(dbPath, { id: "test-event", eventNo: "QT-NOTIFY-2", actorUserId: "QUALITY_TEST_AFTERSALES_001", isTest: true });
    const outbox = createQualityNotificationOutbox({ dbPath, now: () => new Date(NOW) });
    outbox.enqueue({
      eventId: "test-event",
      action: "ASSIGNED",
      recipientUserId: "QUALITY_TEST_MANAGER_001",
      subject: "测试通知",
      markdown: "模拟内容",
      detailUrl: "/quality",
      dedupeKey: "valid-test",
    });
    for (const [index, recipientUserId] of [
      "QUALITY_TEST_EMPLOYEE_001",
      "QUALITY_TEST_EMPLOYEE_002",
      "QUALITY_TEST_EMPLOYEE_003",
    ].entries()) {
      outbox.enqueue({
        eventId: "test-event",
        action: "DELEGATED",
        recipientUserId,
        subject: "测试通知",
        markdown: "模拟内容",
        detailUrl: "/quality",
        dedupeKey: `valid-test-employee-${index + 1}`,
      });
    }
    outbox.close();
    const db = new DatabaseSync(dbPath);
    db.prepare(`INSERT INTO quality_notification_outbox(
      notification_id,event_id,action,recipient_user_id,channel,subject,markdown,
      detail_url,dedupe_key,status,attempt_count,next_attempt_at,created_at,updated_at
    ) VALUES('corrupt','test-event','ASSIGNED','real-user','DINGTALK','错误配置','内容',
      '/quality','corrupt-test','PENDING',0,?,?,?)`).run(NOW, NOW, NOW);
    db.close();

    const notifyQualityAction = vi.fn();
    const scheduler = createQualityNotificationScheduler({
      dbPath,
      now: () => new Date(NOW),
      notifier: { notifyQualityAction } as never,
    });
    const result = await scheduler.sendPending();
    scheduler.close();
    expect(result).toEqual({ processed: 5, sent: 4, failed: 1 });
    expect(notifyQualityAction).not.toHaveBeenCalled();
    const verify = new DatabaseSync(dbPath);
    const corrupt = verify.prepare("SELECT status,attempt_count,last_error FROM quality_notification_outbox WHERE notification_id='corrupt'")
      .get() as { status: string; attempt_count: number; last_error: string };
    verify.close();
    expect(corrupt).toEqual({ status: "DEAD", attempt_count: 1, last_error: "测试通知已被安全阻断" });
    const retry = createQualityNotificationOutbox({ dbPath, now: () => new Date(NOW) });
    expect(() => retry.retryDead("corrupt", {
      actorUserId: "QUALITY_TEST_SPECIALIST_001",
      requestId: "77777777-7777-4777-8777-777777777777",
    })).toThrow("测试通知不能人工重新发送");
    retry.close();
    expect(notifyQualityAction).not.toHaveBeenCalled();
  });

  it("keeps the existing real notification path when both UI flags are off", async () => {
    vi.stubEnv("QUALITY_EVENT_ROLE_PANELS_ENABLED", "0");
    vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED", "0");
    const dbPath = temporaryDb("quality-notification-real-");
    createEvent(dbPath, { id: "real-event", eventNo: "QE-NOTIFY-REAL", actorUserId: "aftersales-real" });
    const outbox = createQualityNotificationOutbox({ dbPath, now: () => new Date(NOW) });
    outbox.enqueue({
      eventId: "real-event",
      action: "ASSIGNED",
      recipientUserId: "real-manager",
      subject: "真实通知",
      markdown: "真实业务内容",
      detailUrl: "/quality",
      dedupeKey: "real-notification",
    });
    outbox.close();
    const notifyQualityAction = vi.fn().mockResolvedValue({
      enabled: true,
      success: [{ userId: "real-manager" }],
      failed: [],
    });
    const scheduler = createQualityNotificationScheduler({
      dbPath,
      now: () => new Date(NOW),
      notifier: { notifyQualityAction } as never,
    });
    expect(await scheduler.sendPending()).toEqual({ processed: 1, sent: 1, failed: 0 });
    scheduler.close();
    expect(notifyQualityAction).toHaveBeenCalledOnce();
  });
});
