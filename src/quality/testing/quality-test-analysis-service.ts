import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import {
  conversationPlanSessionStore,
  createSideThreadSession,
  deleteSideThreadSession,
} from "../../web/conversation-thread-resolver";
import {
  QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_RULE_VERSION,
} from "../analysis/quality-analysis-contracts";
import { createQualityStore } from "../infra/quality-store";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "./quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

export interface QualityTestPlanningHandoff {
  handoffId: string;
  threadId: string;
  planId: string;
  planningUrl: string;
  created: boolean;
}

export interface CompleteQualityTestAnalysisInput {
  eventId: string;
  testSpecialistUserId: string;
  actualAdminUserId: string;
  expectedVersion: number;
  requestId: string;
  problemDirection: string;
  confirmedCategory: string;
  sourceFactSummary: string;
  analysisBasis: string;
  preliminaryConclusion: string;
  informationGaps?: string;
  handlingRequirements: string;
  suggestedDueAt: string;
  deliverableName: string;
  deliverableDescription: string;
  acceptanceCriteria: string;
}

function splitItems(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredText(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return fallback;
  }
}

export function createQualityTestAnalysisService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function complete(input: CompleteQualityTestAnalysisInput) {
    if (input.testSpecialistUserId !== "QUALITY_TEST_SPECIALIST_001") {
      throw new Error("只有佟成（测试）可以完成测试质量初析");
    }
    const eventBoundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({
      event: eventBoundary,
      actorUserId: input.testSpecialistUserId,
    });
    if (!eventBoundary.isTest) throw new Error("真实质量事件不能使用测试初析动作");

    const repeated = db.prepare(`
      SELECT analysis_id,analysis_version FROM quality_analysis_versions WHERE request_id=?
    `).get(input.requestId) as DatabaseRow | undefined;
    if (repeated) {
      const current = db.prepare("SELECT status,version FROM quality_events WHERE id=?")
        .get(input.eventId) as DatabaseRow;
      return {
        analysisId: String(repeated.analysis_id),
        analysisVersion: Number(repeated.analysis_version),
        eventStatus: String(current.status),
        eventVersion: Number(current.version),
      };
    }

    const event = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    if (Number(event.version) !== input.expectedVersion) throw new Error("version conflict");
    if (String(event.status) !== "PENDING_ANALYSIS") throw new Error("当前事件不在待质量初析状态");

    const suggestedDueAt = requiredText(input.suggestedDueAt, "建议总期限");
    if (!Number.isFinite(Date.parse(suggestedDueAt))) throw new Error("建议总期限格式无效");
    const occurredAt = now();
    const analysisVersion = Number((db.prepare(`
      SELECT COALESCE(MAX(analysis_version),0)+1 AS version
      FROM quality_analysis_versions WHERE event_id=?
    `).get(input.eventId) as DatabaseRow).version);
    const analysisId = id();
    const content = {
      problemDirection: requiredText(input.problemDirection, "问题方向"),
      confirmedCategoryReference: requiredText(input.confirmedCategory, "人工确认分类"),
      sourceFactSummary: splitItems(requiredText(input.sourceFactSummary, "来源事实摘要")),
      confirmedFacts: splitItems(input.sourceFactSummary),
      analysisBasis: splitItems(requiredText(input.analysisBasis, "分析依据")),
      preliminaryConclusion: requiredText(input.preliminaryConclusion, "初步结论"),
      causeHypotheses: ["测试流程中的模拟原因待验证"],
      investigationDirections: ["复核测试记录", "形成原因、措施与验证证据"],
      informationGaps: splitItems(input.informationGaps),
      handlingRequirements: splitItems(requiredText(input.handlingRequirements, "处理要求")),
      suggestedTotalDueAt: suggestedDueAt,
    };
    const deliverables = [{
      deliverableId: `quality-test-deliverable:${input.eventId}:${analysisVersion}`,
      name: requiredText(input.deliverableName, "成果名称"),
      description: requiredText(input.deliverableDescription, "成果说明"),
      acceptanceCriteria: requiredText(input.acceptanceCriteria, "验收标准"),
      source: "AI_SUGGESTED",
      selected: true,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }];

    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`
        INSERT INTO quality_analysis_versions(
          analysis_id,event_id,analysis_version,request_id,base_attempt_id,content_json,
          deliverables_json,diff_json,modification_reason,primary_department_id,
          primary_department_name,collaborator_departments_json,primary_manager_user_id,
          primary_manager_name,primary_manager_account_status,suggested_total_due_at,
          schema_version,prompt_version,model_config_id,input_version,rule_version,
          case_library_version,knowledge_version,generated_by,edited_by,confirmed_by,
          confirmed_at,created_at
        ) VALUES(?,?,?,?,NULL,?,?,?,?,?,'研发中心','[]','QUALITY_TEST_MANAGER_001',
          '测试主管','ACTIVE',?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        analysisId,
        input.eventId,
        analysisVersion,
        input.requestId,
        JSON.stringify(content),
        JSON.stringify(deliverables),
        JSON.stringify({ mode: "TEST_INITIAL_ANALYSIS" }),
        "佟成（测试）确认AI质量初析建议",
        "quality-test-department",
        suggestedDueAt,
        QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
        "quality-test-initial-analysis-v1",
        "quality-test-deterministic",
        `quality-test-event:${input.eventId}:v${input.expectedVersion}`,
        QUALITY_ANALYSIS_RULE_VERSION,
        "quality-test-case-library",
        QUALITY_ANALYSIS_KNOWLEDGE_VERSION,
        input.testSpecialistUserId,
        input.testSpecialistUserId,
        input.testSpecialistUserId,
        occurredAt,
        occurredAt,
      );
      const updated = db.prepare(`
        UPDATE quality_events
        SET status='PENDING_ASSIGNMENT',original_primary_department_id='quality-test-department',
            overall_due_at=?,version=version+1,updated_at=?
        WHERE id=? AND is_test=1 AND version=? AND status='PENDING_ANALYSIS'
      `).run(suggestedDueAt, occurredAt, input.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        INSERT INTO quality_audit_events(
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,
          reason,request_id,occurred_at
        ) VALUES(?,?,?,'quality_specialist','QUALITY_ANALYSIS_CONFIRMED',?,?,?, ?,?)
      `).run(
        id(),
        input.eventId,
        input.testSpecialistUserId,
        JSON.stringify({ eventVersion: input.expectedVersion }),
        JSON.stringify({ analysisVersion, nextStatus: "PENDING_ASSIGNMENT" }),
        "隔离测试质量初析确认",
        input.requestId,
        occurredAt,
      );
      appendQualityTestActionAudit(db, {
        eventId: input.eventId,
        testActorUserId: input.testSpecialistUserId,
        actualAdminUserId: input.actualAdminUserId,
        action: "COMPLETE_INITIAL_ANALYSIS",
        requestId: input.requestId,
        occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    }

    return {
      analysisId,
      analysisVersion,
      eventStatus: "PENDING_ASSIGNMENT",
      eventVersion: input.expectedVersion + 1,
    };
  }

  function preparePlanningHandoff(input: {
    eventId: string;
    testManagerUserId: string;
  }): QualityTestPlanningHandoff {
    if (input.testManagerUserId !== "QUALITY_TEST_MANAGER_001") {
      throw new Error("只有测试主管可以承接测试质量任务");
    }
    const boundary = readQualityEventBoundary(db, input.eventId);
    assertQualityActorBoundary({ event: boundary, actorUserId: input.testManagerUserId });
    if (!boundary.isTest) throw new Error("真实质量事件不能使用测试规划会话");

    const event = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(input.eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    const managerNode = db.prepare(`
      SELECT * FROM quality_assignment_nodes
      WHERE event_id=? AND parent_node_id IS NULL AND assignee_user_id=?
        AND status IN ('PENDING_ACCEPTANCE','IN_PROGRESS')
      ORDER BY created_at DESC LIMIT 1
    `).get(input.eventId, input.testManagerUserId) as DatabaseRow | undefined;
    if (!managerNode) throw new Error("测试主管承接记录不存在");
    const analysis = db.prepare(`
      SELECT * FROM quality_analysis_versions
      WHERE event_id=? ORDER BY analysis_version DESC LIMIT 1
    `).get(input.eventId) as DatabaseRow | undefined;
    if (!analysis) throw new Error("质量初析尚未完成");

    const analysisVersion = Number(analysis.analysis_version);
    const existing = db.prepare(`
      SELECT * FROM quality_analysis_handoffs WHERE event_id=? AND analysis_version=?
    `).get(input.eventId, analysisVersion) as DatabaseRow | undefined;
    if (existing) {
      const threadId = String(existing.thread_id);
      return {
        handoffId: String(existing.handoff_id),
        threadId,
        planId: String(existing.plan_id),
        planningUrl: `/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(threadId)}`,
        created: false,
      };
    }

    const content = parseJson<Record<string, unknown>>(analysis.content_json, {});
    const rawDeliverables = parseJson<Array<Record<string, unknown>>>(analysis.deliverables_json, []);
    const dueAt = String(managerNode.due_at ?? analysis.suggested_total_due_at ?? event.overall_due_at ?? "");
    const handlingRequirements = [
      ...(Array.isArray(content.handlingRequirements)
        ? content.handlingRequirements.map((item) => String(item ?? "").trim())
        : []),
      String(managerNode.requirement ?? "").trim(),
    ].filter((item, index, all) => item && all.indexOf(item) === index);
    const deliverables = rawDeliverables
      .filter((item) => item.selected !== false)
      .map((item, index) => ({
        deliverableId: String(item.deliverableId ?? `quality-test-deliverable:${input.eventId}:${analysisVersion}:${index + 1}`),
        name: String(item.name ?? `必须成果 ${index + 1}`).trim() || `必须成果 ${index + 1}`,
        description: String(item.description ?? managerNode.requirement ?? "按质量初析完成并提交成果").trim(),
        acceptanceCriteria: String(item.acceptanceCriteria ?? "满足质量初析与主管验收要求").trim(),
      }));
    if (!deliverables.length) {
      deliverables.push({
        deliverableId: `quality-test-deliverable:${input.eventId}:${analysisVersion}:1`,
        name: "质量事件处理与验证记录",
        description: String(managerNode.requirement ?? "完成质量事件处理并形成验证记录"),
        acceptanceCriteria: "包含处理过程、结论、证据和验证结果",
      });
    }

    const eventNo = String(event.event_no);
    const eventTitle = String(event.title);
    const taskPackage = {
      schemaVersion: "quality-task-package-v1",
      qualityEventId: input.eventId,
      eventNo,
      eventTitle,
      publicFactSummary: content.sourceFactSummary ?? [],
      confirmedCategory: content.confirmedCategoryReference ?? event.initial_category ?? "待确认",
      formalQualityAnalysis: content,
      problemDirection: content.problemDirection ?? "待确认",
      analysisBasis: content.analysisBasis ?? [],
      preliminaryConclusion: content.preliminaryConclusion ?? "待确认",
      informationGaps: content.informationGaps ?? [],
      primaryDepartment: {
        departmentId: "QUALITY_TEST_DEPT_RND",
        departmentName: "研发中心（测试）",
      },
      handlingRequirements,
      requiredDeliverables: deliverables,
      suggestedTotalDueAt: dueAt,
      attachments: [],
      analysisVersion,
      firstResponsibleManager: { userId: input.testManagerUserId, name: "测试主管" },
      testIsolation: true,
    };
    const side = createSideThreadSession(input.testManagerUserId);
    const threadId = String(side.threadId ?? "").trim();
    if (!threadId) throw new Error("测试任务规划会话创建失败");
    const integrationKey = `quality-analysis:${input.eventId}:v${analysisVersion}`;
    const bullets = (value: unknown, empty = "无"): string => {
      const values = Array.isArray(value) ? value : [value];
      const items = values.map((item) => String(item ?? "").trim()).filter(Boolean);
      return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
    };
    const description = [
      `# 质量事件任务草稿｜${eventNo}`,
      "",
      `**事件标题：** ${eventTitle}`,
      "**接收主管：** 测试主管",
      `**建议总期限：** ${dueAt}`,
      "",
      "## 来源事实摘要",
      bullets(taskPackage.publicFactSummary, "尚未提供"),
      "",
      "## 质量初析",
      `- 问题方向：${String(taskPackage.problemDirection)}`,
      `- 人工确认分类：${String(taskPackage.confirmedCategory)}`,
      `- 初步结论：${String(taskPackage.preliminaryConclusion)}`,
      "",
      "## 分析依据",
      bullets(taskPackage.analysisBasis, "尚未提供"),
      "",
      "## 处理要求",
      bullets(handlingRequirements, "尚未提供"),
      "",
      "## 主管下一步",
      "请在原智能规划助手中完善任务步骤、负责人、交付物、验收标准、截止和前后依赖；确认前不会自动发放。",
    ].join("\n");
    const staged = {
      ...side,
      threadLabel: `质量事件 ${eventNo}`.slice(0, 40),
      latestDraft: {
        title: `${eventNo} ${eventTitle}`.slice(0, 200),
        description,
        summary: description,
        tasks: deliverables.map((deliverable, index) => ({
          id: `task_${index + 1}`,
          title: deliverable.name,
          objective: deliverable.description,
          deliverables: [deliverable.name],
          completionCriteria: [deliverable.acceptanceCriteria],
          timeNode: { dueAt },
          qualityDeliverableIds: [deliverable.deliverableId],
          qualityEventId: input.eventId,
        })),
        qualityTaskPackage: taskPackage,
        qualityHandoff: {
          integrationKey,
          qualityEventId: input.eventId,
          analysisVersion,
          requiredDeliverableIds: deliverables.map((item) => item.deliverableId),
        },
      },
      conversationHistory: [{
        role: "assistant",
        content: `已接收质量事件 ${eventNo}。质量背景、初析、处理要求、必须成果和期限已写入待确认草案；当前尚未发放任务。`,
        displayContent: [
          `## 已接收质量事件 ${eventNo}`,
          "",
          `- 事件：${eventTitle}`,
          "- 接收主管：测试主管",
          `- 建议总期限：${dueAt}`,
          `- 必须成果：${deliverables.map((item) => item.name).join("、")}`,
          "",
          "质量背景、质量初析和处理要求已写入待确认草案。你可以直接编辑草案，或点击“让机器人完善任务规划”；系统不会自动发放。",
        ].join("\n"),
        at: now(),
      }],
      knownFacts: [
        `qualityEventId:${input.eventId}`,
        `qualityAnalysisVersion:${analysisVersion}`,
        `qualityIntegrationKey:${integrationKey}`,
      ],
    };
    conversationPlanSessionStore.save(staged);

    const handoffId = id();
    try {
      db.prepare(`INSERT INTO quality_analysis_handoffs(
        handoff_id,event_id,analysis_version,integration_key,primary_department_id,
        primary_department_name,primary_manager_user_id,task_package_json,plan_id,
        thread_id,status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING_PLANNING',?)`).run(
        handoffId,
        input.eventId,
        analysisVersion,
        integrationKey,
        "QUALITY_TEST_DEPT_RND",
        "研发中心（测试）",
        input.testManagerUserId,
        JSON.stringify(taskPackage),
        side.planId,
        threadId,
        now(),
      );
    } catch (error) {
      deleteSideThreadSession(input.testManagerUserId, threadId);
      throw error;
    }
    return {
      handoffId,
      threadId,
      planId: side.planId,
      planningUrl: `/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(threadId)}`,
      created: true,
    };
  }

  function discardPlanningHandoff(input: QualityTestPlanningHandoff & { testManagerUserId: string }): void {
    if (!input.created) return;
    db.prepare("DELETE FROM quality_analysis_handoffs WHERE handoff_id=? AND status='PENDING_PLANNING'")
      .run(input.handoffId);
    deleteSideThreadSession(input.testManagerUserId, input.threadId);
  }

  return { complete, preparePlanningHandoff, discardPlanningHandoff, close: () => db.close() };
}
