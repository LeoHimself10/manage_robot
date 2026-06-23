import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenReportInDingtalkPayload,
  buildReportDetailH5Url,
  wrapReportUrlForDingtalkSlide,
} from "../../../src/agent/daily-report-digest/daily-report-dingtalk-report-link";

describe("daily-report-dingtalk-report-link", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DINGTALK_CORP_ID;
  });

  it("builds landray viewreport H5 with id not reportid", () => {
    const url = buildReportDetailH5Url({
      reportId: "abc123",
      corpId: "dingCorp",
      createTime: 1710000000000,
    });
    expect(url).toContain("id=abc123");
    expect(url).toContain("corpid=dingCorp");
    expect(url).toContain("createtime=1710000000000");
    expect(url).not.toContain("reportid=");
  });

  it("wraps slide applink for desktop sidebar", () => {
    const wrapped = wrapReportUrlForDingtalkSlide("https://example.com/report");
    expect(wrapped).toContain("applink.dingtalk.com/page/link");
    expect(wrapped).toContain("targetDesktop=slide");
  });

  it("returns openInDingtalkUrl when reportId and corpId present", () => {
    vi.stubEnv("DINGTALK_CORP_ID", "dingCorp");
    const payload = buildOpenReportInDingtalkPayload({
      reportId: "r1",
      creatorUserId: "u1",
      createTime: 1710000000000,
    });
    expect(payload?.openInDingtalkUrl).toContain("applink.dingtalk.com");
    expect(payload?.openInDingtalkH5Url).toContain("viewreport.html");
  });
});
