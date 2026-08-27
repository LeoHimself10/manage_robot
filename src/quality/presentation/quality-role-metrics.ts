export type QualityMetricRole =
  | "aftersales"
  | "quality_management"
  | "supervisor"
  | "overview";

export const QUALITY_EVENT_STATUS_LABELS = Object.freeze({
  DRAFT: "通报草稿",
  PENDING_ANALYSIS: "待质量初析",
  PENDING_ASSIGNMENT: "待任务分配",
  PENDING_ACCEPTANCE: "待主管承接",
  IN_PROGRESS: "执行中",
  PENDING_PRIMARY_REVIEW: "待主管验收",
  PENDING_QUALITY_REVIEW: "待质量终验",
  CLOSED: "已关闭",
});

export function resolveQualityMetricRole(input: {
  canReport: boolean;
  isSpecialist: boolean;
  planningMode: boolean;
  isBusinessReadOnly: boolean;
}): QualityMetricRole {
  if (input.isBusinessReadOnly) return "overview";
  if (input.isSpecialist) return "quality_management";
  if (input.planningMode) return "supervisor";
  if (input.canReport) return "aftersales";
  return "overview";
}

function metric(input: {
  title: string;
  description: string;
  tone: string;
  view: "feedback" | "event";
  countPath: string;
  sourceStatus?: string;
  eventStatuses?: string;
  managerStage?: string;
}): string {
  const filters = [
    input.sourceStatus ? `data-metric-source-status="${input.sourceStatus}"` : "",
    input.eventStatuses ? `data-metric-statuses="${input.eventStatuses}"` : "",
    input.managerStage ? `data-metric-manager-stage="${input.managerStage}"` : "",
  ].filter(Boolean).join(" ");
  return `<button class="qpc-metric" type="button" data-metric-view="${input.view}" ${filters} data-metric-count-path="${input.countPath.replaceAll("&", "&amp;")}" style="--tone:${input.tone}"><span>${input.title}</span><strong data-metric-value>—</strong><small>${input.description}</small></button>`;
}

function group(title: string, description: string, metrics: string[]): string {
  return `<section class="qpc-metric-group" aria-label="${title}"><header><strong>${title}</strong><span>${description}</span></header><div class="qpc-metric-grid">${metrics.join("")}</div></section>`;
}

export function renderQualityRoleMetricGroups(role: QualityMetricRole): string {
  const eventBase = "/api/workbench/quality/events?page=1&pageSize=1";
  const sourceBase = "/api/workbench/quality/source?page=1&pageSize=1";
  if (role === "aftersales") {
    return [
      group("反馈研判", "判断反馈是否需要进入质量流程", [
        metric({ title: "待研判", description: "未研判或正在等待补充资料", tone: "#28639f", view: "feedback", sourceStatus: "ACTION_REQUIRED", countPath: `${sourceBase}&reviewStatus=ACTION_REQUIRED` }),
        metric({ title: "已完成研判", description: "仅包含普通反馈和已通报", tone: "#177057", view: "feedback", sourceStatus: "COMPLETED", countPath: `${sourceBase}&reviewStatus=COMPLETED` }),
      ]),
      group("通报后跟踪", "查看已通报质量事件的后续处理结果", [
        metric({ title: "后续处理中", description: "已通报，但质量流程尚未关闭", tone: "#b96718", view: "event", eventStatuses: "PENDING_ANALYSIS,PENDING_ASSIGNMENT,PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW,PENDING_QUALITY_REVIEW", countPath: `${eventBase}&statuses=PENDING_ANALYSIS,PENDING_ASSIGNMENT,PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW,PENDING_QUALITY_REVIEW` }),
        metric({ title: "已关闭", description: "质量流程已经完成并关闭", tone: "#64748b", view: "event", eventStatuses: "CLOSED", countPath: `${eventBase}&status=CLOSED` }),
      ]),
    ].join("");
  }
  if (role === "quality_management") {
    return group("质量事件处理", "只显示质量管理需要关注的阶段", [
      metric({ title: "待质量初析", description: "等待填写并确认质量初析", tone: "#28639f", view: "event", eventStatuses: "PENDING_ANALYSIS", countPath: `${eventBase}&status=PENDING_ANALYSIS` }),
      metric({ title: "任务推进中", description: "任务正在分配、承接、执行或主管验收", tone: "#b96718", view: "event", eventStatuses: "PENDING_ASSIGNMENT,PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW", countPath: `${eventBase}&statuses=PENDING_ASSIGNMENT,PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW` }),
      metric({ title: "待质量终验", description: "等待质量管理人员完成终验", tone: "#9d6b1e", view: "event", eventStatuses: "PENDING_QUALITY_REVIEW", countPath: `${eventBase}&status=PENDING_QUALITY_REVIEW` }),
      metric({ title: "已关闭", description: "质量流程已经完成并关闭", tone: "#64748b", view: "event", eventStatuses: "CLOSED", countPath: `${eventBase}&status=CLOSED` }),
    ]);
  }
  if (role === "supervisor") {
    return group("主管质量任务", "按当前主管需要采取的动作分类", [
      metric({ title: "待我承接", description: "等待当前主管接受质量任务", tone: "#28639f", view: "event", managerStage: "ACCEPT", countPath: `${eventBase}&managerStage=ACCEPT` }),
      metric({ title: "待分派员工", description: "主管已承接，下一步需要分派员工", tone: "#177057", view: "event", managerStage: "DELEGATE", countPath: `${eventBase}&managerStage=DELEGATE` }),
      metric({ title: "员工执行中", description: "已分派员工，正在执行任务", tone: "#b96718", view: "event", managerStage: "EXECUTION", countPath: `${eventBase}&managerStage=EXECUTION` }),
      metric({ title: "待我验收", description: "员工已提交，等待当前主管验收", tone: "#9d6b1e", view: "event", managerStage: "REVIEW", countPath: `${eventBase}&managerStage=REVIEW` }),
      metric({ title: "已关闭", description: "质量流程已经完成并关闭", tone: "#64748b", view: "event", managerStage: "CLOSED", countPath: `${eventBase}&managerStage=CLOSED` }),
    ]);
  }
  return group("质量事件", "按统一质量状态查看当前可见事件", [
    metric({ title: "待质量初析", description: "等待填写并确认质量初析", tone: "#28639f", view: "event", eventStatuses: "PENDING_ANALYSIS", countPath: `${eventBase}&status=PENDING_ANALYSIS` }),
    metric({ title: "待任务分配", description: "质量初析已完成，等待任务分配", tone: "#177057", view: "event", eventStatuses: "PENDING_ASSIGNMENT", countPath: `${eventBase}&status=PENDING_ASSIGNMENT` }),
    metric({ title: "执行中", description: "任务正在承接、执行或主管验收", tone: "#b96718", view: "event", eventStatuses: "PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW", countPath: `${eventBase}&statuses=PENDING_ACCEPTANCE,IN_PROGRESS,PENDING_PRIMARY_REVIEW` }),
    metric({ title: "待质量终验", description: "等待质量管理人员完成终验", tone: "#9d6b1e", view: "event", eventStatuses: "PENDING_QUALITY_REVIEW", countPath: `${eventBase}&status=PENDING_QUALITY_REVIEW` }),
    metric({ title: "已关闭", description: "质量流程已经完成并关闭", tone: "#64748b", view: "event", eventStatuses: "CLOSED", countPath: `${eventBase}&status=CLOSED` }),
  ]);
}
