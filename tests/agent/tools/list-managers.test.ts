import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/security/workbench-manager-directory", () => ({
  listDynamicWorkbenchManagers: () => ["mgr-dyn-1"],
}));
vi.mock("../../../src/security/workbench-manager-whitelist", () => ({
  listWorkbenchManagerIds: () => new Set(["mgr-1", "mgr-2"]),
}));

describe("list_managers tool", () => {
  it("returns dynamic + effective managers", async () => {
    const { buildListManagersHandler } = await import("../../../src/agent/tools/list-managers");
    const handler = buildListManagersHandler();
    const result = handler({}) as any;
    expect(result.ok).toBe(true);
    expect(result.dynamicManagers).toContain("mgr-dyn-1");
    expect(result.effectiveManagers).toContain("mgr-1");
  });
});
