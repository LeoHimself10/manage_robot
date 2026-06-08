import { describe, expect, it } from "vitest";
import {
  buildPerformanceDashboardPayload,
  resolvePerformanceWindowDays,
  isPerformanceDashboardEnabled,
} from "../../src/web/performance-dashboard-api";
import { renderPerformanceDashboardPage } from "../../src/web/performance-dashboard-page";

const DATASET = {
  subtasks: [
    { subtaskId: "A", assigneeUserId: "emp-1", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-03T10:00:00.000Z" },
  ],
  reminders: [],
  overdueAlerts: [],
  reassignedSubtaskIds: [],
};

describe("performance dashboard api", () => {
  it("builds payload from store dataset with names and scope", () => {
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
    expect(payload.windowDays).toBe(365);
    const employees = payload.employees as Array<Record<string, unknown>>;
    expect(employees[0].name).toBe("张三");
    expect(employees[0].lateDone).toBe(1);
  });

  it("resolvePerformanceWindowDays falls back to default", () => {
    expect(resolvePerformanceWindowDays(30)).toBe(30);
    expect(resolvePerformanceWindowDays("abc")).toBe(90);
    expect(resolvePerformanceWindowDays(undefined)).toBe(90);
  });

  it("enabled by default", () => {
    expect(isPerformanceDashboardEnabled()).toBe(true);
  });
});

describe("performance dashboard page", () => {
  it("renders nav, table and chat scaffolding", () => {
    const html = renderPerformanceDashboardPage({ userLabel: "王主管", canViewAll: false });
    expect(html).toContain("交付绩效");
    expect(html).toContain("perfBody");
    expect(html).toContain("/api/workbench/manager/performance");
    expect(html).toContain("/api/workbench/manager/performance/chat");
    expect(html).toContain("您名下员工");
  });

  it("shows all-employee scope label for admins", () => {
    const html = renderPerformanceDashboardPage({ userLabel: "老板", canViewAll: true });
    expect(html).toContain("全员（管理员视角）");
  });
});
