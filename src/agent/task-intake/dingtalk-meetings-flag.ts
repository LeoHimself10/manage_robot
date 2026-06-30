/**
 * DingTalk meeting import tab for task-intake. Disabled by default so only the
 * mingsibot instance can opt in after VideoConference.Conference.Read is granted.
 */
export function isTaskIntakeDingTalkMeetingsEnabled(): boolean {
  const raw = String(process.env.TASK_INTAKE_DINGTALK_MEETINGS_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
