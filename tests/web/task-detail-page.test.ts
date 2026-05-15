import { describe, expect, it } from "vitest";
import { renderTaskDetailPage } from "../../src/web/assignment-workbench";

describe("renderTaskDetailPage", () => {
  it("manager HTML includes subtask detail section and shared dt/dd helper", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks",
    });
    expect(html).toContain("子任务详情");
    expect(html).toContain("function subtaskDetailDtDds");
    expect(html).toContain("输入材料");
    expect(html).toContain("前置依赖");
  });

  it("employee HTML still uses subtaskDetailDtDds for mine section", () => {
    const html = renderTaskDetailPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=current",
    });
    expect(html).toContain("function subtaskDetailDtDds");
  });
});
