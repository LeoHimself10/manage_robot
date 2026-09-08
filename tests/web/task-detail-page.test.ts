import { describe, expect, it } from "vitest";
import {
  renderTaskDetailPage,
  renderTaskEventsPage,
} from "../../src/web/assignment-workbench";
import { renderEmployeeWorkbenchPage } from "../../src/web/employee-workbench-pages";

/**
 * Manual acceptance (Workbench 通知落地页 + 员工按钮 + 事件降噪):
 * - 钉钉员工动作通知 singleURL / Markdown 链接含 taskNo、subtaskId、focus=reassign；打开后主管可见改派区并提交成功。
 * - 员工「需要主管协助」单选 customize / request_changes 各提交一次，审计 action 区分；主管仍收到通知。
 * - 主管/员工任务详情事件无 REASSIGN_NOTIFY_*；MANAGER_REASSIGN 无「查看原始信息」块；?debug=1 时主管可见改派 payload 子事件。
 */
describe("renderTaskDetailPage", () => {
  it("manager HTML includes subtask detail section and shared dt/dd helper", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks",
      enforceActionGuards: false,
    });
    expect(html).toContain("function subtaskCoreDtDds");
    expect(html).toContain("function subtaskPlanningBlock");
    expect(html).not.toContain("function subtaskMoreDtDds");
    expect(html).toContain("前置依赖");
    expect(html).toContain("改派");
    expect(html).toContain("detailReassignBtn");
  });

  it("manager subtask reassign opens the detail-page reassign panel", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks?attention=blocked&expandedProjectId=proj-a",
      enforceActionGuards: false,
    });
    expect(html).toContain("data-mgr-open-reassign-sub");
    expect(html).not.toContain("/workbench/manager/tasks?planId=");
  });

  it("manager quality deep link renders exact review evidence and approve/return actions", () => {
    const html = renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/quality?eventId=event-1&managerStage=REVIEW",
      enforceActionGuards: false,
    });
    expect(html).toContain("urlFocus === 'quality-review'");
    expect(html).toContain("质量验收 · ");
    expect(html).toContain("提交证据");
    expect(html).toContain("data-mgr-quality-review=\"approve\"");
    expect(html).toContain("data-mgr-panel=\"quality-return\"");
    expect(html).toContain("/api/workbench/manager/quality-review");
    expect(html).toContain("返回质量事项");
    expect(html).toContain('id="subtasksCard"');
    expect(html).toContain("subtasksTitle.textContent = '待验收事项'");
    expect(html).toContain("taskCard.parentNode.insertBefore(subtasksCard, taskCard)");
  });

  it("employee HTML uses shared subtask planning helpers for mine section", () => {
    const html = renderTaskDetailPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=current",
      enforceActionGuards: false,
    });
    expect(html).toContain("function subtaskCoreDtDds");
    expect(html).not.toContain("function subtaskMoreDtDds");
  });

  it("uses the quality event number as the public business number without changing task routes", () => {
    const employee = renderEmployeeWorkbenchPage();
    expect(employee).toContain("function employeeBusinessNo(t)");
    expect(employee).toContain("t.businessNo || (context && context.eventNo) || t.taskNo");
    expect(employee).toContain("业务编号 <code>'+esc(businessNo||'—')");
    expect(employee).toContain("taskNo='+encodeURIComponent(tn)");
    expect(employee).toContain("td && !q");

    const detail = renderTaskDetailPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=new",
      enforceActionGuards: false,
    });
    expect(detail).toContain("t.businessNo || t.taskNo || taskNo");
    expect(detail).toContain("businessNo !== internalTaskNo");
    expect(detail).toContain("taskNo <code>");

    const events = renderTaskEventsPage({
      roleLabel: "employee",
      backPath: "/workbench/employee?view=new",
      detailPath: "/workbench/employee/task?taskNo=TASK-1",
    });
    expect(events).toContain("t.businessNo||t.taskNo||taskNo");
    expect(events).toContain("tasks/detail?taskNo='+encodeURIComponent(taskNo)");
  });
});
