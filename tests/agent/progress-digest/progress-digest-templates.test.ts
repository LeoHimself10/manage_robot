import { describe, expect, it } from "vitest";
import type { ProgressDigestFacts } from "../../../src/agent/progress-digest/progress-digest-facts";
import {
  buildDigestSubject,
  renderBriefDigestTemplate,
  renderProgressDigestTemplate,
} from "../../../src/agent/progress-digest/progress-digest-templates";

function sampleFacts(overrides: Partial<ProgressDigestFacts> = {}): ProgressDigestFacts {
  return {
    dateYmd: "2026-05-21",
    dateDisplay: "5月21日",
    audience: "manager",
    contentMode: "full",
    detailUrl: "https://example.com/workbench/manager/tasks",
    isBrief: false,
    activityWindow: {
      sinceIso: "2026-05-19T16:00:00.000Z",
      untilIso: "2026-05-20T16:00:00.000Z",
      labelYmd: "2026-05-20",
      labelDisplay: "5月20日",
    },
    core: {
      summary: {
        needsYouCount: 1,
        inProgressCount: 1,
        waitingAcceptCount: 0,
        blockedCount: 0,
        overdueCount: 0,
      },
      needsAttention: [
        {
          taskTitle: "产线异常调查",
          assigneeNames: ["杨贺新"],
          statusLabel: "已拒绝",
          reasonHint: "请在工作台确认是否改派或调整任务",
          overdue: false,
        },
      ],
      inProgress: [
        {
          taskTitle: "设备验证",
          assigneeName: "姚雪峰",
          statusLabel: "执行中",
          dueLabel: "截止 5月25日",
          overdue: false,
        },
      ],
      recentUpdates: [
        {
          timeLabel: "09:32",
          actorName: "杨贺新",
          taskTitle: "产线异常调查",
          subtaskTitle: "采样",
          actionLabel: "提交进度",
          note: "已完成采样",
        },
      ],
    },
    ...overrides,
  };
}

describe("progress-digest-templates", () => {
  it("buildDigestSubject highlights needs-you count", () => {
    expect(buildDigestSubject(sampleFacts())).toBe("今日任务 · 1项需您处理");
  });

  it("renderProgressDigestTemplate uses dingtalk-friendly list blocks and section headers", () => {
    const { markdown } = renderProgressDigestTemplate(sampleFacts());
    expect(markdown).toContain("### 今日任务一览");
    expect(markdown).toContain("### 今日概览");
    expect(markdown).toContain("### 需您处理");
    expect(markdown).not.toMatch(/\| --- \|/);
    expect(markdown).toContain("#### 1. 产线异常调查");
    expect(markdown).toContain("- **负责人**：杨贺新");
    expect(markdown).toContain("产线异常调查");
    expect(markdown).toContain("### 正常推进");
    expect(markdown).toContain("### 昨日动态（5月20日）");
    expect(markdown).toContain("**09:32** 杨贺新 · 提交进度");
    expect(markdown).not.toContain("过去 24 小时");
  });

  it("includes suggestions section when provided", () => {
    const { markdown } = renderProgressDigestTemplate(sampleFacts(), 8, {
      suggestions: ["优先跟进已逾期项"],
    });
    expect(markdown).toContain("### 后续建议");
    expect(markdown).toContain("优先跟进已逾期项");
  });

  it("renderBriefDigestTemplate is friendly empty state", () => {
    const { markdown } = renderBriefDigestTemplate(
      sampleFacts({ isBrief: true, core: { ...sampleFacts().core, needsAttention: [], inProgress: [] } }),
    );
    expect(markdown).toContain("没有需要跟进的活跃任务");
    expect(markdown).not.toContain("进行中 0 ·");
  });
});
