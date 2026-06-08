import { describe, expect, it } from "vitest";
import { resolvePerformancePeriod, resolvePerformanceWindowDays } from "../../../src/agent/performance/performance-period";

describe("resolvePerformancePeriod", () => {
  it("defaults rolling window to 30 days", () => {
    expect(resolvePerformanceWindowDays(undefined)).toBe(30);
    const p = resolvePerformancePeriod({ asOf: "2026-06-08T12:00:00.000Z" });
    expect(p.kind).toBe("rolling");
    expect(p.windowDays).toBe(30);
    expect(p.label).toBe("近 30 天");
  });

  it("resolves current natural month in Asia/Shanghai", () => {
    const p = resolvePerformancePeriod({
      periodKind: "month",
      asOf: "2026-06-08T12:00:00.000Z",
      timezone: "Asia/Shanghai",
    });
    expect(p.kind).toBe("month");
    expect(p.label).toBe("本月");
    expect(p.periodAnchor).toBe("2026-06");
  });

  it("resolves anchored quarter label", () => {
    const p = resolvePerformancePeriod({
      periodKind: "quarter",
      periodAnchor: "2026-Q1",
      asOf: "2026-06-08T12:00:00.000Z",
      timezone: "Asia/Shanghai",
    });
    expect(p.kind).toBe("quarter");
    expect(p.label).toBe("2026年Q1");
    expect(p.periodAnchor).toBe("2026-Q1");
  });

  it("resolves current year", () => {
    const p = resolvePerformancePeriod({
      periodKind: "year",
      asOf: "2026-06-08T12:00:00.000Z",
      timezone: "Asia/Shanghai",
    });
    expect(p.kind).toBe("year");
    expect(p.label).toBe("本年");
    expect(p.periodAnchor).toBe("2026");
  });
});
