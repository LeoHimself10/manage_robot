import { describe, expect, it } from "vitest";
import {
  DingTalkFileDownloadError,
  fetchDingTalkFile,
} from "../../../src/integrations/dingtalk/dingtalk-file-download";

describe("fetchDingTalkFile / resolveDownloadUrl diagnostics", () => {
  it("includes raw= in message when resolve returns HTTP 400 with non-JSON body", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (String(url).includes("messageFiles/download")) {
        return {
          ok: false,
          status: 400,
          text: async () => "not json at all",
        } as Response;
      }
      throw new Error(`unexpected fetch url: ${url}`);
    };

    try {
      await fetchDingTalkFile({
        downloadCode: "dc1",
        robotCode: "dingRobotCode",
        accessToken: "tok",
        fetchImpl,
      });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DingTalkFileDownloadError);
      const err = e as DingTalkFileDownloadError;
      expect(err.message).toContain("raw=");
      expect(err.message).toContain("not json");
      expect(err.resolveMeta?.httpStatus).toBe(400);
      expect(err.resolveMeta?.rawSnippet).toContain("not json");
    }
  });

  it("includes errcode and errmsg in resolve failure detail when JSON body present", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (String(url).includes("messageFiles/download")) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({ errcode: 40078, errmsg: "invalid robotCode" }),
        } as Response;
      }
      throw new Error(`unexpected fetch url: ${url}`);
    };

    try {
      await fetchDingTalkFile({
        downloadCode: "dc2",
        robotCode: "dingRobotCode",
        accessToken: "tok",
        fetchImpl,
      });
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DingTalkFileDownloadError);
      const err = e as DingTalkFileDownloadError;
      expect(err.message).toContain("code=40078");
      expect(err.message).toContain("errmsg=invalid robotCode");
      expect(err.message).toContain("raw=");
      expect(err.resolveMeta?.apiErrcode).toBe(40078);
    }
  });
});
