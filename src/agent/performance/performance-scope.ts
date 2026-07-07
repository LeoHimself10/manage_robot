import type { WorkbenchSession } from "../../web/assignment-workbench-session-types";
import type { PerformanceScope } from "../tools/performance-tools";
import { resolveWorkbenchManagerScope } from "../../security/workbench-manager-scope";

/**
 * 绩效统计范围按**当前会话视角**（session.role）判定，而非用户是否具备 admin 能力：
 * - admin 视角 → 全员
 * - manager 视角 → 仅 session.userId 名下任务（即使该用户同时是 admin）
 */
export function resolvePerformanceScope(session: Pick<WorkbenchSession, "role" | "userId">): PerformanceScope {
  if (session.role === "admin") {
    return { kind: "all" };
  }
  const scope = resolveWorkbenchManagerScope(session.userId);
  return {
    kind: "manager",
    managerUserId: session.userId,
    managerGroupId: scope.managerGroupId,
    managerGroupMemberUserIds: scope.managerGroupMemberUserIds,
  };
}

export function performanceScopeLabel(scope: PerformanceScope): string {
  return scope.kind === "all" ? "全员（管理员视角）" : "您名下员工";
}
