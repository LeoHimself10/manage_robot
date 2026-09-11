import { DatabaseSync } from "node:sqlite";
import {
  listQualityFormalSubtasksFromDb,
  qualityEmployeeTaskStage,
} from "../analysis/quality-formal-task-projection";

type DatabaseRow = Record<string, unknown>;

export type QualityManagerTaskStage =
  | "ACCEPT"
  | "DELEGATE"
  | "WAITING_EMPLOYEE"
  | "EXECUTION"
  | "REVIEW"
  | "CLOSED";

export const QUALITY_MANAGER_TASK_STAGE_LABELS: Readonly<Record<QualityManagerTaskStage, string>> =
  Object.freeze({
    ACCEPT: "待我承接",
    DELEGATE: "待分派员工",
    WAITING_EMPLOYEE: "待员工承接",
    EXECUTION: "员工执行中",
    REVIEW: "待我验收",
    CLOSED: "已关闭",
  });

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?",
  ).get(tableName));
}

export function qualityManagerTaskStageLabel(stage: QualityManagerTaskStage | ""): string {
  return stage ? QUALITY_MANAGER_TASK_STAGE_LABELS[stage] : "";
}

export function qualityManagerTaskStageBucket(
  stage: QualityManagerTaskStage,
): "TODO" | "PROGRESS" | "DONE" {
  if (stage === "CLOSED") return "DONE";
  if (["ACCEPT", "DELEGATE", "REVIEW"].includes(stage)) return "TODO";
  return "PROGRESS";
}

/**
 * 主管质量总览投影主管承接与原任务系统的五个后续业务阶段。正式子任务存在时，
 * 其状态是唯一权威源；旧质量节点只作为尚未发布正式任务时的兼容回退。
 */
export function resolveQualityManagerTaskStageFromDb(input: {
  db: DatabaseSync;
  eventId: string;
  eventStatus: string;
  managerUserId: string;
}): QualityManagerTaskStage | null {
  const eventId = input.eventId.trim();
  const managerUserId = input.managerUserId.trim();
  if (!eventId || !managerUserId) return null;

  const ownNodes = tableExists(input.db, "quality_assignment_nodes")
    ? input.db.prepare(`
        SELECT node_id,parent_node_id,status
        FROM quality_assignment_nodes
        WHERE event_id=? AND assignee_user_id=? AND status NOT IN ('REJECTED','CANCELLED')
        ORDER BY CASE WHEN parent_node_id IS NULL THEN 0 ELSE 1 END,depth,created_at,node_id
      `).all(eventId, managerUserId) as DatabaseRow[]
    : [];
  const formalSubtasks = listQualityFormalSubtasksFromDb(input.db, { eventId })
    .filter((item) => item.managerUserId === managerUserId);
  if (ownNodes.length === 0 && formalSubtasks.length === 0) {
    const handoff = tableExists(input.db, "quality_analysis_handoffs")
      && input.db.prepare("SELECT 1 FROM quality_analysis_handoffs WHERE event_id=? AND primary_manager_user_id=? LIMIT 1").get(eventId, managerUserId);
    return handoff && input.eventStatus === "PENDING_ASSIGNMENT" ? "DELEGATE" : null;
  }
  if (input.eventStatus === "CLOSED") return "CLOSED";
  if (ownNodes.some((node) => String(node.status) === "PENDING_ACCEPTANCE")) return "ACCEPT";

  if (formalSubtasks.length > 0) {
    const stages = formalSubtasks.map((item) => qualityEmployeeTaskStage(
      item.status,
      item.openDeclineKind,
    ));
    if (stages.some((stage) => stage === "WAITING_MANAGER")) return "DELEGATE";
    if (stages.every((stage) => stage === "DONE")) return "REVIEW";
    if (stages.some((stage) => stage === "ACTIVE")) return "EXECUTION";
    if (stages.some((stage) => stage === "ASSIGNED")) return "WAITING_EMPLOYEE";
    return "REVIEW";
  }

  const ownNodeIds = ownNodes.map((node) => String(node.node_id));
  const children = ownNodeIds.length > 0
    ? input.db.prepare(`
        SELECT node_id,parent_node_id,status
        FROM quality_assignment_nodes
        WHERE parent_node_id IN (${ownNodeIds.map(() => "?").join(",")})
          AND status NOT IN ('REJECTED','CANCELLED')
        ORDER BY depth,created_at,node_id
      `).all(...ownNodeIds) as DatabaseRow[]
    : [];
  if (
    ["PENDING_PRIMARY_REVIEW", "PENDING_QUALITY_REVIEW"].includes(input.eventStatus)
    || children.some((node) => ["PENDING_PARENT_REVIEW", "APPROVED"].includes(String(node.status)))
  ) return "REVIEW";
  if (children.some((node) => String(node.status) === "PENDING_ACCEPTANCE")) {
    return "WAITING_EMPLOYEE";
  }
  if (children.some((node) => ["IN_PROGRESS", "RETURNED"].includes(String(node.status)))) {
    return "EXECUTION";
  }
  return "DELEGATE";
}
