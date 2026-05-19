import { describe, expect, it } from "vitest";
import {
  REMINDER_TEMPLATE_VERSION,
  buildReminderMarkdown,
  resolveTierFromOverdueDays,
} from "../../../src/agent/reminders/reminder-templates";

describe("reminder-templates", () => {
  it("includes task fields in markdown", () => {
    const msg = buildReminderMarkdown({
      taskNo: "TK-1",
      taskTitle: "主任务",
      subtaskTitle: "排查",
      overdueDays: 2,
      tone: "polite",
    });
    expect(REMINDER_TEMPLATE_VERSION).toBe("followup-v1");
    expect(msg.subject).toContain("TK-1");
    expect(msg.markdown).toContain("排查");
    expect(msg.markdown).toContain("主任务");
  });

  it("firm tone adjusts wording", () => {
    const polite = buildReminderMarkdown({
      taskNo: "TK-2",
      taskTitle: "主",
      subtaskTitle: "修复",
      overdueDays: 3,
      tone: "polite",
    });
    const firm = buildReminderMarkdown({
      taskNo: "TK-2",
      taskTitle: "主",
      subtaskTitle: "修复",
      overdueDays: 3,
      tone: "firm",
    });
    expect(firm.markdown).not.toBe(polite.markdown);
  });

  it("resolveTierFromOverdueDays maps day2 threshold", () => {
    expect(resolveTierFromOverdueDays(1, 1)).toBe("day1");
    expect(resolveTierFromOverdueDays(2, 1)).toBe("day2plus");
  });
});
