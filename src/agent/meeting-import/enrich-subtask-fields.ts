import type { MeetingImportActionItem } from "./types";

export interface EnrichedSubtaskFields {
  objective: string;
  deliverables: string;
  completionCriteria: string;
}

export function enrichSubtaskFieldsFromExcerpt(item: MeetingImportActionItem): EnrichedSubtaskFields {
  const excerpt = item.excerpt.trim() || item.title.trim();
  return {
    objective: excerpt.slice(0, 300),
    deliverables: `完成「${item.title.trim()}」相关交付`.slice(0, 300),
    completionCriteria: `会议待办「${item.title.trim()}」已落实并可验收`.slice(0, 300),
  };
}

export function enrichSubtaskFieldsForItems(items: MeetingImportActionItem[]): EnrichedSubtaskFields[] {
  return items.map(enrichSubtaskFieldsFromExcerpt);
}
