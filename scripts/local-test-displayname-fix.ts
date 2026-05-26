/**
 * 本地确定性回归：bulk_assign → prepare_publish_task → renderDingtalkTaskMarkdown
 * 不依赖 LLM / 钉钉。用法：npm run test:displayname-local
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PlanSession } from "../src/infra/plan-session-store";
import { buildBulkAssignTasksHandler } from "../src/agent/tools/bulk-assign-tasks";
import { buildPreparePublishTaskHandler } from "../src/agent/tools/prepare-publish-task";
import { renderDingtalkTaskMarkdown } from "../src/view/dingtalk-task-markdown";
import { isDraftStagedForPublish } from "../src/agent/publish-staging";

const DATA_DIR = join(process.cwd(), ".local-test-displayname");
const LIJIANNAN_ID = "02573051084320";
const LIJIANNAN_NAME = "李嘉男";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`OK: ${msg}`);
}

function makeSession(): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "local-displayname-test",
    planId: "plan-local-displayname",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    lastEmployeeSearchHits: [
      { userId: LIJIANNAN_ID, displayName: LIJIANNAN_NAME, hitAt: now },
    ],
    latestDraft: {
      title: "微导管供应商与双管线决策",
      description:
        "获取苏州迈拓Pro18仿制可行性反馈，评估签约可行性；同步定义激光光纤微导管需求边界，形成明确决策。",
      tasks: [
        { id: "task_1", title: "获取并评估Pro18仿制可行性", objective: "供应商反馈与内评" },
        { id: "task_2", title: "定义激光光纤微导管需求边界", objective: "明确指标与验收" },
        { id: "task_3", title: "综合评估与签约决策", objective: "形成决策建议" },
      ],
    },
  } as PlanSession;
}

function main(): void {
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const session = makeSession();
  const getContact = (userId: string) =>
    userId === LIJIANNAN_ID
      ? { active: true, name: LIJIANNAN_NAME, unionId: "local-union" }
      : undefined;

  const bulk = buildBulkAssignTasksHandler({ currentSession: session, getContact });
  const bulkRes = bulk({
    assignments: [
      { taskId: "task_1", assigneeUserId: LIJIANNAN_ID },
      { taskId: "task_2", assigneeUserId: LIJIANNAN_ID },
      { taskId: "task_3", assigneeUserId: LIJIANNAN_ID },
    ],
  }) as { ok: boolean };
  if (!bulkRes.ok) fail("bulk_assign_tasks");

  const prep = buildPreparePublishTaskHandler({ currentSession: session, getContact });
  const prepRes = prep({ planId: session.planId }) as { ok: boolean };
  if (!prepRes.ok) fail("prepare_publish_task");

  const rows = (session.latestAssignment as { assignments: Array<{ primary?: { displayName?: string; userId?: string } }> })
    .assignments;
  for (const row of rows) {
    const dn = String(row.primary?.displayName ?? "").trim();
    if (dn !== LIJIANNAN_NAME) fail(`assignment displayName="${dn}"`);
  }
  ok("prepare 后 assignment 含 displayName");

  if (!isDraftStagedForPublish(session.latestDraft)) fail("draft 未 staged");

  const outbound = renderDingtalkTaskMarkdown({
    modelMessage: "已完成负责人指派并生成发布预览。",
    currentDraft: session.latestDraft,
    latestAssignment: session.latestAssignment,
    shouldRenderRichSection: true,
    appendStructuredTaskTable: true,
  });
  const table = outbound.slice(outbound.indexOf("### 结构化任务表"));
  if (!table.includes(LIJIANNAN_NAME)) fail("结构化表缺少姓名");
  if (table.includes(LIJIANNAN_ID)) fail("结构化表仍含 userId");

  ok("结构化任务表负责人列为姓名");
  console.log("\n=== 全部通过（本地确定性回归）===");
}

main();
