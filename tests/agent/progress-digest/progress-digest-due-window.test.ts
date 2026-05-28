import { describe, expect, it } from "vitest";
import { horizonEndMs, isDueInHorizon } from "../../../src/agent/progress-digest/progress-digest-due-window";

describe("progress-digest-due-window", () => {
  it("includes due dates within rolling 7 calendar days", () => {
    const now = new Date("2026-05-29T01:00:00.000Z");
    const end = horizonEndMs(now, 7, "Asia/Shanghai");
    expect(isDueInHorizon("2026-06-03", end, "Asia/Shanghai")).toBe(true);
    expect(isDueInHorizon("2026-06-10", end, "Asia/Shanghai")).toBe(false);
  });

  it("includes overdue items", () => {
    const now = new Date("2026-05-29T01:00:00.000Z");
    const end = horizonEndMs(now, 7, "Asia/Shanghai");
    expect(isDueInHorizon("2026-05-20", end, "Asia/Shanghai")).toBe(true);
  });
});
