import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } from "../../../src/security/workbench-manager-groups";
import { buildGetTaskDetailHandler } from "../../../src/agent/tools/get-task-detail";
import { buildListManagedTasksHandler } from "../../../src/agent/tools/list-managed-tasks";
import { buildProjectPortfolioToolHandlers } from "../../../src/agent/tools/project-portfolio-tools";
import { buildPublishTaskHandler, createRecentPublishStore } from "../../../src/agent/tools/publish-task";
import { buildReassignTaskHandler } from "../../../src/agent/tools/reassign-task";
import { stubWorkbenchPublishNotifier } from "../../helpers/stub-workbench-notifier";

describe("manager group agent tools", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "agent-manager-groups-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(dir, "workbench.sqlite"));
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(dir, "groups.json"));
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function sessionFor(planId: string, managerUserId: string): PlanSession {
    return {
      chatKeyHash: `hash-${planId}`,
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: managerUserId,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: { title: `Task ${planId}`, tasks: [{ id: "task_1", title: "Item" }] },
      latestAssignment: { assignments: [{ taskId: "task_1", primary: { userId: "emp-a" } }] },
    };
  }

  function publish(planId: string, managerUserId: string, managerGroupId: string): void {
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId,
      session: sessionFor(planId, managerUserId),
      managerUserId,
      managerGroupId,
      initiatorDepartment: "Project",
      actorUserId: managerUserId,
    });
  }

  it("list_managed_tasks returns group tasks for a group member", () => {
    const group = createWorkbenchManagerGroup({ name: "Mingsi managers" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
    publish("plan-agent-group", "mgr-a", group.groupId);

    const result = buildListManagedTasksHandler({ taskStore: createWorkbenchFormalTaskStore() })({
      actorUserId: "mgr-b",
    }) as { ok: boolean; tasks: Array<{ planId: string }> };

    expect(result.ok).toBe(true);
    expect(result.tasks.some((t) => t.planId === "plan-agent-group")).toBe(true);
  });

  it("get_task_detail allows same group and denies other group", () => {
    const a = createWorkbenchManagerGroup({ name: "Mingsi managers" });
    const b = createWorkbenchManagerGroup({ name: "Business managers" });
    addWorkbenchManagerGroupMember(a.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(a.groupId, "mgr-b");
    addWorkbenchManagerGroupMember(b.groupId, "biz-a");
    publish("plan-agent-detail", "mgr-a", a.groupId);
    const handler = buildGetTaskDetailHandler({ taskStore: createWorkbenchFormalTaskStore() });

    expect(handler({ actorUserId: "mgr-b", actorRole: "manager", planId: "plan-agent-detail" })).toMatchObject({
      ok: true,
    });
    expect(handler({ actorUserId: "biz-a", actorRole: "manager", planId: "plan-agent-detail" })).toMatchObject({
      ok: false,
      reason: "task_not_owned",
    });
  });

  it("reassign_task allows same group and denies other group", () => {
    const a = createWorkbenchManagerGroup({ name: "Mingsi managers" });
    const b = createWorkbenchManagerGroup({ name: "Business managers" });
    addWorkbenchManagerGroupMember(a.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(a.groupId, "mgr-b");
    addWorkbenchManagerGroupMember(b.groupId, "biz-a");
    publish("plan-agent-reassign", "mgr-a", a.groupId);
    const store = createWorkbenchFormalTaskStore();
    const handler = buildReassignTaskHandler({
      taskStore: store,
      planSessionStore: { save: vi.fn(), appendEvent: vi.fn() } as any,
      findSessionByPlanId: () => undefined,
      patchAssignment: () => ({}),
    });

    expect(handler({ actorUserId: "mgr-b", planId: "plan-agent-reassign", assigneeUserId: "emp-b" })).toMatchObject({
      ok: true,
    });
    expect(store.getTaskDetail("plan-agent-reassign")?.subtasks[0]?.assigneeUserId).toBe("emp-b");
    expect(handler({ actorUserId: "biz-a", planId: "plan-agent-reassign", assigneeUserId: "emp-c" })).toMatchObject({
      ok: false,
      reason: "task_not_owned",
    });
  });

  it("publish_task persists the actor manager group", async () => {
    const group = createWorkbenchManagerGroup({ name: "Mingsi managers" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    const publishFromSession = vi.fn(() => ({
      task: { taskId: "task:plan-publish-group", taskNo: "W1", title: "Task", description: "Description" },
      subtasks: [{ assigneeUserId: "emp-a", title: "Item", sourceTaskKey: "task_1" }],
      alreadyPublished: false,
    }));
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "mgr-a",
      currentSessionPlanId: "plan-publish-group",
      currentSession: sessionFor("plan-publish-group", "mgr-a"),
      initiatorDepartment: "Project",
      publishFromSession,
      appendTaskEvent: vi.fn(),
      getContact: () => ({ active: true }),
      notifier: stubWorkbenchPublishNotifier(),
      recentPublished: createRecentPublishStore(),
    });

    await handler({ planId: "plan-publish-group", confirmationContext: "confirm" });

    expect(publishFromSession).toHaveBeenCalledWith(expect.objectContaining({ managerGroupId: group.groupId }));
  });

  it("project portfolio tools share projects inside a portfolio-enabled group", () => {
    const group = createWorkbenchManagerGroup({ name: "Mingsi managers", portfolioEnabled: true });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-a");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");
    const created = buildProjectPortfolioToolHandlers({ trustedActorUserId: "mgr-a" }).create_project.handler({
      name: "Shared project",
      description: "Shared in group",
    }) as { project: { projectId: string } };
    const listed = buildProjectPortfolioToolHandlers({ trustedActorUserId: "mgr-b" }).list_projects.handler({}) as {
      projects: Array<{ projectId: string }>;
    };

    expect(listed.projects.some((p) => p.projectId === created.project.projectId)).toBe(true);
  });
});
