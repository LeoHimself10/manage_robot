/**
 * 任务快录入库 — 本地浏览器测试（无需钉钉 Stream）
 *
 * PowerShell:
 *   npm run dev:task-intake
 *
 * 登录页选主管 userId，打开侧栏「任务快录入库」或直接访问 task-intake 页。
 */
import { config as loadDotenv } from "dotenv";
import { execSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashChatKey, type PlanSession } from "../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { handleAssignmentHttp } from "../src/web/assignment-workbench";
import { canonicalMainChatKey } from "../src/web/canonical-main-session";

for (const envPath of [
  join(process.cwd(), ".env"),
  join(process.cwd(), "..", "..", ".env"),
]) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    break;
  }
}

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787") || 8787;
/** 普通主管（无 Portfolio，验证「全员可用」门禁） */
const MANAGER_PLAIN_ID = "manager-plain-dev";
/** Portfolio 主管（侧栏多「项目总览 / 会议入库」，预览页可选项目） */
const MANAGER_PORTFOLIO_ID = "manager-portfolio-dev";
const DATA_ROOT = join(process.cwd(), "data", "local-task-intake-dev");

const DEMO_CONTACTS = [
  { userId: "u_zhangsan", name: "张三", dept: "研发部" },
  { userId: "u_lisi", name: "李四", dept: "市场部" },
  { userId: "u_wangwu", name: "王五", dept: "产品部" },
  { userId: "u_zhaoliu", name: "赵六", dept: "运营部" },
] as const;

/** 可直接粘贴到向导第 1 步的示例文本 */
export const SAMPLE_PASTE_FULL_ASSIGNEES = `父任务：6月注册申报准备

1. 整理临床资料 — 负责人：张三 — 截止 2026-06-10
2. 撰写技术要求 — 负责人：李四 — 截止 2026-06-12
3. 提交体系核查申请 — 负责人：王五 — 截止 2026-06-15`;

export const SAMPLE_PASTE_PARTIAL_ASSIGNEES = `父任务：渠道复盘跟进

- 收集各区域销售数据（张三）
- 输出复盘报告初稿
- 组织复盘会议（李四）`;

function buildBundles(): void {
  execSync("npm run build:workbench-login", { stdio: "inherit" });
  execSync("npm run build:workbench-draft-grid", { stdio: "inherit" });
}

function mergeIds(envKey: string, ids: string[]): void {
  const set = new Set<string>();
  const raw = process.env[envKey]?.trim();
  if (raw) {
    raw.split(",").map((s) => s.trim()).filter(Boolean).forEach((id) => set.add(id));
  }
  ids.forEach((id) => set.add(id));
  process.env[envKey] = Array.from(set).join(",");
}

function ensureLocalEnv(resetData: boolean): void {
  if (resetData && existsSync(DATA_ROOT)) {
    rmSync(DATA_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, "sessions"), { recursive: true });
  mkdirSync(join(DATA_ROOT, "events"), { recursive: true });

  process.env.TASK_INTAKE_ENABLED ??= "1";
  process.env.ASSIGNMENT_PHASE_ENABLED ??= "1";
  process.env.WORKBENCH_TEST_LOGIN_ENABLED ??= "1";
  process.env.WORKBENCH_ENFORCE_ACTION_GUARDS ??= "0";
  mergeIds("WORKBENCH_MANAGER_USER_IDS", [MANAGER_PLAIN_ID, MANAGER_PORTFOLIO_ID]);
  mergeIds("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", [MANAGER_PORTFOLIO_ID]);
  process.env.WORKBENCH_SESSION_SECRET ??= "local-dev-session-secret-min-32-chars!!";
  process.env.ASSIGNMENT_WEB_SECRET ??= "local-dev-assignment-secret-min-32-chars!!";
  process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ??= `http://127.0.0.1:${LOCAL_PORT}`;
  process.env.WORKBENCH_SQLITE_PATH ??= join(DATA_ROOT, "workbench.sqlite");
  process.env.PLAN_SESSION_DIR ??= join(DATA_ROOT, "sessions");
  process.env.PLAN_SESSION_EVENTS_PATH ??= join(DATA_ROOT, "events", "plan-session-events.jsonl");
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED ??= "0";
  process.env.FOLLOWUP_REMINDER_ENABLED ??= "0";
  process.env.PROGRESS_DIGEST_ENABLED ??= "0";
}

