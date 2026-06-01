/**
 * Compare eval history runs.
 * Run: npx tsx scripts/eval-compare.ts --baseline=2026-06-01 --current=latest
 */
import { existsSync, readFileSync } from "node:fs";
import { resolveEvalHistoryPath } from "./eval-history-append";

interface HistoryRow {
  recordedAt: string;
  suite: string;
  startedAt: string;
  allOk?: boolean;
  criticalOk?: boolean;
  stages?: Array<{ id: string; ok: boolean; critical?: boolean }>;
}

function loadRows(): HistoryRow[] {
  const path = resolveEvalHistoryPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as HistoryRow);
}

function pickRow(rows: HistoryRow[], key: string, suite = "release"): HistoryRow | undefined {
  if (key === "latest") {
    return [...rows].reverse().find((r) => r.suite === suite);
  }
  return rows.find((r) => r.suite === suite && r.startedAt.startsWith(key));
}

function main(): void {
  const args = process.argv.slice(2);
  const baselineKey = args.find((a) => a.startsWith("--baseline="))?.split("=")[1] ?? "latest";
  const currentKey = args.find((a) => a.startsWith("--current="))?.split("=")[1] ?? "latest";
  const suite = args.find((a) => a.startsWith("--suite="))?.split("=")[1] ?? "release";

  const rows = loadRows();
  const baseline = pickRow(rows, baselineKey, suite);
  const current = pickRow(rows, currentKey, suite);

  if (!baseline || !current) {
    console.error("Could not find baseline/current rows in eval history.");
    console.error(`history: ${resolveEvalHistoryPath()}`);
    process.exit(1);
  }

  console.log("=== eval:compare ===");
  console.log(`suite: ${suite}`);
  console.log(`baseline: ${baseline.startedAt} allOk=${baseline.allOk}`);
  console.log(`current:  ${current.startedAt} allOk=${current.allOk}`);

  const baseStages = new Map((baseline.stages ?? []).map((s) => [s.id, s.ok]));
  for (const s of current.stages ?? []) {
    const prev = baseStages.get(s.id);
    if (prev === undefined) {
      console.log(`  + ${s.id}: (new) ok=${s.ok}`);
    } else if (prev !== s.ok) {
      console.log(`  ! ${s.id}: ${prev} → ${s.ok}`);
    }
  }
}

main();
