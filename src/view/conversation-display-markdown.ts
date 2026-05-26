import { renderDingtalkTaskMarkdown } from "./dingtalk-task-markdown";

function readEnvBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return fallback;
}

export interface BuildAssistantDisplayMarkdownInput {
  modelMessage: string;
  currentDraft?: unknown;
  latestAssignment?: unknown;
  shouldRenderRichSection?: boolean;
  appendStructuredTaskTable?: boolean;
  assignmentSection?: string;
  publishResult?: Record<string, unknown>;
  rotatePlanHintTail?: string;
  onModelDrewTable?: () => void;
}

/** Deterministic full assistant markdown for UI / DingTalk outbound. */
export function buildAssistantDisplayMarkdown(
  input: BuildAssistantDisplayMarkdownInput,
): string {
  const appendStructuredTaskTable =
    input.appendStructuredTaskTable
    ?? readEnvBool("DINGTALK_APPEND_STRUCTURED_TABLE", true);
  const shouldRenderRichSection =
    input.shouldRenderRichSection ?? Boolean(input.currentDraft);

  return renderDingtalkTaskMarkdown({
    modelMessage: input.modelMessage,
    currentDraft: input.currentDraft,
    latestAssignment: input.latestAssignment,
    shouldRenderRichSection,
    appendStructuredTaskTable,
    onModelDrewTable: input.onModelDrewTable,
    assignmentSection: input.assignmentSection ?? "",
    publishResult: input.publishResult,
    rotatePlanHintTail: input.rotatePlanHintTail ?? "",
  });
}

export function readAppendStructuredTaskTableEnabled(): boolean {
  return readEnvBool("DINGTALK_APPEND_STRUCTURED_TABLE", true);
}
