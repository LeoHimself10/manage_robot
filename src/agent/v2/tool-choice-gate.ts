/**
 * FR-1: per-turn `tool_choice` gate.
 *
 * Decides whether the upcoming v2 agent turn must call a tool (`required` /
 * forced specific tool) or may answer freely (`auto`). Deterministic guards
 * run first; row-split intent uses a lightweight LLM classifier (fail-open).
 */
import { isIP } from "node:net";
import type { PlanSession } from "../../infra/plan-session-store";
import type { ToolProfile } from "../tools/registry";
import {
  hasAssigneeIntentInUserMessage,
  hasDeadlineInUserMessage,
  hasRowPatchIntentInUserMessage,
  hasWholeTableRedraftIntentInUserMessage,
} from "../orchestrator-turn-hints";
import { isPublishConfirmUserMessage } from "../publish-staging";
import { hasRosterOrPoolContext } from "./turn-requirements";
import { v2ProfileIncludesTool } from "./tools";
import {
  classifyRowSplitIntent,
  type IntentClassifierConfig,
} from "./intent-classifier";

export type V2ToolChoice =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface DecideTurnToolChoiceInput {
  userMessage: string;
  /** Read latestDraft.tasks count, candidatePool, pendingRosterText. */
  session: PlanSession;
  /** Force only when the target tool is exposed in this profile, else auto. */
  toolProfile: ToolProfile;
  /** Force only for trusted actors; missing → auto. */
  trustedActorUserId?: string;
  /** Pre-turn assignment coverage (for U5 roster-assign forcing). */
  assignCoverage?: { covered: number; total: number };
  /** Thinking mode does not support forced tool_choice → always auto. */
  thinkingEnabled: boolean;
  /** Optional LLM config for row-split intent classification (fail-open). */
  classifierConfig?: IntentClassifierConfig;
}

export interface DecideTurnToolChoiceResult {
  toolChoice: V2ToolChoice;
  /** Narrow tool frontier (CMTF) when forcing; undefined = full set (auto). */
  frontier?: string[];
  /** Observability reason, e.g. "patch_required" / "publish_forced" / "auto:no_concrete_value". */
  reason: string;
}

