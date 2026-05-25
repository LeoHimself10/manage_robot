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
  iat: number;
  exp: number;
}
