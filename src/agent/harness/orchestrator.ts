import { Plan } from "../../domain/plan";
import { PlanEvent } from "./types";
import { getNextStatus } from "./state-machine";
import { validateDispatchGate, DispatchPolicyOptions } from "./policies";

export interface AuditSink {
  append(event: PlanEvent, fromStatus: string, toStatus: string): Promise<void>;
}

export class HarnessOrchestrator {
  constructor(
    private readonly policyOptions: DispatchPolicyOptions,
    private readonly auditSink: AuditSink
  ) {}

  async apply(plan: Plan, event: PlanEvent): Promise<Plan> {
    if (event.type === "GATE_PASSED") {
      const firstTask = plan.taskPackages[0];
      if (!firstTask) {
        throw new Error("cannot dispatch without task packages");
      }
      const gateResult = validateDispatchGate(this.policyOptions, {
        taskPackage: firstTask,
        waiverReason: String(event.payload?.waiverReason ?? ""),
      });
      if (!gateResult.passed) {
        const gatedStatus = getNextStatus(plan.status, "GATE_FAILED");
        await this.auditSink.append(event, plan.status, gatedStatus);
        return { ...plan, status: gatedStatus, updatedAt: event.occurredAt };
      }
    }

    const nextStatus = getNextStatus(plan.status, event.type);
    await this.auditSink.append(event, plan.status, nextStatus);
    return { ...plan, status: nextStatus, updatedAt: event.occurredAt };
  }
}

