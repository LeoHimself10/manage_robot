import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createPlanSessionStore,
  hashChatKey,
  resolvePlanSessionDir,
  type PlanSession,
} from "../infra/plan-session-store";
import { resolveWorkbenchIdentityFromToken, type WorkbenchIdentity } from "./workbench-auth";
import { listPlanSessions } from "./loaders";
import { createWorkbenchService } from "./workbench-service";
import type {
  WorkbenchInProgressSession,
  WorkbenchSubtaskProgress,
  WorkbenchSubtaskStatus,
  WorkbenchTaskDetail,
  WorkbenchTaskQuery,
  WorkbenchTaskSummary,
} from "./workbench-types";

interface WorkbenchServiceLike {
  listTasks(identity: WorkbenchIdentity, query?: WorkbenchTaskQuery): WorkbenchTaskSummary[];
  getTaskDetail(planId: string, identity: WorkbenchIdentity): WorkbenchTaskDetail | undefined;
  listInProgressSessions(identity: WorkbenchIdentity): WorkbenchInProgressSession[];
}

type WorkbenchSessionStore = Pick<
  ReturnType<typeof createPlanSessionStore>,
  "appendEvent"
> &
  Partial<Pick<ReturnType<typeof createPlanSessionStore>, "loadOrCreate" | "save">>;

export interface WorkbenchProgressPatch {
  status: WorkbenchSubtaskStatus;
  note?: string;
}

export interface WorkbenchApiDeps {
  service: WorkbenchServiceLike;
  resolveIdentityFromToken?: (token: string) => WorkbenchIdentity;
  loadPlanSessions?: () => PlanSession[];
  updateSubtaskProgress?: (
    identity: WorkbenchIdentity,
    subTaskId: string,
    patch: WorkbenchProgressPatch,
  ) => WorkbenchSubtaskProgress | undefined | Promise<WorkbenchSubtaskProgress | undefined>;
  sessionStore?: WorkbenchSessionStore;
}

export async function handleWorkbenchApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorkbenchApiDeps = createDefaultWorkbenchApiDeps(),
): Promise<boolean> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  if (!url.pathname.startsWith("/api/")) return false;

  const identity = resolveIdentity(url, res, deps);
  if (!identity) return true;

  if (req.method === "GET" && url.pathname === "/api/me") {
    respondJson(res, 200, identity);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    respondJson(res, 200, {
      tasks: deps.service.listTasks(identity, taskQueryFromUrl(url)),
    });
    return true;
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1] ?? "");
    const detail = deps.service.getTaskDetail(taskId, identity);
    if (!detail) {
      respondJson(res, 404, { error: "Task not found" });
      return true;
    }
    respondJson(res, 200, detail);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/in-progress-sessions") {
    respondJson(res, 200, {
      sessions: deps.service.listInProgressSessions(identity),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/conversations/new-task") {
    await handleNewTaskConversation(req, res, identity, deps);
    return true;
  }

  const conversationMessageMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(
    url.pathname,
  );
  if (req.method === "POST" && conversationMessageMatch) {
    await handleConversationMessage(
      req,
      res,
      identity,
      deps,
      decodeURIComponent(conversationMessageMatch[1] ?? ""),
    );
    return true;
  }

  const conversationApplyMatch = /^\/api\/conversations\/([^/]+)\/apply$/.exec(
    url.pathname,
  );
  if (req.method === "POST" && conversationApplyMatch) {
    await handleConversationApply(
      req,
      res,
      identity,
      deps,
      decodeURIComponent(conversationApplyMatch[1] ?? ""),
    );
    return true;
  }

  const progressMatch = /^\/api\/subtasks\/([^/]+)\/progress$/.exec(url.pathname);
  if (req.method === "PATCH" && progressMatch) {
    const subTaskId = decodeURIComponent(progressMatch[1] ?? "");
    const visibleSubtask = findSubtaskForAuthorization(deps.service, subTaskId);
    if (!visibleSubtask) {
      respondJson(res, 404, { error: "Subtask not found" });
      return true;
    }
    if (
      identity.role === "employee" &&
      visibleSubtask.assigneeUserId !== identity.userId
    ) {
      respondJson(res, 403, { error: "Forbidden: subtask is owned by another user" });
      return true;
    }

    const patch = await parseProgressPatch(req, res);
    if (!patch) return true;

    const updated = await deps.updateSubtaskProgress?.(identity, subTaskId, patch);
    if (!updated) {
      respondJson(res, 404, { error: "Subtask not found" });
      return true;
    }
    respondJson(res, 200, { subtask: updated });
    return true;
  }

  respondJson(res, 404, { error: "API route not found" });
  return true;
}

