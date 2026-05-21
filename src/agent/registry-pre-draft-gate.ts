import type { PlanSession } from "../infra/plan-session-store";

const ASSIGN_INTENT_RE =
  /指派|点将|分配给|交给|负责人|谁来做|按这份名单|从.*(中选|分配)|改派/i;

export function hasPublishableDraftInSession(session: PlanSession | undefined): boolean {
  if (!session?.latestDraft || typeof session.latestDraft !== "object") return false;
  const tasks = (session.latestDraft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

export function hasAssigneeIntentInMessage(userMessage: string | undefined): boolean {
  return ASSIGN_INTENT_RE.test(String(userMessage ?? "").trim());
}

export type PreDraftGateTool =
  | "search_employees"
  | "search_similar_plans"
  | "update_known_facts";

export interface PreDraftGateInput {
  session?: PlanSession;
  userMessage?: string;
  toolName: PreDraftGateTool;
  args?: Record<string, unknown>;
}

export function shouldBlockPreDraftTool(input: PreDraftGateInput): boolean {
  if (hasPublishableDraftInSession(input.session)) return false;
  if (hasAssigneeIntentInMessage(input.userMessage)) return false;

  if (input.toolName === "search_employees") {
    const name = String(input.args?.name ?? "").trim();
    if (name.length > 0) return false;
    return true;
  }

  if (input.toolName === "search_similar_plans" || input.toolName === "update_known_facts") {
    return true;
  }

  return false;
}

export function buildPreDraftGateResponse(toolName: PreDraftGateTool): {
  ok: false;
  reason: "search_before_draft" | "pre_draft_tool_blocked";
  toolName: PreDraftGateTool;
  hint: string;
} {
  const hints: Record<PreDraftGateTool, string> = {
    search_employees:
      "当前尚无草案且未要求点将：请先 CLARIFY 追问或输出 draft JSON，勿搜人。",
    search_similar_plans:
      "当前尚无草案：请先 CLARIFY 或输出 draft JSON，勿用相似计划检索代替。",
    update_known_facts:
      "当前尚无草案：请先 CLARIFY 或输出 draft JSON，勿用 update_known_facts 代替追问。",
  };
  return {
    ok: false,
    reason: toolName === "search_employees" ? "search_before_draft" : "pre_draft_tool_blocked",
    toolName,
    hint: hints[toolName],
  };
}
