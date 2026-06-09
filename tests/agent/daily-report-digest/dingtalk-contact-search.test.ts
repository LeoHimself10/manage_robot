import { describe, expect, it, vi } from "vitest";
import { createDingTalkContactDirectory } from "../../../src/agent/daily-report-digest/dingtalk-contact-search";

function makeFetchMock() {
  const calls = { listsub: 0, userList: 0, token: 0 };
  const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    let payload: unknown = {};
    if (url.includes("oauth2/accessToken")) {
      calls.token += 1;
      payload = { accessToken: "tok-123", expireIn: 7200 };
    } else if (url.includes("topapi/v2/department/listsub")) {
      calls.listsub += 1;
      payload =
        body.dept_id === 1
          ? { errcode: 0, result: [{ dept_id: 2, name: "研发" }, { dept_id: 3, name: "医学事务部" }] }
          : { errcode: 0, result: [] };
    } else if (url.includes("topapi/v2/user/list")) {
      calls.userList += 1;
      if (body.dept_id === 2) {
        payload = {
          errcode: 0,
          result: {
            has_more: false,
            list: [
              { userid: "u-caojie", name: "曹杰", dept_id_list: [2] },
              { userid: "u-liqiang", name: "李强", dept_id_list: [2] },
            ],
          },
        };
      } else if (body.dept_id === 3) {
        payload = {
          errcode: 0,
          result: { has_more: false, list: [{ userid: "u-xueting", name: "薛婷", dept_id_list: [3] }] },
        };
      } else {
        payload = { errcode: 0, result: { has_more: false, list: [] } };
      }
    }
    return { ok: true, json: async () => payload } as unknown as Response;
  });
  return { fetchImpl, calls };
}

describe("dingtalk-contact-search", () => {
  it("enumerates departments + users and filters by name", async () => {
    const { fetchImpl } = makeFetchMock();
    const dir = createDingTalkContactDirectory({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const all = await dir.search("KEY", "SECRET", "");
    expect(all.map((u) => u.userid).sort()).toEqual(["u-caojie", "u-liqiang", "u-xueting"]);

    const matched = await dir.search("KEY", "SECRET", "曹");
    expect(matched).toHaveLength(1);
    expect(matched[0].userid).toBe("u-caojie");
    expect(matched[0].departments).toContain("研发");
  });

  it("matches by userid substring too", async () => {
    const { fetchImpl } = makeFetchMock();
    const dir = createDingTalkContactDirectory({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const matched = await dir.search("KEY", "SECRET", "xueting");
    expect(matched.map((u) => u.name)).toEqual(["薛婷"]);
  });

  it("caches the directory per appKey (no re-enumeration within TTL)", async () => {
    const { fetchImpl, calls } = makeFetchMock();
    const dir = createDingTalkContactDirectory({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await dir.search("KEY", "SECRET", "曹");
    const listsubAfterFirst = calls.listsub;
    await dir.search("KEY", "SECRET", "李");
    expect(calls.listsub).toBe(listsubAfterFirst);
  });

  it("re-enumerates after invalidate", async () => {
    const { fetchImpl, calls } = makeFetchMock();
    const dir = createDingTalkContactDirectory({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await dir.search("KEY", "SECRET", "曹");
    const before = calls.listsub;
    dir.invalidate("KEY");
    await dir.search("KEY", "SECRET", "曹");
    expect(calls.listsub).toBeGreaterThan(before);
  });
});
