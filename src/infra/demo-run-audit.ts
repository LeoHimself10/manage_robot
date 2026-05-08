import { appendJsonlLine } from "./write-jsonl";

export interface DemoRunAuditRecord {
  traceId: string;
  status: string;
  reason?: string;
  gatePassed?: boolean;
  tokenTotals?: number;
}

/**
 * Append one line to JSONL for each createTaskPlanningDemo completion.
 * Set AUDIT_DEMO_DISABLED=1 to no-op. Path: AUDIT_DEMO_JSONL_PATH or ./data/demo-runs.jsonl
 */
export function appendDemoRunAudit(record: DemoRunAuditRecord): void {
  if (process.env.AUDIT_DEMO_DISABLED === "1") {
    return;
  }
  try {
    const path =
      process.env.AUDIT_DEMO_JSONL_PATH?.trim() || "./data/demo-runs.jsonl";
    appendJsonlLine(path, {
      kind: "demo_pipeline_run",
      tsIso: new Date().toISOString(),
      ...record,
    });
  } catch (err) {
    console.error(
      "[audit] appendDemoRunAudit failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
