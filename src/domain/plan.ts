import { PlanDomain, PlanStatus } from "../agent/harness/types";
import { TaskPackage } from "./task-package";

export interface Plan {
  id: string;
  domain: PlanDomain;
  subType: string;
  productOrProjectRef?: string;
  severity?: string;
  background: string;
  constraints: string[];
  initiatorId: string;
  status: PlanStatus;
  taskPackages: TaskPackage[];
  externalRefs: string[];
  createdAt: string;
  updatedAt: string;
}

