import { afterEach, describe, expect, it, vi } from "vitest";

import { createDingTalkReportClient } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

describe("createDingTalkReportClient", () => {
  afterEach(() => {
    delete process.env.DINGTALK_RATE_LIMIT_RETRY_DELAY_MS;
    delete process.env.DINGTALK_RATE_LIMIT_RETRY_ATTEMPTS;
    vi.restoreAllMocks();
  });

  it("retries transient report/list rate limits", async () => {
    process.env.DINGTALK_RATE_LIMIT_RETRY_DELAY_MS = "0";
    process.env.DINGTALK_RATE_LIMIT_RETRY_ATTEMPTS = "2";

    let reportCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("oauth2/accessToken")) {
        return {
          ok: true,
          json: async () => ({ accessToken: "tok-123", expireIn: 7200 }),
        } as unknown as Response;
      }
      if (url.includes("topapi/report/list")) {
        reportCalls += 1;
        if (reportCalls === 1) {
          return {
            ok: true,
            json: async () => ({ errcode: 88, errmsg: "QPS limit" }),
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({
            errcode: 0,
            result: { data_list: [], has_more: false },
          }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const client = createDingTalkReportClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.fetchUserReports({
        appKey: "KEY",
        appSecret: "SECRET",
        userid: "u1",
        startTime: 0,
        endTime: 1,
      }),
    ).resolves.toEqual([]);
    expect(reportCalls).toBe(2);
  });
});
