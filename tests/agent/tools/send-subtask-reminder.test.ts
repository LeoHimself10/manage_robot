import { describe, expect, it, vi } from "vitest";
import { buildSendSubtaskReminderHandler } from "../../../src/agent/tools/send-subtask-reminder";

vi.mock("../../../src/agent/reminders/reminder-send", () => ({
  sendSubtaskReminder: vi.fn(async () => ({
    ok: true,
    channels: ["robot", "todo"],
    tier: "day1",
  })),
}));

describe("send_subtask_reminder tool", () => {
  it("requires actor", async () => {
    const handler = buildSendSubtaskReminderHandler({
      taskStore: {} as never,
      notifier: {} as never,
    });
    const out = await handler({ subtaskId: "sid-1" });
    expect(out).toMatchObject({ ok: false, error: "trusted_actor_required" });
  });
});
