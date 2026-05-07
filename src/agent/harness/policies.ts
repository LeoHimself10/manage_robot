import { GuardResult } from "./types";
import { TaskPackage } from "../../domain/task-package";

export interface DispatchPolicyOptions {
  allowWaiver: boolean;
}

export interface DispatchGateContext {
  taskPackage: TaskPackage;
  waiverReason?: string;
}

function isBlankArray(value: string[]): boolean {
  return !value || value.length === 0;
}

export function validateDispatchGate(
  options: DispatchPolicyOptions,
  context: DispatchGateContext
): GuardResult {
  const { taskPackage, waiverReason } = context;
  const missing: string[] = [];

  if (isBlankArray(taskPackage.deliverables)) missing.push("deliverables");
  if (isBlankArray(taskPackage.completionCriteria))
    missing.push("completionCriteria");
  if (!taskPackage.timeNode?.dueAt) missing.push("timeNode");
  if (!taskPackage.feedbackFrequency) missing.push("feedbackFrequency");

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

