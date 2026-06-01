/**
 * 会议待办入库 eval：单元测试 + 全链路 parse/analyze/commit（mock LLM）+ 可选真实 LLM 抽取。
 *
 * Run: npm run eval:meeting-import
 * Filter: EVAL_MEETING_IMPORT_FILTER=M3 npm run eval:meeting-import
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { __setMeetingImportLlmForTest } from "../src/agent/meeting-import/meeting-import-llm";
import { loadMeetingImportPolicy } from "../src/agent/meeting-import/meeting-import-policy";
import {
  handleMeetingImportAnalyze,
  handleMeetingImportCommit,
  handleMeetingImportParse,
  normalizeCommitRowsFromPreview,
} from "../src/web/meeting-import-api";

const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(process.cwd(), ".eval-meeting-import");
const FILTER = process.env.EVAL_MEETING_IMPORT_FILTER?.trim();
const MGR = "eval-mgr-meeting-import";

interface ScenarioResult {
  id: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

const SAMPLE_MINUTES = `# 2026-05-28 OCT 客诉专项周会

## 参会
张三、李四、王五

## 讨论摘要
- 批次 2026Q2-04 焊点开路客诉仍在跟进
- 注册申报资料窗口 6 月底

## Action Items
- 整理 OCT 客诉遏制报告并提交质量部审核，负责人：张三，截止：2026-06-05
- 完成供应商书面反馈含邮件沟通记录，负责人：李四
- 提交注册申报资料清单 v2，负责人：王五，deadline: 2026-06-30
- 更新项目风险台账（与 OCT 客诉遏制报告重复表述的待办）
`;

function runVitest() {
  console.log("\n========== Unit tests ==========\n");
  const patterns = [
    "tests/web/meeting-import.test.ts",
    "tests/agent/meeting-import/relation-rules.test.ts",
    "tests/infra/meeting-import-store.test.ts",
  ];
  const vitestBin = join(process.cwd(), "node_modules/vitest/vitest.mjs");
  const r = spawnSync(process.execPath, [vitestBin, "run", ...patterns], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function bootstrapScenario(scenarioId: string) {
  const dir = join(EVAL_DIR, scenarioId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "employee-profiles"), { recursive: true });
  process.env.WORKBENCH_SQLITE_PATH = join(dir, "workbench.sqlite");
  process.env.EMPLOYEE_PROFILE_DIR = join(dir, "employee-profiles");
  process.env.WORKBENCH_MANAGER_USER_IDS = MGR;
  process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS = MGR;
  process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED = "0";
}

function seedPeople() {
  const people = createPeopleDirectoryStore();
  try {
    const now = new Date().toISOString();
    const base = { active: true, isAdmin: false, isBoss: false, isSenior: false, lastSyncedAt: now };
    people.upsertContact({
      ...base,
      userId: MGR,
      name: "测评主管",
      unionId: "u-mgr001",
      departmentNames: ["质量部"],
    });
    for (const [uid, name] of [
      ["emp-zhang", "张三"],
      ["emp-li", "李四"],
      ["emp-wang", "王五"],
    ] as const) {
      people.upsertContact({
        ...base,
        userId: uid,
        name,
        unionId: `u-${uid}`,
        departmentNames: ["质量部"],
      });
    }
  } finally {
    people.close();
  }
}

function seedExistingTask(input: {
  projectId: string;
  planId: string;
  parentTitle: string;
  subtaskTitle: string;
  assigneeUserId: string;
}) {
  const store = createWorkbenchFormalTaskStore();
  const session = {
    planId: input.planId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    senderStaffId: MGR,
    latestDraft: {
      title: input.parentTitle,
      description: "预置父任务",
      tasks: [
        {
          id: "t1",
          title: input.subtaskTitle,
          objective: "完成 OCT 客诉遏制",
          deliverables: "遏制报告",
          completionCriteria: "质量部审核通过",
        },
      ],
    },
    latestAssignment: {
      assignments: [{ taskId: "t1", primary: { userId: input.assigneeUserId } }],
    },
    conversationHistory: [],
    knownFacts: [],
  };
  store.publishFromSession({
    planId: input.planId,
    session: session as never,
    managerUserId: MGR,
    initiatorDepartment: "质量部",
    actorUserId: MGR,
    projectId: input.projectId,
  });
  return store.listManagerTasks(MGR).find((t) => t.planId === input.planId);
}

function installMockLlm() {
  __setMeetingImportLlmForTest(async ({ system, user }) => {
    if (/Action Items|待办事项/.test(system)) {
      return JSON.stringify([
        {
          id: "item-1",
          title: "整理OCT客诉遏制报告",
          excerpt: "整理 OCT 客诉遏制报告并提交质量部审核",
          assigneeName: "张三",
          dueAt: "2026-06-05",
        },
        {
          id: "item-2",
          title: "完成供应商书面反馈",
          excerpt: "完成供应商书面反馈含邮件沟通记录",
          assigneeName: "李四",
        },
        {
          id: "item-3",
          title: "提交注册申报资料清单v2",
          excerpt: "提交注册申报资料清单 v2",
          assigneeName: "王五",
          dueAt: "2026-06-30",
        },
        {
          id: "item-4",
          title: "更新项目风险台账",
          excerpt: "更新项目风险台账",
        },
      ]);
    }
    if (/父任务/.test(system)) {
      const payload = JSON.parse(user) as {
        items: Array<{ id: string; title: string }>;
        existingTasks: Array<{ taskNo: string; planId: string; title: string }>;
      };
      const existing = payload.existingTasks[0];
      return JSON.stringify(
        payload.items.map((item, index) => {
          if (item.title.includes("OCT") && existing) {
            return {
              itemId: item.id,
              kind: "existing",
              taskNo: existing.taskNo,
              planId: existing.planId,
              reason: "归入已有 OCT 父任务",
            };
          }
          if (index <= 1) {
            return {
              itemId: item.id,
              kind: "new",
              suggestedTitle: "OCT 客诉跟进",
              themeKey: "oct-theme",
              reason: "OCT 相关新建父任务",
            };
          }
          return {
            itemId: item.id,
            kind: "new",
            suggestedTitle: "2026 注册申报跟进",
            themeKey: "reg-theme",
            reason: "注册申报相关",
          };
        }),
      );
    }
    return null;
  });
}

async function runScenario(id: string, fn: () => Promise<string>): Promise<ScenarioResult> {
  if (FILTER && !id.includes(FILTER)) {
    return { id, ok: true, detail: "skipped (filter)", durationMs: 0 };
  }
  const started = Date.now();
  try {
    const detail = await fn();
    return { id, ok: true, detail, durationMs: Date.now() - started };
  } catch (err) {
    return {
      id,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

async function scenarioM1FallbackExtract(): Promise<string> {
  bootstrapScenario("M1_fallback_extract");
  seedPeople();
  process.env.MEETING_IMPORT_LLM_ENABLED = "0";
  __setMeetingImportLlmForTest(undefined);

  const store = createWorkbenchFormalTaskStore();
  store.createProject({ ownerUserId: MGR, name: "OCT 客诉专项", aliases: ["OCT", "客诉"] });

  const parsed = await handleMeetingImportParse({
    taskStore: store,
    managerUserId: MGR,
    pastedText: SAMPLE_MINUTES,
    meetingTitle: "OCT 客诉专项周会",
  });

  if (parsed.items.length < 3) {
    throw new Error(`fallback 抽取不足: ${parsed.items.length} 条`);
  }
  if (parsed.projectSuggestion.confidence === "low" || !parsed.projectSuggestion.projectName) {
    throw new Error(`项目推荐失败: ${parsed.projectSuggestion.reason}`);
  }
  if (!parsed.projectSuggestion.projectName.includes("OCT")) {
    throw new Error(`项目推荐错误: ${parsed.projectSuggestion.projectName}`);
  }
  return `items=${parsed.items.length}, project=${parsed.projectSuggestion.projectName} (${parsed.projectSuggestion.confidence})`;
}

async function scenarioM2DuplicateRelation(): Promise<string> {
  bootstrapScenario("M2_duplicate_relation");
  seedPeople();
  installMockLlm();

  const store = createWorkbenchFormalTaskStore();
  const project = store.createProject({
    ownerUserId: MGR,
    name: "OCT 客诉专项",
    aliases: ["OCT"],
  });
  const existing = seedExistingTask({
    projectId: project.projectId,
    planId: "plan-existing-oct",
    parentTitle: "OCT 客诉遏制",
    subtaskTitle: "整理 OCT 客诉遏制报告并提交质量部审核",
    assigneeUserId: "emp-zhang",
  });
  if (!existing) throw new Error("预置任务失败");

  const parsed = await handleMeetingImportParse({
    taskStore: store,
    managerUserId: MGR,
    pastedText: SAMPLE_MINUTES,
    meetingTitle: "OCT 客诉专项周会",
  });
  const analyzed = await handleMeetingImportAnalyze({
    taskStore: store,
    managerUserId: MGR,
    batchId: parsed.batchId,
    projectId: project.projectId,
    projectName: project.name,
    items: parsed.items,
    meetingTitle: "OCT 客诉专项周会",
  });

  const dupLike = analyzed.rows.find(
    (r) => r.relationKind === "duplicate" || r.relationKind === "contained",
  );
  if (!dupLike) {
    throw new Error(
      `未检测到 duplicate/contained 关系: ${analyzed.rows.map((r) => `${r.title}=${r.relationKind}`).join("; ")}`,
    );
  }
  if (dupLike.selected !== false) throw new Error(`${dupLike.relationKind} 行应默认不选中`);
  const appendCandidate = analyzed.rows.find((r) => r.relationKind === "none" && r.selected);
  if (!appendCandidate) throw new Error("应有可追加的新待办");
  return `${dupLike.relationKind}=${dupLike.title}, appendable=${appendCandidate.title}, rows=${analyzed.rows.length}`;
}

async function scenarioM3FullCommit(): Promise<string> {
  bootstrapScenario("M3_full_commit");
  seedPeople();
  installMockLlm();

  const store = createWorkbenchFormalTaskStore();
  const project = store.createProject({
    ownerUserId: MGR,
    name: "OCT 客诉专项",
    aliases: ["OCT"],
  });
  const regProject = store.createProject({
    ownerUserId: MGR,
    name: "2026 注册申报",
    aliases: ["注册", "申报"],
  });
  void regProject;
  seedExistingTask({
    projectId: project.projectId,
    planId: "plan-existing-oct",
    parentTitle: "OCT 客诉遏制",
    subtaskTitle: "整理 OCT 客诉遏制报告并提交质量部审核",
    assigneeUserId: "emp-zhang",
  });

  const parsed = await handleMeetingImportParse({
    taskStore: store,
    managerUserId: MGR,
    pastedText: SAMPLE_MINUTES,
    meetingTitle: "OCT 客诉专项周会",
  });
  const analyzed = await handleMeetingImportAnalyze({
    taskStore: store,
    managerUserId: MGR,
    batchId: parsed.batchId,
    projectId: project.projectId,
    projectName: project.name,
    items: parsed.items,
    meetingTitle: "OCT 客诉专项周会",
  });

  const commitRows = normalizeCommitRowsFromPreview(analyzed.rows).map((row) => {
    if (!row.assigneeUserId?.trim()) {
      if (row.title.includes("供应商")) return { ...row, assigneeUserId: "emp-li" };
      if (row.title.includes("注册")) return { ...row, assigneeUserId: "emp-wang" };
      if (row.title.includes("风险")) return { ...row, assigneeUserId: "emp-zhang" };
    }
    return row;
  });

  const committed = await handleMeetingImportCommit({
    taskStore: store,
    managerUserId: MGR,
    batchId: parsed.batchId,
    projectId: project.projectId,
    projectName: project.name,
    meetingTitle: "OCT 客诉专项周会",
    rows: commitRows,
    actorName: "测评主管",
  });

  if (committed.createdTasks.length === 0 && committed.appendedSubtasks.length === 0) {
    throw new Error(`commit 无产出: errors=${JSON.stringify(committed.errors)}`);
  }
  if (committed.errors.length > 0) {
    throw new Error(`commit 有错误: ${JSON.stringify(committed.errors)}`);
  }
  const batch = store.getMeetingImportBatch(parsed.batchId, MGR);
  if (batch?.status !== "committed") throw new Error(`batch 状态异常: ${batch?.status}`);
  return `created=${committed.createdTasks.length}, appended=${committed.appendedSubtasks.length}, skipped=${committed.skipped.length}`;
}

async function scenarioM4RealLlm(): Promise<string> {
  const policy = loadMeetingImportPolicy();
  if (!policy.llmApiKey) {
    return "skipped — QWEN_API_KEY / DASHSCOPE_API_KEY 未配置";
  }

  bootstrapScenario("M4_real_llm");
  seedPeople();
  __setMeetingImportLlmForTest(undefined);
  process.env.MEETING_IMPORT_LLM_ENABLED = "1";

  const store = createWorkbenchFormalTaskStore();
  store.createProject({ ownerUserId: MGR, name: "OCT 客诉专项", aliases: ["OCT", "客诉"] });
  store.createProject({ ownerUserId: MGR, name: "2026 注册申报", aliases: ["注册"] });

  const parsed = await handleMeetingImportParse({
    taskStore: store,
    managerUserId: MGR,
    pastedText: SAMPLE_MINUTES,
    meetingTitle: "OCT 客诉专项周会",
  });

  if (parsed.items.length < 2) {
    throw new Error(`LLM 抽取不足: ${parsed.items.length} 条`);
  }
  const withAssignee = parsed.items.filter((i) => i.assigneeName?.trim()).length;
  const project = store.listProjectsForOwner(MGR)[0];
  const analyzed = await handleMeetingImportAnalyze({
    taskStore: store,
    managerUserId: MGR,
    batchId: parsed.batchId,
    projectId: project.projectId,
    projectName: project.name,
    items: parsed.items,
    meetingTitle: "OCT 客诉专项周会",
  });

  const themes = new Set(
    analyzed.rows.map((r) => r.parent.themeKey ?? r.parent.taskNo ?? r.parent.suggestedTitle),
  );
  return `llm items=${parsed.items.length}, assigneeNamed=${withAssignee}, previewRows=${analyzed.rows.length}, parentGroups=${themes.size}, model=${policy.llmModel}`;
}

async function main() {
  mkdirSync(EVAL_DIR, { recursive: true });
  console.log(`Meeting import eval → ${EVAL_DIR}`);
  if (FILTER) console.log(`Filter: ${FILTER}`);

  if (process.env.EVAL_MEETING_IMPORT_SKIP_VITEST !== "1") {
    runVitest();
  } else {
    console.log("\n(skipping vitest — EVAL_MEETING_IMPORT_SKIP_VITEST=1)\n");
  }

  console.log("\n========== Pipeline scenarios ==========\n");
  const results: ScenarioResult[] = [];
  for (const [id, fn] of [
    ["M1_fallback_extract", scenarioM1FallbackExtract],
    ["M2_duplicate_relation", scenarioM2DuplicateRelation],
    ["M3_full_commit", scenarioM3FullCommit],
    ["M4_real_llm", scenarioM4RealLlm],
  ] as const) {
    const result = await runScenario(id, fn);
    results.push(result);
    const mark = result.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${result.id} (${result.durationMs}ms) — ${result.detail}`);
  }

  __setMeetingImportLlmForTest(undefined);
  const report = {
    ranAt: new Date().toISOString(),
    filter: FILTER ?? null,
    results,
    llmConfigured: Boolean(loadMeetingImportPolicy().llmApiKey),
  };
  writeFileSync(join(EVAL_DIR, "report.json"), JSON.stringify(report, null, 2));

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} scenario(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll meeting-import eval scenarios passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
