import type { PlanSession } from "../infra/plan-session-store";
import type { WorkbenchStage } from "./workbench-types";
import type {
  WorkbenchInProgressSession,
  WorkbenchSubtaskProgress,
  WorkbenchTaskDetail,
  WorkbenchTaskQuery,
  WorkbenchTaskSummary,
  WorkbenchUser,
} from "./workbench-types";

type AssignmentDraftReader = (planId: string) => Record<string, unknown> | undefined;
type EmployeeProfileLoader = (profileDir: string) => unknown[];

export interface WorkbenchServiceDeps {
  loadPlanSessions: () => PlanSession[];
  readAssignmentDraft?: AssignmentDraftReader;
  getEmployeeProfiles?: EmployeeProfileLoader;
}

export function mapPlanStatusToWorkbenchStage(status: string): WorkbenchStage {
  if (status === "DRAFT_READY") return "DRAFT";
  if (status === "DRAFT" || status === "IN_REVIEW" || status === "BLOCKED_BY_GATE") return "DRAFT";
  if (status === "ASSIGNMENT_RECOMMENDING" || status === "AWAITING_DISPATCH_CONFIRM") return "ASSIGNMENT";
  if (status === "DISPATCHED") return "DISPATCHED";
  if (status === "NEGOTIATING" || status === "IN_EXECUTION") return "EXECUTION";
  if (status === "IN_ACCEPTANCE") return "ACCEPTANCE";
  console.warn("Unknown plan status mapped to DONE workbench stage", { status });
  return "DONE";
}

export function createWorkbenchService(deps: WorkbenchServiceDeps) {
  return {
    listTasks(
      identity: WorkbenchUser,
      query: WorkbenchTaskQuery = {},
    ): WorkbenchTaskSummary[] {
      return deps
        .loadPlanSessions()
        .filter((session) => canSeePlan(session, identity))
        .filter((session) => matchesTaskFilters(session, query))
        .map((session) => buildTaskSummary(session, preferredOwner(identity, query)));
    },

    getTaskDetail(
      planId: string,
      identity: WorkbenchUser,
    ): WorkbenchTaskDetail | undefined {
      const session = deps.loadPlanSessions().find((item) => item.planId === planId);
      if (!session || !canSeePlan(session, identity)) return undefined;

      const subtasks = buildSubtaskProgress(session).filter((subtask) =>
        identity.role === "manager" || subtask.assigneeUserId === identity.userId
      );
      if (identity.role === "employee" && subtasks.length === 0) return undefined;

      return {
        ...buildTaskSummary(session, preferredOwner(identity, {})),
        subtasks,
        latestDraft: asRecord(session.latestDraft),
        latestAssignment: asRecord(session.latestAssignment),
      };
    },

    listInProgressSessions(identity: WorkbenchUser): WorkbenchInProgressSession[] {
      return deps
        .loadPlanSessions()
        .filter((session) => canSeePlan(session, identity))
        .flatMap((session) => {
          const title = taskTitle(session);
          return (session.conversationSessions ?? [])
            .filter((conversation) => !isCompletedConversation(conversation))
            .filter((conversation) => canSeeConversation(session, conversation, identity))
            .map((conversation) => ({
              planId: session.planId,
              conversationId: conversation.conversationId,
              stage: conversation.stage,
              updatedAt: conversation.updatedAt,
              managerUserId:
                "managerUserId" in conversation ? conversation.managerUserId : undefined,
              employeeUserId:
                "employeeUserId" in conversation ? conversation.employeeUserId : undefined,
              title,
            }));
        });
    },
  };
}

function preferredOwner(
  identity: WorkbenchUser,
  query: WorkbenchTaskQuery,
): string | undefined {
  if (identity.role === "employee") return identity.userId;
  return query.ownerUserId;
}

function buildTaskSummary(
  session: PlanSession,
  preferredOwnerUserId?: string,
): WorkbenchTaskSummary {
  const status = stringField(asRecord(session.latestDraft), "status");
  return {
    planId: session.planId,
    traceId: session.lastTraceId,
    title: taskTitle(session),
    stage: status ? mapPlanStatusToWorkbenchStage(status) : "DRAFT",
    ownerUserId:
      preferredOwnerUserId && planHasAssignee(session, preferredOwnerUserId)
        ? preferredOwnerUserId
        : resolvePlanOwnerUserId(session),
    updatedAt: session.updatedAt,
  };
}

