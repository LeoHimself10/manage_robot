import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../src/infra/plan-session-store";
import { listPlanSessions } from "../../src/web/loaders";
import {
  createWorkbenchService,
  mapPlanStatusToWorkbenchStage,
} from "../../src/web/workbench-service";

describe("workbench-service", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it.each([
    ["DRAFT_READY", "DRAFT"],
    ["ASSIGNMENT_RECOMMENDING", "ASSIGNMENT"],
    ["AWAITING_DISPATCH_CONFIRM", "ASSIGNMENT"],
    ["DISPATCHED", "DISPATCHED"],
    ["NEGOTIATING", "EXECUTION"],
    ["IN_EXECUTION", "EXECUTION"],
    ["IN_ACCEPTANCE", "ACCEPTANCE"],
    ["DONE", "DONE"],
  ])("maps plan status %s to workbench stage %s", (status, expected) => {
    expect(mapPlanStatusToWorkbenchStage(status)).toBe(expected);
  });

  it("warns before falling back for an unknown plan status", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(mapPlanStatusToWorkbenchStage("UNKNOWN_STATUS")).toBe("DONE");
    expect(warn).toHaveBeenCalledWith(
      "Unknown plan status mapped to DONE workbench stage",
      { status: "UNKNOWN_STATUS" },
    );
  });

  it("returns manager-visible tasks with filters", () => {
    const service = createWorkbenchService({
      loadPlanSessions: () => sampleSessions(),
    });

    const tasks = service.listTasks(
      { role: "manager", userId: "manager-1" },
      { keyword: "客诉", stage: "EXECUTION", ownerUserId: "emp-1" },
    );

    expect(tasks).toEqual([
      expect.objectContaining({
        planId: "plan-customer-complaint",
        title: "客诉根因分析",
        stage: "EXECUTION",
        ownerUserId: "emp-1",
      }),
    ]);
  });

  it("restricts employee tasks and details to assignee scope", () => {
    const service = createWorkbenchService({
      loadPlanSessions: () => sampleSessions(),
    });

    const emp1Tasks = service.listTasks(
      { role: "employee", userId: "emp-1" },
      {},
    );
    const emp2Detail = service.getTaskDetail("plan-customer-complaint", {
      role: "employee",
      userId: "emp-2",
    });

    expect(emp1Tasks.map((task) => task.planId)).toEqual([
      "plan-customer-complaint",
    ]);
    expect(emp1Tasks.every((task) => task.ownerUserId === "emp-1")).toBe(true);
    expect(
      service.getTaskDetail("plan-unassigned", {
        role: "employee",
        userId: "emp-1",
      }),
    ).toBeUndefined();
    expect(emp2Detail?.subtasks).toEqual([
      expect.objectContaining({
        taskId: "task-2",
        assigneeUserId: "emp-2",
        title: "整改方案",
      }),
    ]);
  });

  it("lists role-scoped in-progress sessions", () => {
    const service = createWorkbenchService({
      loadPlanSessions: () => sampleSessions(),
    });

    expect(
      service
        .listInProgressSessions({ role: "employee", userId: "emp-2" })
        .map((session) => session.conversationId),
    ).toEqual(["conv-employee"]);
    expect(
      service
        .listInProgressSessions({ role: "manager", userId: "manager-1" })
        .map((session) => session.conversationId),
    ).toEqual(["conv-manager", "conv-employee", "conv-ready"]);
  });

  it("loads plan sessions from session directory json files", () => {
    tempDir = mkdtempSync(join(tmpdir(), "workbench-sessions-"));
    writeFileSync(
      join(tempDir, "a.json"),
      JSON.stringify(sampleSessions()[0], null, 2),
      "utf8",
    );
    writeFileSync(join(tempDir, "ignore.txt"), "not json", "utf8");
    writeFileSync(join(tempDir, "broken.json"), "{", "utf8");

    const loaded = listPlanSessions(tempDir);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(
      expect.objectContaining({
        planId: "plan-customer-complaint",
        knownFacts: [],
        conversationHistory: [],
      }),
    );
  });
});

function sampleSessions(): PlanSession[] {
  return [
    {
      chatKeyHash: "hash-customer",
      planId: "plan-customer-complaint",
      createdAt: "2026-05-11T01:00:00.000Z",
      updatedAt: "2026-05-11T03:00:00.000Z",
      lastTraceId: "trace-customer",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        status: "IN_EXECUTION",
        tasks: [
          {
            id: "task-1",
            title: "客诉根因分析",
            objective: "定位批量客诉原因",
            collaborators: [],
            inputMaterials: [],
            actions: [],
            deliverables: [],
            completionCriteria: [],
            timeNode: { checkpoints: [], dueAt: "2026-05-12" },
            feedbackFrequency: "daily",
            risksAndOpenQuestions: [],
            dependencyTaskIds: [],
          },
          {
            id: "task-2",
            title: "整改方案",
            objective: "制定纠正措施",
            collaborators: [],
            inputMaterials: [],
            actions: [],
            deliverables: [],
            completionCriteria: [],
            timeNode: { checkpoints: [], dueAt: "2026-05-13" },
            feedbackFrequency: "daily",
            risksAndOpenQuestions: [],
            dependencyTaskIds: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [
          {
            taskId: "task-1",
            primary: {
              userId: "emp-1",
              displayName: "员工一",
              rationale: "质量分析负责人",
            },
            alternates: [],
            confidence: "HIGH",
            confidenceReason: "匹配客诉分析经验",
          },
          {
            taskId: "task-2",
            primary: {
              userId: "emp-2",
              displayName: "员工二",
              rationale: "整改执行负责人",
            },
            alternates: [],
            confidence: "MEDIUM",
            confidenceReason: "熟悉整改流程",
          },
        ],
      },
      conversationSessions: [
        {
          conversationId: "conv-manager",
          stage: "WAITING_MANAGER",
          managerUserId: "manager-1",
          updatedAt: "2026-05-11T03:01:00.000Z",
        },
        {
          conversationId: "conv-employee",
          stage: "WAITING_EMPLOYEE",
          employeeUserId: "emp-2",
          updatedAt: "2026-05-11T03:02:00.000Z",
        },
        {
          conversationId: "conv-done",
          stage: "READY_TO_APPLY",
          updatedAt: "2026-05-11T03:03:00.000Z",
          completedAt: "2026-05-11T03:04:00.000Z",
        },
      ],
    } as PlanSession,
    {
      chatKeyHash: "hash-unassigned",
      planId: "plan-unassigned",
      createdAt: "2026-05-11T01:30:00.000Z",
      updatedAt: "2026-05-11T02:30:00.000Z",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        status: "DRAFT_READY",
        tasks: [
          {
            id: "task-3",
            title: "供应商来料复检",
            objective: "确认来料风险",
            collaborators: [],
            inputMaterials: [],
            actions: [],
            deliverables: [],
            completionCriteria: [],
            timeNode: { checkpoints: [], dueAt: "2026-05-14" },
            feedbackFrequency: "weekly",
            risksAndOpenQuestions: [],
            dependencyTaskIds: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [
          {
            taskId: "task-3",
            primary: {
              userId: "emp-3",
              displayName: "员工三",
              rationale: "供应商质量负责人",
            },
            alternates: [],
            confidence: "HIGH",
            confidenceReason: "匹配供应商管理经验",
          },
        ],
      },
      conversationSessions: [
        {
          conversationId: "conv-ready",
          stage: "READY_TO_APPLY",
          updatedAt: "2026-05-11T02:31:00.000Z",
        },
      ],
    } as PlanSession,
  ];
}
