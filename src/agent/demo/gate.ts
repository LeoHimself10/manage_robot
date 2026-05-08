import { TaskPackage } from "../../domain/task-package";

export type DemoGateMissingField =
  | "deliverables"
  | "completionCriteria"
  | "timeNode.dueAt"
  | "feedbackFrequency";

export interface DemoGateMissingTask {
  taskId: string;
  title: string;
  missingFields: DemoGateMissingField[];
}

export interface DemoGateResult {
  passed: boolean;
  missingByTask: DemoGateMissingTask[];
  warnings: string[];
}

export function findDispatchGateMissingFields(
  task: TaskPackage
): DemoGateMissingField[] {
  const missingFields: DemoGateMissingField[] = [];

  if (!hasNonEmptyEntry(task.deliverables)) {
    missingFields.push("deliverables");
  }

  if (!hasNonEmptyEntry(task.completionCriteria)) {
    missingFields.push("completionCriteria");
  }

  if (!task.timeNode.dueAt.trim()) {
    missingFields.push("timeNode.dueAt");
  }

  if (!task.feedbackFrequency.trim()) {
    missingFields.push("feedbackFrequency");
  }

  return missingFields;
}

export function validateDemoGate(tasks: TaskPackage[]): DemoGateResult {
  const missingByTask = tasks
    .map((task) => {
      const missingFields = findDispatchGateMissingFields(task);

      return {
        taskId: task.id,
        title: task.title,
        missingFields,
      };
    })
    .filter((task) => task.missingFields.length > 0);

  return {
    passed: missingByTask.length === 0,
    missingByTask,
    warnings: [],
  };
}

function hasNonEmptyEntry(items: string[]): boolean {
  return items.some((item) => item.trim().length > 0);
}
