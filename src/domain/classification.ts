import { PlanDomain } from "../agent/harness/types";

export type ClassificationConfidence = "HIGH" | "MEDIUM" | "LOW";

export type QualitySubtype =
  | "PRODUCTION_PROCESS_ABNORMALITY"
  | "INSPECTION_OR_TEST_ABNORMALITY"
  | "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE"
  | "SUPPLIER_ISSUE"
  | "DESIGN_RELATED_QUALITY_TASK"
  | "QUALITY_OTHER_OR_UNCERTAIN";

export type RdSubtype =
  | "REQUIREMENT_OR_DESIGN_INPUT"
  | "SOLUTION_DEVELOPMENT"
  | "VERIFICATION_AND_VALIDATION"
  | "DESIGN_CHANGE_ACTION"
  | "RD_OTHER_OR_UNCERTAIN";

export type TaskSubtype = QualitySubtype | RdSubtype;

export interface ClassificationResult {
  domain: PlanDomain;
  subtype: TaskSubtype;
  confidence: ClassificationConfidence;
  rationale: string[];
  missingInformation: string[];
}
