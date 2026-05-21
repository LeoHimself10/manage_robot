/** Shared constants for progress digest modules. */
export const PROGRESS_DIGEST_EVENT_TYPES = [
  "SUBTASK_PROGRESS",
  "SUBTASK_ACCEPTED",
  "SUBTASK_REJECTED",
  "SUBTASK_CHANGES_REQUESTED",
  "SUBTASK_CUSTOMIZE_NOTE",
] as const;

export const PROGRESS_DIGEST_MARKDOWN_MAX = 3200;
