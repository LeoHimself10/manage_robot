/**
 * Batch-publish 22周台账任务（曹杰主管，1 正式任务 = 1 子任务）。
 *
 * Usage (ECS):
 *   set -a && . /etc/manage-robot.env && set +a
 *   npx tsx scripts/batch-publish-ledger-tasks.ts [--dry-run]
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

import type { PlanSession } from "../src/infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../src/infra/workbench-formal-task-store";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createWorkbenchPublishNotifier } from "../src/integrations/dingtalk/workbench-notify";
import { buildPublishTaskHandler } from "../src/agent/tools/publish-task";
import {
  buildPreparePublishArgsFromSession,
  hashAssignmentForStaging,
  hashDraftForStaging,
  isStagingStale,
} from "../src/agent/publish-helpers";
import { logStructured } from "../src/infra/logger";

const MANAGER_USER_ID = "0243556302843671";
const DUE_AT = "2026-05-29";

const ASSIGNEE_BY_NAME: Record<string, string> = {
  李嘉男: "02573051084320",
  曹杰: "0243556302843671",
  李强: "0468001250844204",
  惠芳芳: "200136440924903488",
  韦静: "0105612224091244211",
  武传宾: "ext_wuchuanbin",
  曲绍志: "ext_qu_shaozhi",
  薛婷: "15666300631083452",
};

type LedgerRow = {
  assigneeName: string;
  title: string;
  content: string;
  deliverables: string;
  completionCriteria: string;
};

const LEDGER_TASKS: LedgerRow[] = [
  {
    assigneeName: "李嘉男",
    title: "长海补充协议高层推动",
    content: "配合韦静推进长海边入边签路径，必要时与主任/机构沟通，确保长海可从50例扩展至75例。",
    deliverables: "长海补充协议推进记录；关键卡点与下一步负责人清单。",
    completionCriteria: "完成中期质控/稽查预约或取得机构明确反馈；不影响长海持续入组排程。",
  },
  {
    assigneeName: "李嘉男",
    title: "品牌年度规划与首发文章",
    content: "与薛婷及品宣负责人会面，确定年度品牌提升计划；完成公众号首篇学术文章修改与发布安排。",
    deliverables: "《明思OCT年度品宣计划》；首篇公众号文章稿；发布排期。",
    completionCriteria: "年度计划包含主题、频率、责任人、发布时间；首篇文章完成定稿并明确上线日期。",
  },
  {
    assigneeName: "曹杰",
    title: "创新通道资料汇总上报",
    content: "接收李嘉男PPT和视频后，整理邮件正文、附件清单，统一回复国家局审评中心并跟踪回执。",
    deliverables: "审评中心回复邮件；附件清单；提交状态截图/回执。",
    completionCriteria: "邮件成功发出并留存回执；项目群同步提交状态和后续等待事项。",
  },
  {
    assigneeName: "曹杰",
    title: "AI任务管理工具试运行",
    content: "与姚凯珩/AG工程师继续测试AI任务管理工具，把入组推进、微导管研发、品牌宣传三类项目拆入系统。",
    deliverables: "AI任务台账试运行截图；问题反馈清单；三类项目任务模板。",
    completionCriteria: "工具可生成待办清单和跟进台账；22周周会可基于任务面板核对至少一次。",
  },
  {
    assigneeName: "曹杰",
    title: "公众号发布项目化列表",
    content: "与李嘉男、武传宾对接，制定公众号具体发布计划，明确主题、素材、撰稿、审核、发布时间。",
    deliverables: "《公众号发布项目推进表》。",
    completionCriteria: "首月发布节奏、文章主题、责任人和截止时间均明确。",
  },
  {
    assigneeName: "李强",
    title: "PIU复现实验与根因验证",
    content:
      "对已更换新0db并调整至临床参数的PIU开展生产测试，继续尝试复现临床严重损伤；记录28根测试后的轻微损伤与新增样本结果。",
    deliverables: "《PIU损伤复现实验报告》；测试原始记录；结论与下一步验证方案。",
    completionCriteria: "完成两个PIU的生产测试；形成是否复现、是否排除批次/参数因素的明确结论。",
  },
  {
    assigneeName: "李强",
    title: "导管回收SOP技术确认",
    content: "验证“清洗/擦干 + 注水润滑 + 甩干 + 装盘管”方法，明确导管回收后可再利用的保存要求。",
    deliverables: "《临床回收导管盘管收纳SOP》技术版；现场注意事项。",
    completionCriteria: "SOP被曹杰/韦静/跟台人员确认可执行；后续回收导管不再直接装快递袋。",
  },
  {
    assigneeName: "李强",
    title: "Pro18与激光微导管技术评审",
    content: "配合李嘉男评估苏州迈拓Pro18仿制能力、材料逆向结果和工艺匹配度；评估激光光纤微导管关键技术风险。",
    deliverables: "《Pro18技术评审意见》；《激光光纤微导管技术风险清单》。",
    completionCriteria: "给出能否合作、样品要求、关键尺寸/材料/工艺风险的书面结论。",
  },
  {
    assigneeName: "惠芳芳",
    title: "常市一正式入组落地",
    content: "跟进常市一学习曲线后的正式入组，协调现场跟台、医生沟通、导管/设备准备和术后资料归档。",
    deliverables: "常市一入组跟台记录；病例数据与问题清单。",
    completionCriteria: "常市一完成正式入组或明确未入组原因；现场流程问题形成闭环。",
  },
  {
    assigneeName: "韦静",
    title: "长海补充协议与质控稽查",
    content: "集中处理长海病例稽查整改，争取预约中期质控时间，推动机构允许边入边签。",
    deliverables: "长海稽查整改清单；质控预约记录；补充协议流程状态表。",
    completionCriteria: "完成集中整改；取得质控预约或机构下一步明确意见；同步长海协议风险。",
  },
  {
    assigneeName: "韦静",
    title: "导管回收流程临床执行",
    content: "把导管回收SOP传达给跟台人员，现场确保盘管收集、注水润滑、甩干收纳执行。",
    deliverables: "跟台人员SOP确认记录；回收导管交接记录。",
    completionCriteria: "22周回收导管均有盘管收纳或异常说明；无因运输方式导致的新增折损。",
  },
  {
    assigneeName: "武传宾",
    title: "公众号与品牌素材落地",
    content: "配合李嘉男、曹杰整理公众号模板、视觉识别、LOGO/命名素材，并参与首篇文章排版发布。",
    deliverables: "公众号模板；视觉素材包；首篇文章排版稿。",
    completionCriteria: "模板可复用；首篇文章排版完成并进入审核/发布流程。",
  },
  {
    assigneeName: "曲绍志",
    title: "华山/长海独立跟台巩固",
    content: "继续承担华山或长海跟台任务，按SOP完成设备检查、导管回收、术后数据交接。",
    deliverables: "跟台记录；术后设备/PIU检查记录；导管回收交接记录。",
    completionCriteria: "完成至少一次独立跟台且无流程遗漏；异常问题当天同步曹杰/李强。",
  },
  {
    assigneeName: "薛婷",
    title: "品牌会议与资源协调",
    content: "组织李嘉男与品宣负责人会面，明确年度品牌提升计划所需资源、审核链路和发布权限。",
    deliverables: "会议纪要；品宣资源与审核流程清单。",
    completionCriteria: "年度品宣计划所需资源和审核人明确；首篇文章发布流程无阻塞。",
  },
];

function splitItems(raw: string): string[] {
  return raw
    .split(/[；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSession(row: LedgerRow, planId: string): PlanSession {
  const assigneeUserId = ASSIGNEE_BY_NAME[row.assigneeName];
  if (!assigneeUserId) {
    throw new Error(`unknown assignee: ${row.assigneeName}`);
  }

  const draft = {
    responseIntent: "DRAFT",
    title: row.title,
    description: row.content,
    tasks: [
      {
        id: "task_1",
        title: row.title,
        objective: row.content,
        deliverables: splitItems(row.deliverables),
        completionCriteria: splitItems(row.completionCriteria),
        timeNode: { dueAt: DUE_AT, checkpoints: [] },
        feedbackFrequency: "每周",
        inputMaterials: [],
        actions: [],
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ],
    openQuestions: [],
    assistantMessage: "",
  };

  const assignment = {
    assignments: [
      {
        taskId: "task_1",
        primary: {
          userId: assigneeUserId,
          displayName: row.assigneeName,
        },
        collaborators: [],
      },
    ],
  };

  const stagedAt = new Date().toISOString();
  (draft as Record<string, unknown>).stagedBy = "prepare_publish_task";
  (draft as Record<string, unknown>).stagedAt = stagedAt;
  (draft as Record<string, unknown>).stagedDraftHash = hashDraftForStaging(draft);
  (draft as Record<string, unknown>).stagedAssignmentHash = hashAssignmentForStaging(assignment);
  (assignment as Record<string, unknown>).stagedBy = "prepare_publish_task";
  (assignment as Record<string, unknown>).stagedAt = stagedAt;

  return {
    planId,
    createdAt: stagedAt,
    updatedAt: stagedAt,
    senderStaffId: MANAGER_USER_ID,
    canonicalUserId: MANAGER_USER_ID,
    latestDraft: draft,
    latestAssignment: assignment as PlanSession["latestAssignment"],
    conversationHistory: [],
    knownFacts: [],
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const taskStore = createWorkbenchFormalTaskStore();
  const peopleStore = createPeopleDirectoryStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const notifier = createWorkbenchPublishNotifier();
  const initiatorDepartment =
    employeeRepo.get(MANAGER_USER_ID)?.department?.trim() ||
    peopleStore.getContact(MANAGER_USER_ID)?.departmentNames?.[0]?.trim() ||
    "项目管理部门";

  const existingTitles = new Set(
    taskStore.listManagerTasks(MANAGER_USER_ID).map((t) => t.title.trim()),
  );

  const results: Array<Record<string, unknown>> = [];

  for (const row of LEDGER_TASKS) {
    if (existingTitles.has(row.title.trim())) {
      results.push({ title: row.title, status: "skipped_existing" });
      continue;
    }

    const planId = randomUUID();
    const session = buildSession(row, planId);

    if (!buildPreparePublishArgsFromSession(session)) {
      results.push({ title: row.title, status: "invalid_session" });
      continue;
    }
    if (isStagingStale(session)) {
      results.push({ title: row.title, status: "staging_stale" });
      continue;
    }

    const assigneeUserId = ASSIGNEE_BY_NAME[row.assigneeName];
    const contact = peopleStore.getContact(assigneeUserId);

    if (dryRun) {
      results.push({
        title: row.title,
        status: "dry_run_ok",
        planId,
        assigneeName: row.assigneeName,
        assigneeUserId,
        contactActive: contact?.active ?? false,
        dueAt: DUE_AT,
      });
      continue;
    }

    const handler = buildPublishTaskHandler({
      trustedActorUserId: MANAGER_USER_ID,
      currentSessionPlanId: planId,
      currentSession: session,
      actorName: "曹杰",
      initiatorDepartment,
      publishFromSession: taskStore.publishFromSession.bind(taskStore),
      appendTaskEvent: taskStore.appendTaskEvent.bind(taskStore),
      getContact: (userId) => peopleStore.getContact(userId),
      notifier,
      recentPublished: { get: () => undefined, mark: () => {} },
      onAudit: (entry) => logStructured(entry),
    });

    const result = (await handler({
      planId,
      confirmationContext: "台账批量录入：明思OCT工作台账22周任务清单",
    })) as Record<string, unknown>;

    const taskNo = String(
      (result.task as { taskNo?: string } | undefined)?.taskNo ?? result.taskNo ?? "",
    ).trim();

    if (String(result.ok ?? "") === "true" && taskNo) {
      existingTitles.add(row.title.trim());
    }

    results.push({
      title: row.title,
      assigneeName: row.assigneeName,
      status: String(result.ok ?? "") === "true" ? "published" : "failed",
      taskNo: taskNo || undefined,
      reason: result.reason,
      warnings: result.warnings,
    });
  }

  console.log(JSON.stringify({ dryRun, managerUserId: MANAGER_USER_ID, results }, null, 2));

  const failed = results.filter((r) => r.status === "failed" || r.status === "invalid_session");
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