function seedDirectory(): void {
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = createPeopleDirectoryStore(dbPath);
  try {
    for (const mgr of [
      { userId: MANAGER_PLAIN_ID, name: "普通主管（本地）" },
      { userId: MANAGER_PORTFOLIO_ID, name: "Portfolio主管（本地）" },
    ]) {
      store.upsertContact({
        userId: mgr.userId,
        name: mgr.name,
        departmentNames: ["管理部"],
        departmentIds: ["管理部"],
        active: true,
      });
    }
    for (const c of DEMO_CONTACTS) {
      store.upsertContact({
        userId: c.userId,
        name: c.name,
        departmentNames: [c.dept],
        departmentIds: [c.dept],
        active: true,
      });
    }
  } finally {
    store.close();
  }
}

/** 为主线程预置空会话，便于「缺负责人 → 暂存草案」后跳转点将 */
function seedMainSessions(): void {
  const store = createPlanSessionStore();
  const now = new Date().toISOString();
  for (const userId of [MANAGER_PLAIN_ID, MANAGER_PORTFOLIO_ID]) {
    const chatKey = canonicalMainChatKey(userId);
    store.save({
      chatKeyHash: hashChatKey(chatKey),
      planId: `local-main-${userId}`,
      createdAt: now,
      updatedAt: now,
      senderStaffId: userId,
      canonicalUserId: userId,
      threadKind: "main",
      threadId: "main",
      threadLabel: "主线程",
      conversationHistory: [],
      knownFacts: [],
    } satisfies PlanSession);
  }
}

function printBanner(): void {
  const hasQwen = Boolean(
    process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim(),
  );
  const base = `http://127.0.0.1:${LOCAL_PORT}`;
  console.log("");
  console.log("=== 任务快录入库 · 本地测试 ===");
  console.log(`数据: ${DATA_ROOT}`);
  console.log(`SQLite: ${resolveWorkbenchSqlitePath()}`);
  console.log("");
  console.log("1) 打开登录页（测试登录）");
  console.log(`   ${base}/workbench`);
  console.log(`   普通主管 userId:     ${MANAGER_PLAIN_ID}   （无 Portfolio，侧栏仍有「任务快录入库」）`);
  console.log(`   Portfolio 主管 userId: ${MANAGER_PORTFOLIO_ID} （预览页可选归属项目）`);
  console.log("");
  console.log("2) 任务快录入库向导");
  console.log(`   ${base}/workbench/manager/task-intake`);
  console.log("");
  console.log("3) 建议手测两条路径");
  console.log("   A. 直接发布 — 粘贴示例 A，预览里每条子任务填负责人 userId（张三=u_zhangsan 等），确认录入");
  console.log("   B. 暂存草案 — 粘贴示例 B，留一条子任务负责人为空，确认后点「去点将发布」进 Excel 编辑器");
  console.log("");
  console.log("--- 示例 A（全覆盖负责人，应直接入库正式任务）---");
  console.log(SAMPLE_PASTE_FULL_ASSIGNEES);
  console.log("");
  console.log("--- 示例 B（有缺负责人，应暂存主线程草案）---");
  console.log(SAMPLE_PASTE_PARTIAL_ASSIGNEES);
  console.log("");
  console.log("通讯录 userId 对照: 张三=u_zhangsan 李四=u_lisi 王五=u_wangwu 赵六=u_zhaoliu");
  console.log("");
  if (!hasQwen) {
    console.log("⚠ 未配置 QWEN_API_KEY：解析走「按行拆分」fallback，字段较少，仍可测发布/暂存分支。");
    console.log("  可在仓库根目录 .env 配置 QWEN_API_KEY 后重启，启用 AI 忠实结构化。");
  } else {
    console.log("✓ 已加载 QWEN_API_KEY：解析走 AI 忠实结构化。");
  }
  console.log("");
  console.log("历史任务: " + base + "/workbench/manager/tasks");
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
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`端口 ${LOCAL_PORT} 已被占用。换端口: $env:ASSIGNMENT_WEB_PORT=8788; npm run dev:task-intake`);
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
  seedMainSessions();
  startServer();
}

main();
