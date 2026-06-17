import { describe, expect, it } from "vitest";
import { loadOrCollectProjectViewDigest } from "../../../src/agent/daily-report-digest/daily-report-project-view-digest-collect";
import {
  createProjectViewCacheStore,
  putProjectViewCache,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";
import {
  createProjectViewRosterStore,
  addProjectViewRosterMember,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";
import type { DailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import { resolveDayRangeForYmd } from "../../../src/agent/daily-report-digest/daily-report-window";

function inMemoryDbPath(): string {
  return ":memory:";
}

function sampleConfig(): DailyReportDigestConfig {
  return {
    enabled: false,
    scanIntervalMs: 60000,
    timezone: "Asia/Shanghai",
    sendHour: 8,
    sendMinute: 0,
    weekdaysOnly: true,
    reportDayCutoffHour: 17,
    reportDayCutoffMinute: 0,
    leaveCheckEnabled: false,
    title: "日报",
    pushMode: "morning",
    stateDir: "/tmp",
    webhook: { accessToken: "" },
    orgs: [
      {
        label: "微光",
        appKey: "k",
        appSecret: "s",
        employees: [],
        projectViews: [
          {
            id: "semiconductor-vein",
            label: "半导体激光·静脉项目",
            viewers: ["viewer1"],
            filters: {
              workModuleContains: "半导体激光",
              costProjectContains: "静脉",
            },
          },
        ],
      },
    ],
  };
}

describe("loadOrCollectProjectViewDigest", () => {
  it("returns cached payload without calling collect", async () => {
    const dbPath = inMemoryDbPath();
    const rosterStore = createProjectViewRosterStore(dbPath);
    const cacheStore = createProjectViewCacheStore(dbPath);
    addProjectViewRosterMember(
      "semiconductor-vein",
      { userid: "u1", name: "张三" },
      rosterStore,
    );
    putProjectViewCache(
      "semiconductor-vein",
      "2026-06-08",
      {
        submitted: [
          {
            userid: "u1",
            name: "张三",
            reports: [],
          },
        ],
        errors: [],
      },
      cacheStore,
    );

    const range = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", {
      cutoffHour: 17,
      cutoffMinute: 0,
    });

    const ctx = await loadOrCollectProjectViewDigest({
      config: sampleConfig(),
      viewId: "semiconductor-vein",
      range,
      cacheStore,
      rosterStore,
      ownsCacheStore: false,
      ownsRosterStore: false,
    });

    expect(ctx.fromCache).toBe(true);
    expect(ctx.rosterCount).toBe(1);
    expect(ctx.orgDigest.submitted).toHaveLength(1);
    expect(ctx.orgDigest.submitted[0]!.name).toBe("张三");
    expect(ctx.view.label).toBe("半导体激光·静脉项目");

    rosterStore.close();
    cacheStore.close();
  });

  it("throws when view not found", async () => {
    const range = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai");
    await expect(
      loadOrCollectProjectViewDigest({
        config: sampleConfig(),
        viewId: "nonexistent",
        range,
      }),
    ).rejects.toThrow(/not found/);
  });
});
