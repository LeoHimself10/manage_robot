import type { QualityEventStatus } from "./quality-types";

export type QualityEventAction =
  | "SUBMIT"
  | "ASSIGN_PRIMARY"
  | "REJECT_PRIMARY"
  | "ACCEPT_PRIMARY"
  | "NODE_RETURN"
  | "ALL_BRANCHES_APPROVED"
  | "PRIMARY_RETURN"
  | "PRIMARY_APPROVE"
  | "QUALITY_RETURN_NODE"
  | "QUALITY_CLOSE"
  | "QUALITY_REOPEN";

const TRANSITIONS: Partial<Record<QualityEventStatus, Partial<Record<QualityEventAction, QualityEventStatus>>>> = {
  DRAFT: { SUBMIT: "PENDING_ASSIGNMENT" },
  PENDING_ASSIGNMENT: { ASSIGN_PRIMARY: "PENDING_ACCEPTANCE" },
  PENDING_ACCEPTANCE: { REJECT_PRIMARY: "PENDING_ASSIGNMENT", ACCEPT_PRIMARY: "IN_PROGRESS" },
  IN_PROGRESS: { NODE_RETURN: "IN_PROGRESS", ALL_BRANCHES_APPROVED: "PENDING_PRIMARY_REVIEW" },
  PENDING_PRIMARY_REVIEW: { PRIMARY_RETURN: "IN_PROGRESS", PRIMARY_APPROVE: "PENDING_QUALITY_REVIEW" },
  PENDING_QUALITY_REVIEW: { QUALITY_RETURN_NODE: "IN_PROGRESS", QUALITY_CLOSE: "CLOSED" },
  CLOSED: { QUALITY_REOPEN: "IN_PROGRESS" },
};

export function transitionQualityEvent(from: QualityEventStatus, action: QualityEventAction): QualityEventStatus {
  const next = TRANSITIONS[from]?.[action];
  if (!next) throw new Error(`质量事件非法状态迁移：${from} 不能执行 ${action}`);
  return next;
}

export function computeQualityReturnImpact(
  nodes: Array<{ nodeId: string; parentNodeId: string | null; status: string }>,
  returnedNodeId: string,
) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const target = byId.get(returnedNodeId);
  if (!target) throw new Error("指定退回节点不存在");
  const reopenedAncestorNodeIds: string[] = [];
  let parentId = target.parentNodeId;
  const visited = new Set<string>([target.nodeId]);
  while (parentId) {
    if (visited.has(parentId)) throw new Error("质量分配链存在循环");
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) throw new Error("质量分配链上游节点缺失");
    if (["APPROVED", "PENDING_PARENT_REVIEW"].includes(parent.status)) {
      reopenedAncestorNodeIds.push(parent.nodeId);
    }
    parentId = parent.parentNodeId;
  }
  return {
    returnedNodeId,
    reopenedAncestorNodeIds,
    affectedNodeIds: [returnedNodeId, ...reopenedAncestorNodeIds],
  };
}
