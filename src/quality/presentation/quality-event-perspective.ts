import { DatabaseSync } from "node:sqlite";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from
  "../ai-original-assessment/historical-feedback-taxonomy-v0";
import {
  listQualityAftersalesManagerUserIds,
  resolveQualityCapabilities,
} from "../../security/quality-capabilities";
import { resolveWorkbenchCapabilities } from "../../security/workbench-capabilities";
import {
  getQualityTestActorByUserId,
  resolveQualityTestActor,
  type QualityPerspective,
  type QualityTestActor,
} from "../testing/quality-test-actors";
import {
  qualityActionLabel,
  qualityDecisionLabel,
  qualityNotificationLabel,
  qualityStatusLabel,
  qualityUrgencyLabel,
} from "./quality-display-labels";

type DatabaseRow = Record<string, unknown>;

export interface QualityPerspectiveRequest {
  viewerUserId: string;
  perspective?: QualityPerspective | null;
  testActorRef?: string | null;
}

export interface QualityPerspectiveContext {
  scope: "real" | "test";
  perspective: QualityPerspective;
  actorUserId: string;
  testActor: QualityTestActor | null;
  isAdmin: boolean;
  readonly: boolean;
}

export interface QualityEventSummaryViewModel {
  actionRef: string;
  eventNumber: string;
  title: string;
  statusLabel: string;
  urgencyLabel: string;
  currentOwnerName: string;
  currentDepartmentName: string;
  updatedAt: string;
  testBadge: string | null;
}

const FACT_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "反馈单号", keys: ["反馈单号", "feedbackNo"] },
  { label: "反馈时间", keys: ["反馈时间", "feedbackAt", "发生时间"] },
  { label: "反馈人", keys: ["反馈人", "reporter", "feedbackName"] },
  { label: "设备型号", keys: ["设备型号", "deviceModel"] },
  { label: "设备序列号", keys: ["设备序列号", "序列号", "serialNo", "deviceSerial"] },
  { label: "导管批次", keys: ["导管批次", "catheterBatch"] },
  { label: "问题分类", keys: ["问题分类", "category", "initialCategory"] },
  { label: "问题描述", keys: ["问题描述", "issueDescription", "problemStatus"] },
  { label: "术者感知", keys: ["术者是否感知", "术者是否可感知", "clinicianAware"] },
  { label: "影响说明", keys: ["影响", "impact"] },
  { label: "确认情况", keys: ["确认情况", "confirmation"] },
  { label: "解决方案", keys: ["解决方案", "solution"] },
  { label: "最终原因", keys: ["最终原因", "finalCause"] },
];

