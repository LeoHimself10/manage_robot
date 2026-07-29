import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import { buildCtoRollupDigestForDay } from "../../../src/agent/daily-report-digest/daily-report-cto-rollup-build";
import { createDayPartitionCacheStore } from "../../../src/agent/daily-report-digest/daily-report-day-partition-cache";
import { createProjectViewCacheStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";
import * as unifiedCollect from "../../../src/agent/daily-report-digest/daily-report-unified-day-collect";

const FILTER = {
  workModuleContains: "CLA",
  costProjectContains: "355",
};

describe("buildCtoRollupDigestForDay", () => {
  let tmpDir = "";
  let partitionStore: ReturnType<typeof createDayPartitionCacheStore> | undefined;
  let cacheStore: ReturnType<typeof createProjectViewCacheStore> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    partitionStore?.close();
    cacheStore?.close();
    partitionStore = undefined;
    cacheStore = undefined;
    delete process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("collects one unified day for multiple rollup views in the same org", async () => {
    process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED = "1";
    tmpDir = mkdtempSync(join(tmpdir(), "cto-rollup-build-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    partitionStore = createDayPartitionCacheStore(dbPath);
    cacheStore = createProjectViewCacheStore(dbPath);

    const config = parseDailyReportDigestConfig({
      timezone: "Asia/Shanghai",
      webhook: { accessToken: "t" },
      orgs: [
        {
          label: "org",
          appKey: "k",
          appSecret: "s",
          employees: [],
          projectViews: [
            {
              id: "v1",
              label: "View 1",
              viewers: ["cto"],
              filters: FILTER,
              digest: { enabled: true },
            },
            {
              id: "v2",
              label: "View 2",
              viewers: ["cto"],
              filters: FILTER,
              digest: { enabled: true },
            },
          ],
        },
      ],
    }).config;

    vi.spyOn(unifiedCollect, "collectUnifiedDayForOrg").mockResolvedValue({
      poolCount: 2,
      scanContactCount: 2,
      byViewId: new Map([
        [
          "v1",
          {
            label: "org",
            submitted: [{ userid: "u1", name: "User 1", reports: [] }],
            missing: [],
            onLeave: [],
            errors: [],
          },
        ],
        [
          "v2",
          {
            label: "org",
            submitted: [{ userid: "u2", name: "User 2", reports: [] }],
            missing: [],
            onLeave: [],
            errors: [],
          },
        ],
      ]),
      errors: [],
    });

    const result = await buildCtoRollupDigestForDay({
      config,
      range: {
        labelYmd: "2026-07-08",
        labelDisplay: "2026-07-08",
        startTime: 0,
        endTime: 1,
      },
      viewIds: ["v1", "v2"],
      partitionStore,
      cacheStore,
      precomputeOverviews: false,
    });

    expect(unifiedCollect.collectUnifiedDayForOrg).toHaveBeenCalledTimes(1);
    expect(unifiedCollect.collectUnifiedDayForOrg).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ scanMode: "full" }),
    );
    expect(result.contexts).toHaveLength(2);
    expect(result.quality.ok).toBe(true);
  });
});
