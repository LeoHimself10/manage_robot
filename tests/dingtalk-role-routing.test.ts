import { afterEach, describe, expect, it } from "vitest";
import { buildDingtalkOrchestratorRoutingParams } from "../src/dingtalk-bot";

function fakeRepo(userIds: string[]) {
  return {
    list: () => userIds.map((userId) => ({ userId })) as Array<{ userId: string }>,
  };
}

describe("dingtalk entry routing integration", () => {
  const oldRouting = process.env.DINGTALK_ROLE_ROUTING_ENABLED;
  const oldManagerIds = process.env.WORKBENCH_MANAGER_USER_IDS;
  const oldAdminIds = process.env.WORKBENCH_ADMIN_USER_IDS;

  afterEach(() => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = oldRouting;
    process.env.WORKBENCH_MANAGER_USER_IDS = oldManagerIds;
    process.env.WORKBENCH_ADMIN_USER_IDS = oldAdminIds;
  });

  it("passes manager profile for manager users", () => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "1";
    process.env.WORKBENCH_MANAGER_USER_IDS = "mgr_001";
    const params = buildDingtalkOrchestratorRoutingParams({
      senderStaffId: "mgr_001",
      employeeRepo: fakeRepo([]) as any,
    });
    expect(params.promptProfile).toBe("manager");
    expect(params.toolProfile).toBe("manager");
    expect(params.trustedActorUserId).toBeUndefined();
  });

  it("passes employee profile + trusted actor for employee users", () => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "1";
    const params = buildDingtalkOrchestratorRoutingParams({
      senderStaffId: "emp_001",
      employeeRepo: fakeRepo(["emp_001"]) as any,
    });
    expect(params.promptProfile).toBe("employee");
    expect(params.toolProfile).toBe("employee");
    expect(params.trustedActorUserId).toBe("emp_001");
  });

  it("falls back to planner when routing disabled", () => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "0";
    const params = buildDingtalkOrchestratorRoutingParams({
      senderStaffId: "emp_001",
      employeeRepo: fakeRepo(["emp_001"]) as any,
    });
    expect(params.promptProfile).toBe("planner");
    expect(params.toolProfile).toBe("planner");
    expect(params.trustedActorUserId).toBeUndefined();
  });
});
