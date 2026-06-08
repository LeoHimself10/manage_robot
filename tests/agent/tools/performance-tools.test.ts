import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGetEmployeePerformanceHandler,
} from "../../../src/agent/tools/performance-tools";
import { buildToolRegistry } from "../../../src/agent/tools/registry";

vi.mock("../../../src/integrations/dingtalk/workbench-notify", () => ({
  createWorkbenchPublishNotifier: () => ({
    notifyPublishedTask: vi.fn(async () => ({ enabled: false, skippedReason: "off", success: [], failed: [] })),
    notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, skippedReason: "off", success: [], failed: [] })),
    notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, skippedReason: "off", success: [], failed: [] })),
  }),
}));

const AS_OF_DATASET = {
  subtasks: [
    { subtaskId: "A", assigneeUserId: "emp-1", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-03T10:00:00.000Z" },
    { subtaskId: "B", assigneeUserId: "emp-2", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-01T09:00:00.000Z" },
  ],
  reminders: [],
  overdueAlerts: [],
  reassignedSubtaskIds: [],
};

describe("get_employee_performance tool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ranked employees from the dataset (scope=all)", () => {
    const fakeStore = { loadPerformanceDataset: vi.fn(() => AS_OF_DATASET) };
    const fakePeople = { getContact: (uid: string) => ({ name: uid === "emp-1" ? "张三" : "李四" }) };
    const handler = buildGetEmployeePerformanceHandler({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peopleStore: fakePeople as any,
      scope: { kind: "all" },
    });
    const res = handler({ windowDays: 365 }) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.scopeKind).toBe("all");
    expect(fakeStore.loadPerformanceDataset).toHaveBeenCalledWith({});
    const employees = res.employees as Array<Record<string, unknown>>;
    expect(employees.length).toBe(2);
    // emp-1 late -> ranked first
    expect(employees[0].userId).toBe("emp-1");
    expect(employees[0].name).toBe("张三");
    expect(employees[0].lateDone).toBe(1);
  });

  it("passes managerUserId for manager scope and respects limit", () => {
    const fakeStore = { loadPerformanceDataset: vi.fn(() => AS_OF_DATASET) };
    const fakePeople = { getContact: () => undefined };
    const handler = buildGetEmployeePerformanceHandler({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peopleStore: fakePeople as any,
      scope: { kind: "manager", managerUserId: "mgr-9" },
    });
    const res = handler({ windowDays: 365, limit: 1 }) as Record<string, unknown>;
    expect(fakeStore.loadPerformanceDataset).toHaveBeenCalledWith({ managerUserId: "mgr-9" });
    expect((res.employees as unknown[]).length).toBe(1);
    expect(res.excludesStoppedTasks).toBe(true);
  });

  it("uses queryDefaults for windowDays and projectId when args omitted", () => {
    const fakeStore = { loadPerformanceDataset: vi.fn(() => AS_OF_DATASET) };
    const handler = buildGetEmployeePerformanceHandler({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskStore: fakeStore as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peopleStore: { getContact: () => undefined } as any,
      scope: { kind: "all" },
      queryDefaults: { windowDays: 30, projectId: "proj-1" },
    });
    handler({});
    expect(fakeStore.loadPerformanceDataset).toHaveBeenCalledWith({ projectId: "proj-1" });
  });
});

describe("performance tool profile isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes only read-only stats + people tools, no editing/publish tools", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "performance",
      performanceScope: { kind: "all" },
    });
    expect(registry.get_employee_performance).toBeDefined();
    expect(registry.search_employees).toBeDefined();
    expect(registry.get_employee_details).toBeDefined();
    expect(registry.get_current_time).toBeDefined();
    // No mutation / publishing / assignment / follow-up tools.
    expect(registry.publish_task).toBeUndefined();
    expect(registry.prepare_publish_task).toBeUndefined();
    expect(registry.update_draft_task).toBeUndefined();
    expect(registry.reassign_task).toBeUndefined();
    expect(registry.send_subtask_reminder).toBeUndefined();
    expect(registry.bulk_assign_tasks).toBeUndefined();
    expect(registry.list_managed_tasks).toBeUndefined();
  });

  it("omits get_employee_performance when no performanceScope is provided", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "performance",
    });
    expect(registry.get_employee_performance).toBeUndefined();
  });
});
