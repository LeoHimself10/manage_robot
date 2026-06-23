import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  beforeEach(() => {
    process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_HOUR = "6";
    process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_MINUTE = "45";
  });

  it("returns true Tue 06:47 local", () => {
    const tue0647 = new Date("2026-06-09T06:47:00+08:00");
    expect(isProjectViewPrewarmWindow(tue0647, config)).toBe(true);
  });

  it("returns false Mon 06:47 local (skip Monday)", () => {
    const mon0647 = new Date("2026-06-08T06:47:00+08:00");
    expect(isProjectViewPrewarmWindow(mon0647, config)).toBe(false);
  });

  it("returns false Sun 06:47 local (skip Sunday)", () => {
    const sun0647 = new Date("2026-06-07T06:47:00+08:00");
    expect(isProjectViewPrewarmWindow(sun0647, config)).toBe(false);
  });

  it("returns false Tue 07:32 (old prewarm window)", () => {
    const tue0732 = new Date("2026-06-09T07:32:00+08:00");
    expect(isProjectViewPrewarmWindow(tue0732, config)).toBe(false);
  });
});

describe("daily-report-project-view-prewarm scheduler", () => {
  beforeEach(() => {
    process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED = "1";
    process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_HOUR = "6";
    process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_MINUTE = "45";
  });

  afterEach(() => {
    delete process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED;
  });
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

  it("prewarm runs at Tue 06:47 and caches yesterday range", async () => {
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

    const tue0647 = new Date("2026-06-09T06:47:00+08:00");
    await scheduler.runPrewarm(tue0647);

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

  it("skips prewarm on Mon 06:47", async () => {
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

    const mon0647 = new Date("2026-06-08T06:47:00+08:00");
    await scheduler.runPrewarm(mon0647);

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
