import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPublishNotifier } from "../../../src/integrations/dingtalk/workbench-notify";
import { notifyManagerOfEmployeeActionAfterUpdate } from "../../../src/integrations/dingtalk/manager-notify-on-employee-action";
import {
  addWorkbenchManagerGroupMember,
  createWorkbenchManagerGroup,
} from "../../../src/security/workbench-manager-groups";

describe("notifyManagerOfEmployeeActionAfterUpdate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips notify when manager is the assignee (self-assignment)", async () => {
    const notifyManagerOfEmployeeAction = vi.fn();
    await notifyManagerOfEmployeeActionAfterUpdate({
      taskStore: {
        getSubtaskWithTask: () => ({
          task: {
            taskId: "t1",
            taskNo: "TK-1",
            title: "T",
            managerUserId: "mgr-self",
          },
          subtask: { subtaskId: "s1", title: "S" },
        }),
        appendTaskEvent: vi.fn(),
      } as unknown as Parameters<typeof notifyManagerOfEmployeeActionAfterUpdate>[0]["taskStore"],
      notifier: { notifyManagerOfEmployeeAction } as unknown as WorkbenchPublishNotifier,
      subtaskId: "s1",
      actorUserId: "mgr-self",
      kind: "rejected",
      note: "no",
    });
    expect(notifyManagerOfEmployeeAction).not.toHaveBeenCalled();
  });

  it("notifies the owner manager group for legacy ungrouped tasks", async () => {
    const groupFile = join(mkdtempSync(join(tmpdir(), "manager-notify-groups-")), "groups.json");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", groupFile);
    const group = createWorkbenchManagerGroup({ name: "Shared managers" });
    addWorkbenchManagerGroupMember(group.groupId, "mgr-1");
    addWorkbenchManagerGroupMember(group.groupId, "mgr-2");
    const notifyManagerOfEmployeeAction = vi.fn(async (payload: { managerUserId: string }) => ({
      enabled: true,
      success: [{ userId: payload.managerUserId, robotMessageKey: `mock-${payload.managerUserId}` }],
      failed: [],
    }));

    await notifyManagerOfEmployeeActionAfterUpdate({
      taskStore: {
        getSubtaskWithTask: () => ({
          task: {
            taskId: "t1",
            taskNo: "TK-1",
            title: "T",
            managerUserId: "mgr-1",
          },
          subtask: { subtaskId: "s1", title: "S" },
        }),
        appendTaskEvent: vi.fn(),
      } as unknown as Parameters<typeof notifyManagerOfEmployeeActionAfterUpdate>[0]["taskStore"],
      notifier: { notifyManagerOfEmployeeAction } as unknown as WorkbenchPublishNotifier,
      subtaskId: "s1",
      actorUserId: "emp-1",
      kind: "rejected",
      note: "no",
    });

    expect(
      notifyManagerOfEmployeeAction.mock.calls
        .map(([payload]) => payload.managerUserId)
        .sort(),
    ).toEqual(["mgr-1", "mgr-2"]);
  });
});
