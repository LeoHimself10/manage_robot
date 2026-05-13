import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSetManagerPermissionHandler } from "../../../src/agent/tools/set-manager-permission";
import { setDynamicWorkbenchManager } from "../../../src/security/workbench-manager-directory";

vi.mock("../../../src/security/workbench-manager-directory", () => ({
  setDynamicWorkbenchManager: vi.fn(),
}));

describe("set_manager_permission tool", () => {
  beforeEach(() => {
    vi.mocked(setDynamicWorkbenchManager).mockReset();
  });

  it("updates permission and writes audit event", () => {
    vi.mocked(setDynamicWorkbenchManager).mockReturnValue({
      before: false,
      after: true,
      changed: true,
    });
    const appendPermissionEvent = vi.fn();
    const handler = buildSetManagerPermissionHandler({
      taskStore: { appendPermissionEvent } as any,
      peopleStore: {
        getContact: () => ({ active: true }),
      } as any,
    });
    const result = handler({
      actorUserId: "admin-1",
      userId: "mgr-2",
      enabled: true,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(appendPermissionEvent).toHaveBeenCalledTimes(1);
  });

  it("returns changed false when no real mutation", () => {
    vi.mocked(setDynamicWorkbenchManager).mockReturnValue({
      before: true,
      after: true,
      changed: false,
    });
    const appendPermissionEvent = vi.fn();
    const handler = buildSetManagerPermissionHandler({
      taskStore: { appendPermissionEvent } as any,
      peopleStore: {
        getContact: () => ({ active: true }),
      } as any,
    });
    const result = handler({
      actorUserId: "admin-1",
      userId: "mgr-2",
      enabled: true,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
  });
});
