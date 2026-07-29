import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDayPartitionCacheStore,
  loadOrCollectUnifiedDay,
} from "../../../src/agent/daily-report-digest/daily-report-day-partition-cache";
import {
  createProjectViewCacheStore,
  getProjectViewCache,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";
import * as unifiedCollect from "../../../src/agent/daily-report-digest/daily-report-unified-day-collect";

describe("daily report day partition cache", () => {
  let tmpDir = "";
  let store: ReturnType<typeof createDayPartitionCacheStore> | undefined;
  let projectCacheStore: ReturnType<typeof createProjectViewCacheStore> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    store?.close();
    projectCacheStore?.close();
    store = undefined;
    projectCacheStore = undefined;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("persists top-level collection errors so cached data is not clean by accident", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "day-partition-"));
    store = createDayPartitionCacheStore(join(tmpDir, "wb.sqlite"));
    const collectErrors = [{ userid: "u2", name: "User 2", reason: "rate limited" }];

    vi.spyOn(unifiedCollect, "collectUnifiedDayForOrg").mockResolvedValue({
      poolCount: 1,
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
      ]),
      errors: collectErrors,
    });

    const org = { label: "org", appKey: "k", appSecret: "s", employees: [] };
    const range = {
      labelYmd: "2026-07-08",
      labelDisplay: "2026-07-08",
      startTime: 0,
      endTime: 1,
    };

    const fresh = await loadOrCollectUnifiedDay({
      org,
      range,
      scanMode: "full",
      partitionStore: store,
      ownsPartitionStore: false,
    });
    expect(fresh.errors).toEqual(collectErrors);

    const cached = await loadOrCollectUnifiedDay({
      org,
      range,
      partitionStore: store,
      ownsPartitionStore: false,
    });

    expect(cached.fromCache).toBe(true);
    expect(cached.errors).toEqual(collectErrors);
  });

  it("does not let a roster fast scan replace the formal project-view snapshot", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "day-partition-fast-"));
    const dbPath = join(tmpDir, "wb.sqlite");
    store = createDayPartitionCacheStore(dbPath);
    projectCacheStore = createProjectViewCacheStore(dbPath);
    const org = { label: "org", appKey: "k", appSecret: "s", employees: [] };
    const range = {
      labelYmd: "2026-07-08",
      labelDisplay: "2026-07-08",
      startTime: 0,
      endTime: 1,
    };

    vi.spyOn(unifiedCollect, "collectUnifiedDayForOrg")
      .mockResolvedValueOnce({
        poolCount: 2,
        scanContactCount: 2,
        byViewId: new Map([["v1", {
          label: "org",
          submitted: [{ userid: "u-full", name: "Full snapshot", reports: [] }],
          missing: [], onLeave: [], errors: [],
        }]]),
        errors: [],
      })
      .mockResolvedValueOnce({
        poolCount: 1,
        scanContactCount: 1,
        byViewId: new Map([["v1", {
          label: "org",
          submitted: [{ userid: "u-fast", name: "Fast preview", reports: [] }],
          missing: [], onLeave: [], errors: [],
        }]]),
        errors: [],
      });

    await loadOrCollectUnifiedDay({
      org, range, scanMode: "full", partitionStore: store,
      projectViewCacheStore: projectCacheStore, ownsPartitionStore: false,
    });
    await loadOrCollectUnifiedDay({
      org, range, refresh: true, scanMode: "fast", partitionStore: store,
      projectViewCacheStore: projectCacheStore, ownsPartitionStore: false,
    });

    expect(getProjectViewCache("v1", range.labelYmd, projectCacheStore)?.payload.submitted[0]?.name)
      .toBe("Full snapshot");
  });
});
