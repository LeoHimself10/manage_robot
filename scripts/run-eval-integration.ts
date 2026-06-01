/**
 * L1 eval:integration — mock-LLM full-path (meeting-import M1–M3).
 * Run: npm run eval:integration
 */
import { spawnSync } from "node:child_process";
import { writeEvalReport } from "./eval-report";

const ROOT = process.cwd();
const startedAt = new Date().toISOString();

function runStage(id: string, label: string, env: Record<string, string>): { ok: boolean; exitCode: number; durationMs: number } {
  const t0 = Date.now();
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync("npm", ["run", "eval:meeting-import"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env, EVAL_MEETING_IMPORT_SKIP_VITEST: "1" },
  });
  return { ok: (r.status ?? 1) === 0, exitCode: r.status ?? 1, durationMs: Date.now() - t0 };
}

function main(): void {
  console.log("=== eval:integration (L1) ===\n");
  const stages = [];

  // Vitest already in eval:unit; meeting-import runs M1-M4 with optional M4 skip without key
  const meeting = runStage("meeting-import", "meeting-import M1–M4", {
    EVAL_MEETING_IMPORT_FILTER: "M1,M2,M3,M4",
  });
  stages.push({
    id: "meeting-import",
    label: "Meeting import pipeline",
    ok: meeting.ok,
    exitCode: meeting.exitCode,
    durationMs: meeting.durationMs,
    critical: true,
  });

  const allOk = stages.every((s) => s.ok);
  const path = writeEvalReport("integration", {
    suite: "integration",
    startedAt,
    allOk,
    stages,
  });
  console.log(`\nReport: ${path}`);
  process.exit(allOk ? 0 : 1);
}

main();
