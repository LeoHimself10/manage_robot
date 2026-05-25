/**
 * Local dev server for external executor web login (no DingTalk Stream / Qwen required).
 *
 * Usage (PowerShell):
 *   npm run dev:external-workbench
 *
 * Then open: http://127.0.0.1:8787/workbench/external/login
 * Accounts: wuchuanbin / qushaozhi  Password: LocalTest1238 (override via EXTERNAL_EXECUTOR_INITIAL_PASSWORD)
 */
import "dotenv/config";
import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { EXTERNAL_CONTACT_SOURCE } from "../src/infra/external-contact";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { handleAssignmentHttp } from "../src/web/assignment-workbench";
import { renderWorkbenchRootLandingHtml } from "../src/web/workbench-landing";

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787") || 8787;
const LOCAL_PASSWORD = String(process.env.EXTERNAL_EXECUTOR_INITIAL_PASSWORD ?? "LocalTest1238").trim();
const LOCAL_MANAGER_ID = "manager-local-dev";
const DEMO_PLAN_ID = "local-ext-demo-plan";

const EXECUTORS = [
  {
    userId: "ext_wuchuanbin",
    username: "wuchuanbin",
    displayName: "武传宾",
    department: "学术推广与品牌宣传",
  },
  {
    userId: "ext_qu_shaozhi",
    username: "qushaozhi",
    displayName: "曲绍志",
    department: "临床推进",
  },
] as const;

function ensureLocalEnv(): void {
  process.env.WORKBENCH_EXTERNAL_LOGIN_ENABLED ??= "1";
  process.env.WORKBENCH_TEST_LOGIN_ENABLED ??= "1";
  process.env.WORKBENCH_MANAGER_USER_IDS ??= LOCAL_MANAGER_ID;
  process.env.WORKBENCH_SESSION_SECRET ??= "local-dev-session-secret-min-32-chars!!";
  process.env.ASSIGNMENT_WEB_SECRET ??= "local-dev-assignment-secret-min-32-chars!!";
  process.env.WORKBENCH_SQLITE_PATH ??= "./data/local-external-dev/workbench.sqlite";
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED ??= "0";
  process.env.FOLLOWUP_REMINDER_ENABLED ??= "0";
}

function seedDirectory(): void {
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = createPeopleDirectoryStore(dbPath);
  try {
    store.upsertContact({
      userId: LOCAL_MANAGER_ID,
      name: "本地测试主管",
      departmentIds: ["管理部"],
      departmentNames: ["管理部"],
      position: "Manager",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    for (const row of EXECUTORS) {
      store.upsertContact({
        userId: row.userId,
        name: row.displayName,
        departmentIds: [row.department],
        departmentNames: [row.department],
        position: row.department,
        active: true,
        isAdmin: false,
        isBoss: false,
        isSenior: false,
        rawJson: { source: EXTERNAL_CONTACT_SOURCE },
      });
      const existingAccount = store.getExternalAccountByUserId(row.userId);
      store.upsertExternalAccount({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        enabled: true,
        ...(existingAccount
          ? { passwordHash: existingAccount.passwordHash }
          : { password: LOCAL_PASSWORD }),
      });
    }
  } finally {
    store.close();
  }
}

function seedDemoPublishedTask(): { taskNo: string } {
  const now = new Date().toISOString();
  const session: PlanSession = {
    chatKeyHash: "local-ext-demo",
    planId: DEMO_PLAN_ID,
    createdAt: now,
    updatedAt: now,
    senderStaffId: LOCAL_MANAGER_ID,
    knownFacts: [],
    conversationHistory: [{ role: "user", content: "本地外部执行者测试任务" }],
    latestDraft: {
      title: "本地测试：外部执行者承接",
      description: "用于验证外部账号登录、待承接、接受与进展填写。",
      tasks: [
        { id: "task-1", title: "武传宾负责子任务", deliverables: "完成宣传方案初稿" },
        { id: "task-2", title: "曲绍志负责子任务", deliverables: "完成临床推进联络记录" },
      ],
    },
    latestAssignment: {
      assignments: [
        {
          taskId: "task-1",
          primary: { userId: "ext_wuchuanbin", displayName: "武传宾" },
        },
        {
          taskId: "task-2",
          primary: { userId: "ext_qu_shaozhi", displayName: "曲绍志" },
        },
      ],
    },
  };
  const taskStore = createWorkbenchFormalTaskStore();
  const published = taskStore.publishFromSession({
    planId: DEMO_PLAN_ID,
    session,
    managerUserId: LOCAL_MANAGER_ID,
    initiatorDepartment: "管理部",
    actorUserId: LOCAL_MANAGER_ID,
    actorName: "本地测试主管",
  });
  return { taskNo: published.task.taskNo };
}

function startServer(): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      if (req.method === "HEAD") res.end();
      else res.end("ok");
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") res.end();
      else res.end(renderWorkbenchRootLandingHtml());
      return;
    }
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });
  server.listen(LOCAL_PORT, "127.0.0.1", () => {
    console.log("");
    console.log("=== 外部执行者本地测试环境已就绪 ===");
    console.log(`SQLite: ${resolveWorkbenchSqlitePath()}`);
    console.log("");
    console.log("外部登录（推荐）:");
    console.log(`  http://127.0.0.1:${LOCAL_PORT}/workbench/external/login`);
    console.log("  账号: wuchuanbin 或 qushaozhi");
    console.log(`  密码: ${LOCAL_PASSWORD}`);
    console.log("");
    console.log("主管测试登录（可选）:");
    console.log(`  http://127.0.0.1:${LOCAL_PORT}/workbench`);
    console.log(`  userId: ${LOCAL_MANAGER_ID}  身份: 主管`);
    console.log("");
    console.log("员工工作台（登录后）:");
    console.log(`  http://127.0.0.1:${LOCAL_PORT}/workbench/employee?view=new`);
    console.log("");
    console.log("按 Ctrl+C 停止服务");
    console.log("");
  });
}

function main(): void {
  if (LOCAL_PASSWORD.length < 8) {
    console.error("EXTERNAL_EXECUTOR_INITIAL_PASSWORD must be at least 8 characters");
    process.exit(1);
  }
  ensureLocalEnv();
  seedDirectory();
  const { taskNo } = seedDemoPublishedTask();
  console.log(`[local-external-workbench] demo task published: ${taskNo}`);
  startServer();
}

main();
