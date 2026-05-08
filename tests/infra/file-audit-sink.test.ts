import { readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { createEmptyPlan } from "../../src/agent/harness/bootstrap";
import { HarnessOrchestrator } from "../../src/agent/harness/orchestrator";
import { FileAuditSink } from "../../src/infra/audit-file-sink";

describe("FileAuditSink", () => {
  it("writes one JSON line per append", async () => {
    const filePath = join(tmpdir(), `harness-${Date.now()}.jsonl`);
    const sink = new FileAuditSink(filePath);
    const orchestrator = new HarnessOrchestrator({ allowWaiver: false }, sink);
    let plan = createEmptyPlan({
      status: "DRAFT",
      background: "",
      constraints: [],
    });
    await orchestrator.apply(plan, {
      type: "SUBMIT_FOR_REVIEW",
      planId: plan.id,
      actorId: "u1",
      occurredAt: "2026-05-07T08:00:00.000Z",
    });

    const line = readFileSync(filePath, "utf8").trim();
    expect(line).toBeTruthy();
    const row = JSON.parse(line) as { kind: string; fromStatus: string; toStatus: string };
    expect(row.kind).toBe("harness_audit");
    expect(row.fromStatus).toBe("DRAFT");
    expect(row.toStatus).toBe("IN_REVIEW");
    rmSync(filePath, { force: true });
  });
});
