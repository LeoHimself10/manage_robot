/** Narrow detection for row-level split requests that must increase tasks[].length. */

const ROW_ANCHOR_RE =
  /(?:任务?\s*[0-9一二三四五六七八九十]+|task_\d+|第\s*[0-9一二三四五六七八九十]+\s*(?:条|项|行|个子任务))/i;

const ROW_SPLIT_VERB_RE = /(?:拆成|拆为|分成|分为|拆细成|拆成\s*两个|拆成\s*2\s*个)/i;

const WHOLE_TABLE_REDRAFT_RE =
  /(?:整表|全部子任务|所有子任务|整张表|重新拆解|WBS|整表重出|tasks\[\]\s*全量|扩成\s*[0-9一二三四五六七八九十两三四]+\s*条|拆得更细|增加\s*子任务\s*条数)/i;

const FALSE_SPLIT_CLAIM_RE =
  /(?:已|已完成|已经).{0,6}(?:拆|分)(?:成|为|细)|(?:拆|分)(?:成|为).{0,8}(?:两条|2\s*条|两个|2\s*个|多个)/;

export function hasRowSplitIntent(userMessage: string): boolean {
  const text = String(userMessage ?? "").trim();
  if (!text) return false;
  return ROW_ANCHOR_RE.test(text) && ROW_SPLIT_VERB_RE.test(text);
}

export function hasWholeTableRedraftIntent(userMessage: string): boolean {
  const text = String(userMessage ?? "").trim();
  if (!text) return false;
  return WHOLE_TABLE_REDRAFT_RE.test(text);
}

export function looksLikeFalseSplitClaim(outboundText: string): boolean {
  const text = String(outboundText ?? "").trim();
  if (!text) return false;
  if (/(尚未|未|还未|还没有?|没有).{0,8}(?:拆|分)/.test(text)) return false;
  return FALSE_SPLIT_CLAIM_RE.test(text);
}

export function draftTaskCount(draft: Record<string, unknown> | undefined): number {
  const tasks = (draft as { tasks?: unknown[] } | undefined)?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

export interface FalseSplitDetectionInput {
  userMessage: string;
  preTurnDraft?: Record<string, unknown>;
  postTurnDraft?: Record<string, unknown>;
  outboundMarkdown: string;
  toolInvocationNames?: readonly string[];
  orchResultHasDraftJson?: boolean;
}

export function detectFalseSplit(input: FalseSplitDetectionInput): boolean {
  if (!hasRowSplitIntent(input.userMessage)) return false;
  if (hasWholeTableRedraftIntent(input.userMessage)) return false;
  const preCount = draftTaskCount(input.preTurnDraft);
  if (preCount < 1) return false;

  const postCount = draftTaskCount(input.postTurnDraft);
  if (postCount > preCount) return false;
  if (input.orchResultHasDraftJson && postCount > preCount) return false;

  const tools = input.toolInvocationNames ?? [];
  if (tools.includes("add_draft_subtask") && postCount > preCount) return false;

  if (input.orchResultHasDraftJson) {
    const orchTasks = (input.postTurnDraft as { tasks?: unknown[] } | undefined)?.tasks;
    if (Array.isArray(orchTasks) && orchTasks.length > preCount) return false;
  }

  if (looksLikeFalseSplitClaim(input.outboundMarkdown)) return true;
  if (!tools.includes("add_draft_subtask") && postCount <= preCount) return true;
  return false;
}

export function buildSplitRetryUserMessage(input: {
  originalUserMessage: string;
  taskIndexMap?: Array<{ n: number; id: string; title: string }>;
}): string {
  const mapLine =
    input.taskIndexMap?.length
      ? `taskIndexMap: ${JSON.stringify(input.taskIndexMap)}`
      : "";
  return [
    "[split_retry_required]",
    mapLine,
    "单行拆分须 update_draft_task（改原行）+ add_draft_subtask(insertAfterSubtaskId=该行 taskId) 使 tasks.length 增加；禁止仅在 message 用 1.2. 列表口播。",
    "",
    input.originalUserMessage,
  ]
    .filter(Boolean)
    .join("\n");
}