export function createDefaultWorkbenchApiDeps(): WorkbenchApiDeps {
  const sessionDir = resolveWorkbenchSessionDir();
  const sessionStore = createPlanSessionStore({ sessionDir });
  return {
    service: createWorkbenchService({
      loadPlanSessions: () => listPlanSessions(sessionDir),
    }),
    loadPlanSessions: () => listPlanSessions(sessionDir),
    sessionStore,
    updateSubtaskProgress: createFileBackedSubtaskUpdater(sessionDir, sessionStore),
  };
}

function resolveWorkbenchSessionDir(): string {
  return process.env.WORKBENCH_SESSION_DIR?.trim() || resolvePlanSessionDir();
}

function resolveIdentity(
  url: URL,
  res: ServerResponse,
  deps: WorkbenchApiDeps,
): WorkbenchIdentity | undefined {
  const token = url.searchParams.get("token") ?? accessTokenParam(url);
  if (!token) {
    respondJson(res, 401, { error: "Missing token" });
    return undefined;
  }
  try {
    return (deps.resolveIdentityFromToken ?? resolveWorkbenchIdentityFromToken)(token);
  } catch (err) {
    respondJson(res, 403, {
      error: err instanceof Error ? err.message : "Invalid token",
    });
    return undefined;
  }
}

function accessTokenParam(url: URL): string | undefined {
  return url.searchParams.get("access_token") ?? undefined;
}

function taskQueryFromUrl(url: URL): WorkbenchTaskQuery {
  return {
    keyword: optionalParam(url, "keyword"),
    stage: optionalParam(url, "stage") as WorkbenchTaskQuery["stage"],
    ownerUserId: optionalParam(url, "ownerUserId"),
  };
}

function optionalParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

