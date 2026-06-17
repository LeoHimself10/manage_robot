import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";
import {
  discoverProjectViewMembers,
  runProjectViewDiscovery,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-discovery";
import { createProjectViewRosterStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";
import { parseProjectViewConfig } from "../../../src/agent/daily-report-digest/daily-report-project-views";

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

const entryWithPairMatch: ReportEntry = {
  creatorUserId: "hit",
  creatorName: "命中",
  templateName: "日报",
  createTime: Date.now(),
  contents: moduleFields("②", "半导体激光", "静脉腔内闭合系统", "进展"),
};

describe("daily-report-project-view-discovery", () => {
  let dbPath = "";

  afterEach(() => {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  function createRosterStore() {
    const dir = mkdtempSync(join(tmpdir(), "project-view-discovery-"));
    dbPath = join(dir, "workbench.sqlite");
    return createProjectViewRosterStore(dbPath);
  }

  const view = parseProjectViewConfig(
    {
      id: "semiconductor-vein",
      label: "半导体激光·静脉项目",
      viewers: ["viewer1"],
      discoveryDays: 3,
      filters: FILTER,
    },
    "微光",
  )!;

  const org = {
    label: "微光",
    appKey: "k",
    appSecret: "s",
    templateName: "日报",
    employees: [{ userid: "legacy", name: "Legacy" }],
  };

  const scanConfig = {
    timezone: "Asia/Shanghai",
    reportDayCutoffHour: 17,
    reportDayCutoffMinute: 0,
  };

  const scanContacts = [
    { userid: "hit", name: "命中" },
    { userid: "miss", name: "未命中" },
  ];

  it("discoverProjectViewMembers returns only userids with filter matches", async () => {
    const mockClient = {
      fetchUserReports: vi.fn(async ({ userid }: { userid: string }) =>
        userid === "hit" ? [entryWithPairMatch] : [],
      ),
    };

    const discovered = await discoverProjectViewMembers(org, view, 3, scanConfig, {
      reportClient: mockClient as any,
      scanContacts,
      now: new Date("2026-06-17T12:00:00.000Z"),
      concurrency: 2,
    });

    expect(discovered).toEqual([{ userid: "hit", name: "命中" }]);
    expect(mockClient.fetchUserReports).toHaveBeenCalled();
  });

  it("runProjectViewDiscovery merges discovered members into roster store", async () => {
    const rosterStore = createRosterStore();
    const mockClient = {
      fetchUserReports: vi.fn(async ({ userid }: { userid: string }) =>
        userid === "hit" ? [entryWithPairMatch] : [],
      ),
    };

    const config = {
      enabled: false,
      orgs: [{ ...org, projectViews: [view] }],
      timezone: "Asia/Shanghai",
      reportDayCutoffHour: 17,
      reportDayCutoffMinute: 0,
    } as DailyReportDigestConfig;

    const result = await runProjectViewDiscovery("semiconductor-vein", config, {
      reportClient: mockClient as any,
      scanContacts,
      rosterStore,
      now: new Date("2026-06-17T12:00:00.000Z"),
      concurrency: 2,
    });

    expect(result.added).toBe(1);
    expect(result.totalRoster).toBe(1);
    expect(result.discovered).toEqual([
      { userid: "hit", name: "命中", source: "discovery" },
    ]);

    const again = await runProjectViewDiscovery("semiconductor-vein", config, {
      reportClient: mockClient as any,
      scanContacts,
      rosterStore,
      now: new Date("2026-06-17T12:00:00.000Z"),
      concurrency: 2,
    });
    expect(again.added).toBe(0);
    expect(again.totalRoster).toBe(1);

    rosterStore.close();
  });
});

describe("parseProjectViewConfig discoveryDays", () => {
  it("defaults discoveryDays to 30 when omitted", () => {
    const parsed = parseProjectViewConfig(
      {
        id: "v1",
        label: "x",
        viewers: ["u1"],
        filters: FILTER,
      },
      "微光",
    );
    expect(parsed?.discoveryDays).toBe(30);
  });

  it("parses discoveryDays from JSON", () => {
    const parsed = parseProjectViewConfig(
      {
        id: "v1",
        label: "x",
        viewers: ["u1"],
        discoveryDays: 14,
        filters: FILTER,
      },
      "微光",
    );
    expect(parsed?.discoveryDays).toBe(14);
  });
});
