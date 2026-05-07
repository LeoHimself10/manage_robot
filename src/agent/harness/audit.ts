import { PlanEvent } from "./types";
import { AuditSink } from "./orchestrator";

export interface AuditRecord {
  event: PlanEvent;
  fromStatus: string;
  toStatus: string;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly records: AuditRecord[] = [];

  async append(
    event: PlanEvent,
    fromStatus: string,
    toStatus: string
  ): Promise<void> {
    this.records.push({ event, fromStatus, toStatus });
  }

  snapshot(): AuditRecord[] {
    return [...this.records];
  }
}

