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

  it("portfolio manager HTML includes project nav and filter", () => {
    const html = renderManagerTasksPage({ userLabel: "测试", projectPortfolioEnabled: true });
    expect(html).toContain("项目总览");
    expect(html).toContain("filterProject");
    expect(html).toContain('id="filterProject"');
    expect(html).toContain("/api/workbench/manager/projects");
  });

  it("projects overview page loads project API in script", () => {
    const html = renderManagerProjectsPage({ userLabel: "测试" });
    expect(html).toContain("/api/workbench/manager/projects");
    expect(html).toContain("开会展示");
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
