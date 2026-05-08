import { existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendDemoRunAudit,
  type DemoRunAuditRecord,
} from "../../src/infra/demo-run-audit";

describe("appendDemoRunAudit", () => {
  let filePath: string;

  afterEach(() => {
    delete process.env.AUDIT_DEMO_JSONL_PATH;
    delete process.env.AUDIT_DEMO_DISABLED;
    try {
      if (filePath && existsSync(filePath)) {
        const dir = dirname(filePath);
        rmSync(filePath, { force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  });

  it("writes a DemoRunAuditRecord line when enabled", () => {
    filePath = join(tmpdir(), `audit-demo-${Date.now()}`, "runs.jsonl");
    process.env.AUDIT_DEMO_JSONL_PATH = filePath;
    delete process.env.AUDIT_DEMO_DISABLED;

    const row: DemoRunAuditRecord = {
      traceId: "tid",
      status: "DRAFT_READY",
      gatePassed: true,
      tokenTotals: 42,
    };
    appendDemoRunAudit(row);
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.traceId).toBe("tid");
    expect(parsed.status).toBe("DRAFT_READY");
    expect(parsed.kind).toBe("demo_pipeline_run");
    expect(parsed.tsIso).toBeTruthy();
  });

  it("skips write when AUDIT_DEMO_DISABLED=1", () => {
    filePath = join(tmpdir(), `audit-off-${Date.now()}`, "runs.jsonl");
    process.env.AUDIT_DEMO_JSONL_PATH = filePath;
    process.env.AUDIT_DEMO_DISABLED = "1";
    appendDemoRunAudit({ traceId: "x", status: "NEEDS_MORE_INFO" });
    expect(existsSync(filePath)).toBe(false);
  });
});
