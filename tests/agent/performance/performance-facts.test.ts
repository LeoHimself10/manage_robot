import { describe, expect, it } from "vitest";
import {
  buildEmployeePerformanceFacts,
  type PerformanceDataset,
} from "../../../src/agent/performance/performance-facts";

const AS_OF = "2026-06-08T00:00:00.000Z";

function findRow(facts: ReturnType<typeof buildEmployeePerformanceFacts>, userId: string) {
  const row = facts.rows.find((r) => r.userId === userId);
  if (!row) throw new Error(`row not found: ${userId}`);
  return row;
}

describe("buildEmployeePerformanceFacts", () => {
  it("computes late/on-time/overdue/avgLateDays and sorts by late rate", () => {
    const dataset: PerformanceDataset = {
      subtasks: [
        // emp-1: late done (2d), on-time done, currently overdue, unknown-completion done
        { subtaskId: "A", assigneeUserId: "emp-1", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-03T10:00:00.000Z" },
        { subtaskId: "B", assigneeUserId: "emp-1", status: "DONE", dueAt: "2026-05-20T10:00:00.000Z", completedAt: "2026-05-19T10:00:00.000Z" },
        { subtaskId: "C", assigneeUserId: "emp-1", status: "IN_PROGRESS", dueAt: "2026-06-05T10:00:00.000Z" },
        { subtaskId: "E", assigneeUserId: "emp-1", status: "DONE", dueAt: "2026-06-04T10:00:00.000Z" },
        // emp-2: on-time done; plus one DONE-late but OUTSIDE window (should be excluded)
        { subtaskId: "D", assigneeUserId: "emp-2", status: "DONE", dueAt: "2026-05-01T10:00:00.000Z", completedAt: "2026-05-01T09:00:00.000Z" },
        { subtaskId: "F", assigneeUserId: "emp-2", status: "DONE", dueAt: "2025-01-01T10:00:00.000Z", completedAt: "2025-03-01T10:00:00.000Z" },
      ],
      reminders: [{ subtaskId: "A", total: 3 }],
      overdueAlerts: [{ subtaskId: "C", count: 1 }],
      reassignedSubtaskIds: ["A"],
    };

    const facts = buildEmployeePerformanceFacts(dataset, { asOf: AS_OF, windowDays: 90, scopeKind: "all" });

    expect(facts.scopeKind).toBe("all");
    expect(facts.windowDays).toBe(90);
    // F excluded by window; A,B,C,E (emp-1) + D (emp-2) = 5 considered
    expect(facts.totalSubtasksConsidered).toBe(5);

    const e1 = findRow(facts, "emp-1");
    expect(e1.withDueTotal).toBe(4);
    expect(e1.doneTotal).toBe(3);
    expect(e1.lateDone).toBe(1);
    expect(e1.onTimeDone).toBe(2); // B + E(unknown completion counted on-time)
    expect(e1.lateRate).toBeCloseTo(1 / 3, 4);
    expect(e1.avgLateDays).toBeCloseTo(2, 2);
    expect(e1.maxLateDays).toBeCloseTo(2, 2);
    expect(e1.currentlyOverdue).toBe(1);
    expect(e1.remindedCount).toBe(3);
    expect(e1.managerOverdueAlerts).toBe(1);
    expect(e1.reassignedInvolved).toBe(1);
    expect(e1.unknownCompletion).toBe(1);

    const e2 = findRow(facts, "emp-2");
    expect(e2.doneTotal).toBe(1); // F excluded
    expect(e2.lateDone).toBe(0);
    expect(e2.lateRate).toBe(0);
    expect(e2.sampleStatus).toBe("scored");
    expect(e2.lateRateLabel).toBe("0.0%");

    // sorted: emp-1 (higher late rate) before emp-2
    expect(facts.rows[0].userId).toBe("emp-1");
  });

  it("inactive employee without completions shows null late rate, not 0%", () => {
    const dataset: PerformanceDataset = {
      subtasks: [
        { subtaskId: "Z", assigneeUserId: "idle", status: "STOPPED", dueAt: "2026-05-15T10:00:00.000Z" },
      ],
      reminders: [],
      overdueAlerts: [],
      reassignedSubtaskIds: [],
    };
    const facts = buildEmployeePerformanceFacts(dataset, { asOf: AS_OF, windowDays: 90 });
    const row = findRow(facts, "idle");
    expect(row.doneTotal).toBe(0);
    expect(row.lateRate).toBeNull();
    expect(row.sampleStatus).toBe("inactive");
    expect(row.lateRateLabel).toBe("无完成样本");
  });

  it("honors date-only due (18:00 Asia/Shanghai = 10:00 UTC) for late判定", () => {
    const onTime: PerformanceDataset = {
      subtasks: [
        { subtaskId: "X", assigneeUserId: "u", status: "DONE", dueAt: "2026-06-05", completedAt: "2026-06-05T09:00:00.000Z" },
      ],
      reminders: [],
      overdueAlerts: [],
      reassignedSubtaskIds: [],
    };
    const late: PerformanceDataset = {
      subtasks: [
        { subtaskId: "X", assigneeUserId: "u", status: "DONE", dueAt: "2026-06-05", completedAt: "2026-06-05T12:00:00.000Z" },
      ],
      reminders: [],
      overdueAlerts: [],
      reassignedSubtaskIds: [],
    };
    const onTimeFacts = buildEmployeePerformanceFacts(onTime, { asOf: AS_OF });
    const lateFacts = buildEmployeePerformanceFacts(late, { asOf: AS_OF });
    expect(findRow(onTimeFacts, "u").lateDone).toBe(0);
    expect(findRow(lateFacts, "u").lateDone).toBe(1);
  });

  it("skips subtasks without parseable due_at", () => {
    const dataset: PerformanceDataset = {
      subtasks: [
        { subtaskId: "N", assigneeUserId: "u", status: "DONE", dueAt: undefined, completedAt: "2026-06-01T00:00:00.000Z" },
        { subtaskId: "M", assigneeUserId: "u", status: "DONE", dueAt: "待确认", completedAt: "2026-06-01T00:00:00.000Z" },
      ],
      reminders: [],
      overdueAlerts: [],
      reassignedSubtaskIds: [],
    };
    const facts = buildEmployeePerformanceFacts(dataset, { asOf: AS_OF });
    expect(facts.totalSubtasksConsidered).toBe(0);
    expect(facts.rows).toHaveLength(0);
  });

  it("applies resolveName for display", () => {
    const dataset: PerformanceDataset = {
      subtasks: [
        { subtaskId: "A", assigneeUserId: "emp-9", status: "DONE", dueAt: "2026-06-01T10:00:00.000Z", completedAt: "2026-06-02T10:00:00.000Z" },
      ],
      reminders: [],
      overdueAlerts: [],
      reassignedSubtaskIds: [],
    };
    const facts = buildEmployeePerformanceFacts(dataset, {
      asOf: AS_OF,
      resolveName: (uid) => (uid === "emp-9" ? "张三" : undefined),
    });
    expect(findRow(facts, "emp-9").name).toBe("张三");
  });
});
