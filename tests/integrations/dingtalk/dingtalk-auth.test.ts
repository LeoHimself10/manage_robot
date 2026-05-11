import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DingTalkAuthError,
  createDingTalkAuthClient,
} from "../../../src/integrations/dingtalk/dingtalk-auth";

describe("dingtalk-auth client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws config error when app credentials are missing", async () => {
    vi.stubEnv("DINGTALK_CLIENT_ID", "");
    vi.stubEnv("DINGTALK_CLIENT_SECRET", "");
    const client = createDingTalkAuthClient({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(client.resolveIdentityByAuthCode("code-1")).rejects.toMatchObject({
      code: "CONFIG_MISSING",
      statusCode: 500,
    });
  });

  it("caches access token and resolves identity", async () => {
    vi.stubEnv("DINGTALK_CLIENT_ID", "app-key");
    vi.stubEnv("DINGTALK_CLIENT_SECRET", "app-secret");

    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/accessToken")) {
        return new Response(
          JSON.stringify({
            accessToken: "token-123",
            expireIn: 7200,
          }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { code?: string };
      return new Response(
        JSON.stringify({
          errcode: 0,
          errmsg: "ok",
          result: {
            userid: `u-${body.code}`,
            name: "张三",
            unionid: "union-1",
          },
        }),
        { status: 200 },
      );
    });

    const client = createDingTalkAuthClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    const first = await client.resolveIdentityByAuthCode("a1");
    const second = await client.resolveIdentityByAuthCode("a2");

    expect(first.userId).toBe("u-a1");
    expect(second.userId).toBe("u-a2");
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/oauth2/accessToken"))).toHaveLength(
      1,
    );
  });

  it("maps invalid authCode error to 401", async () => {
    vi.stubEnv("DINGTALK_CLIENT_ID", "app-key");
    vi.stubEnv("DINGTALK_CLIENT_SECRET", "app-secret");

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/oauth2/accessToken")) {
        return new Response(
          JSON.stringify({
            accessToken: "token-123",
            expireIn: 7200,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          errcode: 40078,
          errmsg: "invalid code",
        }),
        { status: 200 },
      );
    });

    const client = createDingTalkAuthClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.resolveIdentityByAuthCode("bad-code")).rejects.toBeInstanceOf(
      DingTalkAuthError,
    );
    await expect(client.resolveIdentityByAuthCode("bad-code")).rejects.toMatchObject({
      code: "AUTH_CODE_INVALID",
      statusCode: 401,
    });
  });
});
