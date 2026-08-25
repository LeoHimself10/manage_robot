import { describe, expect, it } from "vitest";
import { createDingTalkWorkbookClient } from "../../src/agent/daily-report-digest/dingtalk-workbook-client";

describe("DingTalk workbook range writes", () => {
  it("writes only the requested range", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "token", expireIn: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createDingTalkWorkbookClient({ fetchImpl: fetchImpl as typeof fetch });

    await client.writeSheetRangeValues(
      "app", "secret", { workspaceId: "quality", operatorUnionId: "operator" },
      "workbook", "sheet-1", "AB2:AB2", [["普通反馈"]],
    );

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain("/ranges/AB2%3AAB2?operatorId=operator");
    expect(requests[1]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ values: [["普通反馈"]] });
  });
});
