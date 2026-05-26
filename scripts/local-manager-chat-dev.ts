/**
 * Local dev server for manager chat + Excel draft UX (browser testing, no DingTalk Stream).
 *
 * Usage (PowerShell):
 *   copy .env.example .env   # fill QWEN_API_KEY for send / Excel Agent revise
 *   npm run dev:manager-chat
 *
 * Open:
 *   http://127.0.0.1:8787/workbench  → test login → manager-local-dev
 *   http://127.0.0.1:8787/workbench/manager/chat?thread=main
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashChatKey, type PlanSession } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { handleAssignmentHttp } from "../src/web/assignment-workbench";
import { renderWorkbenchRootLandingHtml } from "../src/web/workbench-landing";
import { canonicalMainChatKey } from "../src/web/canonical-main-session";

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787") || 8787;
const LOCAL_MANAGER_ID = "manager-local-dev";
const DATA_ROOT = join(process.cwd(), "data", "local-manager-chat-dev");
const LOCAL_PLAN_ID = "local-chat-ux-demo-plan";

const DEMO_CONTACTS = [
  { userId: "u_zhangsan", name: "张三", dept: "华东区" },
  { userId: "u_lisi", name: "李四", dept: "市场部" },
  { userId: "u_wangwu", name: "王五", dept: "研发部" },
  { userId: "u_zhaoliu", name: "赵六", dept: "产品部" },
  { userId: "u_sunqi", name: "孙七", dept: "运营部" },
  { userId: "u_zhouba", name: "周八", dept: "学术推广与品牌宣传" },
  { userId: "u_wu_jiu", name: "吴九", dept: "临床推进" },
  { userId: "u_zhengshi", name: "郑十", dept: "质量管理部" },
  { userId: "u_wangfang", name: "王芳", dept: "运营" },
  { userId: "u_wanglei", name: "王磊", dept: "研发" },
] as const;

function buildBundles(): void {
  execSync("npm run build:workbench-login", { stdio: "inherit" });
  execSync("npm run build:workbench-draft-grid", { stdio: "inherit" });
}

function mergeLocalManagerWhitelist(): void {
  const ids = new Set<string>();
  const raw = process.env.WORKBENCH_MANAGER_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => ids.add(id));
  }
  ids.add(LOCAL_MANAGER_ID);
  process.env.WORKBENCH_MANAGER_USER_IDS = Array.from(ids).join(",");
}

function ensureLocalEnv(resetData: boolean): void {
  if (resetData && existsSync(DATA_ROOT)) {
    rmSync(DATA_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, "sessions"), { recursive: true });
  mkdirSync(join(DATA_ROOT, "events"), { recursive: true });

  process.env.ASSIGNMENT_PHASE_ENABLED ??= "1";
  process.env.WORKBENCH_TEST_LOGIN_ENABLED ??= "1";
  mergeLocalManagerWhitelist();
  process.env.WORKBENCH_SESSION_SECRET ??= "local-dev-session-secret-min-32-chars!!";
  process.env.ASSIGNMENT_WEB_SECRET ??= "local-dev-assignment-secret-min-32-chars!!";
  process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ??= `http://127.0.0.1:${LOCAL_PORT}`;
  process.env.WORKBENCH_SQLITE_PATH ??= join(DATA_ROOT, "workbench.sqlite");
  process.env.PLAN_SESSION_DIR ??= join(DATA_ROOT, "sessions");
  process.env.PLAN_SESSION_EVENTS_PATH ??= join(DATA_ROOT, "events", "plan-session-events.jsonl");
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED ??= "0";
  process.env.FOLLOWUP_REMINDER_ENABLED ??= "0";
  process.env.PROGRESS_DIGEST_ENABLED ??= "0";
  process.env.DINGTALK_QWEN_THINKING ??= "0";
  process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ??= "6";
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
    for (const c of DEMO_CONTACTS) {
      store.upsertContact({
        userId: c.userId,
        name: c.name,
        departmentIds: [c.dept],
        departmentNames: [c.dept],
        position: "Employee",
        active: true,
        isAdmin: false,
        isBoss: false,
        isSenior: false,
      });
    }
  } finally {
    store.close();
  }
}

function seedMainChatSession(): void {
  const now = new Date().toISOString();
  const chatKey = canonicalMainChatKey(LOCAL_MANAGER_ID);
  const session: PlanSession = {
    chatKeyHash: hashChatKey(chatKey),
    planId: LOCAL_PLAN_ID,
    createdAt: now,
    updatedAt: now,
    senderStaffId: LOCAL_MANAGER_ID,
    canonicalUserId: LOCAL_MANAGER_ID,
    threadKind: "main",
    threadId: "main",
    threadLabel: "Q2 渠道复盘",
    knownFacts: ["本次为本地 UI 测试数据，可直接编辑草案表格。"],
    conversationHistory: [
      {
        role: "user",
        content: "帮我做 Q2 渠道复盘，要含数据收集、分析和汇报三块。",
        at: new Date(Date.now() - 120_000).toISOString(),
      },
      {
        role: "assistant",
        content:
          "已拆成 5 条子任务。可在右侧查看草案摘要，或点「编辑草案表格」修改字段；也可在下方继续对话。",
        at: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    latestDraft: {
      title: "Q2 渠道复盘",
      description: "本地测试：验证智能助手三栏布局、Excel 弹窗、联系人 1 字搜索。",
      tasks: [
        {
          id: "task_1",
          title: "收集各区域 Q2 销售数据",
          objective: "汇总各区域销售明细",
          deliverables: ["Excel 汇总表"],
          completionCriteria: ["数据已上传共享盘"],
          timeNode: { dueAt: "2026-06-10" },
          actions: ["拉取 CRM 导出"],
        },
        {
          id: "task_2",
          title: "竞品渠道对比分析",
          objective: "完成竞品渠道差异分析",
          deliverables: ["对比报告"],
          completionCriteria: ["报告经主管确认"],
          timeNode: { dueAt: "2026-06-15" },
        },
        {
          id: "task_3",
          title: "汇报材料撰写",
          objective: "形成 Q2 复盘汇报 PPT",
          deliverables: ["PPT 初稿"],
          completionCriteria: ["可对外汇报"],
          timeNode: { dueAt: "2026-06-20" },
        },
        {
          id: "task_4",
          title: "渠道异常项跟进",
          objective: "列出异常渠道并跟进",
          deliverables: ["异常清单"],
          completionCriteria: ["每条有负责人"],
          timeNode: { dueAt: "2026-06-18" },
        },
        {
          id: "task_5",
          title: "复盘会组织",
          objective: "组织复盘会并收集结论",
          deliverables: ["会议纪要"],
          completionCriteria: ["结论已归档"],
          timeNode: { dueAt: "2026-06-25" },
        },
      ],
    },
    latestAssignment: {
      assignments: [
        {
          taskId: "task_1",
          primary: { userId: "u_lisi", displayName: "李四" },
          confidence: "HIGH",
        },
        {
          taskId: "task_3",
          primary: { userId: "u_zhangsan", displayName: "张三" },
          confidence: "HIGH",
        },
      ],
    },
  };
  createPlanSessionStore().save(session);
}

function printBanner(): void {
  const hasQwen = Boolean(process.env.QWEN_API_KEY?.trim());
  console.log("");
  console.log("=== 智能助手 + Excel 本地测试环境 ===");
  console.log(`数据目录: ${DATA_ROOT}`);
  console.log(`SQLite:   ${resolveWorkbenchSqlitePath()}`);
  console.log("");
  console.log("1) 浏览器打开登录页");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench`);
  console.log(`   userId: ${LOCAL_MANAGER_ID}  身份: 自动判定（推荐）或 主管`);
  console.log(`   （脚本已强制将 ${LOCAL_MANAGER_ID} 并入 WORKBENCH_MANAGER_USER_IDS）`);
  console.log("");
  console.log("2) 智能规划助手（主线程，已预置草案 + 2 条历史消息）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/chat?thread=main`);
  console.log("");
  console.log("3) 历史任务 / 改派（联系人 1 字搜索）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/tasks`);
  console.log("");
  console.log("4) UI 预览稿（静态 HTML，无需服务）");
  console.log("   docs/mockups/manager-chat-excel-ux-preview.html");
  console.log("");
  if (!hasQwen) {
    console.log("⚠ 未检测到 QWEN_API_KEY：布局/Excel/改派搜索可测；发送消息与 Excel Agent 校验会失败。");
    console.log("  请在 .env 中配置 QWEN_API_KEY 后重启本服务。");
  } else {
    console.log("✓ QWEN_API_KEY 已配置：可测试发送消息与 Excel「提交修改（Agent 校验）」。");
  }
  console.log("");
  console.log("测试清单见: docs/local-test-workbench-excel-chat-ux.md");
  console.log("按 Ctrl+C 停止");
  console.log("");
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
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error("");
      console.error(`端口 ${LOCAL_PORT} 已被占用。请先停止占用进程，或换端口启动：`);
      console.error(`  PowerShell: $env:ASSIGNMENT_WEB_PORT=8788; npm run dev:manager-chat`);
      console.error("");
      process.exit(1);
    }
    throw err;
  });
  server.listen(LOCAL_PORT, "127.0.0.1", printBanner);
}

function main(): void {
  const reset = !process.argv.includes("--keep-data");
  ensureLocalEnv(reset);
  buildBundles();
  seedDirectory();
  seedMainChatSession();
  startServer();
}

main();
