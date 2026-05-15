import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import {
  SEARCH_EMPLOYEES_TOOL,
  GET_EMPLOYEE_DETAILS_TOOL,
  buildSearchEmployeesHandler,
  buildGetEmployeeDetailsHandler,
} from "../assignment/tools/search-employees";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import { SEARCH_WEB_TOOL, buildSearchWebHandler } from "./search-web";
import { SAVE_DRAFT_TOOL, buildSaveDraftHandler } from "./save-draft";
import {
  SEARCH_SIMILAR_PLANS_TOOL,
  buildSearchSimilarPlansHandler,
  readSearchSimilarPlansEnabled,
} from "./search-similar-plans";
import {
  PREPARE_PUBLISH_TASK_TOOL,
  buildPreparePublishTaskHandler,
} from "./prepare-publish-task";
import {
  SUBMIT_EMPLOYEE_RESPONSE_TOOL,
  buildSubmitEmployeeResponseHandler,
} from "./submit-employee-response";
import {
  SUBMIT_PROGRESS_UPDATE_TOOL,
  buildSubmitProgressUpdateHandler,
} from "./submit-progress-update";
import {
  UPDATE_EMPLOYEE_PROFILE_TOOL,
  buildUpdateEmployeeProfileHandler,
} from "./update-employee-profile";
import {
  LIST_MY_TASKS_TOOL,
  buildListMyTasksHandler,
} from "./list-my-tasks";
import {
  LIST_MANAGED_TASKS_TOOL,
  buildListManagedTasksHandler,
} from "./list-managed-tasks";
import {
  GET_TASK_DETAIL_TOOL,
  buildGetTaskDetailHandler,
} from "./get-task-detail";
import {
  REASSIGN_TASK_TOOL,
  buildReassignTaskHandler,
} from "./reassign-task";
import {
  GET_MY_PROFILE_TOOL,
  buildGetMyProfileHandler,
} from "./get-my-profile";
import {
  ADMIN_LIST_ALL_TASKS_TOOL,
  buildAdminListAllTasksHandler,
} from "./admin-list-all-tasks";
import {
  GET_METRICS_TOOL,
  buildGetMetricsHandler,
} from "./get-metrics";
import {
  LIST_MANAGERS_TOOL,
  buildListManagersHandler,
} from "./list-managers";
import {
  SET_MANAGER_PERMISSION_TOOL,
  buildSetManagerPermissionHandler,
} from "./set-manager-permission";
import { GET_CURRENT_TIME_TOOL, buildGetCurrentTimeHandler } from "./get-current-time";
import {
  UPDATE_KNOWN_FACTS_TOOL,
  LIST_KNOWN_FACTS_TOOL,
  buildKnownFactsHandlers,
  type KnownFactsStore,
} from "./update-known-facts";
import { START_NEW_TASK_TOOL, buildStartNewTaskHandler } from "./start-new-task";
import { SWITCH_BACK_TASK_TOOL, buildSwitchBackTaskHandler } from "./switch-back-task";
import { UPDATE_DRAFT_TASK_TOOL, buildUpdateDraftTaskHandler } from "./update-draft-task";
import {
  READ_UPLOADED_ROSTER_TEXT_TOOL,
  SET_CANDIDATE_POOL_TOOL,
  CLEAR_CANDIDATE_POOL_TOOL,
  LIST_CANDIDATE_POOL_TOOL,
  buildReadUploadedRosterTextHandler,
  buildSetCandidatePoolHandler,
  buildClearCandidatePoolHandler,
  buildListCandidatePoolHandler,
} from "./candidate-pool";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import {
  PUBLISH_TASK_TOOL,
  buildPublishTaskHandler,
  createRecentPublishStore,
  type PublishTaskRecentStore,
} from "./publish-task";
import { createWorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../../infra/assignment-env";
import type { PlanSession } from "../../infra/plan-session-store";
import { logStructured } from "../../infra/logger";

export interface ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export interface ToolRegistryDeps {
  employeeRepo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  };
  onDraftSaved?: (draft: Record<string, unknown>) => void;
  toolProfile?: ToolProfile;
  trustedActorUserId?: string;
  allowSearchWeb?: boolean;
  knownFactsStore?: KnownFactsStore;
  currentSessionPlanId?: string;
  currentSession?: PlanSession;
  publishRecentStore?: PublishTaskRecentStore;
  actorName?: string;
  actorRole?: "admin" | "manager" | "employee";
  onPublishTaskResult?: (result: Record<string, unknown>) => void;
  /**
   * candidate-pool 工具修改 currentSession 后回调，便于上层即时落盘 / 审计。
   */
  onSessionMutated?: (session: PlanSession) => void;
}

