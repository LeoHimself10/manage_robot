import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProjectViewCacheStore,
  deleteProjectViewCache,
  getProjectViewCache,
  putProjectViewCache,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-cache";

describe("daily-report-project-view-cache", () => {
  let tmpDir = "";

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createStore() {
    tmpDir = mkdtempSync(join(tmpdir(), "project-view-cache-"));
    const dbPath = join(tmpDir, "workbench.sqlite");
    return createProjectViewCacheStore(dbPath);
  }

  it("round-trips digest payload", () => {
    const store = createStore();
    try {
      const payload = {
        submitted: [{ userid: "u1", name: "A", reports: [] }],
        errors: [],
      };
      putProjectViewCache("semiconductor-vein", "2026-06-08", payload, store);
      const hit = getProjectViewCache("semiconductor-vein", "2026-06-08", store);
      expect(hit?.payload).toEqual(payload);
      expect(hit?.hitCount).toBe(1);
      expect(hit?.scannedAt).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it("returns null for missing cache entry", () => {
    const store = createStore();
    try {
      expect(getProjectViewCache("semiconductor-vein", "2026-06-08", store)).toBeNull();
    } finally {
      store.close();
    }
  });

  it("deletes cache entry for refresh", () => {
    const store = createStore();
    try {
      const payload = { submitted: [], errors: [] };
      putProjectViewCache("semiconductor-vein", "2026-06-08", payload, store);
      deleteProjectViewCache("semiconductor-vein", "2026-06-08", store);
      expect(getProjectViewCache("semiconductor-vein", "2026-06-08", store)).toBeNull();
    } finally {
      store.close();
    }
  });
});
