import { describe, expect, it } from "vitest";
import {
  addDaysToYmd,
  previousCalendarDayRangeInTz,
  startOfDayInTz,
  zonedMidnightUtcIso,
} from "../../../src/agent/reminders/reminder-policy";

describe("reminder-policy timezone helpers", () => {
  it("startOfDayInTz uses Asia/Shanghai midnight not UTC midnight", () => {
    const now = new Date("2026-05-21T01:00:00.000Z");
    expect(startOfDayInTz(now, "Asia/Shanghai")).toBe("2026-05-20T16:00:00.000Z");
  });

  it("zonedMidnightUtcIso for Shanghai calendar day", () => {
    expect(zonedMidnightUtcIso("2026-05-21", "Asia/Shanghai")).toBe(
      "2026-05-20T16:00:00.000Z",
    );
  });

  it("addDaysToYmd subtracts one calendar day", () => {
    expect(addDaysToYmd("2026-05-21", -1)).toBe("2026-05-20");
  });

  it("previousCalendarDayRangeInTz covers yesterday 00:00 to today 00:00 Shanghai", () => {
    const now = new Date("2026-05-21T06:48:00.000Z");
    const range = previousCalendarDayRangeInTz(now, "Asia/Shanghai");
    expect(range.labelYmd).toBe("2026-05-20");
    expect(range.labelDisplay).toBe("5月20日");
    expect(range.sinceIso).toBe("2026-05-19T16:00:00.000Z");
    expect(range.untilIso).toBe("2026-05-20T16:00:00.000Z");
  });

  it("Monday send uses Sunday as previous day", () => {
    const monday = new Date("2026-05-25T01:00:00.000Z");
    const range = previousCalendarDayRangeInTz(monday, "Asia/Shanghai");
    expect(range.labelYmd).toBe("2026-05-24");
  });
});
