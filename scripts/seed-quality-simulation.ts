/**
 * Idempotent production-safe quality workflow simulation data.
 *
 * - Creates 20 clearly labelled fictional quality events across workflow states.
 * - Uses real configured quality employees and manager/department mappings.
 * - Creates planning side threads only for PENDING_ASSIGNMENT events.
 * - Keeps every simulated due date in the future and never writes notification
 *   outbox rows or formal task/task-link rows.
 * - `--remove` soft-deletes only records with this script's fixed prefix.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  createPlanSessionStore,
  hashChatKey,
  type PlanSession,
} from "../src/infra/plan-session-store";
import { createQualityDepartmentDirectory } from
  "../src/quality/analysis/quality-department-directory";
import {
  QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_RULE_VERSION,
  type QualityAnalysisDraftContent,
  type QualityDeliverable,
} from "../src/quality/analysis/quality-analysis-contracts";
import { createQualityStore } from "../src/quality/infra/quality-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
import { listQualitySpecialistUserIds, resolveQualityCapabilities } from
  "../src/security/quality-capabilities";

const SIM_PREFIX = "SIM-QA-20260825";
const SIM_EVENT_PREFIX = "quality-simulation-20260825-";
const SIM_SOURCE_PREFIX = "simulation:quality:20260825:";
const DEFAULT_COUNT = 20;

type EventStatus =
  | "PENDING_ANALYSIS"
  | "PENDING_ASSIGNMENT"
  | "PENDING_ACCEPTANCE"
  | "IN_PROGRESS"
  | "PENDING_PRIMARY_REVIEW"
  | "PENDING_QUALITY_REVIEW"
  | "CLOSED";

interface SimulationTemplate {
  title: string;
  issue: string;
  model: string;
  category: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  impact: string;
}

const TEMPLATES: SimulationTemplate[] = [
  { title: "导管术中异常弯折", issue: "模拟场景：导管进入迂曲血管后出现明显弯折，撤出更换后恢复。", model: "SIM-OCT-M3", category: "导管产品／弯折抖动", risk: "HIGH", impact: "操作暂停约十分钟" },
  { title: "成像画面间歇性条纹", issue: "模拟场景：设备成像画面出现间歇性横向条纹，重启后暂时恢复。", model: "SIM-IVUS-X2", category: "设备／图像异常", risk: "MEDIUM", impact: "影响术者判读" },
  { title: "导管包装封口疑似不完整", issue: "模拟场景：拆包前发现包装封口局部翘起，产品未投入使用。", model: "SIM-CATH-A1", category: "包装／密封完整性", risk: "MEDIUM", impact: "更换同批次备用产品" },
  { title: "连接头装配阻力偏大", issue: "模拟场景：连接头旋合阻力偏大，第二套产品连接正常。", model: "SIM-CONN-P4", category: "附件／连接异常", risk: "LOW", impact: "延迟操作约三分钟" },
  { title: "设备启动自检报警", issue: "模拟场景：设备首次启动自检报警，断电重启后通过。", model: "SIM-HOST-S8", category: "设备／启动报警", risk: "MEDIUM", impact: "术前准备延迟" },
  { title: "导管表面疑似异物", issue: "模拟场景：使用前目检发现导管表面存在微小可见异物。", model: "SIM-CATH-C6", category: "导管产品／外观异常", risk: "HIGH", impact: "产品隔离未使用" },
  { title: "脚踏开关响应延迟", issue: "模拟场景：脚踏开关偶发响应延迟，替换附件后恢复。", model: "SIM-PEDAL-D2", category: "附件／响应异常", risk: "LOW", impact: "未影响患者" },
  { title: "数据导出文件缺少序列", issue: "模拟场景：导出报告中缺少一段成像序列，主机原始数据仍保留。", model: "SIM-SW-R5", category: "软件／数据完整性", risk: "MEDIUM", impact: "报告生成延后" },
  { title: "导管回撤阻力异常", issue: "模拟场景：自动回撤过程中出现阻力增大，改为手动撤出。", model: "SIM-PULL-B7", category: "导管产品／回撤异常", risk: "HIGH", impact: "操作流程中断" },
  { title: "标签批号可读性不足", issue: "模拟场景：外包装标签批号局部印刷模糊，系统扫码可识别。", model: "SIM-LABEL-L1", category: "标签／可追溯性", risk: "LOW", impact: "人工复核耗时增加" },
];

const STATUS_SEQUENCE: EventStatus[] = [
  "PENDING_ANALYSIS", "PENDING_ANALYSIS", "PENDING_ANALYSIS", "PENDING_ANALYSIS",
  "PENDING_ASSIGNMENT", "PENDING_ASSIGNMENT", "PENDING_ASSIGNMENT", "PENDING_ASSIGNMENT", "PENDING_ASSIGNMENT",
  "PENDING_ACCEPTANCE", "PENDING_ACCEPTANCE", "PENDING_ACCEPTANCE",
  "IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS",
  "PENDING_PRIMARY_REVIEW", "PENDING_PRIMARY_REVIEW",
  "PENDING_QUALITY_REVIEW",
  "CLOSED", "CLOSED",
];

function isoOffset(days: number, hours = 0): string {
  return new Date(Date.now() + (days * 24 + hours) * 60 * 60 * 1000).toISOString();
}

function fixedId(index: number): string {
  return String(index).padStart(3, "0");
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function simulationSideThreadChatKey(userId: string, threadId: string): string {
  return `workbench:side:${userId.trim()}:${threadId.trim()}`;
}

function createSimulationSideThread(userId: string): PlanSession {
  const store = createPlanSessionStore();
  const threadId = randomUUID();
  const now = new Date().toISOString();
  const created: PlanSession = {
    chatKeyHash: hashChatKey(simulationSideThreadChatKey(userId, threadId)),
    planId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    senderStaffId: userId,
    threadKind: "side",
    threadId,
    threadLabel: `模拟质量事件 · ${now.slice(5, 16).replace("T", " ")}`,
    knownFacts: [],
    conversationHistory: [],
  };
  store.save(created);
  return created;
}

function deleteSimulationSideThread(userId: string, threadId: string): boolean {
  const tid = threadId.trim();
  if (!tid || tid === "main") return false;
  const store = createPlanSessionStore();
  const chatKeyHash = hashChatKey(simulationSideThreadChatKey(userId, tid));
  const session = store.loadByChatKeyHash(chatKeyHash);
  if (!session || session.threadKind !== "side" || session.threadId !== tid) return false;
  store.deleteByChatKeyHash(chatKeyHash);
  return true;
}

function stageSimulationPlanningThread(input: {
  managerUserId: string;
  eventId: string;
  eventNo: string;
  title: string;
  issue: string;
  category: string;
  departmentName: string;
  dueAt: string;
  integrationKey: string;
  specialistUserId: string;
}): { planId: string; threadId: string } {
  const side = createSimulationSideThread(input.managerUserId);
  const description = [
    `# [模拟] 质量事件任务草稿｜${input.eventNo}`,
    "",
    `**事件标题：** ${input.title}`,
    `**建议主责部门：** ${input.departmentName}`,
    `**建议总期限：** ${input.dueAt}`,
    "",
    "## 来源事实摘要",
    `- ${input.issue}`,
    "",
    "## 质量初析",
    `- 人工确认分类：${input.category}`,
    "- 初步结论：需完成复现、批次核查、原因分析和措施验证。",
    "",
    "## 处理要求",
    "- 核对同批次生产与检验记录。",
    "- 输出根因分析、纠正预防措施及验证证据。",
    "",
    "## 主管下一步",
    "这是模拟演练数据。请按真实流程补充具体负责人和任务拆解；如需发布，请先确认不会通知无关人员。",
  ].join("\n");
  const displayContent = [
    `## 已接收模拟质量事件 ${input.eventNo}`,
    "",
    `质量员工已完成初析，建议由 **${input.departmentName}** 进入任务规划。`,
    "",
    "来源事实、初析结论、处理要求和必须成果已经写入草稿，可按真实主管流程继续编辑。",
  ].join("\n");
  const staged = {
    ...side,
    threadLabel: `[模拟] ${input.eventNo}`.slice(0, 40),
    latestDraft: {
      title: `[模拟] ${input.eventNo} ${input.title}`.slice(0, 200),
      description,
      summary: description,
      tasks: [
        {
          id: "task_1",
          title: "完成原因分析与措施验证",
          objective: "基于模拟质量事件完成可复核的原因分析。",
          deliverables: ["原因分析报告", "纠正预防措施与验证记录"],
          completionCriteria: ["结论有证据支持且措施责任清晰", "验证结果可追溯"],
          timeNode: { dueAt: input.dueAt },
          qualityDeliverableIds: ["sim-deliverable-1", "sim-deliverable-2"],
          qualityEventId: input.eventId,
        },
      ],
      qualityTaskPackage: {
        qualityEventId: input.eventId,
        eventNo: input.eventNo,
        publicFactSummary: [input.issue],
        confirmedCategory: input.category,
        primaryDepartment: { departmentName: input.departmentName },
        suggestedTotalDueAt: input.dueAt,
        requiredDeliverables: ["原因分析报告", "纠正预防措施与验证记录"],
        audit: { confirmedBy: input.specialistUserId },
        simulation: true,
      },
      qualityHandoff: {
        integrationKey: input.integrationKey,
        qualityEventId: input.eventId,
        analysisVersion: 1,
        requiredDeliverableIds: ["sim-deliverable-1", "sim-deliverable-2"],
      },
    },
    conversationHistory: [{
      role: "assistant" as const,
      content: displayContent,
      displayContent,
      at: new Date().toISOString(),
    }],
    knownFacts: [
      `qualityEventId:${input.eventId}`,
      "qualityAnalysisVersion:1",
      `qualityIntegrationKey:${input.integrationKey}`,
      "simulationData:true",
    ],
  };
  createPlanSessionStore().save(staged);
  return { planId: staged.planId, threadId: String(staged.threadId) };
}

function insertBaseEvent(input: {
  db: DatabaseSync;
  index: number;
  status: EventStatus;
  template: SimulationTemplate;
  reportManagerUserId: string;
  specialistUserId: string;
  now: string;
}): { eventId: string; sourceKey: string; eventNo: string; inserted: boolean } {
  const suffix = fixedId(input.index);
  const eventId = `${SIM_EVENT_PREFIX}${suffix}`;
  const sourceKey = `${SIM_SOURCE_PREFIX}${suffix}`;
  const eventNo = `${SIM_PREFIX}-${suffix}`;
  const existing = input.db.prepare("SELECT id,deleted_at FROM quality_events WHERE id=?")
    .get(eventId) as { id: string; deleted_at: string | null } | undefined;
  if (existing) {
    if (existing.deleted_at) {
      input.db.prepare("UPDATE quality_events SET deleted_at=NULL,updated_at=? WHERE id=?")
        .run(input.now, eventId);
    }
    return { eventId, sourceKey, eventNo, inserted: false };
  }
  const normalized = {
    sourceKey,
    feedbackAt: isoOffset(-input.index),
    feedbackNo: eventNo,
    reporter: "模拟客户（仅演练）",
    deviceModel: input.template.model,
    serialNo: `SIM-SN-${suffix}`,
    catheterBatch: `SIM-BATCH-${suffix}`,
    issueDescription: input.template.issue,
    clinicianAware: "可以感知",
    impact: input.template.impact,
    confirmation: "模拟数据，已确认用于流程演练",
    owner: "",
    returned: "否",
    category: input.template.category,
    status: "模拟",
    solutionEngineer: "",
    solution: "",
    finalCause: "",
    customerFollowup: "",
    rawSnapshot: {
      反馈单号: eventNo,
      问题描述: input.template.issue,
      数据标记: "模拟数据，不代表真实客户反馈",
    },
  };
  const contentHash = createHash("sha256").update(json(normalized)).digest("hex");
  input.db.prepare(`INSERT OR IGNORE INTO quality_source_rows(
    source_key,sheet_id,sheet_name,row_number,state,source_version,content_hash,
    normalized_json,raw_snapshot_json,previous_snapshot_json,first_seen_at,last_seen_at,
    source_updated_at,synced_at,version
  ) VALUES(?, 'SIMULATION', '质量流程模拟数据', ?, 'ACTIVE', 1, ?, ?, ?, NULL, ?, ?, NULL, ?, 1)`)
    .run(sourceKey, 10_000 + input.index, contentHash, json(normalized), json(normalized.rawSnapshot), input.now, input.now, input.now);

  input.db.prepare(`INSERT INTO quality_events(
    id,event_no,status,title,problem_status,occurred_at,feedback_at,feedback_user_id,feedback_name,
    device_model,device_serial,catheter_batch,clinician_aware,impact,initial_category,urgency,
    supplement,created_by,submitted_by,submitted_at,overall_due_at,version,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(
    eventId, eventNo, input.status, `[模拟] ${input.template.title}`,
    `${input.template.issue}\n本记录为生产环境流程演练数据，可安全修改。`,
    isoOffset(-input.index), isoOffset(-input.index), "simulation-user", "模拟客户（仅演练）",
    input.template.model, `SIM-SN-${suffix}`, `SIM-BATCH-${suffix}`, "可以感知",
    input.template.impact, input.template.category, input.template.risk,
    "模拟数据，不代表真实产品质量结论。", input.reportManagerUserId,
    input.reportManagerUserId, input.now, isoOffset(14 + (input.index % 8)), input.now, input.now,
  );
  const managerAssessment = {
    sourceKey,
    version: 1,
    handlingRecommendation: "QUALITY_ANOMALY",
    categoryDisplayName: input.template.category,
    riskLevel: input.template.risk,
    conclusion: "模拟主管研判：建议进入质量异常流程并由质量员工完成初析。",
    reviewedBy: input.reportManagerUserId,
    reviewedAt: input.now,
  };
  input.db.prepare(`INSERT OR IGNORE INTO quality_source_assessments(
    source_key,source_version,handling_recommendation,primary_category_code,secondary_category_code,
    category_mode,risk_level,conclusion,adoption_mode,reviewed_by,version,created_at,updated_at
  ) VALUES(?,1,'QUALITY_ANOMALY','SIM','SIM_FLOW','CUSTOM_FULL',?,?,'MANUAL',?,1,?,?)`)
    .run(sourceKey, input.template.risk, managerAssessment.conclusion, input.reportManagerUserId, input.now, input.now);
  input.db.prepare(`INSERT OR IGNORE INTO quality_event_source_links(
    id,event_id,source_key,source_version,source_state_at_link,source_snapshot_json,linked_by,linked_at
  ) VALUES(?,?,?,1,'ACTIVE',?,?,?)`).run(
    `sim-link-${suffix}`, eventId, sourceKey, json(normalized), input.reportManagerUserId, input.now,
  );
  input.db.prepare(`INSERT OR IGNORE INTO quality_event_reporting_context(
    event_id,source_key,assessment_version,created_by,created_at
  ) VALUES(?,?,1,?,?)`).run(eventId, sourceKey, input.reportManagerUserId, input.now);
  input.db.prepare(`INSERT OR IGNORE INTO quality_event_reporting_snapshots(
    event_id,source_snapshots_json,ai_assessments_json,manager_assessments_json,frozen_by,frozen_at
  ) VALUES(?,?,?,?,?,?)`).run(
    eventId,
    json([{ ...normalized, sourceVersion: 1 }]),
    json([{ sourceKey, assessment: null }]),
    json([managerAssessment]),
    input.reportManagerUserId,
    input.now,
  );
  input.db.prepare(`INSERT OR IGNORE INTO quality_source_reviews(
    source_key,status,note,decided_by,decided_at,source_content_hash,assessment_version,
    assessment_snapshot_json,event_id,version,created_at,updated_at
  ) VALUES(?,'REPORTED','模拟流程演练：已正式通报',?,?,?,?,?, ?,1,?,?)`).run(
    sourceKey, input.reportManagerUserId, input.now, contentHash, 1,
    json(managerAssessment), eventId, input.now, input.now,
  );
  input.db.prepare(`INSERT INTO quality_audit_events(
    id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
  ) VALUES(?,?,?,'aftersales_manager','QUALITY_SIMULATION_CREATED',NULL,?,?,?,?)`).run(
    `sim-audit-created-${suffix}`, eventId, input.reportManagerUserId,
    json({ status: input.status, simulation: true }), "生产演练模拟数据",
    `sim-create-${suffix}`, input.now,
  );
  return { eventId, sourceKey, eventNo, inserted: true };
}

function insertFormalAnalysis(input: {
  db: DatabaseSync;
  index: number;
  eventId: string;
  eventNo: string;
  template: SimulationTemplate;
  specialistUserId: string;
  manager: { departmentId: string; departmentName: string; managerUserId: string; managerName: string };
  now: string;
  stagePlanning: boolean;
}): void {
  const suffix = fixedId(input.index);
  const dueAt = isoOffset(14 + (input.index % 8));
  const content: QualityAnalysisDraftContent = {
    problemDirection: "产品质量与过程一致性核查",
    confirmedCategoryReference: input.template.category,
    sourceFactSummary: [input.template.issue, `现场影响：${input.template.impact}`],
    confirmedFacts: ["本记录为模拟数据", "现场已完成替换或隔离，当前无持续影响"],
    analysisBasis: ["模拟客户反馈快照", "模拟主管最终研判"],
    preliminaryConclusion: "需由建议责任部门完成复现、记录核查、根因分析及措施验证。",
    causeHypotheses: ["制造或装配过程波动", "使用条件或附件匹配因素"],
    investigationDirections: ["核查同批次记录与留样", "复现现场条件并验证关键参数"],
    informationGaps: ["待补充实物检测结果"],
    handlingRequirements: ["形成可追溯原因分析", "制定纠正预防措施并上传验证证据"],
    suggestedTotalDueAt: dueAt,
  };
  const deliverables: QualityDeliverable[] = [
    {
      deliverableId: `sim-deliverable-${suffix}-1`,
      name: "原因分析报告",
      description: "覆盖复现、记录核查与根因判断。",
      acceptanceCriteria: "事实、假设和结论分层清晰，引用记录可追溯。",
      source: "HUMAN_CUSTOM",
      selected: true,
      createdAt: input.now,
      updatedAt: input.now,
    },
    {
      deliverableId: `sim-deliverable-${suffix}-2`,
      name: "纠正预防措施与验证记录",
      description: "明确措施、责任和验证方法。",
      acceptanceCriteria: "措施已执行且验证结果满足预期。",
      source: "HUMAN_CUSTOM",
      selected: true,
      createdAt: input.now,
      updatedAt: input.now,
    },
  ];
  const analysisExists = input.db.prepare("SELECT 1 AS ok FROM quality_analysis_versions WHERE event_id=?")
    .get(input.eventId);
  if (!analysisExists) {
    input.db.prepare(`INSERT INTO quality_analysis_versions(
      analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,deliverables_json,diff_json,
      modification_reason,primary_department_id,primary_department_name,collaborator_departments_json,
      primary_manager_user_id,primary_manager_name,primary_manager_account_status,suggested_total_due_at,
      schema_version,prompt_version,model_config_id,input_version,rule_version,case_library_version,
      knowledge_version,generated_by,edited_by,confirmed_by,confirmed_at,created_at
    ) VALUES(?,?,1,?,NULL,?,?,?,?,?,?, '[]',?,?, 'ACTIVE',?,?,NULL,NULL,NULL,?,'simulation-cases-v1',?,NULL,?,?,?,?)`).run(
      `sim-analysis-${suffix}`, input.eventId, `sim-analysis-confirm-${suffix}`,
      json(content), json(deliverables), json({ mode: "SIMULATION" }), "模拟正式初析",
      input.manager.departmentId, input.manager.departmentName,
      input.manager.managerUserId, input.manager.managerName, dueAt,
      QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION, QUALITY_ANALYSIS_RULE_VERSION,
      QUALITY_ANALYSIS_KNOWLEDGE_VERSION, input.specialistUserId, input.specialistUserId,
      input.now, input.now,
    );
  }
  if (!input.stagePlanning) return;
  const handoffExists = input.db.prepare("SELECT 1 AS ok FROM quality_analysis_handoffs WHERE event_id=?")
    .get(input.eventId);
  if (handoffExists) return;
  const integrationKey = `quality-simulation:${input.eventId}:v1`;
  const planning = stageSimulationPlanningThread({
    managerUserId: input.manager.managerUserId,
    eventId: input.eventId,
    eventNo: input.eventNo,
    title: `[模拟] ${input.template.title}`,
    issue: input.template.issue,
    category: input.template.category,
    departmentName: input.manager.departmentName,
    dueAt,
    integrationKey,
    specialistUserId: input.specialistUserId,
  });
  try {
    const taskPackage = {
      qualityEventId: input.eventId,
      eventNo: input.eventNo,
      eventTitle: `[模拟] ${input.template.title}`,
      publicFactSummary: [input.template.issue],
      confirmedCategory: input.template.category,
      formalQualityAnalysis: content,
      problemDirection: content.problemDirection,
      analysisBasis: content.analysisBasis,
      preliminaryConclusion: content.preliminaryConclusion,
      informationGaps: content.informationGaps,
      primaryDepartment: {
        departmentId: input.manager.departmentId,
        departmentName: input.manager.departmentName,
      },
      handlingRequirements: content.handlingRequirements,
      requiredDeliverables: deliverables,
      suggestedTotalDueAt: dueAt,
      analysisVersion: 1,
      firstResponsibleManager: {
        userId: input.manager.managerUserId,
        name: input.manager.managerName,
      },
      simulation: true,
    };
    input.db.prepare(`INSERT INTO quality_analysis_handoffs(
      handoff_id,event_id,analysis_version,integration_key,primary_department_id,
      primary_department_name,primary_manager_user_id,task_package_json,plan_id,thread_id,status,created_at
    ) VALUES(?,?,1,?,?,?,?,?,?,?,'PENDING_PLANNING',?)`).run(
      `sim-handoff-${suffix}`, input.eventId, integrationKey,
      input.manager.departmentId, input.manager.departmentName, input.manager.managerUserId,
      json(taskPackage), planning.planId, planning.threadId, input.now,
    );
    input.db.prepare("UPDATE quality_events SET original_primary_department_id=?,overall_due_at=? WHERE id=?")
      .run(input.manager.departmentId, dueAt, input.eventId);
    input.db.prepare(`INSERT INTO quality_audit_events(
      id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
    ) VALUES(?,?,?,'quality_specialist','QUALITY_ANALYSIS_CONFIRMED',NULL,?,?,?,?)`).run(
      `sim-audit-handoff-${suffix}`, input.eventId, input.specialistUserId,
      json({ analysisVersion: 1, integrationKey, primaryManagerUserId: input.manager.managerUserId, simulation: true }),
      "模拟质量初析推送，不发送钉钉通知", `sim-handoff-${suffix}`, input.now,
    );
  } catch (error) {
    deleteSimulationSideThread(input.manager.managerUserId, planning.threadId);
    throw error;
  }
}

function insertAssignmentProjection(input: {
  db: DatabaseSync;
  index: number;
  eventId: string;
  status: EventStatus;
  specialistUserId: string;
  manager: { departmentName: string; managerUserId: string };
  now: string;
}): void {
  if (["PENDING_ANALYSIS", "PENDING_ASSIGNMENT"].includes(input.status)) return;
  const suffix = fixedId(input.index);
  const nodeStatus = input.status === "PENDING_ACCEPTANCE"
    ? "PENDING_ACCEPTANCE"
    : input.status === "IN_PROGRESS"
      ? "IN_PROGRESS"
      : input.status === "PENDING_PRIMARY_REVIEW"
        ? "PENDING_PARENT_REVIEW"
        : "APPROVED";
  const nodeId = `sim-node-${suffix}`;
  input.db.prepare(`INSERT OR IGNORE INTO quality_assignment_nodes(
    node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,is_primary,
    status,due_at,requirement,version,created_by,request_id,accepted_at,submitted_at,created_at,updated_at
  ) VALUES(?,?,NULL,0,?,'MANAGER',?,1,?,?,?,1,?,?,?, ?,?,?)`).run(
    nodeId, input.eventId, input.manager.managerUserId, input.manager.departmentName,
    // The production reminder scanner is independent from this seeder. A past
    // simulated deadline would therefore create and send a real overdue notice
    // even though the seeder itself never touches the outbox.
    nodeStatus, isoOffset(10 + (input.index % 5)),
    "模拟责任节点：完成原因分析、措施制定与验证证据归档。",
    input.specialistUserId, `sim-node-create-${suffix}`,
    nodeStatus === "PENDING_ACCEPTANCE" ? null : isoOffset(-3),
    ["PENDING_PARENT_REVIEW", "APPROVED"].includes(nodeStatus) ? isoOffset(-1) : null,
    input.now, input.now,
  );
  input.db.prepare("UPDATE quality_events SET primary_node_id=?,original_primary_department_id=COALESCE(original_primary_department_id,'simulation') WHERE id=?")
    .run(nodeId, input.eventId);
  if (["PENDING_PRIMARY_REVIEW", "PENDING_QUALITY_REVIEW", "CLOSED"].includes(input.status)) {
    input.db.prepare(`INSERT OR IGNORE INTO quality_node_reviews(
      review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at
    ) VALUES(?,?,?,?, 'APPROVE','模拟验收记录：材料完整，允许进入下一环节。',1,?,?)`).run(
      `sim-review-${suffix}`, input.eventId, nodeId, input.manager.managerUserId,
      `sim-review-${suffix}`, input.now,
    );
  }
  if (input.status === "CLOSED") {
    input.db.prepare(`INSERT INTO quality_audit_events(
      id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
    ) VALUES(?,?,?,'quality_specialist','QUALITY_EVENT_CLOSED',NULL,?,?,?,?)`).run(
      `sim-audit-closed-${suffix}`, input.eventId, input.specialistUserId,
      json({ conclusion: "模拟终验通过，流程闭环。", simulation: true }),
      "模拟关闭结论", `sim-close-${suffix}`, input.now,
    );
  }
}

export function seedQualitySimulation(params?: {
  dbPath?: string;
  count?: number;
}): { dbPath: string; requested: number; inserted: number; skipped: number; byStatus: Record<string, number> } {
  const dbPath = params?.dbPath ?? resolveWorkbenchSqlitePath();
  const count = Math.max(1, Math.min(Math.floor(params?.count ?? DEFAULT_COUNT), DEFAULT_COUNT));
  createQualityStore(dbPath).close();
  const directory = createQualityDepartmentDirectory(dbPath);
  const managers = directory.listManagerPerspectives();
  directory.close();
  if (managers.length === 0) throw new Error("没有可用的真实部门主管映射，无法生成可流转模拟数据");
  const specialistUserId = listQualitySpecialistUserIds()[0];
  if (!specialistUserId) throw new Error("没有配置质量员工，无法生成可初析模拟数据");
  const reportManager = managers.find((item) => resolveQualityCapabilities(item.managerUserId).canReportQuality)
    ?? managers[0]!;
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  let inserted = 0;
  let skipped = 0;
  const byStatus: Record<string, number> = {};
  try {
    for (let index = 1; index <= count; index += 1) {
      const status = STATUS_SEQUENCE[index - 1]!;
      const template = TEMPLATES[(index - 1) % TEMPLATES.length]!;
      const managerPerspective = managers[(index - 1) % managers.length]!;
      const manager = {
        departmentId: managerPerspective.departmentId,
        departmentName: managerPerspective.departmentName,
        managerUserId: managerPerspective.managerUserId,
        managerName: managerPerspective.managerName,
      };
      const now = isoOffset(0, -(count - index));
      db.exec("BEGIN IMMEDIATE");
      try {
        const base = insertBaseEvent({
          db, index, status, template,
          reportManagerUserId: reportManager.managerUserId,
          specialistUserId,
          now,
        });
        if (base.inserted) inserted += 1;
        else skipped += 1;
        if (base.inserted) {
          if (status !== "PENDING_ANALYSIS") {
            insertFormalAnalysis({
              db, index, eventId: base.eventId, eventNo: base.eventNo, template,
              specialistUserId, manager, now,
              stagePlanning: status === "PENDING_ASSIGNMENT",
            });
          }
          insertAssignmentProjection({
            db, index, eventId: base.eventId, status, specialistUserId, manager, now,
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* no-op */ }
        throw error;
      }
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
  } finally {
    db.close();
  }
  return { dbPath, requested: count, inserted, skipped, byStatus };
}