function countDraftTasks(draft: Record<string, unknown> | undefined): number {
  const tasks = (draft as { tasks?: unknown } | undefined)?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

/** Synchronous check: true if text contains a public http(s) URL (no DNS lookup). */
function hasExternalHttpUrl(text: string): boolean {
  const urlRe = /https?:\/\/([^\s/'"<>()[\]{}]+)/gi;
  for (const match of text.matchAll(urlRe)) {
    const rawHostname = match[1].split("/")[0].split("?")[0].split("#")[0].toLowerCase();
    // Strip optional user-info and port
    const hostname = rawHostname.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
    if (!hostname) continue;
    // Skip obviously local/private hostnames (mirrors url-fetch-guard logic)
    if (hostname === "localhost") continue;
    if (hostname.endsWith(".local") || hostname.endsWith(".localhost")) continue;
    const ipKind = isIP(hostname);
    if (ipKind !== 0) {
      // Skip IP addresses (private-IP check not needed here — if it's any IP, skip forcing)
      continue;
    }
    return true;
  }
  return false;
}

const ASSIGNEE_CHANGE_CLUE_RE =
  /(负责人|换成|改成|改为|换为|改由|交给|改派给?|指派给|分配给)/g;

/** Chinese fragments that follow a change clue but are clearly not a person name. */
const NON_NAME_FRAGMENTS = new Set([
  "一下",
  "这个",
  "那个",
  "任务",
  "内容",
  "时间",
  "日期",
  "截止",
  "标准",
  "目标",
  "那列",
  "这列",
  "那一",
  "这一",
]);

/**
 * 「带目标值」检测：句中命中日期(复用 deadline 正则) **或** 含「负责人/换成…」+
 * 紧随其后的中文姓名片段。缺值返回 false（宁缺退 auto）。
 */
export function hasConcreteChangePayload(userMessage: string): boolean {
  const text = String(userMessage ?? "").trim();
  if (!text) return false;
  if (hasDeadlineInUserMessage(text)) return true;

  let lastIdx = -1;
  let lastLen = 0;
  for (const m of text.matchAll(ASSIGNEE_CHANGE_CLUE_RE)) {
    lastIdx = m.index ?? -1;
    lastLen = m[0].length;
  }
  if (lastIdx < 0) return false;

  const after = text.slice(lastIdx + lastLen);
  const nameMatch = /^[为成由给:：\s]*([\u4e00-\u9fa5]{2,4})/.exec(after);
  const fragment = nameMatch?.[1];
  if (
    fragment
    && !NON_NAME_FRAGMENTS.has(fragment)
    // reject fragments that begin with a change verb (e.g. 「改一下」) — not a name
    && !/^[改换调设定为成到加减删变更]/.test(fragment)
  ) {
    return true;
  }
  return false;
}

/**
 * Decide the per-turn tool_choice + CMTF frontier from user message + session
 * state. Row-split uses async LLM classification when deterministic guards
 * do not already force another tool.
 */
export async function decideTurnToolChoice(
  input: DecideTurnToolChoiceInput,
): Promise<DecideTurnToolChoiceResult> {
  const text = String(input.userMessage ?? "").trim();
  const auto = (reason: string): DecideTurnToolChoiceResult => ({
    toolChoice: "auto",
    reason,
  });

  // Negative guards (any hit → auto)
  if (input.thinkingEnabled) return auto("auto:thinking_enabled");
  if (!input.trustedActorUserId || !input.trustedActorUserId.trim()) {
    return auto("auto:no_trusted_actor");
  }
  if (hasWholeTableRedraftIntentInUserMessage(text)) {
    return auto("auto:whole_table_redraft");
  }

  // External URL (U1): message contains a public http(s) URL ∧ read_url in profile.
  // Force read_url on the first iteration so the model always fetches before drafting.
  if (
    hasExternalHttpUrl(text)
    && v2ProfileIncludesTool(input.toolProfile, "read_url")
  ) {
    return {
      toolChoice: { type: "function", function: { name: "read_url" } },
      frontier: ["read_url"],
      reason: "url_read_forced",
    };
  }

  const draftTaskCount = countDraftTasks(input.session.latestDraft);
  const hasDraft = Boolean(input.session.latestDraft);
  const isPatchIntent = hasRowPatchIntentInUserMessage(text);

  // PATCH (R6): rowPatch intent ∧ draft tasks ≥ 2 ∧ concrete value
  if (isPatchIntent && draftTaskCount >= 2) {
    if (!hasConcreteChangePayload(text)) {
      return auto("auto:no_concrete_value");
    }
    if (!v2ProfileIncludesTool(input.toolProfile, "update_draft_task")) {
      return auto("auto:patch_tool_not_in_profile");
    }
    return {
      toolChoice: "required",
      frontier: ["update_draft_task", "bulk_assign_tasks", "search_employees"],
      reason: "patch_required",
    };
  }

  // Row split (R4/R4b): LLM classifier when draft exists and patch did not match.
  if (hasDraft && !isPatchIntent) {
    const splitIntent = await classifyRowSplitIntent(text, input.classifierConfig);
    if (splitIntent === "split") {
      if (!v2ProfileIncludesTool(input.toolProfile, "split_draft_task")) {
        return auto("auto:split_tool_not_in_profile");
      }
      return {
        toolChoice: { type: "function", function: { name: "split_draft_task" } },
        frontier: ["split_draft_task"],
        reason: "row_split_forced",
      };
    }
  }

  // Publish confirm: confirm message ∧ session has a staged draft
  if (isPublishConfirmUserMessage(text) && hasDraft) {
    if (!v2ProfileIncludesTool(input.toolProfile, "publish_task")) {
      return auto("auto:publish_tool_not_in_profile");
    }
    return {
      toolChoice: { type: "function", function: { name: "publish_task" } },
      frontier: ["publish_task"],
      reason: "publish_forced",
    };
  }

  // Roster assign (U5): assignee intent ∧ roster/pool ready ∧ coverage < full.
  if (
    hasAssigneeIntentInUserMessage(text)
    && hasRosterOrPoolContext(input.session)
    && input.assignCoverage
    && input.assignCoverage.total > 0
    && input.assignCoverage.covered < input.assignCoverage.total
  ) {
    if (!v2ProfileIncludesTool(input.toolProfile, "assign_from_roster")) {
      return auto("auto:assign_tool_not_in_profile");
    }
    return {
      toolChoice: { type: "function", function: { name: "assign_from_roster" } },
      frontier: ["assign_from_roster"],
      reason: "roster_assign_forced",
    };
  }

  return auto("auto:no_match");
}

/** Serialize a tool choice for structured logging. */
export function serializeTurnToolChoice(toolChoice: V2ToolChoice): string {
  if (toolChoice === "auto") return "auto";
  if (toolChoice === "required") return "required";
  return `forced:${toolChoice.function.name}`;
}
