import { GuardResult } from "./types";
import { TaskPackage } from "../../domain/task-package";
import { findDispatchGateMissingFields } from "../demo/gate";

export interface DispatchPolicyOptions {
  allowWaiver: boolean;
}

export interface DispatchGateContext {
  taskPackage: TaskPackage;
  waiverReason?: string;
}

export function validateDispatchGate(
  options: DispatchPolicyOptions,
  context: DispatchGateContext
): GuardResult {
  const { taskPackage, waiverReason } = context;
  const missing = findDispatchGateMissingFields(taskPackage);

  if (missing.length === 0) {
    return { passed: true };
  }

  if (options.allowWaiver && waiverReason) {
    return { passed: true, reason: `waived: ${missing.join(",")}` };
  }

  return {
    passed: false,
    reason: `dispatch gate blocked, missing fields: ${missing.join(", ")}`,
  };
}

