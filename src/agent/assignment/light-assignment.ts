import type { Confidence } from "./types";

const LIGHT_ASSIGNMENT_PROMPT_VERSION = "orchestrator-light-assignment-v1";

interface LightAssignmentCandidate {
  userId: string;
  displayName: string;
  rationale: string;
}

interface LightAssignmentItem {
  taskId: string;
  primary: LightAssignmentCandidate;
  confidence: Confidence;
}

export interface LightAssignmentDraft {
  planId: string;
  traceId: string;
  generatedAt: string;
  promptVersion: string;
  modelName: string;
  assignments: LightAssignmentItem[];
}

export interface LightAssignmentInput {
  rawAssignment: unknown;
  planId: string;
  traceId: string;
  modelName: string;
  taskIds: string[];
  employees: Array<{ userId: string; displayName: string }>;
  /**
   * 主管上传花名册产生的候选池。提供时会与 employees 取交集做白名单：
   * 即只接受同时存在于「候选池」且「通讯录」中的 userId。落库后 publish_task / 通知
   * 仍走通讯录拿真实 unionId，不会被池里残留的离线 ID 污染。
   */
  candidatePoolUserIds?: string[];
}

export function extractLightAssignment(
  input: LightAssignmentInput,
): { ok: true; draft: LightAssignmentDraft } | { ok: false; reason: string } {
  if (!isPlainObject(input.rawAssignment)) {
    return { ok: false, reason: "assignment payload is missing or not an object" };
  }
  const rawAssignments = input.rawAssignment.assignments;
  if (!Array.isArray(rawAssignments) || rawAssignments.length === 0) {
    return { ok: false, reason: "assignment.assignments must be a non-empty array" };
  }

  const allowedTaskIds = new Set(input.taskIds);
  const employeeMap = new Map(
    input.employees.map((e) => [e.userId.trim(), e.displayName.trim() || e.userId.trim()]),
  );
  const poolIds = input.candidatePoolUserIds && input.candidatePoolUserIds.length > 0
    ? new Set(input.candidatePoolUserIds.map((id) => id.trim()).filter(Boolean))
    : undefined;

  const assignments: LightAssignmentItem[] = [];
  for (const item of rawAssignments) {
    if (!isPlainObject(item)) continue;
    const taskId = asNonEmptyString(item.taskId);
    if (!taskId || !allowedTaskIds.has(taskId)) continue;
    const primaryRaw = item.primary;
    if (!isPlainObject(primaryRaw)) continue;

    const userId = asNonEmptyString(primaryRaw.userId);
    if (!userId || !employeeMap.has(userId)) continue;
    if (poolIds && !poolIds.has(userId)) continue; // 硬约束：必须在候选池内

    const displayName = asNonEmptyString(primaryRaw.displayName) ?? employeeMap.get(userId)!;
    const rationale = asNonEmptyString(primaryRaw.rationale) ?? "模型未提供明确理由";
    const confidence = toConfidence(item.confidence);
    assignments.push({
      taskId,
      primary: { userId, displayName, rationale },
      confidence,
    });
  }

  if (assignments.length === 0) {
    return {
      ok: false,
      reason: poolIds
        ? "no assignment entry matched candidate pool"
        : "no valid assignment entries after lightweight validation",
    };
  }

  return {
    ok: true,
    draft: {
      planId: input.planId,
      traceId: input.traceId,
      generatedAt: new Date().toISOString(),
      promptVersion: LIGHT_ASSIGNMENT_PROMPT_VERSION,
      modelName: input.modelName,
      assignments,
    },
  };
}

export function renderLightAssignmentSection(draft: LightAssignmentDraft): string {
  const rows = draft.assignments.map((a) =>
    `| ${a.taskId} | ${a.primary.displayName} | ${a.confidence} | ${a.primary.rationale} |`,
  );
  return (
    "\n\n### 分配建议\n| 任务 | 推荐负责人 | 置信度 | 理由 |\n|---|---|---|---|\n" +
    rows.join("\n")
  );
}

function toConfidence(raw: unknown): Confidence {
  const v = asNonEmptyString(raw)?.toUpperCase();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW") return v;
  return "MEDIUM";
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
