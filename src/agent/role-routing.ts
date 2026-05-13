import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";
import { resolveWorkbenchRole } from "../security/workbench-role-resolver";
import type { AgentPromptProfile } from "./demo/qwen-prompt";
import type { ToolProfile } from "./tools/registry";

export interface DingtalkAgentRoutingInput {
  senderStaffId: string;
  employeeRepo: { list(): EmployeeProfileRecord[] };
  roleRoutingEnabled?: boolean;
}

export interface DingtalkAgentRoutingResult {
  resolvedRole: "admin" | "manager" | "employee" | "unknown";
  promptProfile: AgentPromptProfile;
  toolProfile: ToolProfile;
  trustedActorUserId?: string;
  reason:
    | "routing_disabled"
    | "missing_sender"
    | "manager_role"
    | "employee_directory_match"
    | "employee_directory_miss";
}

export function isDingtalkRoleRoutingEnabled(): boolean {
  const raw = String(process.env.DINGTALK_ROLE_ROUTING_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveDingtalkAgentRouting(
  input: DingtalkAgentRoutingInput
): DingtalkAgentRoutingResult {
  if (!input.roleRoutingEnabled) {
    return {
      resolvedRole: "unknown",
      promptProfile: "planner",
      toolProfile: "planner",
      reason: "routing_disabled",
    };
  }
  const sender = String(input.senderStaffId ?? "").trim();
  if (!sender) {
    return {
      resolvedRole: "unknown",
      promptProfile: "planner",
      toolProfile: "planner",
      reason: "missing_sender",
    };
  }

  const resolved = resolveWorkbenchRole(sender);
  if (resolved === "admin" || resolved === "manager") {
    return {
      resolvedRole: resolved,
      promptProfile: "planner",
      toolProfile: "manager",
      trustedActorUserId: sender,
      reason: "manager_role",
    };
  }

  const inDirectory = input.employeeRepo
    .list()
    .some((e) => String(e.userId ?? "").trim() === sender);

  if (inDirectory) {
    return {
      resolvedRole: "employee",
      promptProfile: "employee",
      toolProfile: "employee",
      trustedActorUserId: sender,
      reason: "employee_directory_match",
    };
  }

  return {
    resolvedRole: "employee",
    promptProfile: "planner",
    toolProfile: "planner",
    reason: "employee_directory_miss",
  };
}
