/**
 * Per-turn [memory_context] action hints (CLARIFY / DRAFT / publish staging).
 * Kept separate from orchestrator.ts to keep hint logic testable.
 */
import {
  hasRowSplitIntent,
  hasWholeTableRedraftIntent,
} from "./draft-mutation/false-split";

export interface TurnHintSessionContext {
  conversationHistory?: Array<{ role: string; content: string }>;
  latestDraft?: Record<string, unknown>;
  memoryFacts?: string[];
  pendingRoster?: { sourceLabel: string; chars: number };
}

const EXPLICIT_DRAFT_REQUEST_RE =
  /请?\s*生成(正式)?草案|出草案|生成任务表|出任务表/i;

const DEADLINE_FACT_PREFIX_RE = /^(deadline:|timerange:|time_range:|fact:deadline:|due:)/i;

const DEADLINE_IN_TEXT_RE =
  /\d{4}[-/年]\d{1,2}([-/月]\d{1,2}日?)?|\d{1,2}\s*月\s*\d{1,2}\s*日|下[周礼拜]|本[周礼拜]|[一二三四五六七八九十\d]+\s*个?\s*月内|[一二三四五六七八九十\d]+\s*周内|之前|以内|前完成|deadline:/i;

const ASSIGN_INTENT_RE =
  /指派|点将|分配给|交给|负责人|谁来做|按这份名单|从.*(中选|分配)|改派|由你.{0,6}分派|由你分配|你来派|帮我分派|为我分派/i;

const START_NEW_TASK_WELCOME_RE =
  /已开启新任务|开启新任务[。！]?请描述|请描述您需要规划的具体工作/i;

/** 用户短句明确要求生成草案（如「请生成草案」）。 */
export function shouldInjectExplicitDraftRequestHint(userMessage: string): boolean {
  return EXPLICIT_DRAFT_REQUEST_RE.test(String(userMessage ?? "").trim());
}

export function hasDeadlineInKnownFacts(facts: readonly string[] | undefined): boolean {
  for (const raw of facts ?? []) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (DEADLINE_FACT_PREFIX_RE.test(lower)) return true;
    if (DEADLINE_IN_TEXT_RE.test(line)) return true;
  }
  return false;
}

export function hasDeadlineInUserMessage(userMessage: string): boolean {
  return DEADLINE_IN_TEXT_RE.test(String(userMessage ?? "").trim());
}

export function hasDeadlineInContext(
  userMessage: string,
  memoryFacts?: readonly string[],
): boolean {
  return hasDeadlineInUserMessage(userMessage) || hasDeadlineInKnownFacts(memoryFacts);
}

export function hasAssigneeIntentInUserMessage(userMessage: string): boolean {
  return ASSIGN_INTENT_RE.test(String(userMessage ?? "").trim());
}

export function hasRowSplitIntentInUserMessage(userMessage: string): boolean {
  return hasRowSplitIntent(userMessage);
}

export function hasWholeTableRedraftIntentInUserMessage(userMessage: string): boolean {
  return hasWholeTableRedraftIntent(userMessage);
}

