import { describe, expect, it } from "vitest";
import { presentDueBarState, presentDueLabel, presentDueProgress } from "../../src/infra/due-present";

describe("due-present", () => {
  const d0 = new Date("2026-06-10T12:00:00.000Z");

  it("returns unset label when no dueAt", () => {
    expect(presentDueLabel(undefined, d0)).toBe("未设置截止");
  });

  it("computes progress within window", () => {
    const created = "2026-06-01T00:00:00.000Z";
    const due = "2026-06-11T00:00:00.000Z";
    const now = new Date("2026-06-06T00:00:00.000Z");
    const p = presentDueProgress(created, due, now);
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("marks overdue bar state", () => {
    const due = "2026-06-01T00:00:00.000Z";
    const now = new Date("2026-06-10T00:00:00.000Z");
    expect(presentDueBarState(due, now, "IN_PROGRESS")).toBe("overdue");
  });

  it("marks urgent within 24h", () => {
    const due = new Date(d0.getTime() + 12 * 60 * 60 * 1000).toISOString();
    expect(presentDueBarState(due, d0, "IN_PROGRESS")).toBe("urgent");
  });

  it("uses normal bar state when due is more than 24h away", () => {
    const due = new Date(d0.getTime() + 72 * 60 * 60 * 1000).toISOString();
    expect(presentDueBarState(due, d0, "IN_PROGRESS")).toBe("normal");
  });

  it("DONE uses done bar state", () => {
    expect(presentDueBarState(undefined, d0, "DONE")).toBe("done");
  });
});
