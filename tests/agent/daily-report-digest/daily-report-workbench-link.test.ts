import { describe, expect, it } from "vitest";

import {
  buildDailyReportsPublicUrl,
  buildDailyReportsPublicUrlForDingtalkOutbound,
} from "../../../src/agent/daily-report-digest/daily-report-workbench-link";

describe("daily-report-workbench-link", () => {
  it("builds role-neutral daily-reports URL by default", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://mingsibot.example.com";
    const url = buildDailyReportsPublicUrl({ dateYmd: "2026-06-08" });
    expect(url).toBe(
      "https://mingsibot.example.com/workbench/daily-reports?date=2026-06-08&view=project",
    );
    delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
  });

  it("wraps neutral URL with dingtalk applink for outbound", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://mingsibot.example.com";
    process.env.DINGTALK_WORKBENCH_APPLINK = "1";
    const url = buildDailyReportsPublicUrlForDingtalkOutbound({ dateYmd: "2026-06-08" });
    expect(url).toContain("applink.dingtalk.com/page/link");
    expect(url).toContain(encodeURIComponent("workbench/daily-reports"));
    delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
    delete process.env.DINGTALK_WORKBENCH_APPLINK;
  });
});
