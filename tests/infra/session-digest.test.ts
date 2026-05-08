import { describe, expect, it } from "vitest";
import { summarizePriorDemoForPrompt } from "../../src/infra/session-digest";
import { CAPA_DISCLAIMER } from "../../src/domain/capa";
import { minimalQualityTask } from "../agent/demo/llm-fixtures";

describe("summarizePriorDemoForPrompt", () => {
  it("summarizes NEEDS_MORE_INFO outcomes", () => {
    const digest = summarizePriorDemoForPrompt({
      status: "NEEDS_MORE_INFO",
      questions: ["请给批次号"],
      missingFields: ["batch"],
    });
    expect(digest).toContain("NEEDS_MORE_INFO");
    expect(digest).toContain("请给批次号");
    expect(digest).toContain("上轮上下文");
  });

  it("keeps enough DRAFT_READY context for follow-up revisions", () => {
    const digest = summarizePriorDemoForPrompt({
      status: "DRAFT_READY",
      questions: ["是否存在重复发生？"],
      missingFields: [],
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["需要确认是否重复发生"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: ["是否影响已出货产品？"],
      },
      tasks: [
        minimalQualityTask({
          id: "task_1",
          title: "问题事实确认",
          deliverables: ["事实确认记录"],
          completionCriteria: ["影响范围明确"],
          timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1 工作日" },
          feedbackFrequency: "每日 17:00 更新",
        }),
      ],
      gate: { passed: true, missingByTask: [] },
      markdown: [
        "# 任务拆解 Demo 草案",
        "",
        "## 任务理解摘要",
        "",
        "生产测试发现 A 产品开机自检失败率升高，需要两天内完成初步分析。",
      ].join("\n"),
      generation: {},
    });

    expect(digest).toContain("上一轮任务理解");
    expect(digest).toContain("生产测试发现 A 产品开机自检失败率升高");
    expect(digest).toContain("PRODUCTION_PROCESS_ABNORMALITY");
    expect(digest).toContain("CAPA建议=UNCERTAIN");
    expect(digest).toContain("task_1 问题事实确认");
    expect(digest).toContain("交付物：事实确认记录");
    expect(digest).toContain("验收：影响范围明确");
    expect(digest).toContain("截止：T+1 工作日");
    expect(digest).toContain("反馈：每日 17:00 更新");
    expect(digest).toContain("仍需关注的问题：是否存在重复发生？");
  });

  it("bounds DRAFT_READY digest length", () => {
    const digest = summarizePriorDemoForPrompt(
      {
        status: "DRAFT_READY",
        questions: [],
        missingFields: [],
        classification: {
          domain: "RD",
          subtype: "VERIFICATION_AND_VALIDATION",
          confidence: "HIGH",
          rationale: [],
          missingInformation: [],
        },
        tasks: [
          minimalQualityTask({
            title: "很长的任务标题".repeat(80),
            deliverables: ["很长的交付物".repeat(80)],
          }),
        ],
        gate: { passed: true, missingByTask: [] },
        markdown: "# 任务拆解 Demo 草案",
        generation: {},
      },
      300
    );

    expect(digest?.length).toBeLessThanOrEqual(307);
    expect(digest).toContain("...(截断)");
  });
});
