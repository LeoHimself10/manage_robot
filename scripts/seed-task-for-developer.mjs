#!/usr/bin/env node
/**
 * 在正式任务库为指定员工发布一条测试任务（全部子任务指派同一人）。
 * 用法（ECS）:
 *   docker exec manage-robot-dingtalk node /app/scripts/seed-task-for-developer.mjs
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SQLITE_PATH = process.env.WORKBENCH_SQLITE_PATH || "/app/data/workbench/workbench.sqlite";
const PLAN_SESSION_DIR = process.env.PLAN_SESSION_DIR || "/app/data/sessions";
const MANAGER_NAME = process.env.SEED_MANAGER_NAME || "姚凯珩";
const ASSIGNEE_QUERY = process.env.SEED_ASSIGNEE_QUERY || "T-developer1";

function findContact(db, pattern) {
  const like = `%${pattern}%`;
  return db
    .prepare(
      `SELECT user_id, name, department_names, active FROM dingtalk_contacts
       WHERE active = 1 AND (name LIKE ? OR user_id LIKE ?)
       ORDER BY name LIMIT 5`,
    )
    .all(like, like);
}

async function main() {
  const db = new Database(SQLITE_PATH);
  const managers = findContact(db, MANAGER_NAME);
  const assignees = findContact(db, ASSIGNEE_QUERY.replace(/^T-/, "").replace(/developer/i, "developer"));

  let manager = managers.find((r) => String(r.name || "").includes(MANAGER_NAME));
  if (!manager) manager = managers[0];
  let assignee = assignees.find((r) =>
    String(r.user_id || "").toLowerCase().includes("developer"),
  );
  if (!assignee) assignee = assignees[0];

  if (!manager?.user_id) {
    console.error("未找到主管:", MANAGER_NAME, managers);
    process.exit(1);
  }
  if (!assignee?.user_id) {
    console.error("未找到员工:", ASSIGNEE_QUERY, assignees);
    process.exit(1);
  }

  console.log("manager:", manager.user_id, manager.name);
  console.log("assignee:", assignee.user_id, assignee.name);

  const planId = randomUUID();
  const chatKeyHash = `seed-${Date.now()}`;
  const now = new Date().toISOString();
  const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const latestDraft = {
    title: "后台种子任务 · 子任务全指派验收",
    description: `由运维脚本为 ${assignee.name} 创建的测试正式任务，主管 ${manager.name}。用于验证工作台与通知链路。`,
    tasks: [
      {
        id: "task_1",
        title: "收集与整理基础资料",
        objective: "汇总测试所需输入",
        deliverables: ["资料清单"],
        completionCriteria: ["清单已确认"],
        timeNode: { dueAt, checkpoints: [] },
        feedbackFrequency: "每周",
      },
      {
        id: "task_2",
        title: "执行主流程验证",
        objective: "按清单完成主流程",
        deliverables: ["验证记录"],
        completionCriteria: ["记录已提交"],
        timeNode: { dueAt, checkpoints: [] },
        feedbackFrequency: "每周",
        dependencyTaskIds: ["task_1"],
      },
      {
        id: "task_3",
        title: "输出结论与复盘",
        objective: "形成可验收结论",
        deliverables: ["结论文档"],
        completionCriteria: ["主管已知晓"],
        timeNode: { dueAt, checkpoints: [] },
        feedbackFrequency: "每周",
        dependencyTaskIds: ["task_2"],
      },
    ],
    stagedBy: "prepare_publish_task",
    stagedAt: now,
  };

  const latestAssignment = {
    assignments: latestDraft.tasks.map((t) => ({
      taskId: t.id,
      primary: { userId: assignee.user_id, displayName: assignee.name },
      confidence: "HIGH",
    })),
    stagedBy: "prepare_publish_task",
    stagedAt: now,
  };

  const session = {
    chatKeyHash,
    planId,
    createdAt: now,
    updatedAt: now,
    senderStaffId: manager.user_id,
    knownFacts: [],
    conversationHistory: [],
    latestDraft,
    latestAssignment,
  };

  const sessionDir = mkdtempSync(join(tmpdir(), "seed-plan-"));
  process.env.PLAN_SESSION_DIR = sessionDir;
  process.env.WORKBENCH_SQLITE_PATH = SQLITE_PATH;
  writeFileSync(join(sessionDir, `${chatKeyHash}.json`), JSON.stringify(session, null, 2));

  const { createWorkbenchFormalTaskStore } = await import("../src/infra/workbench-formal-task-store.ts");
  const store = createWorkbenchFormalTaskStore();
  const published = store.publishFromSession({
    planId,
    session,
    managerUserId: manager.user_id,
    actorUserId: manager.user_id,
    initiatorDepartment: "管理部",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        taskNo: published.task.taskNo,
        taskId: published.task.taskId,
        planId,
        subtasks: published.subtasks.map((s) => ({
          subtaskId: s.subtaskId,
          title: s.title,
          assigneeUserId: s.assigneeUserId,
          status: s.status,
        })),
      },
      null,
      2,
    ),
  );
  store.close();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
