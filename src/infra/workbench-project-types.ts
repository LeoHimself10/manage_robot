export type WorkbenchProjectStatus = "active" | "archived";

export interface WorkbenchProjectRow {
  projectId: string;
  name: string;
  description?: string;
  ownerUserId: string;
  status: WorkbenchProjectStatus;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

export const UNASSIGNED_PROJECT_BUCKET = "__unassigned__";
