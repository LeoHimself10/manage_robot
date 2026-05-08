import type { PlanEvent } from "../agent/harness/types";
import type { AuditSink } from "../agent/harness/orchestrator";
import { appendJsonlLine } from "./write-jsonl";

export class FileAuditSink implements AuditSink {
  constructor(private readonly filePath: string) {}

  async append(
    event: PlanEvent,
    fromStatus: string,
    toStatus: string
  ): Promise<void> {
    appendJsonlLine(this.filePath, {
      kind: "harness_audit",
      tsIso: new Date().toISOString(),
      event,
      fromStatus,
      toStatus,
    });
  }
}