async function parseProgressPatch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<WorkbenchProgressPatch | undefined> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    respondJson(res, 400, { error: "Invalid JSON body" });
    return undefined;
  }

  if (!isRecord(body) || !isWorkbenchSubtaskStatus(body.status)) {
    respondJson(res, 400, { error: "Invalid progress status" });
    return undefined;
  }

  const note = typeof body.note === "string" ? body.note.trim() : undefined;
  return {
    status: body.status,
    ...(note ? { note } : {}),
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

async function handleNewTaskConversation(
  req: IncomingMessage,
  res: ServerResponse,
  identity: WorkbenchIdentity,
  deps: WorkbenchApiDeps,
): Promise<void> {
  if (!deps.sessionStore?.loadOrCreate || !deps.sessionStore.save) {
    respondJson(res, 500, { error: "Session store unavailable" });
    return;
  }

  const body = await parseConversationBody(req, res);
  if (!body) return;

  const conversationId =
    body.conversationId ||
    `conv-${hashChatKey(`workbench:new-task:${identity.userId}:${body.message}`).slice(0, 12)}`;
  const chatKey = `workbench:new-task:${identity.userId}:${conversationId}`;
  const session = deps.sessionStore.loadOrCreate(chatKey);
  const now = new Date().toISOString();
  const conversation = {
    conversationId,
    stage: "WAITING_MODEL" as const,
    updatedAt: now,
  };

  session.conversationHistory = [
    ...(Array.isArray(session.conversationHistory) ? session.conversationHistory : []),
    { role: "user", content: body.message },
  ];
  session.conversationSessions = upsertConversation(
    session.conversationSessions,
    conversation,
  );
  session.updatedAt = now;

  deps.sessionStore.save(session);
  deps.sessionStore.appendEvent({
    planId: session.planId,
    chatKeyHash: session.chatKeyHash,
    eventType: "WORKBENCH_CONVERSATION_CREATED",
    payload: {
      conversationId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      message: body.message,
    },
  });

  respondJson(res, 201, {
    conversation: {
      planId: session.planId,
      ...conversation,
    },
  });
}

async function handleConversationMessage(
  req: IncomingMessage,
  res: ServerResponse,
  identity: WorkbenchIdentity,
  deps: WorkbenchApiDeps,
  conversationId: string,
): Promise<void> {
  if (!deps.sessionStore?.save) {
    respondJson(res, 500, { error: "Session store unavailable" });
    return;
  }

  const body = await parseConversationBody(req, res);
  if (!body) return;

  const match = findSessionByConversationId(deps, conversationId);
  if (!match) {
    respondJson(res, 404, { error: "Conversation not found" });
    return;
  }

  const now = new Date().toISOString();
  match.session.conversationHistory = [
    ...(Array.isArray(match.session.conversationHistory)
      ? match.session.conversationHistory
      : []),
    { role: "user", content: body.message },
  ];
  match.conversation.stage = "WAITING_MODEL";
  match.conversation.updatedAt = now;
  match.session.updatedAt = now;

  deps.sessionStore.save(match.session);
  deps.sessionStore.appendEvent({
    planId: match.session.planId,
    chatKeyHash: match.session.chatKeyHash,
    eventType: "WORKBENCH_CONVERSATION_MESSAGE_ADDED",
    payload: {
      conversationId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      message: body.message,
    },
  });

  respondJson(res, 200, {
    conversation: {
      planId: match.session.planId,
      ...match.conversation,
    },
  });
}

async function handleConversationApply(
  req: IncomingMessage,
  res: ServerResponse,
  identity: WorkbenchIdentity,
  deps: WorkbenchApiDeps,
  conversationId: string,
): Promise<void> {
  if (!deps.sessionStore?.save) {
    respondJson(res, 500, { error: "Session store unavailable" });
    return;
  }

  const body = await parseApplyBody(req, res);
  if (!body) return;

  const match = findSessionByConversationId(deps, conversationId);
  if (!match) {
    respondJson(res, 404, { error: "Conversation not found" });
    return;
  }

  const now = new Date().toISOString();
  const revisionEvent = {
    eventType: "WORKBENCH_CONVERSATION_APPLIED",
    conversationId,
    actorUserId: identity.userId,
    actorRole: identity.role,
    occurredAt: now,
    ...(body.note ? { note: body.note } : {}),
    ...(body.revision ? { revision: body.revision } : {}),
  };

  match.conversation.updatedAt = now;
  match.conversation.completedAt = now;
  match.session.revisionEvents = [
    ...(Array.isArray(match.session.revisionEvents) ? match.session.revisionEvents : []),
    revisionEvent,
  ];
  match.session.updatedAt = now;

  deps.sessionStore.save(match.session);
  deps.sessionStore.appendEvent({
    planId: match.session.planId,
    chatKeyHash: match.session.chatKeyHash,
    eventType: "WORKBENCH_CONVERSATION_APPLIED",
    payload: {
      conversationId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      ...(body.note ? { note: body.note } : {}),
      ...(body.revision ? { revision: body.revision } : {}),
    },
    occurredAt: now,
  });

  respondJson(res, 200, {
    applied: true,
    conversation: {
      planId: match.session.planId,
      ...match.conversation,
    },
  });
}

async function parseConversationBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ conversationId?: string; message: string } | undefined> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    respondJson(res, 400, { error: "Invalid JSON body" });
    return undefined;
  }

  if (!isRecord(body)) {
    respondJson(res, 400, { error: "Invalid conversation body" });
    return undefined;
  }

  const message = stringField(body, "message");
  if (!message) {
    respondJson(res, 400, { error: "Invalid conversation message" });
    return undefined;
  }

  return {
    conversationId: stringField(body, "conversationId"),
    message,
  };
}