export function removeQualitySimulation(dbPath = resolveWorkbenchSqlitePath()): {
  dbPath: string;
  softDeleted: number;
  planningThreadsRemoved: number;
} {
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  let planningThreadsRemoved = 0;
  try {
    const handoffs = db.prepare(`SELECT primary_manager_user_id,thread_id
      FROM quality_analysis_handoffs WHERE event_id LIKE ?`).all(`${SIM_EVENT_PREFIX}%`) as
      Array<{ primary_manager_user_id: string; thread_id: string }>;
    for (const handoff of handoffs) {
      if (deleteSimulationSideThread(handoff.primary_manager_user_id, handoff.thread_id)) {
        planningThreadsRemoved += 1;
      }
    }
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE quality_events SET deleted_at=?,updated_at=?
      WHERE id LIKE ? AND deleted_at IS NULL`).run(now, now, `${SIM_EVENT_PREFIX}%`);
    db.prepare(`UPDATE quality_source_rows SET state='DELETED',synced_at=?
      WHERE source_key LIKE ?`).run(now, `${SIM_SOURCE_PREFIX}%`);
    return { dbPath, softDeleted: Number(result.changes), planningThreadsRemoved };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const result = process.argv.includes("--remove")
    ? removeQualitySimulation()
    : seedQualitySimulation();
  process.stdout.write(`${JSON.stringify({ ok: true, simulationPrefix: SIM_PREFIX, ...result }, null, 2)}\n`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry && import.meta.url === entry) {
  void main();
}
