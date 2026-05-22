import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import {
  SEARCH_EMPLOYEES_TOOL,
  GET_EMPLOYEE_DETAILS_TOOL,
  buildSearchEmployeesHandler,
  buildGetEmployeeDetailsHandler,
  type SearchEmployeesResult,
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
  BULK_ASSIGN_TASKS_TOOL,
  buildBulkAssignTasksHandler,
} from "./bulk-assign-tasks";
import {
  ADD_DRAFT_SUBTASK_TOOL,
  REMOVE_DRAFT_SUBTASK_TOOL,
  buildAddDraftSubtaskHandler,
  buildRemoveDraftSubtaskHandler,
} from "./mutate-draft-subtasks";
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
import {
  LIST_FOLLOW_UP_CANDIDATES_TOOL,
  buildListFollowUpCandidatesHandler,
} from "./list-follow-up-candidates";
import {
  SEND_SUBTASK_REMINDER_TOOL,
  buildSendSubtaskReminderHandler,
} from "./send-subtask-reminder";
import { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../../infra/assignment-env";
import type { PlanSession } from "../../infra/plan-session-store";
import { logStructured } from "../../infra/logger";
import { recordSearchHitsFromCandidates } from "../employee-search-cache";
import {
  buildPreDraftGateResponse,
  shouldBlockPreDraftTool,
  type PreDraftGateTool,
} from "../registry-pre-draft-gate";

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
  /** 本轮 orchestrator 用户消息，供 pre-draft 工具门禁判定点将意图。 */
  orchestratorUserMessage?: string;
}

export type ToolProfile = "planner" | "employee" | "manager" | "admin" | "full";

