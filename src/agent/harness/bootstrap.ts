import { HarnessOrchestrator } from "./orchestrator";
import { InMemoryAuditSink } from "./audit";
import { Plan } from "../../domain/plan";
import { FileAuditSink } from "../../infra/audit-file-sink";

export function createHarness() {
  const mode = process.env.AUDIT_SINK?.trim().toLowerCase() ?? "memory";
  const auditSink =
    mode === "file"
      ? new FileAuditSink(
          process.env.AUDIT_JSONL_PATH?.trim() ?? "./data/audit-harness.jsonl"
        )
      : new InMemoryAuditSink();
  const orchestrator = new HarnessOrchestrator(
    { allowWaiver: false },
    auditSink
  );
  return { orchestrator, auditSink };
}

export function createEmptyPlan(partial?: Partial<Plan>): Plan {
  const now = new Date().toISOString();
  return {
    id: partial?.id ?? `plan_${Date.now()}`,
    domain: partial?.domain ?? "RD",
    subType: partial?.subType ?? "REQUIREMENT_INPUT",
    background: partial?.background ?? "",
    constraints: partial?.constraints ?? [],
    initiatorId: partial?.initiatorId ?? "unknown",
    status: partial?.status ?? "DRAFT",
    taskPackages: partial?.taskPackages ?? [],
    externalRefs: partial?.externalRefs ?? [],
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
    productOrProjectRef: partial?.productOrProjectRef,
    severity: partial?.severity,
    demoClassification: partial?.demoClassification,
    capaAdvisory: partial?.capaAdvisory,
  };
}

