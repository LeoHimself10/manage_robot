import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEvalProductionParitySummary } from "./eval-production-parity-env";

export const EVAL_REPORT_SCHEMA_VERSION = "eval-report-v1";

export interface EvalReportStage {
  id: string;
  label: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  critical?: boolean;
  note?: string;
}

export interface EvalReportDimensions {
  task_completion?: number;
  trajectory?: number;
  grounding?: number;
  hygiene?: number;
  efficiency?: number;
}

export interface EvalReportPayload {
  runId?: string;
  suite: string;
  startedAt: string;
  finishedAt?: string;
  allOk: boolean;
  criticalOk?: boolean;
  parityEnv?: string;
  stages?: EvalReportStage[];
  dimensions?: EvalReportDimensions;
  passed?: number;
  total?: number;
  artifacts?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export function resolveEvalOutputDir(suite: string): string {
  const fromEnv = process.env.EVAL_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  const slug = suite.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "");
  return join(process.cwd(), `.eval-${slug || "run"}`);
}

export function writeEvalReport(suite: string, payload: EvalReportPayload): string {
  const dir = resolveEvalOutputDir(suite);
  mkdirSync(dir, { recursive: true });
  const body: EvalReportPayload & { schemaVersion: string } = {
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    parityEnv: payload.parityEnv ?? formatEvalProductionParitySummary(),
    ...payload,
    finishedAt: payload.finishedAt ?? new Date().toISOString(),
  };
  const path = join(dir, "eval-summary.json");
  writeFileSync(path, JSON.stringify(body, null, 2), "utf8");
  return path;
}

export function readEvalReportIfExists(dir: string): EvalReportPayload | undefined {
  const path = join(dir, "eval-summary.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EvalReportPayload;
  } catch {
    return undefined;
  }
}
