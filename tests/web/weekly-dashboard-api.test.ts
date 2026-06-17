import { describe, expect, it } from "vitest";
import { sanitizeWorkbenchActiveUsersForManager } from "../../src/web/weekly-dashboard-sanitize";

describe("sanitizeWorkbenchActiveUsersForManager", () => {
  it("strips userId and surfaces; unknown names become 未知", () => {
    const out = sanitizeWorkbenchActiveUsersForManager([
      {
        userId: "ding-123",
        displayName: "曹杰",
        eventCount: 3,
        surfaces: ["manager"],
        surfaceLabel: "主管端",
      },
      {
        userId: "ding-456",
        displayName: "ding-456",
        eventCount: 1,
        surfaces: ["employee"],
        surfaceLabel: "员工端",
      },
    ]);
    expect(out).toEqual([
      { displayName: "曹杰", surfaceLabel: "主管端", eventCount: 3 },
      { displayName: "未知", surfaceLabel: "员工端", eventCount: 1 },
    ]);
    expect(out.every((row) => !("userId" in row))).toBe(true);
  });

  it("maps Admin surface label to 主管端 for manager-facing payload", () => {
    const out = sanitizeWorkbenchActiveUsersForManager([
      {
        userId: "admin-1",
        displayName: "Rain",
        eventCount: 2,
        surfaces: ["manager", "admin"],
        surfaceLabel: "主管端 / Admin",
      },
    ]);
    expect(out[0]?.surfaceLabel).toBe("主管端");
  });
});
