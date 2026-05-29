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
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../src/infra/plan-session-store";
import { handleAssignmentHttp } from "../src/web/assignment-workbench";
import { renderWorkbenchRootLandingHtml } from "../src/web/workbench-landing";
import { canonicalMainChatKey } from "../src/web/canonical-main-session";

const LOCAL_PORT = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787") || 8787;
const LOCAL_MANAGER_ID = "manager-local-dev";
const LOCAL_ADMIN_ID = "admin-local-dev";
const LOCAL_EMPLOYEE_ID = "u_lisi";
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

function mergePortfolioWhitelist(): void {
  const ids = new Set<string>();
  const raw = process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => ids.add(id));
  }
  ids.add(LOCAL_MANAGER_ID);
  process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = Array.from(ids).join(",");
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

function mergeLocalAdminWhitelist(): void {
  const ids = new Set<string>();
  const raw = process.env.WORKBENCH_ADMIN_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => ids.add(id));
  }
  ids.add(LOCAL_ADMIN_ID);
  process.env.WORKBENCH_ADMIN_USER_IDS = Array.from(ids).join(",");
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
  process.env.WORKBENCH_ENFORCE_ACTION_GUARDS ??= "1";
  mergeLocalManagerWhitelist();
  mergePortfolioWhitelist();
  mergeLocalAdminWhitelist();
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
    store.upsertContact({
      userId: LOCAL_ADMIN_ID,
      name: "本地测试管理员",
      departmentIds: ["管理部"],
      departmentNames: ["管理部"],
      position: "Admin",
      active: true,
      isAdmin: true,
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

function findProjectByName(
  store: ReturnType<typeof createWorkbenchFormalTaskStore>,
  ownerUserId: string,
  name: string,
) {
  return store.listProjectsForOwner(ownerUserId).find((p) => p.name === name && p.status === "active");
}

function findOrCreateProject(
  store: ReturnType<typeof createWorkbenchFormalTaskStore>,
  input: { ownerUserId: string; name: string; description?: string },
) {
  const hit = findProjectByName(store, input.ownerUserId, input.name);
  if (hit) return hit;
  return store.createProject({
    ownerUserId: input.ownerUserId,
    name: input.name,
    description: input.description,
  });
}

function seedDashboardFormalTasks(): string {
  const store = createWorkbenchFormalTaskStore();
  const planId = "local-weekly-dashboard-demo-plan";
  const existing = store.getTaskDetail(planId);
  if (existing?.task?.taskNo) {
    return existing.task.taskNo;
  }
  const now = new Date().toISOString();
  const session: PlanSession = {
    chatKeyHash: hashChatKey("local-weekly-dashboard-demo"),
    planId,
    createdAt: now,
    updatedAt: now,
    senderStaffId: LOCAL_MANAGER_ID,
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: "周度 Dashboard 演示任务",
      description: "本地 Dashboard 测试数据：覆盖待承接、执行中、阻塞和下周到期。",
      tasks: [
        { id: "dash_1", title: "整理周会关键指标", objective: "形成可投屏指标", deliverables: "指标表", completionCriteria: "主管可直接汇报", timeNode: { dueAt: "2026-05-27" } },
        { id: "dash_2", title: "确认跨部门依赖", objective: "清掉交付阻塞", deliverables: "依赖清单", completionCriteria: "每项有责任人与日期", timeNode: { dueAt: "2026-05-29" } },
        { id: "dash_3", title: "准备下周风险预案", objective: "提前识别风险", deliverables: "风险预案", completionCriteria: "下周一可评审", timeNode: { dueAt: "2026-06-02" } },
      ],
    },
    latestAssignment: {
      assignments: [
        { taskId: "dash_1", primary: { userId: "u_lisi", displayName: "李四" } },
        { taskId: "dash_2", primary: { userId: "u_zhangsan", displayName: "张三" } },
        { taskId: "dash_3", primary: { userId: "u_wangwu", displayName: "王五" } },
      ],
    },
  };
  const published = store.publishFromSession({
    planId,
    session,
    managerUserId: LOCAL_MANAGER_ID,
    initiatorDepartment: "本地测试",
    actorUserId: LOCAL_MANAGER_ID,
  });
  const subtasks = published.subtasks;
  if (subtasks[0]) {
    store.updateSubtaskStatus({ subtaskId: subtasks[0].subtaskId, actorUserId: "u_lisi", action: "accept" });
    store.appendTaskEvent({
      taskId: published.task.taskId,
      subtaskId: subtasks[0].subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "u_lisi",
      note: "指标已整理 80%",
      payload: { progressStatus: "IN_PROGRESS" },
      occurredAt: "2026-05-27T02:00:00.000Z",
    });
  }
  if (subtasks[1]) {
    store.updateSubtaskStatus({ subtaskId: subtasks[1].subtaskId, actorUserId: "u_zhangsan", action: "accept" });
    store.updateSubtaskStatus({ subtaskId: subtasks[1].subtaskId, actorUserId: "u_zhangsan", action: "progress", progressStatus: "BLOCKED", note: "等待市场部数据" });
  }
  if (subtasks[2]) {
    store.appendTaskEvent({
      taskId: published.task.taskId,
      subtaskId: subtasks[2].subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "u_wangwu",
      note: "预案框架已完成",
      payload: { progressStatus: "DONE" },
      occurredAt: "2026-05-26T08:00:00.000Z",
    });
  }
  return published.task.taskNo;
}

/** Portfolio UX v2: 预置 2 个项目 + 1 条未归类正式任务，便于手测按项目归档视图。 */
function seedPortfolioDemo(dashboardTaskNo: string): void {
  const store = createWorkbenchFormalTaskStore();
  const channel = findOrCreateProject(store, {
    ownerUserId: LOCAL_MANAGER_ID,
    name: "Q2 渠道复盘",
    description: "本地 Portfolio 演示：含执行中与阻塞子任务",
  });
  if (dashboardTaskNo) {
    try {
      store.setTaskProject({
        taskNo: dashboardTaskNo,
        managerUserId: LOCAL_MANAGER_ID,
        projectId: channel.projectId,
      });
    } catch {
      /* already assigned or task missing */
    }
  }

  findOrCreateProject(store, {
    ownerUserId: LOCAL_MANAGER_ID,
    name: "微导管上市准备",
    description: "用于测试项目总览卡片跳转与范围筛选",
  });

  const planId = "local-portfolio-unassigned-plan";
  if (store.getTaskDetail(planId)?.task) {
    return;
  }
    const session: PlanSession = {
      chatKeyHash: hashChatKey("local-portfolio-unassigned"),
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: LOCAL_MANAGER_ID,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "未归类演示任务",
        description: "默认落在「未归类」，用于测试批量归入项目。",
        tasks: [
          {
            id: "un_1",
            title: "补充竞品渠道材料",
            objective: "收集竞品资料",
            deliverables: ["材料包"],
            completionCriteria: ["主管确认"],
            timeNode: { dueAt: "2026-06-05" },
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "un_1", primary: { userId: "u_lisi", displayName: "李四" } }],
      },
    };
    store.publishFromSession({
      planId,
      session,
      managerUserId: LOCAL_MANAGER_ID,
      initiatorDepartment: "本地测试",
      actorUserId: LOCAL_MANAGER_ID,
    });
}

