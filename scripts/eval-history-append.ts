import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EvalReportPayload } from "./eval-report";
import { resolveEvalHistoryPath } from "../src/infra/eval-history";

export { resolveEvalHistoryPath } from "../src/infra/eval-history";

export function appendEvalHistory(payload: EvalReportPayload): void {
  if (process.env.EVAL_HISTORY_DISABLED === "1") return;
  const path = resolveEvalHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  const row = {
    recordedAt: new Date().toISOString(),
    suite: payload.suite,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    allOk: payload.allOk,
    criticalOk: payload.criticalOk,
    stages: payload.stages?.map((s) => ({ id: s.id, ok: s.ok, critical: s.critical, durationMs: s.durationMs })),
    passed: payload.passed,
    total: payload.total,
  };
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}
