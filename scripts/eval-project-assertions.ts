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
