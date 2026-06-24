import { describe, expect, it } from "vitest";
import type { DeliveryReminderCore, ProgressDigestFacts } from "../../../src/agent/progress-digest/progress-digest-facts";
import {
  dedupeCombinedManagerDueSoon,
  dueSoonItemKey,
} from "../../../src/agent/progress-digest/progress-digest-facts";
import {
  renderDeliveryReminderTemplate,
} from "../../../src/agent/progress-digest/progress-digest-templates";

function deliveryFacts(overrides: Partial<ProgressDigestFacts> = {}): ProgressDigestFacts {
  const employeeCore: DeliveryReminderCore = {
    dueSoon: [
      {
        taskTitle: "培训任务",
        taskNo: "TASK-1",
        subtaskTitle: "教材准备",
        statusLabel: "待承接",
        dueLabel: "6月3日",
        overdue: false,
        dueSortMs: 1,
      },
    ],
    skippedNoDueDate: 0,
    skippedBeyondHorizon: 4,
  };
  const managerCore: DeliveryReminderCore = {
    dueSoon: [
      {
        taskTitle: "培训任务",
        taskNo: "TASK-1",
        subtaskTitle: "教材准备",
        assigneeUserId: "u-self",
        assigneeName: "姚凯珩",
        statusLabel: "待承接",
        dueLabel: "6月3日",
        overdue: false,
        dueSortMs: 1,
      },
    ],
    skippedNoDueDate: 0,
    skippedBeyondHorizon: 4,
  };
  return {
    dateYmd: "2026-05-29",
    dateDisplay: "5月29日",
    audience: "combined",
    recipientUserId: "u-self",
    detailUrl: "https://example.com/workbench/manager/tasks",
    isBrief: false,
    contentMode: "delivery_reminder",
    activityWindow: {
      sinceIso: "2026-05-27T16:00:00.000Z",
      untilIso: "2026-05-28T16:00:00.000Z",
      labelYmd: "2026-05-28",
      labelDisplay: "5月28日",
    },
    core: {
      summary: {
        needsYouCount: 0,
        inProgressCount: 0,
        waitingAcceptCount: 0,
        blockedCount: 0,
        overdueCount: 0,
      },
      needsAttention: [],
      inProgress: [],
      recentUpdates: [],
    },
    deliveryReminder: { manager: managerCore, employee: employeeCore },
    ...overrides,
  };
}

describe("delivery reminder templates", () => {
  it("dedupes self-assigned rows from manager section for combined audience", () => {
    const facts = deliveryFacts();
    const team = dedupeCombinedManagerDueSoon(
      facts.deliveryReminder!.manager!,
      facts.deliveryReminder!.employee!,
      "u-self",
    );
    expect(team).toHaveLength(0);
    expect(dueSoonItemKey(facts.deliveryReminder!.employee!.dueSoon[0]!)).toBe("TASK-1:教材准备");
  });

  it("renderDeliveryReminderTemplate shows employee section only when combined self-assigned", () => {
    const { markdown, subject } = renderDeliveryReminderTemplate(deliveryFacts());
    expect(subject).toBe("近一周交付 · 1项");
    expect(markdown).toContain("### 近一周交付提醒 · 5月29日");
    expect(markdown).toContain("### 我负责的任务");
    expect(markdown).toContain("#### 1. 培训任务 · 教材准备");
    expect(markdown).toContain("- **截止**：6月3日");
    expect(markdown).toContain("另有 4 项截止在更晚");
    expect(markdown).not.toMatch(/\| --- \|/);
    expect(markdown).not.toContain("### 我主管的任务");
    expect(markdown).not.toContain("昨日动态");
  });
});
