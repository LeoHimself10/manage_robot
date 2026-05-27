/**
 * Stop duplicate manually-appended subtasks on a published task (audit-safe; no DELETE).
 *
 * Usage:
 *   npx tsx scripts/ops-stop-duplicate-subtasks.ts --task-no TASK-20260525-0001 --keep-source-key manual-19194cda --dry-run
 *   npx tsx scripts/ops-stop-duplicate-subtasks.ts --task-no TASK-20260525-0001 --keep-source-key manual-19194cda --apply
 */
import "dotenv/config";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";

function parseArgs(argv: string[]): {
  taskNo: string;
  keepSourceKey: string;
  prefix: string;
  dryRun: boolean;
  apply: boolean;
  note: string;
} {
  let taskNo = "";
  let keepSourceKey = "";
  let prefix = "manual-";
  let dryRun = false;
  let apply = false;
  let note = "duplicate manual add cleanup";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--apply") apply = true;
    else if (a === "--task-no" && argv[i + 1]) taskNo = argv[++i];
    else if (a === "--keep-source-key" && argv[i + 1]) keepSourceKey = argv[++i];
    else if (a === "--prefix" && argv[i + 1]) prefix = argv[++i];
    else if (a === "--note" && argv[i + 1]) note = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/ops-stop-duplicate-subtasks.ts --task-no TASK-xxx --keep-source-key manual-xxx [--prefix manual-] [--dry-run|--apply]",
      );
      process.exit(0);
    }
  }
  if (!taskNo || !keepSourceKey) {
    throw new Error("--task-no and --keep-source-key are required");
  }
  if (!dryRun && !apply) {
    throw new Error("Specify --dry-run or --apply");
  }
  if (dryRun && apply) {
    throw new Error("Use only one of --dry-run or --apply");
  }
  return { taskNo, keepSourceKey, prefix, dryRun, apply, note };
}

function main(): void {
  const args = parseArgs(process.argv);
  const store = createWorkbenchFormalTaskStore();
  const detail = store.getTaskDetail(args.taskNo);
  if (!detail) {
    throw new Error(`Task not found: ${args.taskNo}`);
  }
  const { task, subtasks } = detail;
  const candidates = subtasks.filter(
    (s) =>
      s.sourceTaskKey.startsWith(args.prefix) &&
      s.sourceTaskKey !== args.keepSourceKey &&
      s.status !== "STOPPED" &&
      s.status !== "DONE",
  );
  console.log(
    JSON.stringify(
      {
        taskNo: task.taskNo,
        planId: task.planId,
        managerUserId: task.managerUserId,
        keepSourceKey: args.keepSourceKey,
        stopCount: candidates.length,
        stops: candidates.map((s) => ({
          subtaskId: s.subtaskId,
          sourceTaskKey: s.sourceTaskKey,
          title: s.title,
          status: s.status,
          assigneeUserId: s.assigneeUserId,
        })),
      },
      null,
      2,
    ),
  );
  if (args.dryRun) {
    console.log("[dry-run] no changes written");
    return;
  }
  for (const sub of candidates) {
    const result = store.stopSubtask({
      planId: task.planId,
      subtaskId: sub.subtaskId,
      managerUserId: task.managerUserId,
      note: args.note,
      actorName: "ops-stop-duplicate-subtasks",
    });
    console.log(
      `[apply] stopped ${sub.sourceTaskKey} alreadyStopped=${result.alreadyStopped} status=${result.subtask.status}`,
    );
  }
  const after = store.getTaskDetail(task.planId)!;
  const activeManual = after.subtasks.filter(
    (s) => s.sourceTaskKey.startsWith(args.prefix) && s.status !== "STOPPED" && s.status !== "DONE",
  );
  console.log(
    `[done] active manual subtasks remaining: ${activeManual.length} (${activeManual.map((s) => s.sourceTaskKey).join(", ")})`,
  );
}

main();
