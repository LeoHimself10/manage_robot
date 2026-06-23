import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  filterReportEntryByModuleProjectPair,
  moduleBlockMatchesPairFilter,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-filter";
import {
  resolveDailyReportsAccess,
  parseProjectViewConfig,
} from "../../../src/agent/daily-report-digest/daily-report-project-views";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

const FILTER = {
  workModuleContains: "半导体激光",
  costProjectContains: "静脉腔内闭合系统",
};

function moduleFields(
  idx: string,
  work: string,
  project: string,
  result: string,
): ReportEntry["contents"] {
  return [
    { key: `工作模块${idx}`, value: work },
    { key: `成本归属项目${idx}`, value: project },
    { key: `事项-结果${idx}`, value: result },
  ];
}

describe("daily-report-project-view-filter", () => {
  it("matches same module block with full names on any index", () => {
    expect(
      moduleBlockMatchesPairFilter(
        moduleFields("②", "半导体激光", "静脉腔内闭合系统", "进展"),
        "②",
        FILTER,
      ),
    ).toBe(true);
    expect(
      moduleBlockMatchesPairFilter(
        moduleFields("①", "半导体激光", "静脉腔内闭合系统", "进展"),
        "①",
        FILTER,
      ),
    ).toBe(true);
  });

  it("does not match when only one field hits or wrong block pairing", () => {
    expect(
      moduleBlockMatchesPairFilter(
        moduleFields("②", "半导体激光", "其他项目", "x"),
        "②",
        FILTER,
      ),
    ).toBe(false);
    const cross = [
      ...moduleFields("①", "半导体激光", "其他", "a"),
      ...moduleFields("②", "别的模块", "静脉腔内闭合系统", "b"),
    ];
    expect(moduleBlockMatchesPairFilter(cross, "①", FILTER)).toBe(false);
    expect(moduleBlockMatchesPairFilter(cross, "②", FILTER)).toBe(false);
  });

  it("keeps only matching module blocks", () => {
    const entry: ReportEntry = {
      creatorUserId: "u1",
      creatorName: "测试",
      templateName: "t",
      createTime: 1,
      contents: [
        ...moduleFields("①", "颅内", "2310-导管", "other"),
        ...moduleFields("②", "半导体激光", "静脉腔内闭合系统", "vein work"),
      ],
    };
    const filtered = filterReportEntryByModuleProjectPair(entry, FILTER);
    expect(filtered.contents.map((f) => f.key)).toEqual([
      "工作模块②",
      "成本归属项目②",
      "事项-结果②",
    ]);
  });
});

describe("parseProjectViewConfig filters", () => {
  it("parseProjectViewConfig accepts filters.keyword only", () => {
    const v = parseProjectViewConfig(
      {
        id: "cla",
        label: "CLA",
        viewers: ["u1"],
        filters: { keyword: "CLA" },
      },
      "微光",
    );
    expect(v?.filters.keyword).toBe("CLA");
  });

  it("parseProjectViewConfig still accepts legacy pair", () => {
    const v = parseProjectViewConfig(
      {
        id: "v1",
        label: "旧",
        viewers: ["u1"],
        filters: { workModuleContains: "A", costProjectContains: "B" },
      },
      "微光",
    );
    expect(v?.filters.workModuleContains).toBe("A");
  });
});

describe("daily-report-project-views access", () => {
  beforeEach(() => {
    process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED = "1";
  });

  afterEach(() => {
    delete process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED;
  });

  it("exclusive viewer is customOnly without legacy", () => {
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "半导体激光·静脉项目",
        viewers: ["01451725613871"],
        exclusiveForViewers: true,
        filters: FILTER,
      },
      "微光",
    );
    expect(view).toBeTruthy();
    const config = {
      enabled: false,
      orgs: [{ label: "微光", appKey: "k", appSecret: "s", employees: [], projectViews: [view!] }],
    } as any;
    const access = resolveDailyReportsAccess("01451725613871", config, {
      canAccessAdmin: false,
      canManage: false,
    });
    expect(access.customOnly).toBe(true);
    expect(access.legacyAccess).toBe(false);
    expect(access.customViews[0]!.id).toBe("semiconductor-vein");
  });

  it("admin without legacy employees only sees projectViews (managebot)", () => {
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "半导体激光·静脉项目",
        viewers: ["01451725613871"],
        exclusiveForViewers: true,
        filters: FILTER,
      },
      "微光",
    );
    const config = {
      enabled: false,
      orgs: [{ label: "微光", appKey: "k", appSecret: "s", employees: [], projectViews: [view!] }],
    } as any;
    const access = resolveDailyReportsAccess("652949075622784820", config, {
      canAccessAdmin: true,
      canManage: true,
    });
    expect(access.legacyAccess).toBe(false);
    expect(access.customOnly).toBe(true);
    expect(access.customViews[0]!.id).toBe("semiconductor-vein");
  });

  it("admin keeps legacy access when legacy employees configured", () => {
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "x",
        viewers: ["admin1"],
        exclusiveForViewers: true,
        filters: FILTER,
      },
      "微光",
    );
    const config = {
      enabled: false,
      orgs: [
        {
          label: "微光",
          appKey: "k",
          appSecret: "s",
          employees: [{ userid: "u1" }],
          projectViews: [view!],
        },
      ],
    } as any;
    const access = resolveDailyReportsAccess("admin1", config, {
      canAccessAdmin: true,
      canManage: false,
    });
    expect(access.legacyAccess).toBe(true);
    expect(access.customOnly).toBe(false);
  });
});
