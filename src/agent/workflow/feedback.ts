import { FeedbackEvent } from "../../domain/feedback";

export function buildFeedbackEvent(input: Omit<FeedbackEvent, "id" | "createdAt">): FeedbackEvent {
  return {
    ...input,
    id: `fb_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
}

