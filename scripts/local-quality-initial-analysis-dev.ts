/**
 * AI质量初析 V1 独立本地验收服务。
 *
 *   npm run dev:quality-analysis
 *   npm run dev:quality-analysis:keep
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config as loadDotenv } from "dotenv";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { loadQwenQualityAnalysisConfig } from
  "../src/quality/analysis/qwen-quality-analysis-model";
import { createQualityStore } from "../src/quality/infra/quality-store";
import { createQualitySourceSync } from "../src/quality/source/quality-source-sync";

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8797") || 8797;
const SUPERVISOR_ID = "quality-supervisor-local";
const QUALITY_EMPLOYEE_ID = "quality-employee-local";
const QUALITY_MANAGER_ID = "quality-manager-local";
const RD_MANAGER_ID = "rd-manager-local";
const MANUFACTURING_MANAGER_ID = "manufacturing-manager-local";
const ADMIN_ID = "quality-admin-local";
const DATA_ROOT = resolve(process.cwd(), "data", "local-quality-initial-analysis-v1");

function mergeIds(envKey: string, ids: string[]): void {
  const merged = new Set(
    String(process.env[envKey] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
  );
  ids.forEach((id) => merged.add(id));
  process.env[envKey] = [...merged].join(",");
}

function loadProjectModelEnvironment(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    resolve(process.cwd(), "..", "..", "manage_robot", ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: false, quiet: true });
    break;
  }
  // The newer quality adapters accept the project's DashScope-compatible key
  // name, while the existing planner still reads QWEN_API_KEY. Reuse the same
  // in-memory credential so both paths exercise the deployed default model.
  if (!process.env.QWEN_API_KEY?.trim() && process.env.DASHSCOPE_API_KEY?.trim()) {
    process.env.QWEN_API_KEY = process.env.DASHSCOPE_API_KEY;
  }
}

function ensureLocalEnvironment(resetData: boolean): void {
  const expectedRoot = resolve(process.cwd(), "data", "local-quality-initial-analysis-v1");
  if (DATA_ROOT !== expectedRoot) throw new Error("本地AI质量初析数据目录解析异常");
  if (resetData && existsSync(DATA_ROOT)) rmSync(DATA_ROOT, { recursive: true, force: true });
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, "sessions"), { recursive: true });
  mkdirSync(join(DATA_ROOT, "events"), { recursive: true });
  process.env.ASSIGNMENT_WEB_PORT = String(LOCAL_PORT);
  process.env.WORKBENCH_TEST_LOGIN_ENABLED = "1";
  process.env.WORKBENCH_SESSION_SECRET = "local-quality-analysis-session-secret-min-32-chars";
  process.env.ASSIGNMENT_WEB_SECRET = "local-quality-analysis-assignment-secret-min-32-chars";
  process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = `http://127.0.0.1:${LOCAL_PORT}`;
  process.env.WORKBENCH_SQLITE_PATH = join(DATA_ROOT, "workbench.sqlite");
  process.env.PLAN_SESSION_DIR = join(DATA_ROOT, "sessions");
  process.env.PLAN_SESSION_EVENTS_PATH = join(DATA_ROOT, "events", "plan-session-events.jsonl");
  process.env.QUALITY_SOURCE_SYNC_ENABLED = "0";
  process.env.QUALITY_SOURCE_WRITEBACK_ENABLED = "0";
  process.env.QUALITY_NOTIFICATION_WORKER_ENABLED = "0";
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
  process.env.FOLLOWUP_REMINDER_ENABLED = "0";
  process.env.PROGRESS_DIGEST_ENABLED = "0";
  mergeIds("WORKBENCH_MANAGER_USER_IDS", [
    SUPERVISOR_ID,
    QUALITY_MANAGER_ID,
    RD_MANAGER_ID,
    MANUFACTURING_MANAGER_ID,
  ]);
  mergeIds("QUALITY_AFTERSALES_MANAGER_USER_IDS", [SUPERVISOR_ID]);
  mergeIds("QUALITY_MANAGEMENT_USER_IDS", [QUALITY_EMPLOYEE_ID]);
  mergeIds("WORKBENCH_ADMIN_USER_IDS", [ADMIN_ID]);
}

function seedDirectory(): void {
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const directory = createPeopleDirectoryStore(dbPath);
  const save = (
    userId: string,
    name: string,
    departmentId: string,
    departmentName: string,
    position: string,
  ) => directory.upsertContact({
    userId,
    name,
    departmentIds: [departmentId],
    departmentNames: [departmentName],
    position,
    active: true,
    isAdmin: false,
    isBoss: false,
    isSenior: false,
  });
  try {
    save(SUPERVISOR_ID, "项目主管（本地）", "dept-aftersales", "售后服务部", "项目主管");
    save(QUALITY_EMPLOYEE_ID, "质量专员（本地）", "dept-quality", "质量部", "质量专员");
    save(QUALITY_MANAGER_ID, "质量部主管（本地）", "dept-quality", "质量部", "主管");
    save(RD_MANAGER_ID, "研发部主管（本地）", "dept-rd", "研发部", "主管");
    save("rd-engineer-local", "研发工程师（本地）", "dept-rd", "研发部", "研发工程师");
    save(MANUFACTURING_MANAGER_ID, "制造部主管（本地）", "dept-manufacturing", "制造部", "主管");
    save("manufacturing-engineer-local", "制造工程师（本地）", "dept-manufacturing", "制造部", "制造工程师");
    save("clinical-engineer-local", "临床支持工程师（本地）", "dept-clinical", "临床支持部", "临床支持");
    save(ADMIN_ID, "系统管理员（本地）", "dept-admin", "系统管理部", "管理员");
  } finally {
    directory.close();
  }
}

async function seedQualitySource(): Promise<void> {
  const dbPath = resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const sync = createQualitySourceSync({
    dbPath,
    reader: {
      readFirstSheet: async () => ({
        sheetId: "local-quality-analysis-sheet",
        sheetName: "客户端问题反馈记录表",
        rows: [
          ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "报损导管批次", "问题描述", "术者是否可以感知", "对术者造成的影响", "确认情况"],
          ["2026-08-24 09:10", "QAI-V1-001", "本地客户", "OCT-M3", "SN-QAI-001", "B-QAI-001", "导管术中明显弯折并导致操作暂停，更换导管后恢复；退回实物与批次记录待质量调查", "可以感知", "操作暂停约十分钟并更换导管", "售后已与反馈人员确认"],
        ],
      }),
    },
  });
  try {
    await sync.syncNow();
  } finally {
    sync.close();
  }
}

function hasQualitySource(): boolean {
  const db = new DatabaseSync(resolveWorkbenchSqlitePath(), { readOnly: true });
  try {
    return Number((db.prepare("SELECT COUNT(*) AS count FROM quality_source_rows").get() as { count: number }).count) > 0;
  } finally {
    db.close();
  }
}

function printBanner(): void {
  const base = `http://127.0.0.1:${LOCAL_PORT}`;
  const model = loadQwenQualityAnalysisConfig();
  console.log("");
  console.log("=== AI质量初析 V1 · 独立本地服务 ===");
  console.log(`健康检查: ${base}/health`);
  console.log(`登录页: ${base}/workbench`);
  console.log(`质量处理中心: ${base}/workbench/quality`);
  console.log(`普通主管 userId: ${RD_MANAGER_ID}`);
  console.log(`项目主管 userId: ${SUPERVISOR_ID}`);
  console.log("普通员工 userId: rd-engineer-local");
  console.log(`质量专员 userId: ${QUALITY_EMPLOYEE_ID}`);
  console.log(`质量部首责主管 userId: ${QUALITY_MANAGER_ID}`);
  console.log(`管理员（五视角只读）userId: ${ADMIN_ID}`);
  console.log("预置反馈: QAI-V1-001");
  console.log(`项目默认Qwen配置: ${model ? `已加载（${model.clientConfig.model}）` : "未配置，仍可走人工初析"}`);
  console.log(`隔离数据目录: ${DATA_ROOT}`);
  console.log("钉钉同步、表格回写、通知发送和后台定时任务均已禁用。Ctrl+C 停止。");
  console.log("");
}

async function main(): Promise<void> {
  loadProjectModelEnvironment();
  const resetData = !process.argv.includes("--keep-data");
  ensureLocalEnvironment(resetData);
  // The existing workbench captures its planner model config at module load,
  // so import it only after the project environment and compatibility alias
  // have been applied.
  const { handleAssignmentHttp } = await import("../src/web/assignment-workbench");
  execSync("npm run build:workbench-login", { stdio: "inherit" });
  execSync("npm run build:workbench-draft-grid", { stdio: "inherit" });
  seedDirectory();
  if (resetData || !hasQualitySource()) await seedQualitySource();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        service: "quality-initial-analysis-v1",
        port: LOCAL_PORT,
        qwenConfigured: Boolean(loadQwenQualityAnalysisConfig()),
      }));
      return;
    }
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });
  server.listen(LOCAL_PORT, "127.0.0.1", printBanner);
}

void main();
