import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";

export const GET_MY_PROFILE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_my_profile",
    description: "读取当前员工的能力画像（skillTags/strengths/boundaries/cases/tools/availability）。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
      },
      required: [],
    },
  },
};

export function buildGetMyProfileHandler(
  deps: { peopleStore?: ReturnType<typeof createPeopleDirectoryStore> } = {},
): ToolHandler {
  const peopleStore = deps.peopleStore ?? createPeopleDirectoryStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    if (!actorUserId) throw new Error("actorUserId is required");
    const snapshot = peopleStore.getEmployeeSnapshot(actorUserId);
    return {
      ok: true,
      userId: actorUserId,
      profile: snapshot?.selfProfile ?? {
        skillTags: [],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: {},
      },
      updatedAt: peopleStore.getProfile(actorUserId)?.updatedAt ?? null,
    };
  };
}
