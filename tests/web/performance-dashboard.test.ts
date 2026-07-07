import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPerformanceDashboardPayload,
  buildPerformanceEmployeeDetailPayload,
  parsePerformanceConversationHistory,
  resolvePerformanceScope,
  resolvePerformanceWindowDays,
  isPerformanceDashboardEnabled,
} from "../../src/web/performance-dashboard-api";
import { renderPerformanceDashboardPage } from "../../src/web/performance-dashboard-page";
import { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } from "../../src/security/workbench-manager-groups";

const DATASET = {
  subtasks: [
    {
      subtaskId: "A",
      assigneeUserId: "emp-1",
      status: "DONE",
      dueAt: "2026-06-01T10:00:00.000Z",
      completedAt: "2026-06-03T10:00:00.000Z",
      taskId: "t1",
      taskTitle: "任务一",
      projectId: "p1",
      projectName: "项目甲",
    },
  ],
  reminders: [{ subtaskId: "A", total: 2 }],
  overdueAlerts: [],
  reassignedSubtaskIds: [],
};

describe("performance dashboard api", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds payload from store dataset with names, kpi and projects", () => {
    const fakeStore = { loadPerformanceDataset: () => DATASET };
    const payload = buildPerformanceDashboardPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      scope: { kind: "manager", managerUserId: "mgr-1" },
      windowDays: 365,
      resolveName: (uid) => (uid === "emp-1" ? "张三" : undefined),
    });
    expect(payload.ok).toBe(true);
    expect(payload.scopeKind).toBe("manager");
    expect(payload.scopeLabel).toContain("名下");
    expect(payload.windowDays).toBe(365);
    const employees = payload.employees as Array<Record<string, unknown>>;
    expect(employees[0].name).toBe("张三");
    expect(employees[0].lateDone).toBe(1);
    expect(employees[0].lateRateLabel).toBeTruthy();
    const kpi = payload.kpi as Record<string, unknown>;
    expect(kpi.employeeCount).toBe(1);
    const projects = payload.projects as Array<Record<string, unknown>>;
    expect(projects.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.projectOptions)).toBe(true);
  });

  it("keeps full projectOptions stable when filtered to one project", () => {
    const multiProject = {
      subtasks: [
        { subtaskId: "A", assigneeUserId: "e1", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T09:00:00.000Z", taskId: "t1", taskTitle: "T1", projectId: "p1", projectName: "器械设计" },
        { subtaskId: "B", assigneeUserId: "e2", status: "DONE", dueAt: "2026-06-02T10:00:00.000Z", completedAt: "2026-06-02T09:00:00.000Z", taskId: "t2", taskTitle: "T2", projectId: "p2", projectName: "test" },
      ],
      reminders: [], overdueAlerts: [], reassignedSubtaskIds: [],
    };
    const fakeStore = {
      // 模拟存储层：projectId 过滤只返回该项目子任务；无过滤返回全部。
      loadPerformanceDataset: (scope?: { projectId?: string }) => {
        if (scope?.projectId) {
          return { ...multiProject, subtasks: multiProject.subtasks.filter((s) => s.projectId === scope.projectId) };
        }
        return multiProject;
      },
    };
    const payload = buildPerformanceDashboardPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      scope: { kind: "all" },
      windowDays: 365,
      projectId: "p1",
    });
    const opts = payload.projectOptions as Array<Record<string, unknown>>;
    const names = opts.map((p) => p.projectName);
    expect(names).toContain("器械设计");
    expect(names).toContain("test");
  });

  it("builds employee detail payload", () => {
    const fakeStore = { loadPerformanceDataset: () => DATASET };
    const payload = buildPerformanceEmployeeDetailPayload({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      scope: { kind: "all" },
      userId: "emp-1",
      windowDays: 365,
    });
    expect(payload.ok).toBe(true);
    expect((payload.employee as Record<string, unknown>).userId).toBe("emp-1");
    expect((payload.byTask as unknown[]).length).toBeGreaterThan(0);
    expect((payload.subtasks as unknown[]).length).toBe(1);
  });

  it("resolvePerformanceWindowDays falls back to default", () => {
    expect(resolvePerformanceWindowDays(30)).toBe(30);
    expect(resolvePerformanceWindowDays("abc")).toBe(30);
    expect(resolvePerformanceWindowDays(undefined)).toBe(30);
  });

  it("enabled by default", () => {
    expect(isPerformanceDashboardEnabled()).toBe(true);
  });

  it("manager performance scope carries managerGroupId", () => {
    const dir = mkdtempSync(join(tmpdir(), "performance-manager-groups-"));
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", join(dir, "groups.json"));
    const group = createWorkbenchManagerGroup({ name: "Mingsi managers" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-b");

    expect(resolvePerformanceScope({ userId: "mgr-b", role: "manager" })).toEqual({
      kind: "manager",
      managerUserId: "mgr-b",
      managerGroupId: group.groupId,
      managerGroupMemberUserIds: ["mgr-b"],
    });
  });

  it("parsePerformanceConversationHistory keeps user/assistant turns with caps", () => {
    expect(parsePerformanceConversationHistory(null)).toEqual([]);
    expect(parsePerformanceConversationHistory([
      { role: "user", content: " 曹杰怎么样 " },
      { role: "assistant", content: "迟交率 20%" },
      { role: "system", content: "ignored" },
      { role: "user", content: "" },
    ])).toEqual([
      { role: "user", content: "曹杰怎么样" },
      { role: "assistant", content: "迟交率 20%" },
    ]);
    const many = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn-${i}`,
    }));
    expect(parsePerformanceConversationHistory(many)).toHaveLength(20);
    expect(parsePerformanceConversationHistory(many)[0].content).toBe("turn-5");
  });
});

describe("performance dashboard page", () => {
  it("renders manager nav, kpi, table and chat scaffolding", () => {
    const html = renderPerformanceDashboardPage({
      userLabel: "王主管",
      role: "manager",
      scopeLabel: "您名下员工",
      apiBase: "/api/workbench/manager/performance",
    });
    expect(html).toContain("交付绩效");
    expect(html).toContain("perfBody");
    expect(html).toContain("perfKpiGrid");
    expect(html).toContain("perfDetail");
    expect(html).toContain("/api/workbench/manager/performance");
    expect(html).toContain("您名下员工");
    expect(html).toContain("mgr-perf");
    expect(html).toContain("conversationHistory");
    expect(html).toContain("perf_chat_history_v1");
    expect(html).toContain("/static/performance-chat-markdown.js");
    expect(html).toContain("formatPerfAssistantHtml");
    expect(html).toContain("detailProject");
    expect(html).toContain("detailTotalStack");
    expect(html).toContain("detailTasksToggle");
  });

  it("renders admin page with admin nav and api base", () => {
    const html = renderPerformanceDashboardPage({
      userLabel: "老板",
      role: "admin",
      scopeLabel: "全员（管理员视角）",
      apiBase: "/api/workbench/admin/performance",
    });
    expect(html).toContain("全员（管理员视角）");
    expect(html).toContain("/api/workbench/admin/performance");
    expect(html).toContain("adm-perf");
    expect(html).toContain("/workbench/admin/performance");
  });
});
