/**
 * DingTalk meeting import tab for task-intake. Disabled by default so each
 * DingTalk org instance can opt in only after the meeting/minutes permissions
 * and event subscriptions are ready.
 */
export function isTaskIntakeDingTalkMeetingsEnabled(): boolean {
  const raw = String(process.env.TASK_INTAKE_DINGTALK_MEETINGS_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
