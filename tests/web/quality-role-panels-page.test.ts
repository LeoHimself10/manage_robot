import { describe, expect, it } from "vitest";
import { renderQualityRolePanelsPage } from "../../src/web/quality-role-panels-page";

function visibleMain(html: string): string {
  return html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
}

describe("quality role panels page", () => {
  it("renders the five admin perspectives and five isolated test perspectives", () => {
    const html = renderQualityRolePanelsPage({
      role: "admin",
      userId: "admin-1",
      isAdmin: true,
      canReport: true,
      hasQualityManagement: true,
      testActorsEnabled: true,
    });
    const main = visibleMain(html);
    for (const label of ["马荣鑫", "佟成", "主管", "看板", "测试"]) {
      expect(main).toContain(`>${label}</button>`);
    }
    for (const label of ["马荣鑫（测试）", "佟成（测试）", "主管一（测试）", "主管二（测试）", "测试看板"]) {
      expect(main).toContain(`>${label}</button>`);
    }
    expect(main).toContain("当前为管理员只读预览");
    expect(main).toContain("先展开部门，再单选一名主管");
    expect(main).not.toContain("用户编号");
    expect(main).not.toContain("原始 JSON");
    expect(main).not.toContain("PENDING_ASSIGNMENT");
    expect(html).toContain(".qt-dialog-actions[hidden] { display: none; }");
    expect(html).toContain("actions.hidden=view.readonly||view.perspective!=='manager'");
    expect(html.indexOf("actions.hidden=view.readonly||view.perspective!=='manager'"))
      .toBeLessThan(html.indexOf("if(!view.branch.length)"));
  });

  it("does not expose admin/test switches to a real business user", () => {
    const html = renderQualityRolePanelsPage({
      role: "manager",
      userId: "quality-real",
      hasQualityManagement: true,
      testActorsEnabled: true,
    });
    const main = visibleMain(html);
    expect(main).not.toContain("质量事件查看视角");
    expect(main).not.toContain("质量测试视角");
    expect(main).not.toContain("主管一（测试）");
  });

  it("keeps the selector single-choice and only one department expanded", () => {
    const html = renderQualityRolePanelsPage({
      role: "admin",
      userId: "admin-1",
      isAdmin: true,
      testActorsEnabled: true,
    });
    expect(html).toContain("selectedCandidate=person");
    expect(html).toContain("if(item!==options)item.hidden=true");
    expect(html).toContain("candidateRef:selectedCandidate.candidateRef");
    expect(html).not.toContain("candidateRefs:");
  });
});
