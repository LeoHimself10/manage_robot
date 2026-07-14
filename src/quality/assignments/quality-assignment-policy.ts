import type { QualityAssignmentNode } from "../domain/quality-types";

export function assertNoAncestorAssignee(input: {
  parent: QualityAssignmentNode;
  ancestors: QualityAssignmentNode[];
  assigneeUserId: string;
}): void {
  const blocked = new Set([
    input.parent.assigneeUserId,
    ...input.ancestors.map((node) => node.assigneeUserId),
  ]);
  if (blocked.has(input.assigneeUserId)) {
    throw new Error("不能把质量任务分配给任一祖先节点承接人");
  }
}

export function assertChildDueWithinParent(childDueAt: string, parentDueAt: string): void {
  const child = Date.parse(childDueAt);
  const parent = Date.parse(parentDueAt);
  if (!Number.isFinite(child) || !Number.isFinite(parent) || child > parent) {
    throw new Error("子节点期限不能晚于父节点期限");
  }
}
