import {
  createWorkbenchFormalTaskStore,
  type WorkbenchSubtaskRow,
  type WorkbenchTaskRow,
} from "../../infra/workbench-formal-task-store";

export interface QualityTaskBridgeInput {
  nodeId: string;
  eventNo: string;
  eventTitle: string;
  eventSummary: string;
  requirement: string;
  initiatorUserId: string;
  managerUserId: string;
  assigneeUserId: string;
  dueAt: string;
  requestId: string;
  parentAssigneeUserId?: string;
}

export interface QualityTaskBridgeResult {
  task: WorkbenchTaskRow;
  subtask: WorkbenchSubtaskRow;
  integrationKey: string;
  alreadyCreated: boolean;
}

export function createQualityTaskBridge(
  formalStore = createWorkbenchFormalTaskStore(),
) {
  return {
    createNodeTask(input: QualityTaskBridgeInput): QualityTaskBridgeResult {
      const integrationKey = `quality-node:${input.nodeId}`;
      const description = [
        `质量事件：${input.eventNo}`,
        `事件标题：${input.eventTitle}`,
        `公开摘要：${input.eventSummary}`,
        input.parentAssigneeUserId ? `直接上级：${input.parentAssigneeUserId}` : "",
        `节点要求：${input.requirement}`,
        "完成后请上传证据，并提交直接上级验收。",
      ].filter(Boolean).join("\n");
      const result = formalStore.createIntegrationTask({
        integrationKey,
        title: `[质量任务] ${input.eventNo} ${input.eventTitle}`.slice(0, 500),
        description,
        initiatorUserId: input.initiatorUserId,
        initiatorDepartment: "质量追踪",
        managerUserId: input.managerUserId,
        assigneeUserId: input.assigneeUserId,
        dueAt: input.dueAt,
        sourceTraceId: input.requestId,
      });
      return { ...result, integrationKey };
    },
    formalStore,
  };
}
