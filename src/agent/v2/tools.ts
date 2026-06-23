import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import type { PlanSession } from "../../infra/plan-session-store";
import type { PublishTaskRecentStore } from "../tools/publish-task";
import type { ToolProfile } from "../tools/registry";
import {
  SEARCH_EMPLOYEES_TOOL,
  buildSearchEmployeesHandler,
} from "../assignment/tools/search-employees";
import { GET_EMPLOYEE_DETAILS_TOOL, buildGetEmployeeDetailsHandler } from "../assignment/tools/search-employees";
import { READ_URL_TOOL, buildReadUrlHandler, readUrlEnabled } from "../tools/read-url";
import { SEARCH_WEB_TOOL, buildSearchWebHandler } from "../tools/search-web";
import { PREPARE_PUBLISH_TASK_TOOL, buildPreparePublishTaskHandler } from "../tools/prepare-publish-task";
import { PUBLISH_TASK_TOOL, buildPublishTaskHandler, createRecentPublishStore } from "../tools/publish-task";
import { START_NEW_TASK_TOOL, buildStartNewTaskHandler } from "../tools/start-new-task";
import { SWITCH_BACK_TASK_TOOL, buildSwitchBackTaskHandler } from "../tools/switch-back-task";
import { UPDATE_DRAFT_TASK_TOOL, buildUpdateDraftTaskHandler } from "../tools/update-draft-task";
import { BULK_ASSIGN_TASKS_TOOL, buildBulkAssignTasksHandler } from "../tools/bulk-assign-tasks";
import {
  ADD_DRAFT_SUBTASK_TOOL,
  REMOVE_DRAFT_SUBTASK_TOOL,
  buildAddDraftSubtaskHandler,
  buildRemoveDraftSubtaskHandler,
} from "../tools/mutate-draft-subtasks";
import {
  READ_UPLOADED_ROSTER_TEXT_TOOL,
  RESOLVE_ROSTER_NAMES_TOOL,
  SET_CANDIDATE_POOL_TOOL,
  CLEAR_CANDIDATE_POOL_TOOL,
  LIST_CANDIDATE_POOL_TOOL,
  buildReadUploadedRosterTextHandler,
  buildResolveRosterNamesHandler,
  buildSetCandidatePoolHandler,
  buildClearCandidatePoolHandler,
  buildListCandidatePoolHandler,
} from "../tools/candidate-pool";
import { LIST_MANAGED_TASKS_TOOL, buildListManagedTasksHandler } from "../tools/list-managed-tasks";
import { GET_TASK_DETAIL_TOOL, buildGetTaskDetailHandler } from "../tools/get-task-detail";
import { REASSIGN_TASK_TOOL, buildReassignTaskHandler } from "../tools/reassign-task";
import {
  LIST_FOLLOW_UP_CANDIDATES_TOOL,
  buildListFollowUpCandidatesHandler,
} from "../tools/list-follow-up-candidates";
import { SEND_SUBTASK_REMINDER_TOOL, buildSendSubtaskReminderHandler } from "../tools/send-subtask-reminder";
import { ADMIN_LIST_ALL_TASKS_TOOL, buildAdminListAllTasksHandler } from "../tools/admin-list-all-tasks";
import { GET_METRICS_TOOL, buildGetMetricsHandler } from "../tools/get-metrics";
import { LIST_MANAGERS_TOOL, buildListManagersHandler } from "../tools/list-managers";
import { SET_MANAGER_PERMISSION_TOOL, buildSetManagerPermissionHandler } from "../tools/set-manager-permission";
import { GET_CURRENT_TIME_TOOL, buildGetCurrentTimeHandler } from "../tools/get-current-time";
import { buildProjectPortfolioToolHandlers } from "../tools/project-portfolio-tools";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../../infra/assignment-env";
import { isWorkbenchProjectPortfolioEnabled } from "../../security/workbench-project-portfolio";
import { logStructured } from "../../infra/logger";
import { recordSearchHitsFromCandidates } from "../employee-search-cache";
import type { SearchEmployeesResult } from "../assignment/tools/search-employees";
import {
  REPLACE_DRAFT_TOOL,
  buildReplaceDraftHandler,
} from "./replace-draft-tool";
import {
  ASSIGN_FROM_ROSTER_TOOL,
  buildAssignFromRosterHandler,
} from "./assign-from-roster-tool";
import {
  SPLIT_DRAFT_TASK_TOOL,
  buildSplitDraftTaskHandler,
} from "./split-draft-task-tool";

