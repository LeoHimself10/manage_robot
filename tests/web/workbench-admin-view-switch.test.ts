import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWorkbenchPage } from "../../src/web/workbench-shell";

function render(role: "admin" | "manager" | "employee", userId: string): string {
  return renderWorkbenchPage({
    role,
    activeNav: role === "admin" ? "adm-ops" : role === "manager" ? "mgr-tasks" : "emp-new",
    title: "测试页面",
    pageTitle: "测试页面",
    sessionUserId: userId,
    mainHtml: "",
  });
}

describe("admin workbench view switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows one admin-only switch with all allowed views", () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "dual-admin");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "dual-admin");

    for (const role of ["admin", "manager", "employee"] as const) {
      const html = render(role, "dual-admin");
      expect(html).toContain('class="wb-admin-view-switch"');
      expect(html).toContain("切换视图");
      expect(html).toContain("管理员视图");
      expect(html).toContain("主管视图");
      expect(html).toContain("员工视图");
    }
  });

  it("keeps the existing manager-to-employee action for non-admin managers", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-only");

    const html = render("manager", "manager-only");
    expect(html).not.toContain('class="wb-admin-view-switch"');
    expect(html).toContain('id="navMyTasks"');
    expect(html).toContain("我负责的任务");
  });

  it("does not offer unavailable manager views to admin-only users", () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-only");

    const html = render("admin", "admin-only");
    expect(html).not.toContain('class="wb-admin-view-switch"');
    expect(html).not.toContain('data-wb-view="manager"');
  });

  it("does not expose the view switch to ordinary employees", () => {
    const html = render("employee", "employee-only");
    expect(html).not.toContain('class="wb-admin-view-switch"');
    expect(html).not.toContain("切换视图");
  });
});
