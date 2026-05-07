export type FeedbackType = "PROGRESS" | "EVIDENCE" | "RISK";

export interface FeedbackEvent {
  id: string;
  planId: string;
  taskPackageId: string;
  nodeId: string;
  feedbackType: FeedbackType;
  content: string;
  attachmentRefs: string[];
  createdBy: string;
  createdAt: string;
}

