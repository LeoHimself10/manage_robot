import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  allowsEmployeeSession,
  allowsManagerSession,
  normalizeWorkbenchSession,
  refreshSessionFromWhitelist,
  resolveWorkbenchCapabilities,
} from "../../src/security/workbench-capabilities";

describe("workbench-capabilities", () => {
  let managerDynamicFile = "";

  beforeEach(() => {
    vi.unstubAllEnvs();
    managerDynamicFile = join(tmpdir(), `wb-cap-mgr-${Date.now()}.json`);
    vi.stubEnv("WORKBENCH_DYNAMIC_MANAGER_IDS_FILE", managerDynamicFile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves manager capabilities", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const caps = resolveWorkbenchCapabilities("mgr-a");
    expect(caps.primaryRole).toBe("manager");
    expect(caps.canManage).toBe(true);
    expect(caps.canExecuteAsManager).toBe(true);
  });

  it("allows manager with employee view for employee APIs", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const session = {
      userId: "mgr-a",
      primaryRole: "manager" as const,
      role: "employee" as const,
    };
    expect(allowsEmployeeSession(session)).toBe(true);
    expect(allowsManagerSession(session)).toBe(false);
  });

  it("allows manager with manager view for manager APIs", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const session = {
      userId: "mgr-a",
      primaryRole: "manager" as const,
      role: "manager" as const,
    };
    expect(allowsManagerSession(session)).toBe(true);
    expect(allowsEmployeeSession(session)).toBe(false);
  });

  it("normalizes legacy cookie without primaryRole", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const normalized = normalizeWorkbenchSession({
      userId: "mgr-a",
      role: "employee",
    });
    expect(normalized.primaryRole).toBe("manager");
    expect(normalized.role).toBe("employee");
  });

  it("refreshSessionFromWhitelist preserves manager employee view", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const { session, changed } = refreshSessionFromWhitelist({
      userId: "mgr-a",
      primaryRole: "manager",
      role: "employee",
    });
    expect(changed).toBe(false);
    expect(session.role).toBe("employee");
  });

  it("employee user only allows employee view", () => {
    const session = { userId: "emp-1", role: "employee" as const };
    expect(allowsEmployeeSession(session)).toBe(true);
    expect(allowsManagerSession(session)).toBe(false);
  });

  it("admin also on manager whitelist gets canManage and canAccessAdmin", () => {
    const adminFile = join(tmpdir(), `wb-admin-${Date.now()}.json`);
    const mgrFile = join(tmpdir(), `wb-mgr2-${Date.now()}.json`);
    writeFileSync(adminFile, JSON.stringify(["dual-user"]), "utf8");
    writeFileSync(mgrFile, JSON.stringify(["dual-user"]), "utf8");
    vi.stubEnv("WORKBENCH_ADMIN_IDS_FILE", adminFile);
    vi.stubEnv("WORKBENCH_MANAGER_IDS_FILE", mgrFile);
    const caps = resolveWorkbenchCapabilities("dual-user");
    expect(caps.primaryRole).toBe("admin");
    expect(caps.alsoManager).toBe(true);
    expect(caps.canAccessAdmin).toBe(true);
    expect(caps.canManage).toBe(true);
  });
});
