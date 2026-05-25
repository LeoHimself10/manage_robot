import { isWorkbenchManager } from "../src/security/workbench-manager-whitelist.ts";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../src/agent/role-routing.ts";

const route = resolveDingtalkAgentRouting({
  senderStaffId: "641871342",
  employeeRepo: { list: () => [] },
  roleRoutingEnabled: true,
});

console.log(
  JSON.stringify(
    {
      routingEnabled: isDingtalkRoleRoutingEnabled(),
      isManager: isWorkbenchManager("641871342"),
      resolvedRole: route.resolvedRole,
      reason: route.reason,
    },
    null,
    2,
  ),
);
