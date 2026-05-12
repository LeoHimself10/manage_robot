import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkbenchRole } from "../../src/security/workbench-role-resolver";

describe("resolveWorkbenchRole", () => {
  let managerDynamicFile = "";
  let adminFile = "";

  beforeEach(() => {
    vi.unstubAllEnvs();
    managerDynamicFile = join(tmpdir(), `wb-dynamic-managers-${Date.now()}.json`);
    adminFile = join(tmpdir(), `wb-admins-${Date.now()}.json`);
    vi.stubEnv("WORKBENCH_DYNAMIC_MANAGER_IDS_FILE", managerDynamicFile);
    vi.stubEnv("WORKBENCH_ADMIN_IDS_FILE", adminFile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves by admin > manager > employee priority", () => {
    writeFileSync(adminFile, JSON.stringify(["u-admin", "u-both"]), "utf8");
    writeFileSync(managerDynamicFile, JSON.stringify(["u-manager", "u-both"]), "utf8");
    expect(resolveWorkbenchRole("u-admin")).toBe("admin");
    expect(resolveWorkbenchRole("u-manager")).toBe("manager");
    expect(resolveWorkbenchRole("u-both")).toBe("admin");
    expect(resolveWorkbenchRole("u-employee")).toBe("employee");
  });
});
