import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "../../../src/agent/daily-report-digest/daily-report-config";
import { createDayPartitionCacheStore } from "../../../src/agent/daily-report-digest/daily-report-day-partition-cache";
import { createProjectViewCacheStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";
import {
  createDailyReportProjectViewPrewarmScheduler,
  isProjectViewPrewarmWindow,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-prewarm";
import * as unifiedCollect from "../../../src/agent/daily-report-digest/daily-report-unified-day-collect";

const VIEW_FILTER = {
  keyword: "半导体",
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

  it("defaults missing env to Tue 06:45 window", () => {
    delete process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_HOUR;
    delete process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_MINUTE;

    const tue0647 = new Date("2026-06-09T06:47:00+08:00");
    const tue0002 = new Date("2026-06-09T00:02:00+08:00");

    expect(isProjectViewPrewarmWindow(tue0647, config)).toBe(true);
    expect(isProjectViewPrewarmWindow(tue0002, config)).toBe(false);
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
    process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_SUMMARIES = "0";
  });

  afterEach(() => {
    delete process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED;
    vi.restoreAllMocks();
  });
  let tmpDir: string;
  let scheduler: ReturnType<typeof createDailyReportProjectViewPrewarmScheduler> | undefined;
  let partitionStore: ReturnType<typeof createDayPartitionCacheStore> | undefined;
  let cacheStore: ReturnType<typeof createProjectViewCacheStore> | undefined;

  afterEach(() => {
    scheduler?.close();
    scheduler = undefined;
    partitionStore?.close();
    partitionStore = undefined;
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

  it("prewarm runs unified collect at Tue 06:47 and caches yesterday range", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prewarm-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    const config = configWithProjectView();
    partitionStore = createDayPartitionCacheStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);

    const digest = {
      label: "明思",
      submitted: [{ userid: "u1", name: "张三", reports: [] }],
      missing: [],
      onLeave: [],
      errors: [],
    };
    vi.spyOn(unifiedCollect, "collectUnifiedDayForOrg").mockResolvedValue({
      poolCount: 3,
      byViewId: new Map([["view-1", digest]]),
      errors: [],
    });

    scheduler = createDailyReportProjectViewPrewarmScheduler({
      config,
      partitionStore,
      cacheStore,
    });

    const tue0647 = new Date("2026-06-09T06:47:00+08:00");
    await scheduler.runPrewarm(tue0647);

    expect(unifiedCollect.collectUnifiedDayForOrg).toHaveBeenCalledTimes(1);

    const cached = partitionStore.db
      .prepare(
        `SELECT payload_json FROM daily_report_day_partition_cache
         WHERE org_label = ? AND date_ymd = ?`,
      )
      .get("明思", "2026-06-08") as { payload_json: string } | undefined;
    expect(cached).toBeDefined();
    const payload = JSON.parse(cached!.payload_json) as {
      views: Record<string, { submitted: unknown[] }>;
    };
    expect(payload.views["view-1"]?.submitted).toHaveLength(1);
  });

  it("skips prewarm on Mon 06:47", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "prewarm-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    const config = configWithProjectView();
    partitionStore = createDayPartitionCacheStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);
    const spy = vi.spyOn(unifiedCollect, "collectUnifiedDayForOrg");

    scheduler = createDailyReportProjectViewPrewarmScheduler({
      config,
      partitionStore,
      cacheStore,
    });

    const mon0647 = new Date("2026-06-08T06:47:00+08:00");
    await scheduler.runPrewarm(mon0647);

    expect(spy).not.toHaveBeenCalled();
  });

  it("bootstrapOnStartup is no-op under unified collect", async () => {
    const config = configWithProjectView();
    scheduler = createDailyReportProjectViewPrewarmScheduler({ config });
    await expect(scheduler.bootstrapOnStartup()).resolves.toBeUndefined();
  });
});
