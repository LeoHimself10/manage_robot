import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { setDynamicWorkbenchManager } from "../../security/workbench-manager-directory";

export const SET_MANAGER_PERMISSION_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_manager_permission",
    description:
      "管理员设置某用户是否拥有主管权限。会写权限审计日志；调用前必须明确 userId 与 enabled(true/false)。若用户用人名描述对象，请先调 search_employees 解析 userId 并在 message 里向管理员复述“将把 <显示名>(<userId>) 设为/取消主管，确认吗？”，待管理员明确确认后再调本工具。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        userId: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["userId", "enabled"],
    },
  },
};

export function buildSetManagerPermissionHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const peopleStore = deps.peopleStore ?? createPeopleDirectoryStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    const userId = String(args.userId ?? "").trim();
    const enabled = args.enabled === true;
    if (!actorUserId || !userId || typeof args.enabled !== "boolean") {
      throw new Error("actorUserId, userId and enabled(boolean) are required");
    }
    const contact = peopleStore.getContact(userId);
    if (!contact) throw new Error("contact not found");
    if (enabled && !contact.active) {
      throw new Error("cannot grant manager to inactive contact");
    }
    const mutation = setDynamicWorkbenchManager(userId, enabled);
    taskStore.appendPermissionEvent({
      actorUserId,
      targetUserId: userId,
      before: mutation.before,
      after: mutation.after,
      payload: {
        changed: mutation.changed,
        source: "agent_tool",
      },
    });
    return {
      ok: true,
      userId,
      before: mutation.before,
      after: mutation.after,
      changed: mutation.changed,
    };
  };
}
