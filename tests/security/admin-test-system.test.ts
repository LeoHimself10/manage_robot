import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_TEST_ACTORS,
  listAdminTestActors,
} from "../../src/testing/admin-test-actors";
import {
  decorateWorkbenchHtmlForAdminImpersonation,
  listWorkbenchImpersonationTargets,
} from "../../src/web/workbench-admin-impersonation";
import { resolveWorkbenchRole } from "../../src/security/workbench-role-resolver";
import { resolveQualityCapabilities } from "../../src/security/quality-capabilities";

describe("isolated administrator test system", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("contains exactly the requested six identities and one supervisor for all three employees", () => {
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED", "1");
    expect(ADMIN_TEST_ACTORS.map((actor) => actor.displayName)).toEqual([
      "马荣鑫（测试）",
      "佟成（测试）",
      "测试员工1",
      "测试员工2",
      "测试员工3",
      "测试主管",
    ]);
    expect(listAdminTestActors()).toHaveLength(6);
    expect(
      ADMIN_TEST_ACTORS.filter((actor) => actor.displayName.startsWith("测试员工"))
        .map((actor) => actor.supervisorUserId),
    ).toEqual([
      "QUALITY_TEST_MANAGER_001",
      "QUALITY_TEST_MANAGER_001",
      "QUALITY_TEST_MANAGER_001",
    ]);
  });

  it("does not expose the real directory and keeps the requested display order", () => {
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED", "1");
    const targets = listWorkbenchImpersonationTargets({
      // The isolated selector deliberately ignores the old role filter.
      kind: "project_manager",
    });
    expect(targets.map((target) => target.userId)).toEqual(
      ADMIN_TEST_ACTORS.map((actor) => actor.userId),
    );
    expect(listWorkbenchImpersonationTargets({ query: "员工2" })).toMatchObject([
      { userId: "QUALITY_TEST_EMPLOYEE_002", name: "测试员工2" },
    ]);
  });

  it("assigns real workbench and quality capabilities to every test identity", () => {
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED", "1");
    expect(resolveWorkbenchRole("QUALITY_TEST_AFTERSALES_001")).toBe("manager");
    expect(resolveWorkbenchRole("QUALITY_TEST_SPECIALIST_001")).toBe("employee");
    expect(resolveWorkbenchRole("QUALITY_TEST_MANAGER_001")).toBe("manager");
    expect(resolveWorkbenchRole("QUALITY_TEST_EMPLOYEE_001")).toBe("employee");

    expect(resolveQualityCapabilities("QUALITY_TEST_AFTERSALES_001")).toMatchObject({
      canAccessTracking: true,
      canReportQuality: true,
      isBusinessReadOnly: false,
      specialistUserIds: ["QUALITY_TEST_SPECIALIST_001"],
    });
    expect(resolveQualityCapabilities("QUALITY_TEST_SPECIALIST_001")).toMatchObject({
      canAccessTracking: true,
      canAnalyzeQuality: true,
      hasQualityManagement: true,
    });
    for (const userId of [
      "QUALITY_TEST_MANAGER_001",
      "QUALITY_TEST_EMPLOYEE_001",
      "QUALITY_TEST_EMPLOYEE_002",
      "QUALITY_TEST_EMPLOYEE_003",
    ]) {
      expect(resolveQualityCapabilities(userId).canAccessTracking).toBe(true);
    }
  });

  it("renders the existing admin switcher as a six-identity test selector only when enabled", () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED", "1");
    const html = decorateWorkbenchHtmlForAdminImpersonation(
      '<html><head></head><body><div class="wb-appbar-actions"></div></body></html>',
      { userId: "admin-1", role: "admin", dingUser: undefined, impersonation: undefined },
    );
    expect(html).toContain("切换测试身份");
    expect(html).toContain("系统内数据和状态正常流转，不发送真实钉钉消息");
    expect(html).not.toContain('id="wbImpersonationKind"');
  });
});
