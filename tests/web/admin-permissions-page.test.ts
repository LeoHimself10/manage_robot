import { describe, expect, it } from "vitest";
import {
  renderAdminPermissionsPage,
  renderAdminWorkbenchPage,
} from "../../src/web/admin-workbench-pages";

describe("admin permissions page", () => {
  it("admin tasks page no longer embeds permission maintenance block", () => {
    const html = renderAdminWorkbenchPage({ userLabel: "管理员" });
    expect(html).not.toContain('id="permissions"');
    expect(html).not.toContain("saveManagerBtn");
  });

  it("permissions page exposes manager and portfolio sections", () => {
    const html = renderAdminPermissionsPage({ userLabel: "管理员" });
    expect(html).toContain("权限中心");
    expect(html).toContain("项目管理主管");
    expect(html).toContain("/api/workbench/admin/portfolio-managers");
    expect(html).toContain("grantPortfolioBtn");
    expect(html).toContain("/workbench/admin/permissions");
  });
});
