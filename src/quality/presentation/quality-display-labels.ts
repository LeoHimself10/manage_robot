const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_ANALYSIS: "待质量初析",
  PENDING_ASSIGNMENT: "待主管选择",
  PENDING_ACCEPTANCE: "待主管承接",
  IN_PROGRESS: "处理中",
  PENDING_PRIMARY_REVIEW: "待主管确认",
  PENDING_QUALITY_REVIEW: "待质量终验",
  CLOSED: "已关闭",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  RETURNED: "已退回",
  CANCELLED: "已取消",
  PENDING_PARENT_REVIEW: "待上级验收",
};

const ACTION_LABELS: Record<string, string> = {
  DRAFT_CREATED: "创建通报草稿",
  DRAFT_UPDATED: "更新通报草稿",
  EVENT_SUBMITTED: "正式通报质量事件",
  SUPPLEMENT_ADDED: "补充事件事实",
  REPORT_CORRECTED: "更正事件信息",
  PRIMARY_ASSIGNED: "选择责任主管",
  QUALITY_NODE_ACCEPTED: "主管接受承接",
  QUALITY_NODE_REJECTED: "主管拒绝承接",
  QUALITY_NODE_DELEGATED: "分配部门员工",
  QUALITY_CHILD_DUE_CHANGED: "调整下级期限",
  QUALITY_NODE_PUBLIC_NOTE: "补充处理说明",
  QUALITY_DIRECT_CHILD_REVIEWED: "完成下级验收",
  QUALITY_PRIMARY_APPROVED: "完成主管验收",
  QUALITY_PRIMARY_RETURNED_BRANCH: "退回责任分支",
  QUALITY_RETURNED: "质量终验退回",
  QUALITY_CLOSED: "关闭质量事件",
  QUALITY_REOPENED: "重开质量事件",
  QUALITY_NOTIFICATION_REQUEUED: "重新记录通知",
};

const NOTIFICATION_LABELS: Record<string, string> = {
  PENDING: "等待发送",
  SENDING: "正在发送",
  SENT: "已记录",
  RETRY: "等待重试",
  DEAD: "已停止发送",
};

const URGENCY_LABELS: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  CRITICAL: "紧急",
};

export function qualityStatusLabel(status: unknown): string {
  return STATUS_LABELS[String(status ?? "")] ?? "状态待确认";
}

export function qualityActionLabel(action: unknown): string {
  return ACTION_LABELS[String(action ?? "")] ?? "业务记录已更新";
}

export function qualityNotificationLabel(status: unknown, channel?: unknown): string {
  if (String(channel ?? "") === "TEST" && String(status ?? "") === "SENT") return "模拟通知已记录";
  if (String(channel ?? "") === "TEST" && String(status ?? "") === "DEAD") return "模拟通知已阻断";
  return NOTIFICATION_LABELS[String(status ?? "")] ?? "通知状态待确认";
}

export function qualityUrgencyLabel(urgency: unknown): string {
  return URGENCY_LABELS[String(urgency ?? "")] ?? "暂未标注";
}

export function qualityDecisionLabel(decision: unknown): string {
  const value = String(decision ?? "");
  if (value === "ORDINARY") return "普通反馈";
  if (value === "NEEDS_INFO") return "待补资料";
  if (value === "REPORTED") return "通报质量异常";
  if (value === "QUALITY_ANOMALY") return "质量异常";
  return "结论待确认";
}
