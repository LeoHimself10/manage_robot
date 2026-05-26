/**
 * 本地复现曹杰场景：预置微导管草案 + 通讯录「李嘉男」，工作台对话测点将→prepare→表渲染。
 *
 *   npm run dev:microcatheter-repro
 *
 * 打开 http://127.0.0.1:8787/workbench → 登录 manager-local-dev → 智能助手
 * 发送：新任务负责人李嘉男。请把全部子任务点将给李嘉男并做发布预览。
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
const LIJIANNAN_ID = "02573051084320";
const LIJIANNAN_NAME = "李嘉男";
const DATA_ROOT = join(process.cwd(), "data", "local-microcatheter-repro");

function mergeLocalManagerWhitelist(): void {
  const ids = new Set<string>();
  (process.env.WORKBENCH_MANAGER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((id) => ids.add(id));
  ids.add(LOCAL_MANAGER_ID);
  process.env.WORKBENCH_MANAGER_USER_IDS = Array.from(ids).join(",");
}

function ensureLocalEnv(resetData: boolean): void {
  if (resetData && existsSync(DATA_ROOT)) rmSync(DATA_ROOT, { recursive: true, force: true });
  mkdirSync(join(DATA_ROOT, "sessions"), { recursive: true });
  mkdirSync(join(DATA_ROOT, "events"), { recursive: true });
  process.env.ASSIGNMENT_PHASE_ENABLED ??= "1";
  process.env.DINGTALK_ROLE_ROUTING_ENABLED ??= "1";
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
  process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ??= "30";
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
    store.upsertContact({
      userId: LIJIANNAN_ID,
      name: LIJIANNAN_NAME,
      departmentIds: ["售后服务部"],
      departmentNames: ["售后服务部"],
      position: "技术总监",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
  } finally {
    store.close();
  }
}

function seedMicrocatheterSession(): void {
  const now = new Date().toISOString();
  const chatKey = canonicalMainChatKey(LOCAL_MANAGER_ID);
  const session: PlanSession = {
    chatKeyHash: hashChatKey(chatKey),
    planId: "local-microcatheter-plan",
    createdAt: now,
    updatedAt: now,
    senderStaffId: LOCAL_MANAGER_ID,
    canonicalUserId: LOCAL_MANAGER_ID,
    threadKind: "main",
    threadId: "main",
    threadLabel: "微导管供应商与双管线决策",
    knownFacts: [],
    conversationHistory: [
      {
        role: "user",
        content:
          "新任务：\n负责人 李嘉男\n任务名称 微导管供应商与双管线决策\n任务内容 获取苏州迈拓Pro18仿制可行性反馈；评估签约；定义激光光纤微导管需求边界。",
        at: now,
      },
    ],
    latestDraft: {
      title: "微导管供应商与双管线决策",
      description:
        "获取苏州迈拓Pro18仿制可行性反馈，评估签约可行性；同步定义激光光纤微导管需求边界，形成明确决策。",
      tasks: [
        {
          id: "task_1",
          title: "获取并评估Pro18仿制可行性",
          objective: "从苏州迈拓获取Pro18仿制的技术反馈，评估技术路径、周期与风险。",
          deliverables: ["《Pro18仿制可行性评估》"],
          completionCriteria: ["获得供应商书面或会议反馈记录", "完成技术可行性分析报告并通过内部评审"],
          feedbackFrequency: "每周",
        },
        {
          id: "task_2",
          title: "定义激光光纤微导管需求边界",
          objective: "明确激光光纤微导管的技术指标、应用场景及验收标准。",
          deliverables: ["《激光光纤微导管需求要点》"],
          completionCriteria: ["完成需求调研与内部讨论", "输出经确认的需求要点文档"],
          feedbackFrequency: "每周",
        },
        {
          id: "task_3",
          title: "综合评估与签约决策",
          objective: "结合可行性评估与需求定义，与李强、曹杰共同决策是否签约及下单。",
          deliverables: ["签约/下单决策建议"],
          completionCriteria: ["召开决策会议并形成会议纪要", "输出明确的决策结论"],
          feedbackFrequency: "每周",
          dependencyTaskIds: ["task_1", "task_2"],
        },
      ],
    },
  };
  createPlanSessionStore().save(session);
}

function printBanner(): void {
  const hasQwen = Boolean(process.env.QWEN_API_KEY?.trim());
  console.log("\n=== 微导管 displayName 本地复现 ===");
  console.log(`数据: ${DATA_ROOT}`);
  console.log(`登录: http://127.0.0.1:${LOCAL_PORT}/workbench  userId=${LOCAL_MANAGER_ID}`);
  console.log(`助手: http://127.0.0.1:${LOCAL_PORT}/workbench/manager/chat?thread=main`);
  console.log("\n建议发送：");
  console.log("  请把当前草案全部子任务点将给李嘉男，并做发布预览，不要发布。");
  console.log("\n验收：助手回复里的「结构化任务表」负责人列应为「李嘉男」，不能是 02573051084320。");
  console.log(hasQwen ? "\n✓ QWEN_API_KEY 已配置" : "\n⚠ 请在 .env 配置 QWEN_API_KEY");
  console.log("Ctrl+C 停止\n");
}

function main(): void {
  const reset = !process.argv.includes("--keep-data");
  ensureLocalEnv(reset);
  execSync("npm run build:workbench-login", { stdio: "inherit" });
  execSync("npm run build:workbench-draft-grid", { stdio: "inherit" });
  seedDirectory();
  seedMicrocatheterSession();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderWorkbenchRootLandingHtml());
      return;
    }
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404);
    res.end("Not Found");
  });
  server.listen(LOCAL_PORT, "127.0.0.1", printBanner);
}

main();
