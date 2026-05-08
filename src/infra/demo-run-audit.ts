import { appendJsonlLine } from "./write-jsonl";
import { logStructured } from "./logger";

/** Segment timings for createTaskPlanningDemo (ms); gate/render only when applicable */
export interface DemoRunAuditTimingsMs {
  plannerMs: number;
  coerceMs: number;
  validateMs: number;
  gateMs?: number;
  renderMs?: number;
}

export interface DemoRunAuditRecord {
  traceId: string;
  status: string;
  reason?: string;
  gatePassed?: boolean;
  tokenTotals?: number;
  /** Wall-clock from createTaskPlanningDemo entry to completion (ms, rounded). */
  wallClockMs?: number;
  timingsMs?: DemoRunAuditTimingsMs;
  correctionUsed?: boolean;
  /**
   * When true, skip stdout `demo_pipeline_timing` (DRAFT_READY uses `demo_draft_ready` in pipeline).
   */
  skipTimingStdout?: boolean;
}

/**
 * Append one line to JSONL for each createTaskPlanningDemo completion.
 * Set AUDIT_DEMO_DISABLED=1 to no-op. Path: AUDIT_DEMO_JSONL_PATH or ./data/demo-runs.jsonl
 */
export function appendDemoRunAudit(record: DemoRunAuditRecord): void {
  const { skipTimingStdout, ...persistable } = record;

  const timingStdout =
    process.env.DEMO_TIMING_LOG_STDOUT?.trim() !== "0";
  if (
    record.wallClockMs !== undefined &&
    !skipTimingStdout &&
    timingStdout
  ) {
    logStructured({
      event: "demo_pipeline_timing",
      traceId: persistable.traceId,
      status: persistable.status,
      wallClockMs: persistable.wallClockMs,
      timingsMs: persistable.timingsMs,
      correctionUsed: persistable.correctionUsed,
      tokenTotals: persistable.tokenTotals,
      gatePassed: persistable.gatePassed,
      reason: persistable.reason,
    });
  }

  if (process.env.AUDIT_DEMO_DISABLED === "1") {
    return;
  }
  try {
    const path =
      process.env.AUDIT_DEMO_JSONL_PATH?.trim() || "./data/demo-runs.jsonl";
    appendJsonlLine(path, {
      kind: "demo_pipeline_run",
      tsIso: new Date().toISOString(),
      ...persistable,
    });
  } catch (err) {
    console.error(
      "[audit] appendDemoRunAudit failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
