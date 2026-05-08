import { readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readPlanSnapshot, savePlanSnapshot } from "../../src/infra/plan-store";

describe("plan-store", () => {
  const saved = process.env.PLAN_SNAPSHOT_DISABLED;
  let dir: string;

  afterEach(() => {
    if (saved === undefined) delete process.env.PLAN_SNAPSHOT_DISABLED;
    else process.env.PLAN_SNAPSHOT_DISABLED = saved;
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("writes and reads round-trip JSON", () => {
    delete process.env.PLAN_SNAPSHOT_DISABLED;
    dir = join(tmpdir(), `plans-${Date.now()}`);
    process.env.PLAN_STORE_DIR = dir;

    const payload = { traceId: "abc", gate: { passed: true } };
    savePlanSnapshot("abc", payload);
    expect(readPlanSnapshot("abc")).toEqual(payload);
    const raw = readFileSync(join(dir, "abc.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(payload);
  });
});
