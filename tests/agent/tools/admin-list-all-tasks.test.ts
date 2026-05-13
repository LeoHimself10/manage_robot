import { describe, expect, it, vi } from "vitest";
import { buildAdminListAllTasksHandler } from "../../../src/agent/tools/admin-list-all-tasks";

describe("admin_list_all_tasks tool", () => {
  it("passes filters and returns tasks", () => {
    const listAdminTasks = vi.fn(() => [{ taskNo: "TASK-1" }]);
    const handler = buildAdminListAllTasksHandler({
      taskStore: { listAdminTasks } as any,
    });
    const result = handler({ status: "ASSIGNED", keyword: "abc" }) as any;
    expect(result.ok).toBe(true);
    expect(result.tasks.length).toBe(1);
    expect(listAdminTasks).toHaveBeenCalled();
  });
});
