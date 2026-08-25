import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  allowsEmployeeSession,
  allowsManagerSession,
  defaultLoginViewRole,
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

  it("does not let a manager become an employee view", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const session = {
      userId: "mgr-a",
      primaryRole: "manager" as const,
      role: "employee" as const,
    };
    expect(allowsEmployeeSession(session)).toBe(false);
    expect(allowsManagerSession(session)).toBe(true);
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

  it("normalizes a legacy cross-role cookie back to the configured base role", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const normalized = normalizeWorkbenchSession({
      userId: "mgr-a",
      role: "employee",
    });
    expect(normalized.primaryRole).toBe("manager");
    expect(normalized.role).toBe("manager");
  });

  it("refreshSessionFromWhitelist removes a legacy manager employee view", () => {
    writeFileSync(managerDynamicFile, JSON.stringify(["mgr-a"]), "utf8");
    const { session, changed } = refreshSessionFromWhitelist({
      userId: "mgr-a",
      primaryRole: "manager",
      role: "employee",
    });
    expect(changed).toBe(true);
    expect(session.role).toBe("manager");
  });

  it("employee user only allows employee view", () => {
    const session = { userId: "emp-1", role: "employee" as const };
    expect(allowsEmployeeSession(session)).toBe(true);
    expect(allowsManagerSession(session)).toBe(false);
  });

  it("admin on a legacy manager whitelist remains an admin without manager writes", () => {
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
    expect(caps.canManage).toBe(false);
    expect(caps.canExecuteAsManager).toBe(false);
  });

  it("admin always defaults login to the operations role", () => {
    const adminFile = join(tmpdir(), `wb-admin-${Date.now()}.json`);
    const mgrFile = join(tmpdir(), `wb-mgr2-${Date.now()}.json`);
    writeFileSync(adminFile, JSON.stringify(["dual-user"]), "utf8");
    writeFileSync(mgrFile, JSON.stringify(["dual-user"]), "utf8");
    vi.stubEnv("WORKBENCH_ADMIN_IDS_FILE", adminFile);
    vi.stubEnv("WORKBENCH_MANAGER_IDS_FILE", mgrFile);
    expect(defaultLoginViewRole("dual-user")).toBe("admin");
  });
});
