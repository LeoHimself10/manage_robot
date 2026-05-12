import { afterEach, describe, expect, it } from "vitest";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../../src/agent/role-routing";

function fakeRepo(userIds: string[]) {
  return {
    list: () => userIds.map((userId) => ({ userId })) as Array<{ userId: string }>,
  };
}

describe("resolveDingtalkAgentRouting", () => {
  const oldAdminIds = process.env.WORKBENCH_ADMIN_USER_IDS;
  const oldManagerIds = process.env.WORKBENCH_MANAGER_USER_IDS;
  const oldRouting = process.env.DINGTALK_ROLE_ROUTING_ENABLED;

  afterEach(() => {
    process.env.WORKBENCH_ADMIN_USER_IDS = oldAdminIds;
    process.env.WORKBENCH_MANAGER_USER_IDS = oldManagerIds;
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = oldRouting;
  });

  it("falls back to planner when routing disabled", () => {
    const result = resolveDingtalkAgentRouting({
      senderStaffId: "emp_001",
      employeeRepo: fakeRepo(["emp_001"]) as any,
      roleRoutingEnabled: false,
    });
    expect(result.promptProfile).toBe("planner");
    expect(result.toolProfile).toBe("planner");
    expect(result.reason).toBe("routing_disabled");
    expect(result.trustedActorUserId).toBeUndefined();
  });

  it("routes admin/manager to manager profile", () => {
    process.env.WORKBENCH_ADMIN_USER_IDS = "admin_1";
    process.env.WORKBENCH_MANAGER_USER_IDS = "mgr_1";

    const adminResult = resolveDingtalkAgentRouting({
      senderStaffId: "admin_1",
      employeeRepo: fakeRepo([]) as any,
      roleRoutingEnabled: true,
    });
    expect(adminResult.promptProfile).toBe("manager");
    expect(adminResult.toolProfile).toBe("manager");

    const managerResult = resolveDingtalkAgentRouting({
      senderStaffId: "mgr_1",
      employeeRepo: fakeRepo([]) as any,
      roleRoutingEnabled: true,
    });
    expect(managerResult.promptProfile).toBe("manager");
    expect(managerResult.toolProfile).toBe("manager");
  });

  it("routes employee to employee profile only when in people directory", () => {
    const employeeResult = resolveDingtalkAgentRouting({
      senderStaffId: "emp_001",
      employeeRepo: fakeRepo(["emp_001"]) as any,
      roleRoutingEnabled: true,
    });
    expect(employeeResult.promptProfile).toBe("employee");
    expect(employeeResult.toolProfile).toBe("employee");
    expect(employeeResult.trustedActorUserId).toBe("emp_001");
    expect(employeeResult.reason).toBe("employee_directory_match");

    const missResult = resolveDingtalkAgentRouting({
      senderStaffId: "emp_001",
      employeeRepo: fakeRepo([]) as any,
      roleRoutingEnabled: true,
    });
    expect(missResult.promptProfile).toBe("planner");
    expect(missResult.toolProfile).toBe("planner");
    expect(missResult.trustedActorUserId).toBeUndefined();
    expect(missResult.reason).toBe("employee_directory_miss");
  });
});

describe("isDingtalkRoleRoutingEnabled", () => {
  const oldRouting = process.env.DINGTALK_ROLE_ROUTING_ENABLED;

  afterEach(() => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = oldRouting;
  });

  it("parses boolean-like env values", () => {
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "1";
    expect(isDingtalkRoleRoutingEnabled()).toBe(true);
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "true";
    expect(isDingtalkRoleRoutingEnabled()).toBe(true);
    process.env.DINGTALK_ROLE_ROUTING_ENABLED = "0";
    expect(isDingtalkRoleRoutingEnabled()).toBe(false);
  });
});
