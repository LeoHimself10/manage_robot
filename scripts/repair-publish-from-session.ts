/**
 * One-off repair: publish a staged plan session to SQLite + employee notify,
 * using the same publish_task handler as production (no raw SQL).
 *
 * Usage:
 *   npx tsx scripts/repair-publish-from-session.ts --plan-id <uuid> --session-file <path> [--dry-run]
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

import type { PlanSession } from "../src/infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../src/integrations/dingtalk/workbench-notify";
import { buildPublishTaskHandler } from "../src/agent/tools/publish-task";
import {
  buildPreparePublishArgsFromSession,
  hashAssignmentForStaging,
  hashDraftForStaging,
  isStagingStale,
} from "../src/agent/publish-helpers";
import { logStructured } from "../src/infra/logger";

function parseArgs(argv: string[]): {
  planId: string;
  sessionFile: string;
  dryRun: boolean;
  writeSession: boolean;
  dueAtByTaskId: Record<string, string>;
} {
  let planId = "";
  let sessionFile = "";
  let dryRun = false;
  let writeSession = true;
  const dueAtByTaskId: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--no-write-session") writeSession = false;
    else if (a === "--plan-id" && argv[i + 1]) planId = argv[++i];
    else if (a === "--session-file" && argv[i + 1]) sessionFile = argv[++i];
    else if (a === "--due-at" && argv[i + 1]) {
      const spec = argv[++i];
      const [taskId, due] = spec.split("=", 2);
      if (taskId && due) dueAtByTaskId[taskId.trim()] = due.trim();
    }
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/repair-publish-from-session.ts --plan-id UUID --session-file path [--due-at task_1=YYYY-MM-DD]... [--dry-run]",
      );
      process.exit(0);
    }
  }
  if (!planId || !sessionFile) {
    throw new Error("--plan-id and --session-file are required");
  }
  return { planId, sessionFile, dryRun, writeSession, dueAtByTaskId };
}

function normalizeSessionForRepair(
  session: PlanSession,
  planId: string,
  dueAtByTaskId: Record<string, string>,
): PlanSession {
  const next: PlanSession = JSON.parse(JSON.stringify(session)) as PlanSession;
  next.planId = planId;

  const draft = next.latestDraft;
  if (!draft || typeof draft !== "object") {
    throw new Error("latestDraft missing");
  }
  const tasks = (draft as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("latestDraft.tasks empty");
  }

  for (const raw of tasks) {
    const t = raw as Record<string, unknown>;
    const id = String(t.id ?? "").trim();
    const due = dueAtByTaskId[id];
    if (!due) continue;
    const timeNode =
      t.timeNode && typeof t.timeNode === "object" && !Array.isArray(t.timeNode)
        ? { ...(t.timeNode as Record<string, unknown>) }
        : {};
    if (!String(timeNode.dueAt ?? "").trim()) {
      timeNode.dueAt = due;
      t.timeNode = timeNode;
    }
  }

  (draft as Record<string, unknown>).openQuestions = [];
  (draft as Record<string, unknown>).assistantMessage = "";

  const assignment = next.latestAssignment;
  if (!assignment || typeof assignment !== "object") {
    throw new Error("latestAssignment missing");
  }

  const stagedAt = new Date().toISOString();
  (draft as Record<string, unknown>).stagedBy = "prepare_publish_task";
  (draft as Record<string, unknown>).stagedAt = stagedAt;
  (draft as Record<string, unknown>).stagedDraftHash = hashDraftForStaging(draft);
  (draft as Record<string, unknown>).stagedAssignmentHash = hashAssignmentForStaging(assignment);
  (assignment as Record<string, unknown>).stagedBy = "prepare_publish_task";
  (assignment as Record<string, unknown>).stagedAt = stagedAt;

  const scopeId = next.currentTaskScopeId;
  if (scopeId && next.taskScopes?.[scopeId]) {
    next.taskScopes[scopeId].latestDraft = draft;
    next.taskScopes[scopeId].latestAssignment = assignment as PlanSession["latestAssignment"];
  }

  return next;
}

async function main(): Promise<void> {
  const { planId, sessionFile, dryRun, writeSession, dueAtByTaskId } = parseArgs(process.argv);
  const raw = readFileSync(sessionFile, "utf8");
  const loaded = JSON.parse(raw) as PlanSession;
  const session = normalizeSessionForRepair(loaded, planId, dueAtByTaskId);

  const managerUserId = String(
    session.senderStaffId ?? session.canonicalUserId ?? "",
  ).trim();
  if (!managerUserId) {
    throw new Error("session missing senderStaffId / canonicalUserId");
  }

  const taskStore = createWorkbenchFormalTaskStore();
  const peopleStore = createPeopleDirectoryStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();

  const existing = taskStore.listManagerTasks(managerUserId).find((t) => t.planId === planId);
  if (existing) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          alreadyPublished: true,
          taskNo: existing.taskNo,
          title: existing.title,
          planId,
        },
        null,
        2,
      ),
    );
    return;
  }

  const prepareArgs = buildPreparePublishArgsFromSession(session);
  if (!prepareArgs) {
    throw new Error("buildPreparePublishArgsFromSession returned null — draft/assignment incomplete");
  }

  const stale = isStagingStale(session);
  const assignRows = (session.latestAssignment as { assignments?: Array<{ taskId: string; primary?: { userId?: string } }> })
    ?.assignments ?? [];
  const contactChecks = assignRows.map((row) => {
    const uid = String(row.primary?.userId ?? "").trim();
    const c = peopleStore.getContact(uid);
    return {
      taskId: row.taskId,
      userId: uid,
      active: c?.active ?? false,
      name: c?.name ?? null,
    };
  });

  const preview = {
    planId,
    managerUserId,
    title: (session.latestDraft as { title?: string })?.title,
    subtaskCount: (session.latestDraft as { tasks?: unknown[] })?.tasks?.length ?? 0,
    stagingStale: stale,
    prepareOk: true,
    contactChecks,
    dryRun,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (dryRun) {
    if (stale) throw new Error("staging still stale after normalize — abort");
    const missingContact = contactChecks.filter((c) => !c.active);
    if (missingContact.length > 0) {
      console.warn("WARN: assignees not active in contacts:", missingContact);
    }
    return;
  }

  if (stale) {
    throw new Error("staging stale after normalize — abort");
  }

  const handler = buildPublishTaskHandler({
    trustedActorUserId: managerUserId,
    currentSessionPlanId: planId,
    currentSession: session,
    initiatorDepartment:
      employeeRepo.get(managerUserId)?.department?.trim() || "未配置部门",
    publishFromSession: taskStore.publishFromSession.bind(taskStore),
    appendTaskEvent: taskStore.appendTaskEvent.bind(taskStore),
    getContact: (userId) => peopleStore.getContact(userId),
    notifier,
    recentPublished: { get: () => undefined, mark: () => {} },
    onAudit: (entry) => logStructured(entry),
  });

  const result = (await handler({
    planId,
    confirmationContext: "repair: manual backfill after false publish",
  })) as Record<string, unknown>;

  console.log(JSON.stringify(result, null, 2));

  if (String(result.ok ?? "") !== "true") {
    process.exitCode = 1;
    return;
  }

  const taskNo = String(
    (result.task as { taskNo?: string } | undefined)?.taskNo ?? result.taskNo ?? "",
  ).trim();

  if (writeSession && taskNo) {
    const scopeId = session.currentTaskScopeId;
    if (scopeId && session.taskScopes?.[scopeId]) {
      session.taskScopes[scopeId].publishedTaskNo = taskNo;
    }
    session.updatedAt = new Date().toISOString();
    writeFileSync(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    console.log(`session updated: ${sessionFile} publishedTaskNo=${taskNo}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