function publishDemoTask(input: {
  planId: string;
  title: string;
  description: string;
  tasks: Array<{ id: string; title: string; dueAt: string }>;
  assignments: Array<{ taskId: string; userId: string; displayName: string }>;
  projectId?: string;
}): string {
  const store = createWorkbenchFormalTaskStore();
  const existing = store.getTaskDetail(input.planId);
  if (existing?.task) return existing.task.taskNo;
  const now = new Date().toISOString();
  const session: PlanSession = {
    chatKeyHash: hashChatKey(`local-dash-${input.planId}`),
    planId: input.planId,
    createdAt: now,
    updatedAt: now,
    senderStaffId: LOCAL_MANAGER_ID,
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: input.title,
      description: input.description,
      tasks: input.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        objective: t.title,
        deliverables: "交付物",
        completionCriteria: "主管确认",
        timeNode: { dueAt: t.dueAt },
      })),
    },
    latestAssignment: {
      assignments: input.assignments.map((a) => ({
        taskId: a.taskId,
        primary: { userId: a.userId, displayName: a.displayName },
      })),
    },
  };
  const published = store.publishFromSession({
    planId: input.planId,
    session,
    managerUserId: LOCAL_MANAGER_ID,
    initiatorDepartment: "本地测试",
    actorUserId: LOCAL_MANAGER_ID,
    projectId: input.projectId ?? null,
  });
  return published.task.taskNo;
}