export const KNOWN_TOOL_NAMES = [
  "search_employees",
  "get_employee_details",
  "read_uploaded_roster_text",
  "resolve_roster_names",
  "set_candidate_pool",
  "clear_candidate_pool",
  "list_candidate_pool",
  "save_draft",
  "prepare_publish_task",
  "start_new_task",
  "switch_back_task",
  "update_draft_task",
  "add_draft_subtask",
  "remove_draft_subtask",
  "submit_employee_response",
  "submit_progress_update",
  "update_employee_profile",
  "list_my_tasks",
  "list_managed_tasks",
  "get_task_detail",
  "reassign_task",
  "get_my_profile",
  "admin_list_all_tasks",
  "get_metrics",
  "list_managers",
  "set_manager_permission",
  "get_current_time",
  "publish_task",
  "update_known_facts",
  "list_known_facts",
  "search_web",
  "search_similar_plans",
] as const;

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

  const searchQuotaState = { exhausted: false };
  let updateDraftTaskCallCount = 0;
  let updateDraftTaskAssigneePatchCount = 0;
  const UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX = (() => {
    const raw = Number(
      String(process.env.UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX ?? "4").trim(),
    );
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
  })();

  const wrapPreDraftGate = (
    toolName: PreDraftGateTool,
    handler: ToolHandler,
  ): ToolHandler => (args) => {
    if (
      shouldBlockPreDraftTool({
        session: deps.currentSession,
        userMessage: deps.orchestratorUserMessage,
        toolName,
        args: args as Record<string, unknown>,
      })
    ) {
      return buildPreDraftGateResponse(toolName);
    }
    return handler(args);
  };

  const baseSearchEmployeesHandler = buildSearchEmployeesHandler(employeeRepoResolved, {
    actorUserId: trustedActor,
    candidatePool: candidatePoolReader,
    onQuotaExhausted: () => {
      searchQuotaState.exhausted = true;
    },
  });

  const all: Record<string, ToolRegistryEntry> = {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: wrapPreDraftGate("search_employees", (args: Record<string, unknown>) => {
        const result = baseSearchEmployeesHandler(args) as SearchEmployeesResult & {
          ok?: false;
          candidates?: string[];
        };
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
              return c
                ? { name: c.name, departmentNames: c.departmentNames }
                : undefined;
            },
          );
        }
        return result;
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
    save_draft: {
      definition: SAVE_DRAFT_TOOL,
      handler: buildSaveDraftHandler({ onDraftSaved: deps.onDraftSaved }),
    },
    prepare_publish_task: {
      definition: PREPARE_PUBLISH_TASK_TOOL,
      handler: buildPreparePublishTaskHandler({
        currentSession: deps.currentSession,
        getContact: (userId) => peopleStore.getContact(userId),
        searchEmployeesQuotaExhausted: () => searchQuotaState.exhausted,
      }),
    },
    start_new_task: {
      definition: START_NEW_TASK_TOOL,
      handler: buildStartNewTaskHandler({
        currentSession: deps.currentSession,
        onSessionMutated: deps.onSessionMutated,
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
      handler: (args: Record<string, unknown>) => {
        updateDraftTaskCallCount += 1;
        const patchRaw = (args.patch ?? {}) as Record<string, unknown>;
        const hasAssigneePatch =
          typeof patchRaw.assigneeUserId === "string" && patchRaw.assigneeUserId.trim().length > 0;
        if (hasAssigneePatch) {
          updateDraftTaskAssigneePatchCount += 1;
          if (updateDraftTaskAssigneePatchCount > 1) {
            return {
              ok: false,
              reason: "bulk_assign_required",
              assigneePatchCount: updateDraftTaskAssigneePatchCount,
              hint:
                "多 subtask 指派请改用 **bulk_assign_tasks** 或顶层 **assignment JSON** 一次覆盖全部 taskId；禁止逐条 update_draft_task(assigneeUserId)。",
            };
          }
        }
        if (updateDraftTaskCallCount > UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX) {
          return {
            ok: false,
            reason: "too_many_draft_patches",
            callCount: updateDraftTaskCallCount,
            max: UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX,
            hint:
              "本轮 update_draft_task 次数过多。多 subtask 指派请改用 **bulk_assign_tasks** 或顶层 **assignment JSON** 一次写完。",
          };
        }
        return buildUpdateDraftTaskHandler({
          currentSession: deps.currentSession,
          getContact: (userId) => peopleStore.getContact(userId),
        })(args);
      },
    },
    bulk_assign_tasks: {
      definition: BULK_ASSIGN_TASKS_TOOL,
      handler: buildBulkAssignTasksHandler({
        currentSession: deps.currentSession,
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
    submit_employee_response: {
      definition: SUBMIT_EMPLOYEE_RESPONSE_TOOL,
      handler: buildSubmitEmployeeResponseHandler({
        taskStore,
        notifier,
        getDisplayName: (userId) => peopleStore.getContact(userId)?.name?.trim(),
        getContact: (userId) => peopleStore.getContact(userId) ?? undefined,
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
    list_follow_up_candidates: {
      definition: LIST_FOLLOW_UP_CANDIDATES_TOOL,
      handler: buildListFollowUpCandidatesHandler({ taskStore }),
    },
    send_subtask_reminder: {
      definition: SEND_SUBTASK_REMINDER_TOOL,
      handler: buildSendSubtaskReminderHandler({ taskStore, notifier }),
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
      handler: wrapPreDraftGate("update_known_facts", knownFactsHandlers.update),
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
      handler: wrapPreDraftGate("search_similar_plans", buildSearchSimilarPlansHandler()),
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
    "list_follow_up_candidates",
    "send_subtask_reminder",
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
      "add_draft_subtask",
      "remove_draft_subtask",
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
      "get_employee_details",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
      "start_new_task",
      "switch_back_task",
      "update_draft_task",
      "bulk_assign_tasks",
      "add_draft_subtask",
      "remove_draft_subtask",
      "read_uploaded_roster_text",
      "resolve_roster_names",
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
      "list_follow_up_candidates",
      "send_subtask_reminder",
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
      "bulk_assign_tasks",
      "add_draft_subtask",
      "remove_draft_subtask",
      "read_uploaded_roster_text",
      "resolve_roster_names",
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
