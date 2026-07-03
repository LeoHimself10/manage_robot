import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorkbenchManagerGroupMember,
  createWorkbenchManagerGroup,
  findWorkbenchManagerGroupForUser,
  isWorkbenchManagerGroupsEnabled,
  listWorkbenchManagerGroupMemberIds,
  listWorkbenchManagerGroups,
  migrateLegacyManagerGroupFile,
  removeWorkbenchManagerGroupMember,
  updateWorkbenchManagerGroup,
} from "../../src/security/workbench-manager-groups";

describe("workbench manager groups", () => {
  let dir = "";
  let file = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "manager-groups-"));
    file = join(dir, "groups.json");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", file);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled unless WORKBENCH_MANAGER_GROUPS_ENABLED=1", () => {
    expect(isWorkbenchManagerGroupsEnabled()).toBe(false);
    expect(listWorkbenchManagerGroups()).toEqual([]);

    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    expect(isWorkbenchManagerGroupsEnabled()).toBe(true);
  });

  it("creates groups and enforces one group per regular manager", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const a = createWorkbenchManagerGroup({ name: "Mingsi project managers", description: "project pilots" });
    const b = createWorkbenchManagerGroup({ name: "Business managers" });

    addWorkbenchManagerGroupMember(a.groupId, "rain");

    expect(a.groupId.startsWith("mgrgrp:")).toBe(true);
    expect(b.groupId.startsWith("mgrgrp:")).toBe(true);
    expect(() => addWorkbenchManagerGroupMember(b.groupId, "rain")).toThrow(/already belongs/i);
    expect(findWorkbenchManagerGroupForUser("rain")?.groupId).toBe(a.groupId);
    expect(listWorkbenchManagerGroupMemberIds()).toEqual(new Set(["rain"]));
  });

  it("removes members and preserves the group", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "Business managers" });

    addWorkbenchManagerGroupMember(group.groupId, "biz-1");
    removeWorkbenchManagerGroupMember(group.groupId, "biz-1");

    expect(findWorkbenchManagerGroupForUser("biz-1")).toBeUndefined();
    expect(listWorkbenchManagerGroups()).toHaveLength(1);
  });

  it("updates name, description, status and portfolio flag", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "Old name" });

    const updated = updateWorkbenchManagerGroup(group.groupId, {
      name: "Mingsi project managers",
      description: "shared project management",
      status: "inactive",
      portfolioEnabled: true,
    });

    expect(updated).toMatchObject({
      groupId: group.groupId,
      name: "Mingsi project managers",
      description: "shared project management",
      status: "inactive",
      portfolioEnabled: true,
    });
  });

  it("normalizes old array files into the object shape", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");

    migrateLegacyManagerGroupFile([
      { groupId: "mgrgrp:legacy", name: "Legacy", memberUserIds: ["a", "b"] },
    ]);

    const raw = JSON.parse(readFileSync(file, "utf8")) as { groups: unknown[] };
    expect(raw.groups).toHaveLength(1);
    expect(listWorkbenchManagerGroups()[0].memberUserIds).toEqual(["a", "b"]);
  });

  it("does not activate inactive or invalid-status persisted group members", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    writeFileSync(
      file,
      JSON.stringify({
        groups: [
          { groupId: "mgrgrp:active", name: "Active", status: "active", memberUserIds: ["active-mgr"] },
          { groupId: "mgrgrp:inactive", name: "Inactive", status: "inactive", memberUserIds: ["inactive-mgr"] },
          { groupId: "mgrgrp:invalid", name: "Invalid", status: "paused", memberUserIds: ["invalid-mgr"] },
          { groupId: "mgrgrp:legacy", name: "Legacy", memberUserIds: ["legacy-mgr"] },
        ],
      }),
      "utf8",
    );

    expect(listWorkbenchManagerGroupMemberIds()).toEqual(new Set(["active-mgr", "legacy-mgr"]));
    expect(findWorkbenchManagerGroupForUser("inactive-mgr")).toBeUndefined();
    expect(findWorkbenchManagerGroupForUser("invalid-mgr")).toBeUndefined();
  });
});
