import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { isWorkbenchProjectPortfolioEnabled } from "../../security/workbench-project-portfolio";
import { resolvePublishProjectIdForSession } from "./resolve-publish-project-id";

export { resolvePublishProjectIdForSession };

function resolvePortfolioActor(args: Record<string, unknown>, trusted: string): string {
  const trustedTrim = trusted.trim();
  if (trustedTrim) return trustedTrim;
  return String(args.actorUserId ?? "").trim();
}

function requirePortfolio(actorUserId: string): void {
  if (!actorUserId.trim()) throw new Error("actor_required");
  if (!isWorkbenchProjectPortfolioEnabled(actorUserId)) {
    throw new Error("project_portfolio_not_enabled");
  }
}

export const LIST_PROJECTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_projects",
    description: "列出当前主管名下的大项目（含名称与简述）。仅 project portfolio 主管可用。",
    parameters: {
      type: "object",
      properties: { actorUserId: { type: "string" } },
      required: [],
    },
  },
};

export const CREATE_PROJECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_project",
    description:
      "新建大项目。name 必填；description 与 aliases（关键词数组，用于后续 suggest）可选。仅 portfolio 主管可用。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        aliases: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
  },
};

export const SUGGEST_PROJECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "suggest_project",
    description:
      "根据用户描述与已登记项目，返回 1–3 个最可能的大项目及理由（不自动写库）。仅 portfolio 主管可用。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        userMessage: { type: "string", description: "用户本轮或近期描述" },
      },
      required: ["userMessage"],
    },
  },
};

export const SET_ACTIVE_PROJECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_active_project",
    description:
      "将当前会话默认大项目设为 projectId；传空字符串清除。写入 session，发布时可作为默认归属。仅 portfolio 主管可用。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        projectId: { type: "string" },
      },
      required: [],
    },
  },
};

function scoreProject(
  project: { name: string; description?: string; aliases: string[] },
  text: string,
): { score: number; reason: string } {
  const hay = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const name = project.name.toLowerCase();
  if (name && hay.includes(name)) {
    score += 10;
    reasons.push(`名称匹配「${project.name}」`);
  }
  for (const a of project.aliases) {
    const al = a.toLowerCase();
    if (al.length >= 2 && hay.includes(al)) {
      score += 6;
      reasons.push(`关键词「${a}」`);
    }
  }
  const desc = String(project.description ?? "").toLowerCase();
  if (desc.length >= 4) {
    const words = desc.split(/\s+/).filter((w) => w.length >= 2);
    for (const w of words.slice(0, 8)) {
      if (hay.includes(w)) {
        score += 2;
        break;
      }
    }
    if (score >= 2 && !reasons.length) reasons.push("描述相关");
  }
  return { score, reason: reasons.join("；") || "弱相关" };
}

export function buildProjectPortfolioToolHandlers(deps: {
  trustedActorUserId?: string;
  currentSession?: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
}): Record<string, { definition: ToolDefinition; handler: ToolHandler }> {
  const taskStore = createWorkbenchFormalTaskStore();
  const trusted = deps.trustedActorUserId?.trim() ?? "";

  const listHandler: ToolHandler = (args) => {
    const actor = resolvePortfolioActor(args, trusted);
    requirePortfolio(actor);
    const projects = taskStore.listProjectsForOwner(actor);
    return { ok: true, actorUserId: actor, projects };
  };

  const createHandler: ToolHandler = (args) => {
    const actor = resolvePortfolioActor(args, trusted);
    requirePortfolio(actor);
    const name = String(args.name ?? "").trim();
    const aliases = Array.isArray(args.aliases)
      ? (args.aliases as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const project = taskStore.createProject({
      ownerUserId: actor,
      name,
      description: String(args.description ?? "").trim() || undefined,
      aliases,
    });
    return { ok: true, project };
  };

  const suggestHandler: ToolHandler = (args) => {
    const actor = resolvePortfolioActor(args, trusted);
    requirePortfolio(actor);
    const userMessage = String(args.userMessage ?? "").trim();
    if (!userMessage) return { ok: false, reason: "userMessage required" };
    const projects = taskStore.listProjectsForOwner(actor).filter((p) => p.status === "active");
    const ranked = projects
      .map((p) => {
        const { score, reason } = scoreProject(p, userMessage);
        return { projectId: p.projectId, name: p.name, score, reason };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const top = ranked[0];
    return {
      ok: true,
      suggestions: ranked,
      recommended: top ?? null,
      hint: top
        ? `建议归入「${top.name}」（${top.reason}）。请向用户确认，确认后 set_active_project 或写入 draft.projectId。`
        : "无强匹配项目；可 create_project 或请用户指明项目名称。",
    };
  };

  const setActiveHandler: ToolHandler = (args) => {
    const actor = resolvePortfolioActor(args, trusted);
    requirePortfolio(actor);
    const session = deps.currentSession;
    if (!session) return { ok: false, reason: "session_not_found" };
    const pid = String(args.projectId ?? "").trim();
    if (!pid) {
      session.activeProjectId = undefined;
      deps.onSessionMutated?.(session);
      return { ok: true, cleared: true };
    }
    const proj = taskStore.getProject(pid, actor);
    if (!proj || proj.status !== "active") {
      return { ok: false, reason: "invalid_project", hint: "project_id 无效或非本人 active 项目" };
    }
    session.activeProjectId = pid;
    deps.onSessionMutated?.(session);
    return { ok: true, projectId: pid, projectName: proj.name };
  };

  return {
    list_projects: { definition: LIST_PROJECTS_TOOL, handler: listHandler },
    create_project: { definition: CREATE_PROJECT_TOOL, handler: createHandler },
    suggest_project: { definition: SUGGEST_PROJECT_TOOL, handler: suggestHandler },
    set_active_project: { definition: SET_ACTIVE_PROJECT_TOOL, handler: setActiveHandler },
  };
}
