import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDayPartitionCacheStore,
  loadOrCollectUnifiedDay,
} from "../../../src/agent/daily-report-digest/daily-report-day-partition-cache";
import * as unifiedCollect from "../../../src/agent/daily-report-digest/daily-report-unified-day-collect";

describe("daily report day partition cache", () => {
  let tmpDir = "";
  let store: ReturnType<typeof createDayPartitionCacheStore> | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    store?.close();
    store = undefined;
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
});
