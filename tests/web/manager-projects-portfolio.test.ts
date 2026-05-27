import { describe, expect, it } from "vitest";
import { renderManagerTasksPage } from "../../src/web/manager-workbench-pages";
import { renderManagerProjectsPage } from "../../src/web/manager-projects-pages";
import { buildQwenPlannerSystemPrompt } from "../../src/agent/demo/qwen-prompt";

describe("manager project portfolio UI guards", () => {
  it("baseline manager HTML has no 项目总览 nav", () => {
    const html = renderManagerTasksPage({ userLabel: "测试", projectPortfolioEnabled: false });
    expect(html).not.toContain("项目总览");
    expect(html).not.toContain("/api/workbench/manager/projects");
    expect(html).not.toContain('id="filterProject"');
  });

  it("portfolio manager HTML includes grouped view and bulk assign", () => {
    const html = renderManagerTasksPage({
      userLabel: "测试",
      projectPortfolioEnabled: true,
      initialView: "group",
    });
    expect(html).toContain("项目总览");
    expect(html).toContain('id="filterProject"');
    expect(html).toContain("bulkAssignBar");
    expect(html).toContain("将所选任务归入到项目");
    expect(html).toContain("按项目归档");
    expect(html).toContain("所属项目");
    expect(html).not.toContain("wbScopeChipsMount");
    expect(html).not.toContain("大项目");
    expect(html).not.toContain("条大任务");
  });

  it("projects overview page has no presentation mode and uses view=group links", () => {
    const html = renderManagerProjectsPage({ userLabel: "测试" });
    expect(html).toContain("/api/workbench/manager/projects");
    expect(html).not.toContain("开会展示");
    expect(html).not.toContain("presentation=1");
    expect(html).toContain("view=group");
    expect(html).toContain("project-card__progress");
    expect(html).not.toContain("kpi-row");
    expect(html).not.toContain("条大任务");
  });

  it("planner prompt without portfolio omits project tools line", () => {
    const sys = buildQwenPlannerSystemPrompt("planner", { projectPortfolioContext: false });
    expect(sys).not.toContain("list_projects");
    expect(sys).not.toContain("suggest_project");
  });

  it("planner prompt with portfolio injects project discipline", () => {
    const sys = buildQwenPlannerSystemPrompt("planner", { projectPortfolioContext: true });
    expect(sys).toContain("list_projects");
    expect(sys).toContain("suggest_project");
  });
});
