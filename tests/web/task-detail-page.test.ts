import { describe, expect, it } from "vitest";
import { renderTaskDetailPage } from "../../src/web/assignment-workbench";

/**
 * Manual acceptance (Workbench 通知落地页 + 员工按钮 + 事件降噪):
 * - 钉钉员工动作通知 singleURL / Markdown 链接含 taskNo、subtaskId、focus=reassign；打开后主管可见改派区并提交成功。
 * - 员工「需要主管协助」统一走 request_changes，主管通知 focus=reassign；历史 customize 入口仍由 API 归一。
 * - 主管/员工任务详情事件无 REASSIGN_NOTIFY_*；MANAGER_REASSIGN 无「查看原始信息」块；?debug=1 时主管可见改派 payload 子事件。
 */
describe("renderTaskDetailPage", () => {
  it("manager HTML includes subtask detail section and shared dt/dd helper", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks",
      enforceActionGuards: false,
    });
    expect(html).toContain("子任务详情");
    expect(html).toContain("function subtaskDetailDtDds");
    expect(html).toContain("输入材料");
    expect(html).toContain("前置依赖");
    expect(html).toContain("改派");
    expect(html).toContain("detailReassignBtn");
  });

  it("employee HTML still uses subtaskDetailDtDds for mine section", () => {
    const html = renderTaskDetailPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=current",
      enforceActionGuards: false,
    });
    expect(html).toContain("function subtaskDetailDtDds");
  });
});
