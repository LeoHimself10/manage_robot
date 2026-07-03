import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addWorkbenchManagerGroupMember,
  createWorkbenchManagerGroup,
} from "../../src/security/workbench-manager-groups";
import {
  canAccessManagerOwnedObject,
  managerScopeLabel,
  resolveWorkbenchManagerScope,
} from "../../src/security/workbench-manager-scope";

describe("workbench manager scope", () => {
  let groupFile = "";

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "manager-scope-"));
    groupFile = join(dir, "groups.json");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", groupFile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a trimmed personal scope when manager groups are disabled", () => {
    const scope = resolveWorkbenchManagerScope(" manager-1 ");

    expect(scope).toEqual({
      actorUserId: "manager-1",
      managerUserId: "manager-1",
    });
    expect(managerScopeLabel(scope)).toBe("manager:manager-1");
  });

  it("returns a personal scope when groups are enabled but the actor has no active group", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    createWorkbenchManagerGroup({ name: "Project managers" });

    expect(resolveWorkbenchManagerScope("manager-1")).toEqual({
      actorUserId: "manager-1",
      managerUserId: "manager-1",
    });
  });

  it("returns a group scope for enabled active group members", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const group = createWorkbenchManagerGroup({ name: "Project managers" });
    addWorkbenchManagerGroupMember(group.groupId, "manager-1");

    const scope = resolveWorkbenchManagerScope(" manager-1 ");

    expect(scope).toEqual({
      actorUserId: "manager-1",
      managerUserId: "manager-1",
      managerGroupId: group.groupId,
    });
    expect(managerScopeLabel(scope)).toBe(`group:${group.groupId}`);
  });

  it("allows same-group and own personal objects only", () => {
    const groupScope = {
      actorUserId: "manager-1",
      managerUserId: "manager-1",
      managerGroupId: "mgrgrp:alpha",
    };

    expect(
      canAccessManagerOwnedObject({ managerUserId: "manager-2", managerGroupId: "mgrgrp:alpha" }, groupScope),
    ).toBe(true);
    expect(canAccessManagerOwnedObject({ managerUserId: "manager-1" }, groupScope)).toBe(true);
    expect(canAccessManagerOwnedObject({ managerUserId: "manager-2" }, groupScope)).toBe(false);
    expect(
      canAccessManagerOwnedObject({ managerUserId: "manager-1", managerGroupId: "mgrgrp:beta" }, groupScope),
    ).toBe(false);

    const personalScope = {
      actorUserId: "manager-1",
      managerUserId: "manager-1",
    };
    expect(
      canAccessManagerOwnedObject({ managerUserId: "manager-1", managerGroupId: "mgrgrp:alpha" }, personalScope),
    ).toBe(false);
  });
});
