import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { SEARCH_EMPLOYEES_TOOL, buildSearchEmployeesHandler } from "../assignment/tools/search-employees";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import { SEARCH_WEB_TOOL, buildSearchWebHandler } from "./search-web";
import { UPDATE_KNOWN_FACTS_TOOL, LIST_KNOWN_FACTS_TOOL, buildKnownFactsHandlers, type KnownFactsStore } from "./update-known-facts";
import { SAVE_DRAFT_TOOL, buildSaveDraftHandler } from "./save-draft";
import { SEARCH_SIMILAR_PLANS_TOOL, buildSearchSimilarPlansHandler } from "./search-similar-plans";

export interface ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export interface ToolRegistryDeps {
  employeeRepo: { list(): EmployeeProfileRecord[] };
  knownFacts: KnownFactsStore;
}

export function buildToolRegistry(deps: ToolRegistryDeps): Record<string, ToolRegistryEntry> {
  const { get: getFacts, update: updateFacts } = buildKnownFactsHandlers(deps.knownFacts);

  return {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: buildSearchEmployeesHandler(deps.employeeRepo),
    },
    search_web: {
      definition: SEARCH_WEB_TOOL,
      handler: buildSearchWebHandler(),
    },
    search_similar_plans: {
      definition: SEARCH_SIMILAR_PLANS_TOOL,
      handler: buildSearchSimilarPlansHandler(),
    },
    update_known_facts: {
      definition: UPDATE_KNOWN_FACTS_TOOL,
      handler: updateFacts,
    },
    list_known_facts: {
      definition: LIST_KNOWN_FACTS_TOOL,
      handler: getFacts,
    },
    save_draft: {
      definition: SAVE_DRAFT_TOOL,
      handler: buildSaveDraftHandler(),
    },
  };
}