function hasDraftTasks(sessionContext: TurnHintSessionContext | undefined): boolean {
  const draft = sessionContext?.latestDraft;
  if (!draft || typeof draft !== "object") return false;
  const tasks = (draft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

/** 已有草案且用户要求单行拆分 → ROW_SPLIT 工具纪律注入。 */
export function shouldInjectSplitActionHint(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): boolean {
  if (!hasDraftTasks(sessionContext)) return false;
  if (!hasRowSplitIntentInUserMessage(userMessage)) return false;
  if (hasWholeTableRedraftIntentInUserMessage(userMessage)) return false;
  return true;
}

/** 已有草案且用户要求分派/点将 → ASSIGN 批量纪律注入。 */
export function shouldInjectAssignActionHint(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): boolean {
  if (!hasDraftTasks(sessionContext)) return false;
  return hasAssigneeIntentInUserMessage(userMessage);
}

/** start_new_task 后的「请描述…期望完成时间？」欢迎语，不是真实 CLARIFY 回合。 */
export function isStartNewTaskWelcomeMessage(assistantMessage: string): boolean {
  const text = String(assistantMessage ?? "").trim();
  if (!text) return false;
  if (START_NEW_TASK_WELCOME_RE.test(text) && /请描述|期望.{0,8}完成时间/.test(text)) {
    return true;
  }
  if (/已开启新任务/.test(text) && /请描述/.test(text) && !/请补充|已采纳要点/.test(text)) {
    return true;
  }
  return false;
}

/** 上一轮 assistant 是否为真实 CLARIFY（追问缺信息），而非开任务欢迎语。 */
export function isGenuineClarifyAssistantMessage(assistantMessage: string): boolean {
  const text = String(assistantMessage ?? "").trim();
  if (!text || isStartNewTaskWelcomeMessage(text)) return false;
  if (/请补充|补充以下|关键信息|型号|批次|截止日期|期望.{0,6}完成时间|openQuestions/i.test(text)) {
    return true;
  }
  if (/[？?]\s*$/.test(text) && text.length >= 20 && text.length <= 400 && !/任务列表/.test(text)) {
    return !/已开启新任务/.test(text);
  }
  return false;
}

function lastAssistantMessage(
  history: Array<{ role: string; content: string }> | undefined,
): string {
  if (!history?.length) return "";
  const last = [...history].reverse().find((h) => h.role === "assistant");
  return String(last?.content ?? "").trim();
}

/** 用户在上轮真实 CLARIFY 后补充，且已有 deadline → 注入 DRAFT 强提示。 */
export function shouldInjectPostClarifyDraftHint(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): boolean {
  const text = String(userMessage ?? "").trim();
  if (text.length < 80) return false;
  if (sessionContext?.latestDraft) return false;
  if (!hasDeadlineInContext(text, sessionContext?.memoryFacts)) return false;

  const lastAssistant = lastAssistantMessage(sessionContext?.conversationHistory);
  return isGenuineClarifyAssistantMessage(lastAssistant);
}

/** 无 draft、缺 deadline、用户已描述场景 → CLARIFY-only 注入。 */
export function shouldInjectClarifyActionHint(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): boolean {
  if (sessionContext?.latestDraft) return false;
  const text = String(userMessage ?? "").trim();
  if (text.length < 40) return false;
  if (hasDeadlineInContext(text, sessionContext?.memoryFacts)) return false;
  if (shouldInjectPostClarifyDraftHint(sessionContext, userMessage)) return false;
  return true;
}

export type TurnActionHint =
  | { kind: "explicitDraftRequest" }
  | { kind: "assignAction" }
  | { kind: "splitAction" }
  | { kind: "clarifyAction" }
  | { kind: "postClarifyDraftAction" };

/** 互斥优先级：explicit → assign（有草案）→ split（有草案）→ clarify → postClarify */
export function resolveTurnActionHint(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): TurnActionHint | undefined {
  if (shouldInjectExplicitDraftRequestHint(userMessage)) {
    if (hasDeadlineInContext(userMessage, sessionContext?.memoryFacts)) {
      return { kind: "explicitDraftRequest" };
    }
    return { kind: "clarifyAction" };
  }
  if (shouldInjectAssignActionHint(sessionContext, userMessage)) {
    return { kind: "assignAction" };
  }
  if (shouldInjectSplitActionHint(sessionContext, userMessage)) {
    return { kind: "splitAction" };
  }
  if (shouldInjectClarifyActionHint(sessionContext, userMessage)) {
    return { kind: "clarifyAction" };
  }
  if (shouldInjectPostClarifyDraftHint(sessionContext, userMessage)) {
    return { kind: "postClarifyDraftAction" };
  }
  return undefined;
}

export function formatAssignActionHint(taskCount?: number): string {
  const nHint = taskCount && taskCount > 1 ? `${taskCount} 条 draft → ${taskCount} 行 assignment；` : "";
  return (
    "assignAction: 用户要求分派；" + nHint +
    "≤2 次 search_employees + get_employee_details 核对 shortlisted 后，" +
    "**bulk_assign_tasks 或顶层 assignment JSON 一次覆盖全部 taskId**；" +
    "**禁止**逐 task 循环 update_draft_task(assigneeUserId)（第 2 次会被拒）。"
  );
}

export function formatSplitActionHint(): string {
  return (
    "splitAction: 用户要求单行拆分（任务N拆成M条）；须 update_draft_task 改原行 + " +
    "add_draft_subtask(insertAfterSubtaskId=该行 taskId) 使 tasks.length 增加；" +
    "禁止仅在 message 用 1.2. 列表口播。"
  );
}

export function formatTurnActionHint(
  hint: TurnActionHint,
  sessionContext?: TurnHintSessionContext,
): string {
  switch (hint.kind) {
    case "explicitDraftRequest":
      return "explicitDraftRequest: 用户要求生成草案；本轮须 DRAFT + 顶层 draft JSON（含 title/description/tasks[]）。";
    case "assignAction":
      return formatAssignActionHint(
        Array.isArray((sessionContext?.latestDraft as { tasks?: unknown[] } | undefined)?.tasks)
          ? ((sessionContext!.latestDraft as { tasks: unknown[] }).tasks.length)
          : undefined,
      );
    case "splitAction":
      return formatSplitActionHint();
    case "clarifyAction":
      return "clarifyAction: 缺关键信息（如截止时间）；CLARIFY-only，直接输出 message JSON，禁止 tool_calls。";
    case "postClarifyDraftAction":
      return "postClarifyDraftAction: CLARIFY 后已补充；须 DRAFT + 顶层 draft JSON。";
    default:
      return "";
  }
}

export function buildTurnActionHintLine(
  sessionContext: TurnHintSessionContext | undefined,
  userMessage: string,
): string | undefined {
  const hint = resolveTurnActionHint(sessionContext, userMessage);
  return hint ? formatTurnActionHint(hint, sessionContext) : undefined;
}

export function formatPublishStagingActionHint(staged: boolean): string {
  return staged
    ? "publishStagingAction: 用户确认发布 → 调用 publish_task(planId=当前 planId)。"
    : "publishStagingAction: 用户确认发布 → 先 prepare_publish_task，再 publish_task。";
}

export function formatScopeBoundaryHint(input: {
  fromLabel?: string;
  toLabel?: string;
}): string {
  const toDesc = input.toLabel ? `「${input.toLabel}」` : "新任务";
  const fromDesc = input.fromLabel ? `（从「${input.fromLabel}」）` : "";
  return `scopeBoundary: 已切换到 ${toDesc}${fromDesc}。`;
}

export function formatPendingRosterHint(roster: { sourceLabel: string; chars: number }): string {
  return (
    `pendingRoster: ${JSON.stringify(roster)} → read_uploaded_roster_text → resolve_roster_names → set_candidate_pool；` +
    "禁止逐一 search_employees(name=...)。"
  );
}
