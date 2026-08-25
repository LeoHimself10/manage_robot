import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWorkbenchPage } from "../../src/web/workbench-shell";

afterEach(() => vi.unstubAllEnvs());

function render(role: "manager" | "employee" | "admin", userId: string): string {
  return renderWorkbenchPage({
    role,
    activeNav: role === "manager" ? "mgr-tasks" : role === "employee" ? "emp-new" : "adm-ops",
    title: "身份导航测试",
    pageTitle: "身份导航测试",
    sessionUserId: userId,
    mainHtml: "<p>test</p>",
  });
}

describe("workbench role navigation", () => {
  it("keeps ordinary and quality overlays on their configured base role", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "manager-1,project-manager-1");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "project-manager-1");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-specialist-1");

    const manager = render("manager", "manager-1");
    expect(manager).toContain("历史任务");
    expect(manager).not.toContain("质量追踪");
    expect(manager).not.toContain("管理员查看视角");

    const projectManager = render("manager", "project-manager-1");
    expect(projectManager).toContain("历史任务");
    expect(projectManager).toContain("质量追踪");
    expect(projectManager).not.toContain("管理员查看视角");

    const employee = render("employee", "employee-1");
    expect(employee).toContain("待承接");
    expect(employee).not.toContain("质量追踪");
    expect(employee).not.toContain("管理员查看视角");

    const specialist = render("employee", "quality-specialist-1");
    expect(specialist).toContain("待承接");
    expect(specialist).toContain("质量追踪");
    expect(specialist).not.toContain("管理员查看视角");
  });

  it("keeps the administrator operations shell unchanged and adds only the quality entry", () => {
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin-1");
    const html = render("admin", "admin-1");
    expect(html).toContain("任务总览");
    expect(html).toContain("运营看板");
    expect(html).toContain("权限中心");
    expect(html).toContain("质量追踪");
    expect(html).not.toContain("管理员查看视角");
  });
});
