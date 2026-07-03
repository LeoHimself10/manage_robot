import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { isWorkbenchAdmin } from "../../security/workbench-role-resolver";
import { resolveWorkbenchManagerScope } from "../../security/workbench-manager-scope";
import {
  listFollowUpCandidatesForActor,
  type FollowUpBucket,
} from "../reminders/reminder-eligibility";

export const LIST_FOLLOW_UP_CANDIDATES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_follow_up_candidates",
    description:
      "列出主管名下正式子任务的跟进候选（逾期/今日到期/本周到期/久未更新）。仅 IN_PROGRESS/BLOCKED；不按当前 planId 过滤。admin 可看全量。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        bucket: {
          type: "string",
          enum: ["overdue", "due_today", "due_this_week", "stale"],
        },
      },
      required: [],
    },
  },
};

export function buildListFollowUpCandidatesHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    if (!actorUserId) return { ok: false, error: "trusted_actor_required" };
    const bucketRaw = String(args.bucket ?? "").trim();
    const bucket = (["overdue", "due_today", "due_this_week", "stale"] as const).includes(
      bucketRaw as FollowUpBucket,
    )
      ? (bucketRaw as FollowUpBucket)
      : undefined;
    const people = createPeopleDirectoryStore();
    try {
      const isAdmin = isWorkbenchAdmin(actorUserId);
      const scope = resolveWorkbenchManagerScope(actorUserId);
      const candidates = listFollowUpCandidatesForActor(taskStore, actorUserId, {
        bucket,
        isAdmin,
        managerGroupId: isAdmin ? undefined : scope.managerGroupId,
        resolveDisplayName: (uid) => people.getContact(uid)?.name?.trim(),
      });
      return { ok: true, actorUserId, count: candidates.length, candidates };
    } finally {
      people.close();
    }
  };
}
