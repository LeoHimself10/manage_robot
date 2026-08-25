/**
 * 质量正式处置与通报 V1 本地验收服务。
 *
 *   npm run dev:quality-disposition
 *   npm run dev:quality-disposition:keep
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { createQualityStore } from "../src/quality/infra/quality-store";
import { createQualitySourceSync } from "../src/quality/source/quality-source-sync";
import { handleAssignmentHttp } from "../src/web/assignment-workbench";

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8796") || 8796;
const LOCAL_MANAGER_ID = "quality-manager-local";
const LOCAL_SPECIALIST_ID = "quality-specialist-local";
const DATA_ROOT = resolve(process.cwd(), "data", "local-quality-disposition-v1");

function mergeIds(envKey: string, ids: string[]): void {
  const merged = new Set(
    String(process.env[envKey] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
  );
  ids.forEach((id) => merged.add(id));
  process.env[envKey] = [...merged].join(",");
}

function ensureLocalEnvironment(resetData: boolean): void {
  const expectedRoot = resolve(process.cwd(), "data", "local-quality-disposition-v1");
  if (DATA_ROOT !== expectedRoot) throw new Error("本地质量验收数据目录解析异常");
  if (resetData && existsSync(DATA_ROOT)) {
    rmSync(DATA_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, "sessions"), { recursive: true });
  mkdirSync(join(DATA_ROOT, "events"), { recursive: true });
  process.env.ASSIGNMENT_WEB_PORT = String(LOCAL_PORT);
  process.env.WORKBENCH_TEST_LOGIN_ENABLED = "1";
  process.env.WORKBENCH_SESSION_SECRET = "local-quality-session-secret-min-32-chars";
  process.env.ASSIGNMENT_WEB_SECRET = "local-quality-assignment-secret-min-32-chars";
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
  mergeIds("WORKBENCH_MANAGER_USER_IDS", [LOCAL_MANAGER_ID]);
  mergeIds("QUALITY_AFTERSALES_MANAGER_USER_IDS", [LOCAL_MANAGER_ID]);
  mergeIds("QUALITY_SPECIALIST_USER_IDS", [LOCAL_SPECIALIST_ID]);
}

function seedDirectory(): void {
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const directory = createPeopleDirectoryStore(dbPath);
  try {
    directory.upsertContact({
      userId: LOCAL_MANAGER_ID,
      name: "质量处置主管（本地）",
      departmentIds: ["售后服务部"],
      departmentNames: ["售后服务部"],
      position: "主管",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    directory.upsertContact({
      userId: LOCAL_SPECIALIST_ID,
      name: "质量专员（本地）",
      departmentIds: ["质量部"],
      departmentNames: ["质量部"],
      position: "质量专员",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
  } finally {
    directory.close();
  }
}

async function seedQualitySources(): Promise<void> {
  const dbPath = resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const sync = createQualitySourceSync({
    dbPath,
    reader: {
      readFirstSheet: async () => ({
        sheetId: "local-quality-disposition-sheet",
        sheetName: "客户端问题反馈记录表",
        rows: [
          ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "报损导管批次", "问题描述", "术者是否可以感知", "对术者造成的影响", "确认情况"],
          ["2026-08-23 09:00", "QLOCAL-ORD", "本地客户甲", "OCT-M1", "SN-ORD-001", "B-ORD-001", "咨询设备清洁周期，设备与导管工作正常", "无异常感知", "无现场影响", "已确认是使用咨询"],
          ["2026-08-23 10:00", "QLOCAL-INFO", "本地客户乙", "OCT-M2", "SN-INFO-001", "B-INFO-001", "反馈图像短暂闪烁，尚未提供现场日志和原始图像", "可以感知", "影响程度待补充", "尚待补充现场资料"],
          ["2026-08-23 11:00", "QLOCAL-ANOM", "本地客户丙", "OCT-M3", "SN-ANOM-001", "B-ANOM-001", "导管术中明显弯折并导致操作暂停，已更换导管", "可以感知", "操作暂停并更换导管", "已与反馈人员确认"],
          ["2026-08-23 12:00", "QLOCAL-FRESH", "本地客户丁", "OCT-M4", "SN-FRESH-001", "B-FRESH-001", "备用的未研判反馈，供人工继续验收", "无", "无", "已确认"],
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

function hasQualitySources(): boolean {
  const dbPath = resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM quality_source_rows").get() as {
      count: number;
    };
    return Number(row.count) > 0;
  } finally {
    db.close();
  }
}

function printBanner(): void {
  const base = `http://127.0.0.1:${LOCAL_PORT}`;
  console.log("");
  console.log("=== 质量正式处置与通报 V1 · 独立本地服务 ===");
  console.log(`数据目录: ${DATA_ROOT}`);
  console.log(`SQLite: ${resolveWorkbenchSqlitePath()}`);
  console.log(`登录页: ${base}/workbench`);
  console.log(`质量处理中心: ${base}/workbench/quality`);
  console.log(`主管 userId: ${LOCAL_MANAGER_ID}`);
  console.log(`质量专员 userId: ${LOCAL_SPECIALIST_ID}`);
  console.log("预置反馈: QLOCAL-ORD / QLOCAL-INFO / QLOCAL-ANOM / QLOCAL-FRESH");
  console.log("钉钉来源同步、表格回写与通知均已禁用；不会连接线上服务。");
  console.log("Ctrl+C 停止");
  console.log("");
}

async function main(): Promise<void> {
  const resetData = !process.argv.includes("--keep-data");
  ensureLocalEnvironment(resetData);
  execSync("npm run build:workbench-login", { stdio: "inherit" });
  execSync("npm run build:workbench-draft-grid", { stdio: "inherit" });
  seedDirectory();
  if (resetData || !hasQualitySources()) await seedQualitySources();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });
  server.listen(LOCAL_PORT, "127.0.0.1", printBanner);
}

void main();
