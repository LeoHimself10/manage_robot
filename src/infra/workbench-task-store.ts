import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type PlanSession, resolvePlanSessionDir } from "./plan-session-store";

export type WorkbenchTaskStatus =
  | "ASSIGNED"
  | "CHANGES_REQUESTED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "DONE"
  | "REJECTED";

export interface WorkbenchTaskEvent {
  type:
    | "SYNC_FROM_SESSION"
    | "MANAGER_REASSIGN"
    | "EMPLOYEE_ACCEPT"
    | "EMPLOYEE_REJECT"
    | "EMPLOYEE_CUSTOMIZE"
    | "EMPLOYEE_REQUEST_CHANGES"
    | "EMPLOYEE_PROGRESS";
  actorUserId: string;
  note?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

export interface WorkbenchTaskRecord {
  planId: string;
  title: string;
  managerUserId: string;
  assigneeUserId: string;
  status: WorkbenchTaskStatus;
  createdAt: string;
  updatedAt: string;
  progressNote?: string;
  history: WorkbenchTaskEvent[];
}

interface WorkbenchTaskDb {
  tasks: WorkbenchTaskRecord[];
}

export function resolveWorkbenchTasksPath(): string {
  return process.env.WORKBENCH_TASKS_PATH?.trim() || "./data/workbench/tasks.json";
}

function readDb(): WorkbenchTaskDb {
  try {
    const path = resolveWorkbenchTasksPath();
    if (!existsSync(path)) return { tasks: [] };
    const raw = JSON.parse(readFileSync(path, "utf8")) as WorkbenchTaskDb;
    const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    return { tasks };
  } catch {
    return { tasks: [] };
  }
}

function writeDb(db: WorkbenchTaskDb): void {
  const path = resolveWorkbenchTasksPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(db, null, 2), "utf8");
}

function inferTitleFromSession(session: PlanSession): string {
  const first = session.conversationHistory?.find((m) => m.role === "user")?.content ?? "";
  const trimmed = first.trim();
  if (!trimmed) return `任务 ${session.planId.slice(0, 8)}`;
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}...` : trimmed;
}

function pickAssigneeUserId(session: PlanSession): string | undefined {
  const assignment = session.latestAssignment as
    | {
        assignments?: Array<{
          primary?: { userId?: unknown };
        }>;
      }
    | undefined;
  const first = assignment?.assignments?.[0]?.primary?.userId;
  const uid = String(first ?? "").trim();
  return uid || undefined;
}

function loadSessionFiles(): PlanSession[] {
  try {
    const dir = resolvePlanSessionDir();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const out: PlanSession[] = [];
    for (const file of files) {
      try {
        const session = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlanSession;
        if (session?.planId) out.push(session);
      } catch {
        // ignore invalid sessions
      }
    }
    return out;
  } catch {
    return [];
  }
}

function upsertTask(tasks: WorkbenchTaskRecord[], task: WorkbenchTaskRecord): WorkbenchTaskRecord[] {
  const idx = tasks.findIndex((t) => t.planId === task.planId);
  if (idx < 0) return [...tasks, task];
  const existing = tasks[idx];
  const merged: WorkbenchTaskRecord = {
    ...existing,
    ...task,
    createdAt: existing.createdAt,
    updatedAt: task.updatedAt,
    history: [...(existing.history ?? []), ...(task.history ?? [])].slice(-80),
  };
  const next = [...tasks];
  next[idx] = merged;
  return next;
}

export function createWorkbenchTaskStore() {
  return {
    syncFromSessions(): WorkbenchTaskRecord[] {
      const db = readDb();
      const now = new Date().toISOString();
      const sessions = loadSessionFiles();
      let tasks = db.tasks;
      for (const session of sessions) {
        const managerUserId = String(session.senderStaffId ?? "").trim();
        if (!managerUserId) continue;
        const existing = tasks.find((t) => t.planId === session.planId);
        const assignee = pickAssigneeUserId(session) ?? existing?.assigneeUserId ?? managerUserId;
        const nextTask: WorkbenchTaskRecord = {
          planId: session.planId,
          title: existing?.title ?? inferTitleFromSession(session),
          managerUserId,
          assigneeUserId: assignee,
          status: existing?.status ?? "ASSIGNED",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          progressNote: existing?.progressNote,
          history:
            existing?.history ??
            [
              {
                type: "SYNC_FROM_SESSION",
                actorUserId: managerUserId,
                occurredAt: now,
              },
            ],
        };
        tasks = upsertTask(tasks, nextTask);
      }
      writeDb({ tasks });
      return tasks;
    },

    listAll(): WorkbenchTaskRecord[] {
      return readDb().tasks;
    },

    listForManager(userId: string): WorkbenchTaskRecord[] {
      return readDb().tasks.filter((t) => t.managerUserId === userId);
    },

    listForEmployee(userId: string): WorkbenchTaskRecord[] {
      return readDb().tasks.filter((t) => t.assigneeUserId === userId);
    },

    updateTask(planId: string, mutate: (task: WorkbenchTaskRecord) => WorkbenchTaskRecord): WorkbenchTaskRecord {
      const db = readDb();
      const idx = db.tasks.findIndex((t) => t.planId === planId);
      if (idx < 0) throw new Error(`Task not found for planId=${planId}`);
      const nextTask = mutate(db.tasks[idx]);
      const next = [...db.tasks];
      next[idx] = {
        ...nextTask,
        updatedAt: new Date().toISOString(),
      };
      writeDb({ tasks: next });
      return next[idx];
    },
  };
}
