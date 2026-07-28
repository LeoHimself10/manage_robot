import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderAdminPermissionsPage,
  renderAdminWorkbenchPage,
} from "../../src/web/admin-workbench-pages";

describe("admin permissions page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admin tasks page no longer embeds permission maintenance block", () => {
    const html = renderAdminWorkbenchPage({ userLabel: "Admin" });
    expect(html).not.toContain('id="permissions"');
    expect(html).not.toContain("saveManagerBtn");
  });

  it("permissions page exposes manager, portfolio, and competency sections", () => {
    const html = renderAdminPermissionsPage({ userLabel: "Admin" });
    expect(html).toContain("/api/workbench/admin/portfolio-managers");
    expect(html).toContain("grantPortfolioBtn");
    expect(html).toContain("/api/workbench/admin/competency-eval-users");
    expect(html).toContain("grantCompetencyEvalBtn");
    expect(html).toContain("能力评估助手可见名单");
    expect(html).toContain("/workbench/admin/permissions");
  });

  it("permissions page hides manager group management when disabled", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "0");
    const html = renderAdminPermissionsPage({ userLabel: "Admin" });
    expect(html).not.toContain("/api/workbench/admin/manager-groups");
    expect(html).not.toContain("managerGroupListMount");
    expect(html).not.toContain("createManagerGroupBtn");
  });

  it("permissions page exposes manager group management when enabled", () => {
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    const html = renderAdminPermissionsPage({ userLabel: "Admin" });
    expect(html).toContain("/api/workbench/admin/manager-groups");
    expect(html).toContain("managerGroupListMount");
    expect(html).toContain("createManagerGroupBtn");
  });
});