/** 额外 Dashboard 演示任务：多任务、多项目、多人员。 */
function seedExtraDashboardTasks(): void {
  const store = createWorkbenchFormalTaskStore();
  const micro = store.listProjectsForOwner(LOCAL_MANAGER_ID).find((p) => p.name.includes("微导管"));
  const microId = micro?.projectId;

  publishDemoTask({
    planId: "local-dash-capacity-plan",
    title: "产能爬坡与良率提升",
    description: "多子任务、多负责人，用于 Dashboard 密度测试。",
    projectId: microId,
    tasks: [
      { id: "cap_1", title: "产线 A 参数复核", dueAt: "2026-05-28" },
      { id: "cap_2", title: "SPC 脚本联调", dueAt: "2026-05-30" },
      { id: "cap_3", title: "来料检验对齐", dueAt: "2026-06-03" },
    ],
    assignments: [
      { taskId: "cap_1", userId: "u_wangwu", displayName: "王五" },
      { taskId: "cap_2", userId: "u_zhaoliu", displayName: "赵六" },
      { taskId: "cap_3", userId: "u_sunqi", displayName: "孙七" },
    ],
  });

  publishDemoTask({
    planId: "local-dash-regulatory",
    title: "注册资料与临床推进",
    description: "含待承接与执行中混合状态。",
    projectId: microId,
    tasks: [
      { id: "reg_1", title: "补充临床随访表", dueAt: "2026-05-29" },
      { id: "reg_2", title: "专家函审材料", dueAt: "2026-06-06" },
    ],
    assignments: [
      { taskId: "reg_1", userId: "u_wu_jiu", displayName: "吴九" },
      { taskId: "reg_2", userId: "u_zhengshi", displayName: "郑十" },
    ],
  });

  publishDemoTask({
    planId: "local-dash-brand-campaign",
    title: "学术推广与品牌活动",
    description: "Q2 渠道复盘关联任务。",
    tasks: [
      { id: "br_1", title: "KOL 圆桌议程", dueAt: "2026-05-27" },
      { id: "br_2", title: "宣传物料定稿", dueAt: "2026-06-04" },
    ],
    assignments: [
      { taskId: "br_1", userId: "u_zhouba", displayName: "周八" },
      { taskId: "br_2", userId: "u_wangfang", displayName: "王芳" },
    ],
  });

  const cap = store.getTaskDetail("local-dash-capacity-plan");
  if (cap?.subtasks[0]) {
    store.updateSubtaskStatus({ subtaskId: cap.subtasks[0].subtaskId, actorUserId: "u_wangwu", action: "accept" });
  }
  const reg = store.getTaskDetail("local-dash-regulatory");
  if (reg?.subtasks[1]) {
    store.updateSubtaskStatus({ subtaskId: reg.subtasks[1].subtaskId, actorUserId: "u_zhengshi", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: reg.subtasks[1].subtaskId,
      actorUserId: "u_zhengshi",
      action: "progress",
      progressStatus: "IN_PROGRESS",
      note: "初稿 60%",
    });
  }
}

function printBanner(): void {
  const hasQwen = Boolean(process.env.QWEN_API_KEY?.trim());
  console.log("");
  console.log("=== Portfolio UX v2 + 智能助手 本地测试环境 ===");
  console.log(`数据目录: ${DATA_ROOT}`);
  console.log(`SQLite:   ${resolveWorkbenchSqlitePath()}`);
  console.log("");
  console.log("1) 浏览器打开登录页");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench`);
  console.log(`   主管 userId: ${LOCAL_MANAGER_ID}`);
  console.log(`   管理员 userId: ${LOCAL_ADMIN_ID}`);
  console.log(`   员工 userId: ${LOCAL_EMPLOYEE_ID}（李四）`);
  console.log(`   （脚本已强制将 ${LOCAL_MANAGER_ID} 并入 WORKBENCH_MANAGER_USER_IDS）`);
  console.log("");
  console.log("2) 智能规划助手（主线程，已预置草案 + 2 条历史消息）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/chat?thread=main`);
  console.log("");
  console.log("3) 项目总览（Portfolio 角色 A，已预置 2 项目 + 未归类任务）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/projects`);
  console.log("");
  console.log("4) 历史任务（默认「按项目归档」，含批量归入 / 防重复按钮）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/tasks`);
  console.log(`   扁平列表: http://127.0.0.1:${LOCAL_PORT}/workbench/manager/tasks?view=flat`);
  console.log("");
  console.log("5) 周度 Dashboard（已预置演示正式任务）");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/manager/dashboard`);
  console.log("");
  console.log("6) 员工工作台");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/employee?view=new`);
  console.log("");
  console.log("7) 管理员工作台");
  console.log(`   http://127.0.0.1:${LOCAL_PORT}/workbench/admin`);
  console.log("");
  console.log("8) UI 预览稿（静态 HTML，无需服务）");
  console.log("   docs/mockups/manager-weekly-dashboard-ui-v3-preview.html");
  console.log("");
  console.log("已启用: WORKBENCH_PROJECT_PORTFOLIO_USER_IDS 含 manager-local-dev");
  console.log("已启用: WORKBENCH_ENFORCE_ACTION_GUARDS=1（与生产防重复一致）");
  console.log("");
  if (!hasQwen) {
    console.log("⚠ 未检测到 QWEN_API_KEY：布局/Excel/改派搜索可测；发送消息与 Excel Agent 校验会失败。");
    console.log("  请在 .env 中配置 QWEN_API_KEY 后重启本服务。");
  } else {
    console.log("✓ QWEN_API_KEY 已配置：可测试发送消息与 Excel「提交修改（Agent 校验）」。");
  }
  console.log("");
  console.log("手动测试清单: docs/local-test-portfolio-ux-v2-manual.md");
  console.log("（Excel/聊天细项见 docs/local-test-workbench-excel-chat-ux.md）");
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
  const dashboardTaskNo = seedDashboardFormalTasks();
  seedPortfolioDemo(dashboardTaskNo);
  seedExtraDashboardTasks();
  startServer();
}

main();
