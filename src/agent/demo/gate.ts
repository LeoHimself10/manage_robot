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
}

export function validateDemoGate(tasks: TaskPackage[]): DemoGateResult {
  const missingByTask = tasks
    .map((task) => {
      const missingFields: DemoGateMissingField[] = [];

      if (task.deliverables.length === 0) {
        missingFields.push("deliverables");
      }

      if (task.completionCriteria.length === 0) {
        missingFields.push("completionCriteria");
      }

      if (!task.timeNode.dueAt.trim()) {
        missingFields.push("timeNode.dueAt");
      }

      if (!task.feedbackFrequency.trim()) {
        missingFields.push("feedbackFrequency");
      }

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
  };
}
