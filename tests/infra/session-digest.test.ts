import { describe, expect, it } from "vitest";
import {
  buildConversationStateFromResult,
  summarizePriorDemoForPrompt,
} from "../../src/infra/session-digest";
import { CAPA_DISCLAIMER } from "../../src/domain/capa";
import { minimalQualityTask } from "../agent/demo/llm-fixtures";
import type { TaskPlanningDemoResult } from "../../src/agent/demo/pipeline";

describe("buildConversationStateFromResult", () => {
  it("clears draft context on RESET_OR_NEW_TASK", () => {
    const result: TaskPlanningDemoResult = {
      status: "CONVERSATION",
      traceId: "test-trace-id",
      responseIntent: "RESET_OR_NEW_TASK",
      assistantMessage: "好的，我们从新任务开始。",
      questions: [],
      missingFields: [],
      clarificationUx: "NON_TASK",
    };
    const state = buildConversationStateFromResult(result, {
      currentTopicSummary: "旧质量问题",
      activeDraftBrief: "旧草案",
      unresolvedQuestions: ["旧问题现象是什么？"],
    });
    expect(state.userRejectedTemplate).toBe(true);
    expect(state.activeDraftBrief).toBeUndefined();
    expect(state.currentTopicSummary).toBeUndefined();
    expect(state.unresolvedQuestions).toEqual([]);
    expect(state.lastResponseIntent).toBe("RESET_OR_NEW_TASK");
  });

  it("updates draft state on DRAFT_READY", () => {
    const result: TaskPlanningDemoResult = {
      status: "DRAFT_READY",
      traceId: "test-trace-id",
      responseIntent: "DRAFT",
      assistantMessage: "已生成草案。",
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
        promptingQuestions: [],
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
      markdown: "# 任务拆解草案\n\n## 建议任务包",
      generation: {},
    };
    const state = buildConversationStateFromResult(result);
    expect(state.currentTopicSummary).toBe("QUALITY/PRODUCTION_PROCESS_ABNORMALITY");
    expect(state.lastResponseIntent).toBe("DRAFT");
    expect(state.activeDraftBrief).toContain("task_1 问题事实确认");
    expect(state.userRejectedTemplate).toBe(false);
  });

  it("preserves active draft brief on DISCUSS when previous had draft", () => {
    const prev = {
      activeDraftBrief: "task_1 事实确认：收集证据",
      currentTopicSummary: "QUALITY/PRODUCTION_PROCESS_ABNORMALITY",
    };
    const result: TaskPlanningDemoResult = {
      status: "CONVERSATION",
      traceId: "test-trace-id",
      responseIntent: "DISCUSS",
      assistantMessage: "风险排查放在后面是因为…",
      questions: [],
      missingFields: [],
      clarificationUx: undefined,
    };
    const state = buildConversationStateFromResult(result, prev);
    expect(state.lastResponseIntent).toBe("DISCUSS");
    expect(state.activeDraftBrief).toBe(prev.activeDraftBrief);
    expect(state.lastUserIntent).toContain("风险排查");
  });
});

describe("summarizePriorDemoForPrompt", () => {
  it("summarizes NEEDS_MORE_INFO outcomes", () => {
    const digest = summarizePriorDemoForPrompt({
      status: "NEEDS_MORE_INFO",
      traceId: "test-trace-id",
      questions: ["请给批次号"],
      missingFields: ["batch"],
    });
    expect(digest).toContain("NEEDS_MORE_INFO");
    expect(digest).toContain("请给批次号");
    expect(digest).toContain("上轮上下文");
  });

  it("keeps enough DRAFT_READY context without markdown 任务理解摘要", () => {
    const digest = summarizePriorDemoForPrompt({
      status: "DRAFT_READY",
      traceId: "test-trace-id",
      responseIntent: "DRAFT",
      assistantMessage: "已生成草案。",
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
      markdown: "# 任务拆解草案\n\n（用户侧已无任务理解摘要节）",
      generation: {},
    });

    expect(digest).not.toContain("## 任务理解摘要");
    expect(digest).toContain("PRODUCTION_PROCESS_ABNORMALITY");
    expect(digest).toContain("CAPA建议=UNCERTAIN");
    expect(digest).toContain("task_1 问题事实确认");
    expect(digest).toContain("交付物：事实确认记录");
    expect(digest).toContain("验收：影响范围明确");
    expect(digest).toContain("截止：T+1 工作日");
    expect(digest).toContain("反馈：每日 17:00 更新");
    expect(digest).toContain("仍需关注的问题：是否存在重复发生？");
  });

  it("includes conversation state block when state is passed", () => {
    const digest = summarizePriorDemoForPrompt(
      {
        status: "DRAFT_READY",
        traceId: "test-trace-id",
        responseIntent: "DRAFT",
        assistantMessage: "已生成草案。",
        questions: [],
        missingFields: [],
        classification: {
          domain: "QUALITY",
          subtype: "PRODUCTION_PROCESS_ABNORMALITY",
          confidence: "HIGH",
          rationale: [],
          missingInformation: [],
        },
        tasks: [minimalQualityTask()],
        gate: { passed: true, missingByTask: [] },
        markdown: "# x",
        generation: {},
      },
      4000,
      {
        lastResponseIntent: "DISCUSS",
        userRejectedTemplate: true,
      }
    );
    expect(digest).toContain("当前会话状态");
    expect(digest).toContain("DISCUSS");
    expect(digest).toContain("用户已表达不希望重复");
  });

  it("bounds DRAFT_READY digest length", () => {
    const digest = summarizePriorDemoForPrompt(
      {
        status: "DRAFT_READY",
        traceId: "test-trace-id",
        responseIntent: "DRAFT",
        assistantMessage: "已生成草案。",
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
