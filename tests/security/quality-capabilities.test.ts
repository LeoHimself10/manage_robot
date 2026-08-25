import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listQualitySpecialistUserIds,
  resolveQualityCapabilities,
} from "../../src/security/quality-capabilities";

afterEach(() => vi.unstubAllEnvs());

describe("quality capability overlay", () => {
  it("keeps the three base roles and grants quality analysis only through explicit capability", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1");
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "manager-1,quality-employee,admin-1");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-employee,manager-1,admin-1");

    expect(resolveQualityCapabilities("manager-1")).toMatchObject({
      baseRole: "manager",
      canReportQuality: true,
      canAnalyzeQuality: false,
      isProjectManager: true,
      isQualitySpecialist: false,
    });
    expect(resolveQualityCapabilities("quality-employee")).toMatchObject({
      baseRole: "employee",
      canReportQuality: false,
      canAnalyzeQuality: true,
      hasQualityManagement: true,
      isProjectManager: false,
      isQualitySpecialist: true,
    });
    expect(resolveQualityCapabilities("admin-1")).toMatchObject({
      baseRole: "admin",
      canReportQuality: false,
      canAnalyzeQuality: false,
      canAccessTracking: true,
      isBusinessReadOnly: true,
      isProjectManager: false,
      isQualitySpecialist: false,
    });
    expect(listQualitySpecialistUserIds()).toEqual(["quality-employee"]);
  });

  it("accepts the legacy specialist allowlist as the same capability facade", () => {
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "legacy-quality");
    expect(resolveQualityCapabilities("legacy-quality")).toMatchObject({
      baseRole: "employee",
      canAnalyzeQuality: true,
      hasQualityManagement: true,
      roles: ["quality_specialist"],
    });
  });
});
