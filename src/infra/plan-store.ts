import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export function resolvePlanStoreDir(): string {
  return process.env.PLAN_STORE_DIR?.trim() || "./data/plans";
}

export function savePlanSnapshot(
  planId: string,
  snapshot: Record<string, unknown>
): void {
  if (process.env.PLAN_SNAPSHOT_DISABLED === "1") return;
  try {
    const dir = resolvePlanStoreDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sanitizeId(planId)}.json`);
    writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (err) {
    console.error(
      "[plan-store] save failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function readPlanSnapshot(planId: string): Record<string, unknown> | undefined {
  try {
    const file = join(resolvePlanStoreDir(), `${sanitizeId(planId)}.json`);
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
