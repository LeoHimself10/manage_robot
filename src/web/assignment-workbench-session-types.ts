import type { WorkbenchRole } from "../security/workbench-role-resolver";

export interface WorkbenchSession {
  sid: string;
  userId: string;
  role: WorkbenchRole;
  primaryRole?: WorkbenchRole;
  loginSource: "entry" | "signed_link" | "dingtalk_authcode" | "external_password";
  dingUser?: {
    userId: string;
    name?: string;
    unionId?: string;
    loginAt: string;
  };
  /**
   * Signed administrator delegation context. `userId` remains the effective
   * business identity so every existing workbench permission and data-scope
   * check behaves exactly as it does for the selected person. The real
   * administrator is retained separately for exit and audit.
   */
  impersonation?: {
    actorUserId: string;
    actorName?: string;
    actorDingUser?: WorkbenchSession["dingUser"];
    targetUserId: string;
    targetName?: string;
    targetKind: "manager" | "project_manager" | "employee" | "quality_specialist";
    startedAt: string;
  };
  iat: number;
  exp: number;
}
