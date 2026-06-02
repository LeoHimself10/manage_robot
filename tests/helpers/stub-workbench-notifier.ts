import { vi } from "vitest";
import type { WorkbenchPublishNotifier } from "../../src/integrations/dingtalk/workbench-notify";

const emptyNotify = async () => ({ enabled: false as const, success: [], failed: [] });

/** Full WorkbenchPublishNotifier stub for tests; override individual methods as needed. */
export function stubWorkbenchPublishNotifier(
  overrides: Partial<WorkbenchPublishNotifier> = {},
): WorkbenchPublishNotifier {
  return {
    notifyPublishedTask: vi.fn(emptyNotify),
    notifyReassignedAssignee: vi.fn(emptyNotify),
    notifyTaskStopped: vi.fn(emptyNotify),
    notifyManagerOfEmployeeAction: vi.fn(emptyNotify),
    notifyEmployeeOfManagerAction: vi.fn(emptyNotify),
    notifySubtaskReminder: vi.fn(emptyNotify),
    notifyManagerSubtaskOverdue: vi.fn(emptyNotify),
    notifyProgressDigest: vi.fn(emptyNotify),
    notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })),
    ...overrides,
  };
}