function nullable(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function stageKey(status: unknown): string {
  const keys: Record<string, string> = {
    DRAFT: "draft",
    PENDING_ANALYSIS: "pending-analysis",
    PENDING_ASSIGNMENT: "awaiting-supervisor",
    PENDING_ACCEPTANCE: "awaiting-acceptance",
    IN_PROGRESS: "in-progress",
    PENDING_PRIMARY_REVIEW: "manager-review",
    PENDING_QUALITY_REVIEW: "quality-review",
    CLOSED: "closed",
  };
  return keys[String(status ?? "")] ?? "unknown";
}

function safePerspective(value: unknown): QualityPerspective | null {
  const perspective = String(value ?? "");
  return ["aftersales", "quality_management", "manager", "employee", "dashboard"].includes(perspective)
    ? perspective as QualityPerspective
    : null;
}

export function resolveQualityPerspectiveContext(input: QualityPerspectiveRequest): QualityPerspectiveContext {
  const workbench = resolveWorkbenchCapabilities(input.viewerUserId);
  const isAdmin = workbench.primaryRole === "admin";
  const testActor = resolveQualityTestActor(input.testActorRef);
  if (testActor) {
    if (!isAdmin) throw new Error("只有管理员可以进入质量测试视角");
    return {
      scope: "test",
      perspective: testActor.perspective,
      actorUserId: testActor.userId,
      testActor,
      isAdmin,
      readonly: false,
    };
  }
  const requested = safePerspective(input.perspective);
  if (isAdmin) {
    const perspective = requested ?? "aftersales";
    const aftersales = listQualityAftersalesManagerUserIds()[0] ?? input.viewerUserId;
    return {
      scope: "real",
      perspective,
      actorUserId: perspective === "aftersales" ? aftersales : input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: true,
    };
  }
  const quality = resolveQualityCapabilities(input.viewerUserId);
  if (quality.roles.includes("aftersales_manager")) {
    return {
      scope: "real",
      perspective: "aftersales",
      actorUserId: input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: false,
    };
  }
  if (quality.hasQualityManagement) {
    return {
      scope: "real",
      perspective: "quality_management",
      actorUserId: input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: false,
    };
  }
  throw new Error("无质量业务访问权限");
}

export function createQualityEventPerspectiveProjector(
  dbPath = resolveWorkbenchSqlitePath(),
) {
  const people = createPeopleDirectoryStore(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");

  function displayName(userId: unknown): string {
    const normalized = String(userId ?? "").trim();
    if (!normalized) return "暂未指定";
    const testActor = getQualityTestActorByUserId(normalized);
    if (testActor) return testActor.displayName;
    return people.getContact(normalized)?.name?.trim() || "相关人员";
  }

  function eventRow(eventId: string): DatabaseRow | null {
    return db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(eventId) as DatabaseRow | undefined ?? null;
  }

  function nodes(eventId: string): DatabaseRow[] {
    return db.prepare(`
      SELECT * FROM quality_assignment_nodes
      WHERE event_id=? AND status<>'CANCELLED'
      ORDER BY depth,created_at,node_id
    `).all(eventId) as DatabaseRow[];
  }

  function activeRoot(allNodes: DatabaseRow[]): DatabaseRow | null {
    const roots = allNodes.filter((node) => node.parent_node_id == null && String(node.status) !== "REJECTED");
    return roots.at(-1) ?? null;
  }

  function summary(row: DatabaseRow): QualityEventSummaryViewModel {
    const root = activeRoot(nodes(String(row.id)));
    return {
      actionRef: String(row.id),
      eventNumber: String(row.event_no),
      title: String(row.title),
      statusLabel: qualityStatusLabel(row.status),
      urgencyLabel: qualityUrgencyLabel(row.urgency),
      currentOwnerName: displayName(root?.assignee_user_id),
      currentDepartmentName: nullable(root?.department_name) ?? "暂未指定",
      updatedAt: String(row.updated_at),
      testBadge: Number(row.is_test ?? 0) === 1 ? "测试事件" : null,
    };
  }

  function canSeeEvent(row: DatabaseRow, context: QualityPerspectiveContext): boolean {
    const isTest = Number(row.is_test ?? 0) === 1;
    if ((context.scope === "test") !== isTest) return false;
    if (context.isAdmin && context.scope === "real") return true;
    if (context.perspective === "dashboard") return context.isAdmin;
    if (context.perspective === "aftersales") return String(row.created_by) === context.actorUserId;
    if (context.perspective === "quality_management") return String(row.status) !== "DRAFT";
    return nodes(String(row.id)).some((node) => String(node.assignee_user_id) === context.actorUserId);
  }

  function listEvents(input: QualityPerspectiveRequest) {
    const context = resolveQualityPerspectiveContext(input);
    const rows = db.prepare(`
      SELECT * FROM quality_events
      WHERE deleted_at IS NULL AND is_test=?
      ORDER BY updated_at DESC,id
    `).all(context.scope === "test" ? 1 : 0) as DatabaseRow[];
    const visible = rows.filter((row) => canSeeEvent(row, context));
    const events = visible.map(summary);
    const stages = visible.map((row) => stageKey(row.status));
    const stats = {
      total: events.length,
      awaitingAction: stages.filter((stage) => ["awaiting-supervisor", "awaiting-acceptance", "manager-review", "quality-review"].includes(stage)).length,
      inProgress: stages.filter((stage) => stage === "in-progress").length,
      closed: stages.filter((stage) => stage === "closed").length,
    };
    return { context, events, stats };
  }

  function factRows(eventId: string) {
    const links = db.prepare(`
      SELECT source_snapshot_json FROM quality_event_source_links
      WHERE event_id=? ORDER BY linked_at,id
    `).all(eventId) as DatabaseRow[];
    const facts: Array<{ label: string; value: string }> = [];
    const seen = new Set<string>();
    for (const link of links) {
      const snapshot = parseObject(link.source_snapshot_json);
      for (const field of FACT_FIELDS) {
        const value = field.keys.map((key) => nullable(snapshot[key])).find(Boolean);
        if (!value || seen.has(`${field.label}:${value}`)) continue;
        seen.add(`${field.label}:${value}`);
        facts.push({ label: field.label, value });
      }
    }
    return facts.slice(0, 80);
  }

  function categoryLabel(
    primaryCode: unknown,
    secondaryCode: unknown,
    customPrimary?: unknown,
    customSecondary?: unknown,
  ): string {
    const custom = [nullable(customPrimary), nullable(customSecondary)].filter(Boolean).join("／");
    if (custom) return custom;
    const primary = HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.find(
      (item) => item.primaryCode === String(primaryCode ?? ""),
    );
    const secondary = primary?.secondaryCategories.find(
      (item) => item.secondaryCode === String(secondaryCode ?? ""),
    );
    return [primary?.primaryLabel, secondary?.secondaryLabel].filter(Boolean).join("／")
      || "分类待确认";
  }

  function originalAssessment(eventId: string) {
    const row = tableExists(db, "quality_source_ai_assessments")
      ? db.prepare(`
          SELECT ai.output_json
          FROM quality_source_ai_assessments ai
          JOIN quality_event_source_links link ON link.source_key=ai.source_key
          WHERE link.event_id=?
          ORDER BY ai.source_version DESC,ai.created_at DESC
          LIMIT 1
        `).get(eventId) as DatabaseRow | undefined
      : undefined;
    const ai = row ? parseObject(row.output_json) : null;
    const reasoning = Array.isArray(ai?.reasoningBasis)
      ? ai!.reasoningBasis as Array<Record<string, unknown>>
      : [];
    const missing = Array.isArray(ai?.missingInformation)
      ? ai!.missingInformation as Array<Record<string, unknown>>
      : [];
    const recommendation = ai?.handlingRecommendation;
    const risk = String(ai?.riskLevel ?? "");
    const riskLabel = risk === "HIGH" ? "高风险"
      : risk === "MEDIUM" ? "中风险"
        : risk === "LOW" ? "低风险" : "风险待人工确认";
    const evidenceStrength = missing.length === 0
      ? "证据较强"
      : missing.length <= 2 ? "一般" : "证据不足";
    return {
      available: ai != null,
      summary: nullable(ai?.summary)
        ?? (ai
          ? `AI建议：${qualityDecisionLabel(recommendation)}；建议分类：${categoryLabel(ai?.primaryCategoryCode, ai?.secondaryCategoryCode)}。`
          : "当前事件未保存 AI 原始研判建议。"),
      recommendedDecision: recommendation == null
        ? "建议暂不可用"
        : qualityDecisionLabel(recommendation),
      suggestedCategory: ai
        ? categoryLabel(ai.primaryCategoryCode, ai.secondaryCategoryCode)
        : "分类待确认",
      suggestedRisk: riskLabel,
      evidenceStrength: ai ? evidenceStrength : "证据情况暂不可用",
      reasons: reasoning.map((item) => nullable(item.statement)).filter(Boolean).slice(0, 20),
      missingInformation: missing.map((item) => {
        const field = nullable(item.field);
        const reason = nullable(item.reason);
        return [field, reason].filter(Boolean).join("：");
      }).filter(Boolean).slice(0, 20),
    };
  }

  function finalAssessment(eventId: string) {
    if (!tableExists(db, "quality_source_assessments")) return [];
    return (db.prepare(`
      SELECT assessment.*,review.status AS disposition_status,review.note AS disposition_note,
             review.decided_at AS disposition_at
      FROM quality_source_assessments assessment
      JOIN quality_event_source_links link ON link.source_key=assessment.source_key
      LEFT JOIN quality_source_reviews review ON review.source_key=assessment.source_key
      WHERE link.event_id=?
      ORDER BY assessment.updated_at DESC
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      conclusion: qualityDecisionLabel(row.handling_recommendation),
      category: categoryLabel(
        row.primary_category_code,
        row.secondary_category_code,
        row.custom_primary_category_name,
        row.custom_secondary_category_name,
      ),
      riskLabel: qualityUrgencyLabel(row.risk_level),
      note: nullable(row.conclusion) ?? "无补充说明",
      adoptionLabel: String(row.adoption_mode) === "DIRECT" ? "直接采纳"
        : String(row.adoption_mode) === "MODIFIED" ? "修改后采纳" : "人工研判",
      changeReason: nullable(row.change_reason),
      dispositionLabel: row.disposition_status == null
        ? "尚未正式处置"
        : qualityDecisionLabel(row.disposition_status),
      reviewerName: displayName(row.reviewed_by),
      decidedAt: String(row.updated_at),
    }));
  }

  function initialAnalysis(eventId: string, perspective: QualityPerspective) {
    if (!tableExists(db, "quality_analysis_versions")) return { latest: null, versions: [] };
    const rows = db.prepare(`
      SELECT * FROM quality_analysis_versions
      WHERE event_id=? ORDER BY analysis_version DESC
    `).all(eventId) as DatabaseRow[];
    const allowed = perspective === "manager" || perspective === "employee" ? rows.slice(0, 1) : rows;
    const versions = allowed.map((row) => ({
      actionRef: String(row.analysis_id),
      versionLabel: `V${Number(row.analysis_version)}`,
      statusLabel: "已完成",
      problemDirection: nullable(parseObject(row.content_json).problemDirection) ?? "信息暂不可用",
      confirmedCategory: nullable(parseObject(row.content_json).confirmedCategoryReference) ?? "信息暂不可用",
      sourceSummary: (Array.isArray(parseObject(row.content_json).sourceFactSummary)
        ? parseObject(row.content_json).sourceFactSummary as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      analysisBasis: (Array.isArray(parseObject(row.content_json).analysisBasis)
        ? parseObject(row.content_json).analysisBasis as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      initialConclusion: nullable(parseObject(row.content_json).preliminaryConclusion) ?? "信息暂不可用",
      informationGaps: (Array.isArray(parseObject(row.content_json).informationGaps)
        ? parseObject(row.content_json).informationGaps as unknown[] : [])
        .map(String).join("；") || "暂无",
      suggestedDepartment: nullable(row.primary_department_name) ?? "部门待确认",
      processingRequirements: (Array.isArray(parseObject(row.content_json).handlingRequirements)
        ? parseObject(row.content_json).handlingRequirements as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      deliverables: parseArray(row.deliverables_json).map((item) => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          name: nullable(value.name) ?? "待确认成果",
          description: nullable(value.description) ?? "",
          acceptanceCriteria: nullable(value.acceptanceCriteria) ?? "",
          selected: value.selected !== false,
        };
      }).filter((item) => item.selected),
      suggestedDueAt: String(row.suggested_total_due_at),
      updatedAt: String(row.confirmed_at),
    }));
    return { latest: versions[0] ?? null, versions };
  }

  function visibleNodes(allNodes: DatabaseRow[], context: QualityPerspectiveContext): DatabaseRow[] {
    if (context.perspective !== "manager" && context.perspective !== "employee") return allNodes;
    if (context.perspective === "employee") {
      return allNodes.filter((node) => String(node.assignee_user_id) === context.actorUserId);
    }
    const children = new Map<string, DatabaseRow[]>();
    for (const node of allNodes) {
      const parent = nullable(node.parent_node_id);
      if (!parent) continue;
      const bucket = children.get(parent) ?? [];
      bucket.push(node);
      children.set(parent, bucket);
    }
    const result: DatabaseRow[] = [];
    const add = (node: DatabaseRow) => {
      result.push(node);
      for (const child of children.get(String(node.node_id)) ?? []) add(child);
    };
    for (const node of allNodes) {
      if (String(node.assignee_user_id) === context.actorUserId) add(node);
    }
    return [...new Map(result.map((node) => [String(node.node_id), node])).values()];
  }

  function getEventDetail(input: QualityPerspectiveRequest & { eventId: string }) {
    let context = resolveQualityPerspectiveContext(input);
    const row = eventRow(input.eventId);
    if (!row || !canSeeEvent(row, context)) return null;
    const allNodes = nodes(input.eventId);
    if (context.isAdmin && context.scope === "real" && context.perspective === "manager") {
      const root = activeRoot(allNodes);
      if (root) context = { ...context, actorUserId: String(root.assignee_user_id) };
    }
    const branch = visibleNodes(allNodes, context);
    if ((context.perspective === "manager" || context.perspective === "employee") && branch.length === 0) return null;
    const nodeRefs = new Set(branch.map((node) => String(node.node_id)));
    const evidenceRows = tableExists(db, "quality_evidence")
      ? db.prepare("SELECT * FROM quality_evidence WHERE event_id=? ORDER BY created_at,evidence_id").all(input.eventId) as DatabaseRow[]
      : [];
    const reviewRows = tableExists(db, "quality_node_reviews")
      ? db.prepare("SELECT * FROM quality_node_reviews WHERE event_id=? ORDER BY created_at,review_id").all(input.eventId) as DatabaseRow[]
      : [];
    const auditRows = tableExists(db, "quality_audit_events")
      ? db.prepare("SELECT * FROM quality_audit_events WHERE event_id=? ORDER BY occurred_at,id").all(input.eventId) as DatabaseRow[]
      : [];
    const notificationRows = tableExists(db, "quality_notification_outbox")
      ? db.prepare("SELECT * FROM quality_notification_outbox WHERE event_id=? ORDER BY created_at,notification_id").all(input.eventId) as DatabaseRow[]
      : [];
    const managerAuditVisible = (audit: DatabaseRow) => {
      if (context.perspective !== "manager" && context.perspective !== "employee") return true;
      for (const raw of [audit.before_json, audit.after_json]) {
        const value = parseObject(raw);
        if (value.nodeId != null && nodeRefs.has(String(value.nodeId))) return true;
        if (value.returnedNodeId != null && nodeRefs.has(String(value.returnedNodeId))) return true;
      }
      return String(audit.actor_user_id) === context.actorUserId;
    };
    const root = activeRoot(allNodes);
    const readonly = context.readonly || context.perspective === "dashboard";
    const allowedActions: string[] = [];
    if (!readonly && context.perspective === "quality_management") {
      if (String(row.status) === "PENDING_ASSIGNMENT") allowedActions.push("assign-supervisor");
      if (String(row.status) === "PENDING_QUALITY_REVIEW") allowedActions.push("return-node", "close");
      if (String(row.status) === "CLOSED") allowedActions.push("reopen");
    }
    if (!readonly && context.perspective === "manager") {
      const ownPending = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && String(node.status) === "PENDING_ACCEPTANCE");
      if (ownPending) allowedActions.push("accept", "reject");
      const ownActive = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && ["IN_PROGRESS", "RETURNED"].includes(String(node.status)));
      if (ownActive) allowedActions.push("delegate", "upload-evidence", "submit-completion");
      if (branch.some((node) => String(node.parent_node_id) === ownActive?.node_id
        && String(node.status) === "PENDING_PARENT_REVIEW")) allowedActions.push("review-child");
      if (String(row.status) === "PENDING_PRIMARY_REVIEW"
        && root && String(root.assignee_user_id) === context.actorUserId) allowedActions.push("primary-review");
    }
    if (!readonly && context.perspective === "employee") {
      const ownPending = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && String(node.status) === "PENDING_ACCEPTANCE");
      if (ownPending) allowedActions.push("accept", "reject");
      const ownActive = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && ["IN_PROGRESS", "RETURNED"].includes(String(node.status)));
      if (ownActive) allowedActions.push("upload-evidence", "submit-completion");
    }
    if (!readonly && context.perspective === "aftersales" && String(row.status) !== "CLOSED") {
      allowedActions.push("supplement", "correct");
    }
    const viewModel: Record<string, unknown> = {
      scope: context.scope,
      perspective: context.perspective,
      readonly,
      actorLabel: context.testActor?.displayName
        ?? (context.perspective === "aftersales" ? "马荣鑫视角"
          : context.perspective === "quality_management" ? "佟成视角"
            : context.perspective === "manager" ? "主管视角"
              : context.perspective === "employee" ? "员工视角" : "管理看板"),
      event: {
        ...summary(row),
        currentSituation: String(row.problem_status),
        occurredAt: nullable(row.occurred_at),
        feedbackAt: nullable(row.feedback_at),
        feedbackName: nullable(row.feedback_name),
        deviceModel: nullable(row.device_model),
        deviceSerial: nullable(row.device_serial),
        catheterBatch: nullable(row.catheter_batch),
        initialCategory: nullable(row.initial_category),
        impact: nullable(row.impact),
        supplement: nullable(row.supplement),
        overallDueAt: nullable(row.overall_due_at),
        version: Number(row.version),
      },
      sourceFacts: factRows(input.eventId),
      initialAnalysis: context.perspective === "aftersales" ? undefined : initialAnalysis(input.eventId, context.perspective),
      supervisorAssignment: {
        assigned: root != null,
        supervisorName: displayName(root?.assignee_user_id),
        departmentName: nullable(root?.department_name) ?? "暂未指定",
        statusLabel: root ? qualityStatusLabel(root.status) : "等待选择主管",
      },
      branch: branch.map((node) => ({
        actionRef: String(node.node_id),
        parentActionRef: nullable(node.parent_node_id) && nodeRefs.has(String(node.parent_node_id))
          ? String(node.parent_node_id)
          : null,
        assigneeName: displayName(node.assignee_user_id),
        assigneeTypeLabel: String(node.assignee_kind) === "MANAGER" ? "主管" : "员工",
        departmentName: nullable(node.department_name) ?? "部门待确认",
        statusLabel: qualityStatusLabel(node.status),
        dueAt: String(node.due_at),
        requirement: String(node.requirement),
        version: Number(node.version),
      })),
      evidence: evidenceRows.filter((item) => !["manager", "employee"].includes(context.perspective) || nodeRefs.has(String(item.node_id))).map((item) => ({
        actionRef: String(item.evidence_id),
        fileName: String(item.original_name),
        summary: String(item.summary ?? ""),
        uploaderName: displayName(item.uploaded_by),
        createdAt: String(item.created_at),
      })),
      reviews: reviewRows.filter((item) => !["manager", "employee"].includes(context.perspective) || nodeRefs.has(String(item.node_id))).map((item) => ({
        reviewerName: displayName(item.reviewer_user_id),
        conclusion: String(item.decision) === "APPROVE" ? "通过" : "退回",
        reason: nullable(item.reason) ?? "无补充说明",
        createdAt: String(item.created_at),
      })),
      audit: auditRows.filter(managerAuditVisible).map((item) => ({
        actorName: displayName(item.actor_user_id),
        actionLabel: qualityActionLabel(item.action),
        reason: nullable(item.reason),
        occurredAt: String(item.occurred_at),
      })),
      notifications: notificationRows
        .filter((item) => !["manager", "employee"].includes(context.perspective) || String(item.recipient_user_id) === context.actorUserId)
        .map((item) => ({
          recipientName: displayName(item.recipient_user_id),
          resultLabel: qualityNotificationLabel(item.status, item.channel),
          subject: String(item.subject),
          createdAt: String(item.created_at),
        })),
      allowedActions,
    };
    if (context.perspective === "aftersales") {
      viewModel.assessment = {
        originalSuggestion: originalAssessment(input.eventId),
        finalReviews: finalAssessment(input.eventId),
      };
    }
    return { context, viewModel };
  }

  return { listEvents, getEventDetail, close: () => { people.close(); db.close(); } };
}
