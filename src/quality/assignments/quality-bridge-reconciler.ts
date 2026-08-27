import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createQualityStore } from "../infra/quality-store";
import { createQualityTaskBridge } from "./quality-task-bridge";

type DatabaseRow = Record<string, unknown>;
export type QualityBridgeReconcileStatus = "OK" | "REPAIRED_LINK" | "RECREATED_TASK" | "CONFLICT";

export function reconcileQualityTaskBridges(input?: { dbPath?: string }) {
  const dbPath = input?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 8000");
  const nodes = db.prepare(`
    SELECT n.*,e.event_no,e.title AS event_title,e.problem_status,
           p.assignee_user_id AS parent_assignee_user_id,
           l.task_id AS linked_task_id,l.subtask_id AS linked_subtask_id,l.integration_key AS linked_integration_key
    FROM quality_assignment_nodes n
    JOIN quality_events e ON e.id = n.event_id AND e.deleted_at IS NULL AND e.is_test = 0
    LEFT JOIN quality_assignment_nodes p ON p.node_id = n.parent_node_id
    LEFT JOIN quality_task_links l ON l.node_id = n.node_id
    ORDER BY n.created_at,n.node_id
  `).all() as DatabaseRow[];
  const items: Array<{ nodeId: string; status: QualityBridgeReconcileStatus; detail: string }> = [];
  if (nodes.length === 0) {
    db.close();
    return { items, summary: { total: 0, ok: 0, repaired: 0, conflicts: 0 } };
  }
  const bridge = createQualityTaskBridge(createWorkbenchFormalTaskStore());
  for (const row of nodes) {
    const nodeId = String(row.node_id);
    const integrationKey = `quality-node:${nodeId}`;
    const expectedTaskId = `task:integration:${integrationKey}`;
    const expectedSubtaskId = `${expectedTaskId}:work`;
    const expectedTitle = `[质量任务] ${String(row.event_no)} ${String(row.event_title)}`.slice(0, 500);
    const expectedDescription = [
      `质量事件：${String(row.event_no)}`,
      `事件标题：${String(row.event_title)}`,
      `公开摘要：${String(row.problem_status)}`,
      row.parent_assignee_user_id == null ? "" : `直接上级：${String(row.parent_assignee_user_id)}`,
      `节点要求：${String(row.requirement)}`,
      "完成后请上传证据，并提交直接上级验收。",
    ].filter(Boolean).join("\n");
    try {
      if (row.linked_task_id != null && (
        String(row.linked_task_id) !== expectedTaskId
        || String(row.linked_subtask_id) !== expectedSubtaskId
        || String(row.linked_integration_key) !== integrationKey
      )) {
        items.push({ nodeId, status: "CONFLICT", detail: "桥接指向与确定性任务标识不一致" });
        continue;
      }
      const created = bridge.createNodeTask({
        nodeId,
        eventNo: String(row.event_no), eventTitle: String(row.event_title), eventSummary: String(row.problem_status),
        requirement: String(row.requirement), initiatorUserId: String(row.created_by), managerUserId: String(row.created_by),
        assigneeUserId: String(row.assignee_user_id), dueAt: String(row.due_at), requestId: String(row.request_id),
        parentAssigneeUserId: row.parent_assignee_user_id == null ? undefined : String(row.parent_assignee_user_id),
      });
      const dueMatches = Date.parse(String(created.subtask.dueAt ?? "")) === Date.parse(String(row.due_at));
      if (created.task.taskId !== expectedTaskId || created.subtask.subtaskId !== expectedSubtaskId
        || created.task.title !== expectedTitle || created.task.description !== expectedDescription
        || created.task.managerUserId !== String(row.created_by)
        || created.subtask.assigneeUserId !== String(row.assignee_user_id) || !dueMatches) {
        items.push({ nodeId, status: "CONFLICT", detail: "正式任务字段与质量节点不一致，未覆盖人工数据" });
        continue;
      }
      if (row.linked_task_id == null) {
        db.prepare(`
          INSERT INTO quality_task_links(node_id,task_id,subtask_id,integration_key,created_at)
          VALUES (?,?,?,?,?)
        `).run(nodeId, created.task.taskId, created.subtask.subtaskId, integrationKey, new Date().toISOString());
        items.push({
          nodeId,
          status: created.alreadyCreated ? "REPAIRED_LINK" : "RECREATED_TASK",
          detail: created.alreadyCreated ? "已补建缺失桥接" : "已按确定性键重建正式任务并补建桥接",
        });
      } else {
        items.push({ nodeId, status: created.alreadyCreated ? "OK" : "RECREATED_TASK", detail: created.alreadyCreated ? "节点、正式任务与桥接一致" : "已按确定性键重建缺失正式任务" });
      }
    } catch (error) {
      items.push({ nodeId, status: "CONFLICT", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  db.close();
  return {
    items,
    summary: {
      total: items.length,
      ok: items.filter((item) => item.status === "OK").length,
      repaired: items.filter((item) => item.status === "REPAIRED_LINK" || item.status === "RECREATED_TASK").length,
      conflicts: items.filter((item) => item.status === "CONFLICT").length,
    },
  };
}