async function parseApplyBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ note?: string; revision?: Record<string, unknown> } | undefined> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    respondJson(res, 400, { error: "Invalid JSON body" });
    return undefined;
  }

  if (!isRecord(body)) {
    respondJson(res, 400, { error: "Invalid apply body" });
    return undefined;
  }

  const revision = asRecord(body.revision);
  return {
    note: stringField(body, "note"),
    ...(revision ? { revision } : {}),
  };
}

function findSessionByConversationId(
  deps: WorkbenchApiDeps,
  conversationId: string,
):
  | {
      session: PlanSession;
      conversation: NonNullable<PlanSession["conversationSessions"]>[number];
    }
  | undefined {
  for (const session of deps.loadPlanSessions?.() ?? []) {
    const conversation = (session.conversationSessions ?? []).find(
      (item) => item.conversationId === conversationId,
    );
    if (conversation) return { session, conversation };
  }
  return undefined;
}

function upsertConversation(
  conversations: PlanSession["conversationSessions"],
  next: NonNullable<PlanSession["conversationSessions"]>[number],
): NonNullable<PlanSession["conversationSessions"]> {
  const existing = conversations ?? [];
  const index = existing.findIndex(
    (conversation) => conversation.conversationId === next.conversationId,
  );
  if (index < 0) return [...existing, next];
  return existing.map((conversation, currentIndex) =>
    currentIndex === index ? next : conversation,
  );
}

function findSubtaskForAuthorization(
  service: WorkbenchServiceLike,
  subTaskId: string,
): WorkbenchSubtaskProgress | undefined {
  const systemManager: WorkbenchIdentity = {
    planId: "*",
    userId: "__workbench_api__",
    role: "manager",
  };
  for (const task of service.listTasks(systemManager, {})) {
    const detail = service.getTaskDetail(task.planId, systemManager);
    const found = detail?.subtasks.find((subtask) => subtask.taskId === subTaskId);
    if (found) return found;
  }
  return undefined;
}

function createFileBackedSubtaskUpdater(
  sessionDir: string,
  sessionStore: Pick<ReturnType<typeof createPlanSessionStore>, "appendEvent" | "save">,
) {
  return async (
    identity: WorkbenchIdentity,
    subTaskId: string,
    patch: WorkbenchProgressPatch,
  ): Promise<WorkbenchSubtaskProgress | undefined> => {
    const sessions = listPlanSessions(sessionDir);
    const now = new Date().toISOString();

    for (const session of sessions) {
      const task = draftTasks(session).find(
        (item) => taskIdOf(item) === subTaskId,
      );
      if (!task) continue;

      const updated: WorkbenchSubtaskProgress = {
        taskId: subTaskId,
        title: stringField(task, "title") || "(未命名子任务)",
        assigneeUserId: resolveTaskOwnerUserId(session, task),
        status: patch.status,
        note: patch.note,
        updatedAt: now,
      };

      task.status = patch.status;
      if (patch.note) task.note = patch.note;
      task.updatedAt = now;
      session.updatedAt = now;

      sessionStore.save(session);
      sessionStore.appendEvent({
        planId: session.planId,
        chatKeyHash: session.chatKeyHash,
        eventType: "WORKBENCH_SUBTASK_PROGRESS_UPDATED",
        payload: {
          actorUserId: identity.userId,
          actorRole: identity.role,
          subTaskId,
          status: patch.status,
          note: patch.note,
        },
      });
      return updated;
    }

    return undefined;
  };
}

function respondJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function isWorkbenchSubtaskStatus(input: unknown): input is WorkbenchSubtaskStatus {
  return (
    input === "TODO" ||
    input === "IN_PROGRESS" ||
    input === "BLOCKED" ||
    input === "DONE"
  );
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

function resolveTaskOwnerUserId(
  session: PlanSession,
  task: Record<string, unknown>,
): string | undefined {
  const explicitOwner = stringField(task, "ownerId");
  if (explicitOwner) return explicitOwner;

  const matchedAssignment = assignmentRows(session).find(
    (assignment) => stringField(assignment, "taskId") === taskIdOf(task),
  );
  return stringField(asRecord(matchedAssignment?.primary), "userId");
}

function taskIdOf(task: Record<string, unknown>): string | undefined {
  return stringField(task, "id") || stringField(task, "taskId");
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
