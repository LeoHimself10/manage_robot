import { describe, expect, it } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import {
  isUserInEvalRoster,
  loadEvalRosterUserIds,
} from "../../../src/agent/competency-eval/eval-roster";

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
      employees: [{ userid: "u_c", name: "王五" }],
    },
  ],
}).config;

describe("eval-roster", () => {
  it("unions employees from all orgs", () => {
    expect(loadEvalRosterUserIds(MOCK_CONFIG).sort()).toEqual(["u_a", "u_b", "u_c"]);
  });

  it("isUserInEvalRoster checks membership", () => {
    expect(isUserInEvalRoster("u_a", MOCK_CONFIG)).toBe(true);
    expect(isUserInEvalRoster("u_c", MOCK_CONFIG)).toBe(true);
    expect(isUserInEvalRoster("unknown", MOCK_CONFIG)).toBe(false);
    expect(isUserInEvalRoster("", MOCK_CONFIG)).toBe(false);
  });
});
