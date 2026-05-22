import { getAssignmentCoverage } from "./merge-assignment";
import { hasAssigneeIntentInUserMessage } from "../orchestrator-turn-hints";

const FALSE_ASSIGN_CLAIM =
  /(已|已完成|已经)(指派|分配|点将|分派|指定负责人|完成分配)|负责人.{0,6}(已|都).{0,4}(指|分|派|定)/;

export function looksLikeFalseAssignClaim(outboundText: string): boolean {
  const text = String(outboundText ?? "").trim();
  if (!text) return false;
  if (/(尚未|未|还未|还没有?|没有).{0,8}(指派|分配|负责人)/.test(text)) return false;
  return FALSE_ASSIGN_CLAIM.test(text);
}

export interface FalseAssignDetectionInput {
  userMessage: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  outboundMarkdown: string;
  hasFullAssignmentJson?: boolean;
}

export function detectFalseAssign(input: FalseAssignDetectionInput): boolean {
  if (!hasAssigneeIntentInUserMessage(input.userMessage)) return false;
  if (input.hasFullAssignmentJson) return false;
  const coverage = getAssignmentCoverage(input.latestDraft, input.latestAssignment);
  if (coverage.total === 0) return false;
  if (coverage.covered === coverage.total) return false;
  return looksLikeFalseAssignClaim(input.outboundMarkdown);
}

export function formatFalseAssignObservedNotice(input?: {
  missingTaskIds?: string[];
}): string {
  const missing = input?.missingTaskIds?.filter(Boolean) ?? [];
  const tail =
    missing.length > 0
      ? `仍缺负责人：${missing.join("、")}。请用 **bulk_assign_tasks** 或顶层 **assignment JSON** 一次覆盖全部 taskId。`
      : "请用 **bulk_assign_tasks** 或顶层 **assignment JSON** 一次覆盖全部 taskId。";
  return `\n\n---\n**负责人尚未写入系统**：${tail}`;
}

export function buildAssignRetryUserMessage(input: {
  originalUserMessage: string;
  missingTaskIds: string[];
  taskIndexMap?: Array<{ n: number; id: string; title: string }>;
}): string {
  const mapLine =
    input.taskIndexMap?.length
      ? `taskIndexMap: ${JSON.stringify(input.taskIndexMap)}`
      : "";
  return [
    "[assign_retry_required]",
    `missingTaskIds: ${JSON.stringify(input.missingTaskIds)}`,
    mapLine,
    "须 bulk_assign_tasks 或顶层 assignment JSON 一次覆盖全部 draft taskId；禁止逐条 update_draft_task。",
    "",
    input.originalUserMessage,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTaskIndexMap(
  draft: Record<string, unknown> | undefined,
): Array<{ n: number; id: string; title: string }> {
  const tasks = Array.isArray((draft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  return tasks.map((t, i) => ({
    n: i + 1,
    id: String(t?.id ?? "").trim(),
    title: String(t?.title ?? "").trim().slice(0, 80),
  }));
}