export interface V2ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export interface V2ToolRegistryDeps {
  employeeRepo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  };
  toolProfile?: ToolProfile;
  trustedActorUserId?: string;
  allowSearchWeb?: boolean;
  currentSessionPlanId?: string;
  currentSession?: PlanSession;
  publishRecentStore?: PublishTaskRecentStore;
  actorName?: string;
  actorRole?: "admin" | "manager" | "employee";
  onPublishTaskResult?: (result: Record<string, unknown>) => void;
  onSessionMutated?: (session: PlanSession) => void;
  orchestratorUserMessage?: string;
  projectPortfolioEnabled?: boolean;
}

const PARALLEL_SAFE = new Set([
  "search_employees",
  "get_employee_details",
  "list_managed_tasks",
  "get_task_detail",
  "list_my_tasks",
  "read_url",
  "get_current_time",
  "list_follow_up_candidates",
  "list_projects",
  "suggest_project",
]);

export function isV2ParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE.has(name);
}

/** Static per-profile base tool names (excludes dynamic `full` + roster/portfolio additions). */
const PROFILE_BASE_TOOL_NAMES: Record<Exclude<ToolProfile, "full">, string[]> = {
  planner: [
    "search_employees",
    "read_url",
    "search_web",
    "start_new_task",
    "switch_back_task",
    "update_draft_task",
    "add_draft_subtask",
    "remove_draft_subtask",
    "replace_draft",
  ],
  manager: [
    "prepare_publish_task",
    "publish_task",
    "list_managed_tasks",
    "get_task_detail",
    "reassign_task",
    "list_follow_up_candidates",
    "send_subtask_reminder",
    "search_employees",
    "read_url",
    "search_web",
    "start_new_task",
    "switch_back_task",
    "update_draft_task",
    "bulk_assign_tasks",
    "assign_from_roster",
    "split_draft_task",
    "add_draft_subtask",
    "remove_draft_subtask",
    "replace_draft",
  ],
  admin: [
    "prepare_publish_task",
    "publish_task",
    "list_managed_tasks",
    "get_task_detail",
    "reassign_task",
    "list_follow_up_candidates",
    "send_subtask_reminder",
    "admin_list_all_tasks",
    "get_metrics",
    "list_managers",
    "set_manager_permission",
    "search_employees",
    "read_url",
    "search_web",
    "start_new_task",
    "switch_back_task",
    "update_draft_task",
    "bulk_assign_tasks",
    "assign_from_roster",
    "split_draft_task",
    "add_draft_subtask",
    "remove_draft_subtask",
    "replace_draft",
  ],
  employee: [],
  performance: [],
  competency_eval: [],
};

/** Whether a tool name is exposed for the given profile (gate target-tool guard). */
export function v2ProfileIncludesTool(profile: ToolProfile, toolName: string): boolean {
  if (profile === "full") return true;
  return (PROFILE_BASE_TOOL_NAMES[profile] ?? PROFILE_BASE_TOOL_NAMES.planner).includes(toolName);
}

