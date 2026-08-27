import { describe, expect, it } from "vitest";
import {
  QUALITY_EVENT_STATUS_LABELS,
  renderQualityRoleMetricGroups,
  resolveQualityMetricRole,
} from "../../src/quality/presentation/quality-role-metrics";

describe("quality role metric copy", () => {
  it("uses one unambiguous event-status vocabulary", () => {
    expect(QUALITY_EVENT_STATUS_LABELS).toEqual({
      DRAFT: "通报草稿",
      PENDING_ANALYSIS: "待质量初析",
      PENDING_ASSIGNMENT: "待任务分配",
      PENDING_ACCEPTANCE: "待主管承接",
      IN_PROGRESS: "执行中",
      PENDING_PRIMARY_REVIEW: "待主管验收",
      PENDING_QUALITY_REVIEW: "待质量终验",
      CLOSED: "已关闭",
    });
  });

  it("keeps needs-info work out of completed aftersales reviews", () => {
    const html = renderQualityRoleMetricGroups("aftersales");
    expect(html).toContain("反馈研判");
    expect(html).toContain("待研判");
    expect(html).toContain("未研判或正在等待补充资料");
    expect(html).toContain("已完成研判");
    expect(html).toContain("仅包含普通反馈和已通报");
    expect(html).toContain('data-metric-source-status="ACTION_REQUIRED"');
    expect(html).toContain('data-metric-source-status="COMPLETED"');
    expect(html).toContain("后续处理中");
    expect(html).toContain("已关闭");
  });

  it("renders explicit quality-management and supervisor actions", () => {
    const quality = renderQualityRoleMetricGroups("quality_management");
    expect(quality).toContain("待质量初析");
    expect(quality).toContain("任务推进中");
    expect(quality).toContain("待质量终验");
    expect(quality).not.toContain("待终验");

    const supervisor = renderQualityRoleMetricGroups("supervisor");
    for (const label of [
      "待我承接",
      "待分派员工",
      "员工执行中",
      "待我验收",
      "已关闭",
    ]) expect(supervisor).toContain(label);
    for (const stage of ["ACCEPT", "DELEGATE", "EXECUTION", "REVIEW", "CLOSED"]) {
      expect(supervisor).toContain(`data-metric-manager-stage="${stage}"`);
    }
  });

  it("chooses the metric group from actual capabilities, not a display name", () => {
    expect(resolveQualityMetricRole({ canReport: true, isSpecialist: false, planningMode: false, isBusinessReadOnly: false })).toBe("aftersales");
    expect(resolveQualityMetricRole({ canReport: false, isSpecialist: true, planningMode: false, isBusinessReadOnly: false })).toBe("quality_management");
    expect(resolveQualityMetricRole({ canReport: false, isSpecialist: false, planningMode: true, isBusinessReadOnly: false })).toBe("supervisor");
    expect(resolveQualityMetricRole({ canReport: true, isSpecialist: true, planningMode: true, isBusinessReadOnly: true })).toBe("overview");
  });
});
