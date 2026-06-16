import { describe, expect, it, vi } from "vitest";
import {
  isFullDayLeave,
  leaveDurationHours,
  leaveOverlapsWindow,
  splitMissingByFullDayLeave,
  applyLeaveToOrgDigests,
} from "../../../src/agent/daily-report-digest/daily-report-leave";
import type { OrgDigest } from "../../../src/agent/daily-report-digest/daily-report-build";

describe("daily-report-leave", () => {
  const window = { startTime: 1000, endTime: 2000 };

  it("isFullDayLeave: 1 day or >=8 work hours; partial hours stay false", () => {
    expect(
      isFullDayLeave({
        userid: "u1",
        startTime: 1100,
        endTime: 1900,
        durationUnit: "percent_day",
        durationPercent: 100,
      }),
    ).toBe(true);
    expect(
      isFullDayLeave({
        userid: "u1",
        startTime: 1100,
        endTime: 1900,
        durationUnit: "percent_hour",
        durationPercent: 800,
      }),
    ).toBe(true);
    expect(
      isFullDayLeave({
        userid: "u1",
        startTime: 1100,
        endTime: 1400,
        durationUnit: "percent_hour",
        durationPercent: 400,
      }),
    ).toBe(false);
    expect(
      isFullDayLeave({
        userid: "u1",
        startTime: 1100,
        endTime: 1200,
        durationUnit: "percent_hour",
        durationPercent: 200,
      }),
    ).toBe(false);
    expect(leaveDurationHours({
      userid: "u1",
      startTime: 0,
      endTime: 0,
      durationUnit: "percent_hour",
      durationPercent: 800,
    })).toBe(8);
  });

  it("splitMissingByFullDayLeave moves only full-day overlapping leave", () => {
    const missing = [
      { userid: "u_a", name: "甲" },
      { userid: "u_b", name: "乙" },
      { userid: "u_c", name: "丙" },
    ];
    const leaveEntries = [
      {
        userid: "u_a",
        startTime: 1200,
        endTime: 1800,
        durationUnit: "percent_day",
        durationPercent: 100,
      },
      {
        userid: "u_b",
        startTime: 1200,
        endTime: 1800,
        durationUnit: "percent_hour",
        durationPercent: 400,
      },
    ];
    const result = splitMissingByFullDayLeave(missing, leaveEntries, window);
    expect(result.onLeave.map((m) => m.userid)).toEqual(["u_a"]);
    expect(result.missing.map((m) => m.userid)).toEqual(["u_b", "u_c"]);
  });

  it("leaveOverlapsWindow requires interval intersection", () => {
    expect(
      leaveOverlapsWindow(
        { userid: "u1", startTime: 500, endTime: 900, durationUnit: "percent_day", durationPercent: 100 },
        window.startTime,
        window.endTime,
      ),
    ).toBe(false);
    expect(
      leaveOverlapsWindow(
        { userid: "u1", startTime: 1500, endTime: 2500, durationUnit: "percent_day", durationPercent: 100 },
        window.startTime,
        window.endTime,
      ),
    ).toBe(true);
  });

  it("applyLeaveToOrgDigests keeps missing on API failure", async () => {
    const digest: OrgDigest = {
      label: "明思",
      submitted: [],
      missing: [{ userid: "u_a", name: "甲" }],
      onLeave: [],
      errors: [],
    };
    const client = {
      fetchLeaveStatus: vi.fn().mockRejectedValue(new Error("permission denied")),
    };
    const out = await applyLeaveToOrgDigests([digest], [
      { label: "明思", appKey: "k", appSecret: "s", employees: [{ userid: "u_a" }] },
    ], window, { leaveClient: client });
    expect(out[0]!.missing).toHaveLength(1);
    expect(out[0]!.onLeave).toEqual([]);
  });

  it("applyLeaveToOrgDigests splits missing when leave API succeeds", async () => {
    const digest: OrgDigest = {
      label: "明思",
      submitted: [],
      missing: [{ userid: "u_a", name: "甲" }],
      onLeave: [],
      errors: [],
    };
    const client = {
      fetchLeaveStatus: vi.fn().mockResolvedValue([
        {
          userid: "u_a",
          startTime: 1100,
          endTime: 1900,
          durationUnit: "percent_day",
          durationPercent: 100,
        },
      ]),
    };
    const out = await applyLeaveToOrgDigests([digest], [
      { label: "明思", appKey: "k", appSecret: "s", employees: [{ userid: "u_a" }] },
    ], window, { leaveClient: client });
    expect(out[0]!.missing).toEqual([]);
    expect(out[0]!.onLeave.map((m) => m.name)).toEqual(["甲"]);
  });
});