/** v2 tool surface: no pre-draft gate, no per-tool quotas, no save_draft / known_facts / similar_plans. */
export function buildV2ToolRegistry(
  deps: V2ToolRegistryDeps,
): Record<string, V2ToolRegistryEntry> {
  const profile = deps.toolProfile ?? "planner";
  const taskStore = createWorkbenchFormalTaskStore();
  const peopleStore = createPeopleDirectoryStore();
  const trustedActor = deps.trustedActorUserId?.trim();
  const allowSearchWeb = deps.allowSearchWeb ?? false;
  const searchWebEnabled = String(process.env.SEARCH_WEB_ENABLED ?? "1").trim() !== "0";
  const notifyEmployeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();
  const publishRecentStore = deps.publishRecentStore ?? createRecentPublishStore();

  const employeeRepoResolved = {
    list: () => deps.employeeRepo.list(),
    get: (userId: string) =>
      deps.employeeRepo.get?.(userId) ?? deps.employeeRepo.list().find((p) => p.userId === userId),
  };

  const candidatePoolReader = (): Array<{
    userId: string;
    displayName: string;
    fileNotes?: string;
  }> => {
    const pool = deps.currentSession?.candidatePool;
    if (!pool || pool.entries.length === 0) return [];
    return pool.entries.map((e) => ({
      userId: e.userId,
      displayName: e.displayName,
      fileNotes: e.fileNotes,
    }));
  };

  const candidatePoolDeps = {
    currentSession: deps.currentSession,
    onSessionMutated: deps.onSessionMutated,
    getContact: (userId: string) => peopleStore.getContact(userId),
    searchContacts: (keyword: string, limit?: number) =>
      peopleStore.searchContacts(keyword, limit),
  };

  const baseSearchEmployeesHandler = buildSearchEmployeesHandler(employeeRepoResolved, {
    actorUserId: trustedActor,
    candidatePool: candidatePoolReader,
  });

  const all: Record<string, V2ToolRegistryEntry> = {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: (args: Record<string, unknown>) => {
        const result = baseSearchEmployeesHandler(args) as SearchEmployeesResult & { ok?: false };
        if (
          deps.currentSession
          && result
          && String((result as { ok?: unknown }).ok ?? "") !== "false"
          && Array.isArray(result.candidates)
          && result.candidates.length > 0
        ) {
          recordSearchHitsFromCandidates(
            deps.currentSession,
            result.candidates,
            (userId) => {
              const c = peopleStore.getContact(userId);
              return c ? { name: c.name, departmentNames: c.departmentNames } : undefined;
            },
          );
        }
        return result;
      },
    },
    get_employee_details: {
      definition: GET_EMPLOYEE_DETAILS_TOOL,
      handler: buildGetEmployeeDetailsHandler(employeeRepoResolved, {
        candidatePool: candidatePoolReader,
      }),
    },
    replace_draft: {
      definition: REPLACE_DRAFT_TOOL,
      handler: buildReplaceDraftHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
      }),
    },
    prepare_publish_task: {
      definition: PREPARE_PUBLISH_TASK_TOOL,
      handler: buildPreparePublishTaskHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
        searchEmployeesQuotaExhausted: () => false,
      }),
    },
    publish_task: {
      definition: PUBLISH_TASK_TOOL,
      handler: buildPublishTaskHandler({
        trustedActorUserId: deps.trustedActorUserId,
        currentSessionPlanId: deps.currentSessionPlanId,
        currentSession: deps.currentSession,
        actorName: deps.actorName,
        initiatorDepartment:
          notifyEmployeeRepo.get(String(deps.trustedActorUserId ?? "").trim())?.department?.trim()
          || "未配置部门",
        publishFromSession: taskStore.publishFromSession,
        appendTaskEvent: taskStore.appendTaskEvent,
        getContact: (userId) => peopleStore.getContact(userId),
        notifier,
        recentPublished: publishRecentStore,
        onAudit: (entry) => logStructured(entry),
        onPublishResult: deps.onPublishTaskResult,
      }),
    },
    start_new_task: {
      definition: START_NEW_TASK_TOOL,
      handler: buildStartNewTaskHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
        userMessage: deps.orchestratorUserMessage,
      }),
    },
    switch_back_task: {
      definition: SWITCH_BACK_TASK_TOOL,
      handler: buildSwitchBackTaskHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
      }),
    },
    update_draft_task: {
      definition: UPDATE_DRAFT_TASK_TOOL,
      handler: buildUpdateDraftTaskHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    bulk_assign_tasks: {
      definition: BULK_ASSIGN_TASKS_TOOL,
      handler: buildBulkAssignTasksHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    assign_from_roster: {
      definition: ASSIGN_FROM_ROSTER_TOOL,
      handler: buildAssignFromRosterHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
        getContact: (userId) => peopleStore.getContact(userId),
        searchContacts: (keyword, limit) => peopleStore.searchContacts(keyword, limit),
      }),
    },
    split_draft_task: {
      definition: SPLIT_DRAFT_TASK_TOOL,
      handler: buildSplitDraftTaskHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    add_draft_subtask: {
      definition: ADD_DRAFT_SUBTASK_TOOL,
      handler: buildAddDraftSubtaskHandler({ currentSession: deps.currentSession }),
    },
    remove_draft_subtask: {
      definition: REMOVE_DRAFT_SUBTASK_TOOL,
      handler: buildRemoveDraftSubtaskHandler({ currentSession: deps.currentSession }),
    },
    list_managed_tasks: {
      definition: LIST_MANAGED_TASKS_TOOL,
      handler: buildListManagedTasksHandler({ taskStore }),
    },
    get_task_detail: {
      definition: GET_TASK_DETAIL_TOOL,
      handler: buildGetTaskDetailHandler({ taskStore, actorRole: deps.actorRole }),
    },
    reassign_task: {
      definition: REASSIGN_TASK_TOOL,
      handler: buildReassignTaskHandler({
        taskStore,
        notifier,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    list_follow_up_candidates: {
      definition: LIST_FOLLOW_UP_CANDIDATES_TOOL,
      handler: buildListFollowUpCandidatesHandler({ taskStore }),
    },
    send_subtask_reminder: {
      definition: SEND_SUBTASK_REMINDER_TOOL,
      handler: buildSendSubtaskReminderHandler({ taskStore, notifier }),
    },
    admin_list_all_tasks: {
      definition: ADMIN_LIST_ALL_TASKS_TOOL,
      handler: buildAdminListAllTasksHandler({ taskStore }),
    },
    get_metrics: {
      definition: GET_METRICS_TOOL,
      handler: buildGetMetricsHandler({ taskStore }),
    },
    list_managers: {
      definition: LIST_MANAGERS_TOOL,
      handler: buildListManagersHandler(),
    },
    set_manager_permission: {
      definition: SET_MANAGER_PERMISSION_TOOL,
      handler: buildSetManagerPermissionHandler({ taskStore, peopleStore }),
    },
    get_current_time: {
      definition: GET_CURRENT_TIME_TOOL,
      handler: buildGetCurrentTimeHandler(),
    },
  };

  if (searchWebEnabled && (allowSearchWeb || profile === "full")) {
    all.search_web = {
      definition: SEARCH_WEB_TOOL,
      handler: buildSearchWebHandler(),
    };
  }

  if (readUrlEnabled()) {
    let readUrlCallCount = 0;
    all.read_url = {
      definition: READ_URL_TOOL,
      handler: buildReadUrlHandler({
        getCallCount: () => readUrlCallCount,
        incrementCallCount: () => {
          readUrlCallCount += 1;
        },
      }),
    };
  }

  const profileTools: Record<ToolProfile, string[]> = {
    ...PROFILE_BASE_TOOL_NAMES,
    full: Object.keys(all),
  };

  const names = new Set(profileTools[profile] ?? profileTools.planner);
  const out: Record<string, V2ToolRegistryEntry> = {};
  for (const [name, entry] of Object.entries(all)) {
    if (names.has(name)) out[name] = entry;
  }

  const portfolioOn =
    deps.projectPortfolioEnabled === true
    || (trustedActor ? isWorkbenchProjectPortfolioEnabled(trustedActor) : false);
  if (portfolioOn && (profile === "manager" || profile === "admin")) {
    const portfolioHandlers = buildProjectPortfolioToolHandlers({
      trustedActorUserId: trustedActor,
      currentSession: deps.currentSession,
      onSessionMutated: deps.onSessionMutated,
    });
    for (const [name, entry] of Object.entries(portfolioHandlers)) {
      out[name] = entry;
    }
  }

  if (profile === "manager" || profile === "admin" || profile === "full") {
    for (const name of [
      "get_employee_details",
      "read_uploaded_roster_text",
      "resolve_roster_names",
      "set_candidate_pool",
      "clear_candidate_pool",
      "list_candidate_pool",
    ] as const) {
      const rosterEntry: Record<string, V2ToolRegistryEntry> = {
        read_uploaded_roster_text: {
          definition: READ_UPLOADED_ROSTER_TEXT_TOOL,
          handler: buildReadUploadedRosterTextHandler(candidatePoolDeps),
        },
        resolve_roster_names: {
          definition: RESOLVE_ROSTER_NAMES_TOOL,
          handler: buildResolveRosterNamesHandler(candidatePoolDeps),
        },
        set_candidate_pool: {
          definition: SET_CANDIDATE_POOL_TOOL,
          handler: buildSetCandidatePoolHandler(candidatePoolDeps),
        },
        clear_candidate_pool: {
          definition: CLEAR_CANDIDATE_POOL_TOOL,
          handler: buildClearCandidatePoolHandler(candidatePoolDeps),
        },
        list_candidate_pool: {
          definition: LIST_CANDIDATE_POOL_TOOL,
          handler: buildListCandidatePoolHandler(candidatePoolDeps),
        },
        get_employee_details: all.get_employee_details!,
      };
      if (rosterEntry[name]) out[name] = rosterEntry[name];
    }
  }

  const sensitiveTools = [
    "list_managed_tasks",
    "get_task_detail",
    "reassign_task",
    "set_manager_permission",
    "publish_task",
    "list_follow_up_candidates",
    "send_subtask_reminder",
  ] as const;

  if (trustedActor) {
    const enforceActor = (handler: ToolHandler): ToolHandler => (args) =>
      handler({ ...(args as Record<string, unknown>), actorUserId: trustedActor });
    for (const key of sensitiveTools) {
      const entry = out[key];
      if (entry) entry.handler = enforceActor(entry.handler);
    }
  } else {
    for (const key of sensitiveTools) {
      const entry = out[key];
      if (!entry) continue;
      entry.handler = () => ({ ok: false, error: "trusted_actor_required" });
    }
  }

  return out;
}

export function v2ToolsToOpenAIFormat(
  registry: Record<string, V2ToolRegistryEntry>,
): Array<{ type: "function"; function: ToolDefinition["function"] }> {
  return Object.values(registry).map((e) => ({
    type: "function" as const,
    function: e.definition.function,
  }));
}

/**
 * CMTF (FR-3/C2): restrict the OpenAI-format tool surface to a narrow frontier.
 * Frontier entries not present in the registry are skipped (avoid forcing a tool
 * that cannot be executed). The execution registry stays full elsewhere.
 */
export function v2ToolsToOpenAIFormatFiltered(
  registry: Record<string, V2ToolRegistryEntry>,
  frontier: readonly string[],
): Array<{ type: "function"; function: ToolDefinition["function"] }> {
  const allowed = new Set(frontier);
  return Object.entries(registry)
    .filter(([name]) => allowed.has(name))
    .map(([, e]) => ({
      type: "function" as const,
      function: e.definition.function,
    }));
}
