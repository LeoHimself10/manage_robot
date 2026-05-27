import { describe, expect, it } from "vitest";
import { buildWeekSpanRange, resolveCenterWeek, zonedMidnightUtcIso } from "../../../src/agent/weekly-dashboard/week-range";

describe("weekly dashboard week range", () => {
  it("uses Asia/Shanghai Monday midnight as UTC boundary", () => {
    const week = resolveCenterWeek({
      week: "2026-05-27",
      timezone: "Asia/Shanghai",
    });
    expect(week.mondayYmd).toBe("2026-05-25");
    expect(week.startIso).toBe("2026-05-24T16:00:00.000Z");
    expect(week.endIso).toBe("2026-05-31T16:00:00.000Z");
    expect(week.id).toBe("2026-W22");
  });

  it("builds +/- span weeks across year boundaries", () => {
    const span = buildWeekSpanRange({
      centerWeek: "2026-01-01",
      span: 1,
      timezone: "Asia/Shanghai",
    });
    expect(span.weeks.map((w) => w.mondayYmd)).toEqual(["2025-12-22", "2025-12-29", "2026-01-05"]);
    expect(span.weeks[1]?.id).toBe("2026-W01");
  });

  it("converts DST-zone local midnight without using UTC ISO week shortcuts", () => {
    expect(zonedMidnightUtcIso("2026-03-09", "America/New_York")).toBe("2026-03-09T04:00:00.000Z");
  });
});
