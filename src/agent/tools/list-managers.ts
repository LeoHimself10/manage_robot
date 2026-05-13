import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { listDynamicWorkbenchManagers } from "../../security/workbench-manager-directory";
import { listWorkbenchManagerIds } from "../../security/workbench-manager-whitelist";

export const LIST_MANAGERS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_managers",
    description: "列出当前管理者名单（动态名单 + 生效名单）。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export function buildListManagersHandler(): ToolHandler {
  return () => ({
    ok: true,
    dynamicManagers: listDynamicWorkbenchManagers(),
    effectiveManagers: [...listWorkbenchManagerIds()].sort(),
  });
}
