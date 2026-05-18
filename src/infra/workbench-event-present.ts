export type PresentedEventSeverity = "info" | "warn" | "error";

export interface PresentedWorkbenchTaskEvent {
  occurredAt: string;
  type: string;
  severity: PresentedEventSeverity;
  title: string;
  summary: string;
  detail?: string;
}

function asString(v: unknown): string {
  return String(v ?? "").trim();
}

function parsePayload(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map raw `task_events` row to user-facing copy. Unknown types fall back to generic info.
 */
export function presentWorkbenchTaskEvent(
  row: Record<string, unknown>,
  ctx?: {
    resolveActorName?: (userId: string) => string;
    /** When true, include raw JSON payload in `detail` for MANAGER_REASSIGN (admin / debug). */
    showManagerReassignPayload?: boolean;
  },
): PresentedWorkbenchTaskEvent {
  const type = asString(row.event_type);
  const occurredAt = asString(row.occurred_at) || new Date().toISOString();
  const note = asString(row.note);
  const actorId = asString(row.actor_user_id);
  const actor = ctx?.resolveActorName?.(actorId) || actorId || "系统";
  const payload = parsePayload(row.payload_json);
  const subtaskId = asString(row.subtask_id);

  const detailFromNote = (): string | undefined => {
    if (!note) return undefined;
    if (type === "EMPLOYEE_NOTIFY_FAILED") return note;
    if (note.length > 160 || /[{[]/.test(note)) return note;
    return undefined;
  };

  const shortNote = note.length > 120 ? `${note.slice(0, 120)}…` : note;

  const base = (): PresentedWorkbenchTaskEvent => ({
    occurredAt,
    type,
    severity: "info",
    title: "任务事件",
    summary: shortNote || `${actor} 触发 ${type}`,
    detail: detailFromNote(),
  });

  switch (type) {
    case "TASK_PUBLISHED":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "任务发布",
        summary: payload?.taskNo ? `任务已发布，编号 ${asString(payload.taskNo)}` : "任务已发布到工作台",
        detail: note || undefined,
      };
    case "SUBTASK_ACCEPTED":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "员工接受子任务",
        summary: subtaskId ? `${actor} 已接受子任务` : `${actor} 已接受分配`,
        detail: note || undefined,
      };
    case "SUBTASK_PROGRESS":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "员工提交进度",
        summary: shortNote || `${actor} 更新了执行进度`,
        detail: note && note.length > 120 ? note : undefined,
      };
    case "SUBTASK_CHANGES_REQUESTED":
      return {
        occurredAt,
        type,
        severity: "warn",
        title: "员工申请修改",
        summary: shortNote || `${actor} 申请调整任务内容`,
        detail: note || undefined,
      };
    case "SUBTASK_REJECTED":
      return {
        occurredAt,
        type,
        severity: "warn",
        title: "员工拒绝子任务",
        summary: shortNote || `${actor} 拒绝了子任务`,
        detail: note || undefined,
      };
    case "MANAGER_REASSIGN":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "主管改派",
        summary: note || `${actor} 调整了负责人`,
        detail:
          ctx?.showManagerReassignPayload && payload
            ? JSON.stringify(payload, null, 0)
            : undefined,
      };
    case "MANAGER_REASSIGN_SAVED":
    case "manager_reassign_saved":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "改派已保存",
        summary: `${actor} 保存了改派结果`,
        detail: note || undefined,
      };
    case "EMPLOYEE_NOTIFIED":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "钉钉通知已发送",
        summary: "已向员工发送卡片或待办提醒",
        detail: note || undefined,
      };
    case "EMPLOYEE_NOTIFY_SKIPPED":
      return {
        occurredAt,
        type,
        severity: "info",
        title: "通知跳过",
        summary: note || "未开通通知或条件不满足，已跳过发送",
      };
    case "EMPLOYEE_NOTIFY_FAILED": {
      const detail = note || undefined;
      return {
        occurredAt,
        type,
        severity: "error",
        title: "钉钉通知失败",
        summary: "创建待办或发送通知时失败，请查看原始信息",
        detail,
      };
    }
    default:
      return base();
  }
}
