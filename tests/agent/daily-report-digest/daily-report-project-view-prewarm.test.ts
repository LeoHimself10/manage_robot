import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../../../src/agent/daily-report-digest/daily-report-config";
import { createProjectViewCacheStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";
import {
  createDailyReportProjectViewPrewarmScheduler,
  isProjectViewPrewarmWindow,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-prewarm";
import { createProjectViewRosterStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";

const VIEW_FILTER = {
  workModuleContains: "半导体激光",
  costProjectContains: "静脉腔内闭合系统",
};

function configWithProjectView(): DailyReportDigestConfig {
  return {
    ...parseDailyReportDigestConfig({
      title: "每日日报汇总",
      timezone: "Asia/Shanghai",
      sendHour: 7,
      sendMinute: 0,
      weekdaysOnly: true,
      webhook: { accessToken: "tok", secret: "sec" },
      orgs: [
        {
          label: "明思",
          appKey: "ak",
          appSecret: "as",
          employees: [],
          projectViews: [
            {
              id: "view-1",
              label: "测试视图",
              viewers: ["mgr1"],
              filters: VIEW_FILTER,
            },
          ],
        },
      ],
    }).config,
    enabled: true,
    scanIntervalMs: 60_000,
  };
}

describe("isProjectViewPrewarmWindow", () => {
  const config = configWithProjectView();

  it("returns true Tue 07:32 local", () => {
    const tue0732 = new Date("2026-06-09T07:32:00+08:00");
    expect(isProjectViewPrewarmWindow(tue0732, config)).toBe(true);
  });

  it("returns false Mon 07:32 local (skip Monday)", () => {
    const mon0732 = new Date("2026-06-08T07:32:00+08:00");
    expect(isProjectViewPrewarmWindow(mon0732, config)).toBe(false);
  });

  it("returns false Sun 07:32 local (skip Sunday)", () => {
    const sun0732 = new Date("2026-06-07T07:32:00+08:00");
    expect(isProjectViewPrewarmWindow(sun0732, config)).toBe(false);
  });
});

describe("daily-report-project-view-prewarm scheduler", () => {
  let tmpDir: string;
  let scheduler: ReturnType<typeof createDailyReportProjectViewPrewarmScheduler> | undefined;
  let rosterStore: ReturnType<typeof createProjectViewRosterStore> | undefined;
  let cacheStore: ReturnType<typeof createProjectViewCacheStore> | undefined;

  afterEach(() => {
    scheduler?.close();
    scheduler = undefined;
    rosterStore?.close();
    rosterStore = undefined;
    cacheStore?.close();
    cacheStore = undefined;
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows may keep SQLite handles briefly after close
      }
      tmpDir = "";
    }
  });

  it("prewarm runs at Tue 07:32 and caches yesterday range", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prewarm-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    const config = configWithProjectView();
    rosterStore = createProjectViewRosterStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);
    const runDiscovery = vi.fn().mockResolvedValue({ added: 0, totalRoster: 0, discovered: [] });
    const collectDigest = vi.fn().mockResolvedValue({
      label: "明思",
      submitted: [{ userid: "u1", name: "张三", reports: [] }],
      missing: [],
      onLeave: [],
      errors: [],
    });

    scheduler = createDailyReportProjectViewPrewarmScheduler({
      config,
      rosterStore,
      cacheStore,
      runDiscovery,
      collectDigest,
    });

    const tue0732 = new Date("2026-06-09T07:32:00+08:00");
    await scheduler.runPrewarm(tue0732);

    expect(runDiscovery).toHaveBeenCalledWith("view-1", config, expect.any(Object));
    expect(collectDigest).toHaveBeenCalledTimes(1);
    expect(collectDigest.mock.calls[0]?.[2]?.labelYmd).toBe("2026-06-08");

    const cached = cacheStore.db
      .prepare(
        `SELECT payload_json FROM daily_report_project_view_cache
         WHERE view_id = ? AND date_ymd = ?`,
      )
      .get("view-1", "2026-06-08") as { payload_json: string } | undefined;
    expect(cached).toBeDefined();
    const payload = JSON.parse(cached!.payload_json) as { submitted: unknown[] };
    expect(payload.submitted).toHaveLength(1);
  });

  it("skips prewarm on Mon 07:32", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prewarm-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    const config = configWithProjectView();
    rosterStore = createProjectViewRosterStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);
    const runDiscovery = vi.fn();
    const collectDigest = vi.fn();

    scheduler = createDailyReportProjectViewPrewarmScheduler({
      config,
      rosterStore,
      cacheStore,
      runDiscovery,
      collectDigest,
    });

    const mon0732 = new Date("2026-06-08T07:32:00+08:00");
    await scheduler.runPrewarm(mon0732);

    expect(runDiscovery).not.toHaveBeenCalled();
    expect(collectDigest).not.toHaveBeenCalled();
  });

  it("bootstrapOnStartup fires discovery for empty roster views", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prewarm-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    const config = configWithProjectView();
    rosterStore = createProjectViewRosterStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);
    const runDiscovery = vi.fn().mockResolvedValue({ added: 1, totalRoster: 1, discovered: [] });

    scheduler = createDailyReportProjectViewPrewarmScheduler({
      config,
      rosterStore,
      cacheStore,
      runDiscovery,
    });

    await scheduler.bootstrapOnStartup();
    await vi.waitFor(() => expect(runDiscovery).toHaveBeenCalledTimes(1));
    expect(runDiscovery).toHaveBeenCalledWith("view-1", config, expect.any(Object));
  });
});
