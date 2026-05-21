import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { sendSubtaskReminder } from "../reminders/reminder-send";
import { loadReminderPolicy } from "../reminders/reminder-policy";

export const SEND_SUBTASK_REMINDER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "send_subtask_reminder",
    description:
      "向子任务负责人发送催办/提醒（钉钉待办+机器人；逾期较久时追加工作通知）。须先 list_follow_up_candidates 或 get_task_detail 解析 subtaskId。主管仅可操作本人任务；admin 豁免。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        subtaskId: { type: "string", description: "完整 subtask_id 或先通过 taskNo/sourceTaskKey 查详情" },
        tone: { type: "string", enum: ["polite", "firm"] },
      },
      required: ["subtaskId"],
    },
  },
};

export function buildSendSubtaskReminderHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    notifier?: ReturnType<typeof createWorkbenchPublishNotifier>;
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const notifier = deps.notifier ?? createWorkbenchPublishNotifier();
  return async (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    const subtaskId = String(args.subtaskId ?? "").trim();
    if (!actorUserId) return { ok: false, error: "trusted_actor_required" };
    if (!subtaskId) return { ok: false, error: "subtask_id_required" };
    const toneRaw = String(args.tone ?? "").trim();
    const tone = toneRaw === "firm" || toneRaw === "polite" ? toneRaw : undefined;
    const peopleStore = createPeopleDirectoryStore();
    try {
      const result = await sendSubtaskReminder(
        {
          subtaskId,
          trigger: "manual_chat",
          actorUserId,
          tone,
        },
        { taskStore, notifier, peopleStore, policy: loadReminderPolicy() },
      );
      return { ...result };
    } finally {
      peopleStore.close();
    }
  };
}
