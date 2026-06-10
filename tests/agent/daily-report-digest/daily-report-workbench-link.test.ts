import { describe, expect, it } from "vitest";

import { buildDailyReportsPublicUrl } from "../../../src/agent/daily-report-digest/daily-report-workbench-link";

describe("daily-report-workbench-link", () => {
  it("builds manager daily-reports URL with project view default", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://mingsibot.example.com";
    const url = buildDailyReportsPublicUrl({ dateYmd: "2026-06-08" });
    expect(url).toBe(
      "https://mingsibot.example.com/workbench/manager/daily-reports?date=2026-06-08&view=project",
    );
    delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
  });
});