function buildSubtaskProgress(session: PlanSession): WorkbenchSubtaskProgress[] {
  return draftTasks(session).map((task) => ({
    taskId: stringField(task, "id") || stringField(task, "taskId") || "",
    title: stringField(task, "title") || "(未命名子任务)",
    assigneeUserId: resolveTaskOwnerUserId(session, task),
    status: normalizeSubtaskStatus(stringField(task, "status")),
    note: stringField(task, "note"),
    updatedAt: stringField(task, "updatedAt") || session.updatedAt,
  }));
}

function matchesTaskFilters(session: PlanSession, query: WorkbenchTaskQuery): boolean {
  const summary = buildTaskSummary(session, query.ownerUserId);
  if (query.stage && summary.stage !== query.stage) return false;
  if (query.ownerUserId && !planHasAssignee(session, query.ownerUserId)) return false;

  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) return true;
  const haystack = [
    summary.title,
    session.planId,
    ...draftTasks(session).map((task) => stringField(task, "title")),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(keyword);
}

function canSeePlan(session: PlanSession, identity: WorkbenchUser): boolean {
  if (identity.role === "manager") return true;
  return planHasAssignee(session, identity.userId);
}

function canSeeConversation(
  session: PlanSession,
  conversation: NonNullable<PlanSession["conversationSessions"]>[number],
  identity: WorkbenchUser,
): boolean {
  if (identity.role === "manager") return true;
  if ("managerUserId" in conversation && conversation.managerUserId) return false;
  if ("employeeUserId" in conversation && conversation.employeeUserId === identity.userId) {
    return true;
  }
  return planHasAssignee(session, identity.userId);
}

function isCompletedConversation(
  conversation: NonNullable<PlanSession["conversationSessions"]>[number],
): boolean {
  return Boolean(conversation.completedAt);
}

function taskTitle(session: PlanSession): string {
  const firstTask = draftTasks(session)[0];
  return stringField(firstTask, "title") || `规划 ${session.planId}`;
}

function draftTasks(session: PlanSession): Record<string, unknown>[] {
  const draft = asRecord(session.latestDraft);
  const tasks = draft?.tasks;
  return Array.isArray(tasks) ? tasks.filter(isRecord) : [];
}

function assignmentRows(session: PlanSession): Record<string, unknown>[] {
  const assignment = asRecord(session.latestAssignment);
  const rows = assignment?.assignments;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function planHasAssignee(session: PlanSession, userId: string): boolean {
  return buildSubtaskProgress(session).some((task) => task.assigneeUserId === userId);
}

function resolvePlanOwnerUserId(session: PlanSession): string | undefined {
  return buildSubtaskProgress(session).find((task) => task.assigneeUserId)?.assigneeUserId;
}

function resolveTaskOwnerUserId(
  session: PlanSession,
  task: Record<string, unknown>,
): string | undefined {
  const taskId = stringField(task, "id") || stringField(task, "taskId");
  const explicitOwner = stringField(task, "ownerId");
  if (explicitOwner) return explicitOwner;

  const matchedAssignment = assignmentRows(session).find(
    (assignment) => stringField(assignment, "taskId") === taskId,
  );
  const matchedOwner = candidateUserId(matchedAssignment?.primary);
  if (matchedOwner) return matchedOwner;

  const assignments = assignmentRows(session);
  if (assignments.length === 1) {
    return candidateUserId(assignments[0].primary);
  }

  // Historical draft snapshots did not always carry ownerId. When the
  // assignment draft is ambiguous, leave the owner empty instead of guessing.
  return undefined;
}

function candidateUserId(candidate: unknown): string | undefined {
  return stringField(asRecord(candidate), "userId");
}

function normalizeSubtaskStatus(raw: string | undefined): WorkbenchSubtaskProgress["status"] {
  if (raw === "TODO" || raw === "IN_PROGRESS" || raw === "BLOCKED" || raw === "DONE") {
    return raw;
  }
  return "TODO";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return isRecord(input) ? input : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function stringField(
  input: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = input?.[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
