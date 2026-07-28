import { describe, expect, it, vi } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import type {
  ContactCandidate,
  DingTalkContactDirectory,
} from "../../../src/agent/daily-report-digest/dingtalk-contact-search";
import { findOrgsForEvalUser } from "../../../src/agent/competency-eval/eval-roster";

const MOCK_CONFIG = parseDailyReportDigestConfig({
  orgs: [
    {
      label: "明思",
      appKey: "ak1",
      appSecret: "as1",
      employees: [
        { userid: "u_a", name: "张三" },
        { userid: "u_b", name: "李四" },
      ],
    },
    {
      label: "微光",
      appKey: "ak2",
      appSecret: "as2",
      employees: [],
    },
  ],
}).config;

function mockDirectory(
  usersByAppKey: Record<string, ContactCandidate[]>,
): DingTalkContactDirectory {
  return {
    search: vi.fn(async (appKey, _appSecret, query, limit = 30) =>
      (usersByAppKey[appKey] ?? [])
        .filter((user) => user.userid.includes(query) || user.name.includes(query))
        .slice(0, limit)),
    listAll: vi.fn(async (appKey, _appSecret, limit = 5000) =>
      (usersByAppKey[appKey] ?? []).slice(0, limit)),
    invalidate: vi.fn(),
  };
}

describe("eval organisation access", () => {
  it("keeps configured legacy employees available", async () => {
    const directory = mockDirectory({});
    const orgs = await findOrgsForEvalUser("u_a", MOCK_CONFIG, { directory });

    expect(orgs.map((org) => org.label)).toEqual(["明思"]);
  });

  it("accepts a current organisation contact outside the historical project roster", async () => {
    const directory = mockDirectory({
      ak2: [{ userid: "u_current", name: "当前员工", departments: ["研发中心"] }],
    });
    const orgs = await findOrgsForEvalUser("u_current", MOCK_CONFIG, { directory });

    expect(orgs.map((org) => org.label)).toEqual(["微光"]);
  });

  it("requires an exact userid match", async () => {
    const directory = mockDirectory({
      ak2: [{ userid: "u_current_2", name: "当前员工", departments: ["研发中心"] }],
    });
    const orgs = await findOrgsForEvalUser("u_current", MOCK_CONFIG, { directory });

    expect(orgs).toEqual([]);
  });

  it("surfaces directory failures when no configured organisation can be verified", async () => {
    const directory = mockDirectory({});
    vi.mocked(directory.search).mockRejectedValue(new Error("directory unavailable"));

    await expect(
      findOrgsForEvalUser("u_unknown", MOCK_CONFIG, { directory }),
    ).rejects.toThrow("directory unavailable");
  });
});
