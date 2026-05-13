import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { SEARCH_EMPLOYEES_TOOL, buildSearchEmployeesHandler } from "../assignment/tools/search-employees";
import type { EmployeeProfileRecord } from "../../integrations/repos/employee-profile-repo";
import { SEARCH_WEB_TOOL, buildSearchWebHandler } from "./search-web";
import { SAVE_DRAFT_TOOL, buildSaveDraftHandler } from "./save-draft";
import { SEARCH_SIMILAR_PLANS_TOOL, buildSearchSimilarPlansHandler } from "./search-similar-plans";
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
import { GET_CURRENT_TIME_TOOL, buildGetCurrentTimeHandler } from "./get-current-time";
import {
  UPDATE_KNOWN_FACTS_TOOL,
  LIST_KNOWN_FACTS_TOOL,
  buildKnownFactsHandlers,
  type KnownFactsStore,
} from "./update-known-facts";
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
  employeeRepo: { list(): EmployeeProfileRecord[] };
  onDraftSaved?: (draft: Record<string, unknown>) => void;
  toolProfile?: ToolProfile;
  trustedActorUserId?: string;
  allowSearchWeb?: boolean;
  knownFactsStore?: KnownFactsStore;
  currentSessionPlanId?: string;
  currentSession?: PlanSession;
  publishRecentStore?: PublishTaskRecentStore;
  actorName?: string;
  onPublishTaskResult?: (result: Record<string, unknown>) => void;
}

export type ToolProfile = "planner" | "employee" | "manager" | "full";

export function buildToolRegistry(deps: ToolRegistryDeps): Record<string, ToolRegistryEntry> {
  const profile = deps.toolProfile ?? "planner";
  const taskStore = createWorkbenchFormalTaskStore();
  const peopleStore = createPeopleDirectoryStore();
  const trustedActor = deps.trustedActorUserId?.trim();
  const allowSearchWeb = deps.allowSearchWeb ?? false;
  const searchWebEnabled = String(process.env.SEARCH_WEB_ENABLED ?? "1").trim() !== "0";
  const knownFactsHandlers = deps.knownFactsStore ? buildKnownFactsHandlers(deps.knownFactsStore) : undefined;
  const publishRecentStore = deps.publishRecentStore ?? createRecentPublishStore();
  const notifyEmployeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();

  const all: Record<string, ToolRegistryEntry> = {
    search_employees: {
      definition: SEARCH_EMPLOYEES_TOOL,
      handler: buildSearchEmployeesHandler(deps.employeeRepo),
    },
    search_similar_plans: {
      definition: SEARCH_SIMILAR_PLANS_TOOL,
      handler: buildSearchSimilarPlansHandler(),
    },
    save_draft: {
      definition: SAVE_DRAFT_TOOL,
      handler: buildSaveDraftHandler({ onDraftSaved: deps.onDraftSaved }),
    },
    prepare_publish_task: {
      definition: PREPARE_PUBLISH_TASK_TOOL,
      handler: buildPreparePublishTaskHandler(),
    },
    submit_employee_response: {
      definition: SUBMIT_EMPLOYEE_RESPONSE_TOOL,
      handler: buildSubmitEmployeeResponseHandler({ taskStore }),
    },
    submit_progress_update: {
      definition: SUBMIT_PROGRESS_UPDATE_TOOL,
      handler: buildSubmitProgressUpdateHandler({ taskStore }),
    },
    update_employee_profile: {
      definition: UPDATE_EMPLOYEE_PROFILE_TOOL,
      handler: buildUpdateEmployeeProfileHandler({ peopleStore }),
    },
    list_my_tasks: {
      definition: LIST_MY_TASKS_TOOL,
      handler: buildListMyTasksHandler({ taskStore }),
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

  // Never trust actor identity from model arguments.
  const sensitiveTools = [
    "list_my_tasks",
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
      "save_draft",
      "search_employees",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
    ],
    manager: [
      "save_draft",
      "prepare_publish_task",
      "publish_task",
      "search_employees",
      "search_similar_plans",
      "search_web",
      "get_current_time",
      "update_known_facts",
      "list_known_facts",
    ],
    employee: [
      "list_my_tasks",
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
