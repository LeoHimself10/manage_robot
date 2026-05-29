import type { PlanSession } from "../src/infra/plan-session-store";
import { DatabaseSync } from "node:sqlite";

const PROJECT_TOOL_NAMES = new Set([
  "list_projects",
  "create_project",
  "suggest_project",
  "set_active_project",
]);

export function assertNoProjectTools(toolCalls: string[]): void {
  for (const name of toolCalls) {
    if (PROJECT_TOOL_NAMES.has(name)) {
      throw new Error(`forbidden project tool in baseline eval: ${name}`);
    }
  }
}

export function assertNoProjectClarifyInMessage(message: string): void {
  const hay = String(message ?? "");
  if (/属于哪(个|一)?(大)?项目/.test(hay) || /请选择项目/.test(hay)) {
    throw new Error("baseline agent asked user to pick a project");
  }
}

export function assertSomeProjectTool(toolCalls: string[]): void {
  if (!toolCalls.some((n) => PROJECT_TOOL_NAMES.has(n))) {
    throw new Error("expected at least one project portfolio tool call");
  }
}

export function assertProjectToolIncluded(toolCalls: string[], name: string): void {
  if (!toolCalls.includes(name)) {
    throw new Error(`expected project tool: ${name}`);
  }
}

export function assertForbiddenTool(toolCalls: string[], name: string): void {
  if (toolCalls.includes(name)) {
    throw new Error(`forbidden tool: ${name}`);
  }
}

function draftProjectId(session: PlanSession): string {
  const draft = session.latestDraft as Record<string, unknown> | undefined;
  return String(draft?.projectId ?? "").trim();
}

export function assertProjectBindingWritten(session: PlanSession): void {
  const active = String(session.activeProjectId ?? "").trim();
  const fromDraft = draftProjectId(session);
  if (!active && !fromDraft) {
    throw new Error("expected activeProjectId or draft.projectId after project binding");
  }
}

export function assertActiveProjectMatchesName(
  session: PlanSession,
  projects: Array<{ projectId: string; name: string }>,
  nameFragment: string,
): void {
  const pid = String(session.activeProjectId ?? draftProjectId(session)).trim();
  if (!pid) throw new Error(`expected active/draft project for "${nameFragment}"`);
  const proj = projects.find((p) => p.projectId === pid);
  if (!proj || !proj.name.includes(nameFragment)) {
    throw new Error(`expected project name containing "${nameFragment}", got ${proj?.name ?? pid}`);
  }
}

export function assertDraftTaskCountUnchanged(before: number, after: number): void {
  if (before !== after) {
    throw new Error(`expected draft task count unchanged (${before} -> ${after})`);
  }
}

export function assertTaskProjectId(
  sqlitePath: string,
  planId: string,
  expectedProjectId: string | null,
): void {
  const db = new DatabaseSync(sqlitePath);
  try {
    const row = db
      .prepare("SELECT project_id FROM tasks WHERE plan_id = ? LIMIT 1")
      .get(planId) as { project_id: string | null } | undefined;
    const got = row?.project_id ?? null;
    if (expectedProjectId === null) {
      if (got !== null && String(got).trim() !== "") {
        throw new Error(`expected project_id NULL, got ${got}`);
      }
      return;
    }
    if (got !== expectedProjectId) {
      throw new Error(`expected project_id ${expectedProjectId}, got ${got}`);
    }
  } finally {
    db.close();
  }
}

export function assertPortfolioAssistantHygiene(message: string): string[] {
  const reasons: string[] = [];
  const banned = [
    /\blist_projects\b/i,
    /\bcreate_project\b/i,
    /\bsuggest_project\b/i,
    /\bset_active_project\b/i,
    /\bprojectId\b/i,
    /\bactiveProjectId\b/i,
  ];
  for (const re of banned) {
    if (re.test(message)) reasons.push(`assistant leaks portfolio internal: ${re.source}`);
  }
  return reasons;
}

export function assertDraftProjectMatchesName(
  session: PlanSession,
  projects: Array<{ projectId: string; name: string }>,
  nameFragment: string,
): void {
  const draft = session.latestDraft as Record<string, unknown> | undefined;
  const pid = String(draft?.projectId ?? "").trim();
  if (!pid) throw new Error(`expected draft.projectId for "${nameFragment}"`);
  const proj = projects.find((p) => p.projectId === pid);
  if (!proj || !proj.name.includes(nameFragment)) {
    throw new Error(`expected draft project "${nameFragment}", got ${proj?.name ?? pid}`);
  }
}

export function resolveProjectIdByName(
  projects: Array<{ projectId: string; name: string }>,
  nameFragment: string,
): string | undefined {
  return projects.find((p) => p.name.includes(nameFragment))?.projectId;
}
