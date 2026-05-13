import { describe, expect, it, vi } from "vitest";
import { buildListManagedTasksHandler } from "../../../src/agent/tools/list-managed-tasks";

describe("list_managed_tasks tool", () => {
  it("returns manager tasks", () => {
    const handler = buildListManagedTasksHandler({
      taskStore: {
        listManagerTasks: vi.fn(() => [{ taskNo: "TASK-1" }]),
      } as any,
    });
    const result = handler({ actorUserId: "mgr-1" }) as any;
    expect(result.ok).toBe(true);
    expect(result.tasks.length).toBe(1);
  });

  it("requires actorUserId", () => {
    const handler = buildListManagedTasksHandler({
      taskStore: { listManagerTasks: vi.fn(() => []) } as any,
    });
    expect(() => handler({})).toThrow("actorUserId is required");
  });
});