export type ToolProfile = "planner" | "employee" | "manager" | "admin" | "full";

export function buildToolRegistry(deps: ToolRegistryDeps): Record<string, ToolRegistryEntry> {
  const profile = deps.toolProfile ?? "planner";
  const taskStore = createWorkbenchFormalTaskStore();
  const peopleStore = createPeopleDirectoryStore();
  const trustedActor = deps.trustedActorUserId?.trim();
  const allowSearchWeb = deps.allowSearchWeb ?? false;
  const searchWebEnabled = String(process.env.SEARCH_WEB_ENABLED ?? "1").trim() !== "0";
  const searchSimilarPlansEnabled = readSearchSimilarPlansEnabled();
  const knownFactsHandlers = deps.knownFactsStore ? buildKnownFactsHandlers(deps.knownFactsStore) : undefined;
  const publishRecentStore = deps.publishRecentStore ?? createRecentPublishStore();
  const notifyEmployeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();

  const employeeRepoResolved = {
    list: () => deps.employeeRepo.list(),
    get: (userId: string) =>
      deps.employeeRepo.get?.(userId) ?? deps.employeeRepo.list().find((p) => p.userId === userId),
  };

  /**
   * 候选池实时取值：buildToolRegistry 在每次 orchestrator 调用开头执行一次，
   * deps.currentSession.candidatePool 可能在同一轮 orchestrator 内被
   * set_candidate_pool / clear_candidate_pool 工具改写，所以这里用闭包按需读取。
   */
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
  };

  const all: Record<string, ToolRegistryEntry> = {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: buildSearchEmployeesHandler(employeeRepoResolved, {
        actorUserId: trustedActor,
        candidatePool: candidatePoolReader,
      }),
    },
    get_employee_details: {
      definition: GET_EMPLOYEE_DETAILS_TOOL,
      handler: buildGetEmployeeDetailsHandler(employeeRepoResolved),
    },
    read_uploaded_roster_text: {
      definition: READ_UPLOADED_ROSTER_TEXT_TOOL,
      handler: buildReadUploadedRosterTextHandler(candidatePoolDeps),
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
    save_draft: {
      definition: SAVE_DRAFT_TOOL,
      handler: buildSaveDraftHandler({ onDraftSaved: deps.onDraftSaved }),
    },
    prepare_publish_task: {
      definition: PREPARE_PUBLISH_TASK_TOOL,
      handler: buildPreparePublishTaskHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    start_new_task: {
      definition: START_NEW_TASK_TOOL,
      handler: buildStartNewTaskHandler({ currentSession: deps.currentSession }),
    },
    switch_back_task: {
      definition: SWITCH_BACK_TASK_TOOL,
      handler: buildSwitchBackTaskHandler({ currentSession: deps.currentSession }),
    },
    update_draft_task: {
      definition: UPDATE_DRAFT_TASK_TOOL,
      handler: buildUpdateDraftTaskHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
      }),
    },
    submit_employee_response: {
      definition: SUBMIT_EMPLOYEE_RESPONSE_TOOL,
      handler: buildSubmitEmployeeResponseHandler({
        taskStore,
        notifier,
        getDisplayName: (userId) => peopleStore.getContact(userId)?.name?.trim(),
      }),
    },
    submit_progress_update: {
      definition: SUBMIT_PROGRESS_UPDATE_TOOL,
      handler: buildSubmitProgressUpdateHandler({
        taskStore,
        notifier,
        getDisplayName: (userId) => peopleStore.getContact(userId)?.name?.trim(),
      }),
    },
    update_employee_profile: {
      definition: UPDATE_EMPLOYEE_PROFILE_TOOL,
      handler: buildUpdateEmployeeProfileHandler({ peopleStore }),
    },
    list_my_tasks: {
      definition: LIST_MY_TASKS_TOOL,
      handler: buildListMyTasksHandler({ taskStore }),
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
    get_my_profile: {
      definition: GET_MY_PROFILE_TOOL,
      handler: buildGetMyProfileHandler({ peopleStore }),
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
    publish_task: {
      definition: PUBLISH_TASK_TOOL,
      handler: buildPublishTaskHandler({
        trustedActorUserId: deps.trustedActorUserId,
        currentSessionPlanId: deps.currentSessionPlanId,
        currentSession: deps.currentSession,
        actorName: deps.actorName,
        initiatorDepartment:
          notifyEmployeeRepo.get(String(deps.currentSession?.senderStaffId ?? deps.trustedActorUserId ?? "").trim())
            ?.department?.trim() || "未配置部门",
        publishFromSession: taskStore.publishFromSession,
        appendTaskEvent: taskStore.appendTaskEvent,
        getContact: (userId) => peopleStore.getContact(userId),
        notifier,
        recentPublished: publishRecentStore,
        onAudit: (entry) => logStructured(entry),
        onPublishResult: deps.onPublishTaskResult,
      }),
    },
  };
  if (knownFactsHandlers) {
    all.update_known_facts = {
      definition: UPDATE_KNOWN_FACTS_TOOL,
      handler: knownFactsHandlers.update,
    };
    all.list_known_facts = {
      definition: LIST_KNOWN_FACTS_TOOL,
      handler: knownFactsHandlers.get,
    };
  }

  if (searchWebEnabled && (allowSearchWeb || profile === "full")) {
    all.search_web = {
      definition: SEARCH_WEB_TOOL,
      handler: buildSearchWebHandler(),
    };
  }

  if (searchSimilarPlansEnabled) {
    all.search_similar_plans = {
      definition: SEARCH_SIMILAR_PLANS_TOOL,
      handler: buildSearchSimilarPlansHandler(),
    };
  }

  // Never trust actor identity from model arguments.
  const sensitiveTools = [
    "list_my_tasks",
    "list_managed_tasks",
    "get_task_detail",
    "reassign_task",
    "get_my_profile",
    "set_manager_permission",
    "submit_employee_response",
    "submit_progress_update",
    "update_employee_profile",
    "publish_task",
  ] as const;
  if (trustedActor) {
    const enforceActor = (handler: ToolHandler): ToolHandler => (args) =>
      handler({
        ...(args as Record<string, unknown>),
        actorUserId: trustedActor,
      });
    for (const key of sensitiveTools) {
      const entry = all[key];
      if (entry) entry.handler = enforceActor(entry.handler);
    }
  } else {
    for (const key of sensitiveTools) {
      const entry = all[key];
      if (!entry) continue;
      entry.handler = () => ({
        ok: false,
        error: "trusted_actor_required",
      });
    }
  }

  const profileTools: Record<ToolProfile, string[]> = {
    planner: [
      "search_employees",
      "get_employee_details",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
      "start_new_task",
      "switch_back_task",
      "update_draft_task",
    ],
    manager: [
      "prepare_publish_task",
      "publish_task",
      "list_managed_tasks",
      "get_task_detail",
      "reassign_task",
      "search_employees",
      "get_employee_details",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
      "start_new_task",
      "switch_back_task",
      "update_draft_task",
      "read_uploaded_roster_text",
      "set_candidate_pool",
      "clear_candidate_pool",
      "list_candidate_pool",
    ],
    admin: [
      "prepare_publish_task",
      "publish_task",
      "list_managed_tasks",
      "get_task_detail",
      "reassign_task",
      "admin_list_all_tasks",
      "get_metrics",
      "list_managers",
      "set_manager_permission",
      "search_employees",
      "get_employee_details",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
      "start_new_task",
      "switch_back_task",
      "update_draft_task",
      "read_uploaded_roster_text",
      "set_candidate_pool",
      "clear_candidate_pool",
      "list_candidate_pool",
    ],
    employee: [
      "list_my_tasks",
      "get_task_detail",
      "get_my_profile",
      "submit_employee_response",
      "submit_progress_update",
      "update_employee_profile",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
    ],
    full: Object.keys(all),
  };

  const names = new Set(profileTools[profile] ?? profileTools.planner);
  const out: Record<string, ToolRegistryEntry> = {};
  for (const [name, entry] of Object.entries(all)) {
    if (names.has(name)) out[name] = entry;
  }
  return out;
}
