/** Independent local acceptance server. Never resets existing data or connects to DingTalk. */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";

const dataRoot = resolve("data/local-ma-quality-workbench");
const port = Number(process.env.MA_WORKBENCH_PORT ?? "8810");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("MA_WORKBENCH_PORT 无效");
if (existsSync(".env")) loadDotenv({ path: ".env", quiet: true });
const settings: Record<string, string> = {
  ASSIGNMENT_WEB_PORT: String(port), ASSIGNMENT_WEB_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  WORKBENCH_TEST_LOGIN_ENABLED: "1", WORKBENCH_SESSION_SECRET: "ma-workbench-local-session-only-secret-20260909",
  ASSIGNMENT_WEB_SECRET: "ma-workbench-local-assignment-only-secret-20260909",
  WORKBENCH_SQLITE_PATH: join(dataRoot, "workbench.sqlite"), PLAN_SESSION_DIR: join(dataRoot, "sessions"),
  PLAN_SESSION_EVENTS_PATH: join(dataRoot, "events", "plan-session-events.jsonl"),
  QUALITY_FILE_DIR: join(dataRoot, "quality-files"), QUALITY_EVIDENCE_DIR: join(dataRoot, "quality-evidence"),
  QUALITY_MA_WORKBENCH_ENABLED: "1", QUALITY_MA_LOCAL_DATA: "1", QUALITY_TASK_PLANNING_V2_ENABLED: "1",
  QUALITY_ROLE_PANELS_ENABLED: "1", QUALITY_TEST_ACTORS_ENABLED: "0", WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED: "0",
  WORKBENCH_MANAGER_USER_IDS: "ma-local,rd-manager-local", QUALITY_AFTERSALES_MANAGER_USER_IDS: "ma-local",
  QUALITY_MANAGEMENT_USER_IDS: "tong-local", WORKBENCH_ADMIN_USER_IDS: "admin-local",
  QUALITY_SOURCE_SYNC_ENABLED: "0", QUALITY_SOURCE_WRITEBACK_ENABLED: "0", QUALITY_NOTIFICATION_WORKER_ENABLED: "0",
  WORKBENCH_DINGTALK_NOTIFY_ENABLED: "0", FOLLOWUP_REMINDER_ENABLED: "0", PROGRESS_DIGEST_ENABLED: "0",
  WORKBENCH_DYNAMIC_MANAGER_IDS_FILE: join(dataRoot, "managers.json"),
  WORKBENCH_PROJECT_PORTFOLIO_IDS_FILE: join(dataRoot, "portfolio-managers.json"),
};
Object.assign(process.env, settings);
for (const dir of [dataRoot, settings.PLAN_SESSION_DIR!, join(dataRoot, "events"), settings.QUALITY_EVIDENCE_DIR!]) mkdirSync(dir, { recursive: true });
const directory = createPeopleDirectoryStore(settings.WORKBENCH_SQLITE_PATH!);
for (const [userId, name, departmentId, departmentName, position] of [
  ["ma-local", "马荣鑫（本地测试）", "aftersales-local", "售后服务部（本地测试）", "项目主管"],
  ["tong-local", "佟成（本地测试）", "quality-local", "质量部（本地测试）", "质量专员"],
  ["rd-manager-local", "研发主管（本地测试）", "rd-local", "软件研发部（本地测试）", "主管"],
  ["rd-one-local", "研发员工一（本地测试）", "rd-local", "软件研发部（本地测试）", "工程师"],
  ["rd-two-local", "研发员工二（本地测试）", "rd-local", "软件研发部（本地测试）", "工程师"],
  ["admin-local", "管理员（本地测试）", "admin-local", "系统管理部（本地测试）", "管理员"],
]) directory.upsertContact({ userId: userId!, name: name!, departmentIds: [departmentId!], departmentNames: [departmentName!], position: position!, active: true, isAdmin: false, isBoss: false, isSenior: false });
directory.close();

const { seedMaQualityWorkbench } = await import("./seed-ma-quality-workbench");
await seedMaQualityWorkbench(settings.WORKBENCH_SQLITE_PATH!);
for (const build of ["build:workbench-login", "build:workbench-draft-grid", "build:performance-chat-markdown"]) execSync(`npm run ${build}`, { stdio: "inherit" });
const { handleAssignmentHttp } = await import("../src/web/assignment-workbench");
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "ma-quality-workbench", baseCommit: "58dab61", localData: true, oaConnected: false }));
    return;
  }
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>马荣鑫工作台 · 本地验收</title><style>body{font:16px/1.7 system-ui;color:#173153;background:#f2f5fa;max-width:620px;margin:12vh auto;padding:32px}button{font:inherit;border:0;border-radius:6px;padding:12px 24px;background:#245fbd;color:white;cursor:pointer}small{display:block;margin-top:24px;color:#60738d}</style><h1>马荣鑫工作台</h1><p>正式功能的独立本地验收版本，使用本地模拟数据。钉钉 OA 接口已预留，尚未连接。</p><button id="enter">进入马荣鑫视角</button><small>基于 9 月 3 日 18:00 版本 · 数据刷新后保留</small><p id="error" role="alert"></p><script>document.getElementById('enter').onclick=async function(){this.disabled=true;try{const r=await fetch('/api/workbench/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'ma-local',role:'manager',next:'/workbench/quality/ma'})});const v=await r.json();if(!r.ok||v.ok===false)throw new Error(v.error||'登录失败');location.href='/workbench/quality/ma'}catch(e){document.getElementById('error').textContent=e.message;this.disabled=false}}</script></html>`);
    return;
  }
  try {
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not Found");
  } catch (error) {
    console.error("Local workbench request failed", error instanceof Error ? error.message : "unknown error");
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("本地请求失败，请查看服务日志");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`马荣鑫工作台已启动：http://127.0.0.1:${port}/ （独立持久数据；OA 待接入）`));
