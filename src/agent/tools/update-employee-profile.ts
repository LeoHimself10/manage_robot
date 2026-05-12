import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";

export const UPDATE_EMPLOYEE_PROFILE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_employee_profile",
    description:
      "更新员工自助能力画像（只写本地 employee_profiles 与审计事件，不修改通讯录快照）。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        skillTags: { type: "array", items: { type: "string" } },
        strengths: { type: "array", items: { type: "string" } },
        boundaries: { type: "array", items: { type: "string" } },
        tools: { type: "array", items: { type: "string" } },
        availability: { type: "object" },
      },
      required: ["actorUserId"],
    },
  },
};

export function buildUpdateEmployeeProfileHandler(
  deps: { peopleStore?: ReturnType<typeof createPeopleDirectoryStore> } = {},
): ToolHandler {
  const peopleStore = deps.peopleStore ?? createPeopleDirectoryStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    if (!actorUserId) throw new Error("actorUserId is required");
    const stringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
    const availability =
      args.availability && typeof args.availability === "object"
        ? (args.availability as {
            capacityHint?: string;
            emergencyOk?: boolean;
            rejectedTaskTypes?: string[];
          })
        : {};
    const existed = peopleStore.getProfile(actorUserId);
    peopleStore.upsertProfile({
      userId: actorUserId,
      skillTags: stringArray(args.skillTags),
      strengths: stringArray(args.strengths),
      boundaries: stringArray(args.boundaries),
      tools: stringArray(args.tools),
      cases: existed?.cases ?? [],
      availability: {
        capacityHint: typeof availability.capacityHint === "string" ? availability.capacityHint : undefined,
        emergencyOk: typeof availability.emergencyOk === "boolean" ? availability.emergencyOk : undefined,
        rejectedTaskTypes: stringArray(availability.rejectedTaskTypes),
      },
      source: "agent_tool_self_update",
      selfUpdatedAt: new Date().toISOString(),
    });
    peopleStore.appendProfileEvent({
      userId: actorUserId,
      eventType: "employee_profile_updated",
      actorUserId,
      payload: {
        byTool: "update_employee_profile",
      },
    });
    return { ok: true, userId: actorUserId };
  };
}
