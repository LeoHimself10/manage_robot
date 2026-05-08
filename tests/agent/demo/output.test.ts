import { describe, expect, it } from "vitest";
import { validateDemoGate } from "../../../src/agent/demo/gate";
import { renderPlanDraftMarkdown } from "../../../src/agent/demo/markdown-renderer";

describe("demo gate and markdown output", () => {
  it("fails gate when a task is missing deliverables", () => {
    const result = validateDemoGate([
      {
        id: "task_1",
        title: "问题事实确认",
        objective: "确认事实",
        collaborators: [],
        inputMaterials: [],
        actions: ["确认事实"],
        deliverables: [],
        completionCriteria: ["范围清楚"],
        timeNode: { checkpoints: [], dueAt: "T+1" },
        feedbackFrequency: "每日",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingByTask[0].missingFields).toContain("deliverables");
  });

  it("fails gate when required list fields only contain whitespace", () => {
    const result = validateDemoGate([
      {
        id: "task_1",
        title: "问题事实确认",
        objective: "确认事实",
        collaborators: [],
        inputMaterials: [],
        actions: ["确认事实"],
        deliverables: ["   "],
        completionCriteria: ["\t"],
        timeNode: { checkpoints: [], dueAt: "T+1" },
        feedbackFrequency: "每日",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingByTask[0].missingFields).toContain("deliverables");
    expect(result.missingByTask[0].missingFields).toContain(
      "completionCriteria"
    );
  });

  it("renders markdown with CAPA advisory and task table", () => {
    const markdown = renderPlanDraftMarkdown({
      summary: "生产测试发现不良率升高。",
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
        disclaimer:
          "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
        promptingQuestions: ["是否影响已出货产品？"],
      },
      tasks: [
        {
          id: "task_1",
          title: "问题事实确认",
          objective: "确认事实",
          collaborators: [],
          inputMaterials: ["生产记录"],
          actions: ["确认事实"],
          deliverables: ["事实确认记录"],
          completionCriteria: ["范围清楚"],
          timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      gate: { passed: true, missingByTask: [] },
      openQuestions: [],
    });

    expect(markdown).toContain("## CAPA 建议");
    expect(markdown).toContain(
      "| 任务ID | 任务标题 | 目标 | 交付物 | 验收标准 | 截止时间 | 反馈频率 | 依赖任务 |"
    );
    expect(markdown).toContain("| task_1 | 问题事实确认 |");
    expect(markdown).not.toContain("| task ID | title | objective |");
    expect(markdown).not.toContain("## 派发门禁");
    expect(markdown).not.toContain("状态：通过");
  });

  it("renders gate gaps as draft supplements instead of internal gate wording", () => {
    const markdown = renderPlanDraftMarkdown({
      summary: "生产测试发现不良率升高。",
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "问题事实确认",
          objective: "确认事实",
          collaborators: [],
          inputMaterials: ["生产记录"],
          actions: ["确认事实"],
          deliverables: [],
          completionCriteria: ["范围清楚"],
          timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      gate: {
        passed: false,
        missingByTask: [
          {
            taskId: "task_1",
            title: "问题事实确认",
            missingFields: ["deliverables"],
          },
        ],
      },
      openQuestions: [],
    });

    expect(markdown).toContain("## 草案待补充");
    expect(markdown).toContain("task_1 问题事实确认 需补充：deliverables");
    expect(markdown).not.toContain("## 派发门禁");
    expect(markdown).not.toContain("状态：未通过");
  });

  it("can render diagnostic markdown with internal gate details", () => {
    const markdown = renderPlanDraftMarkdown(
      {
        summary: "生产测试发现不良率升高。",
        classification: {
          domain: "QUALITY",
          subtype: "PRODUCTION_PROCESS_ABNORMALITY",
          confidence: "HIGH",
          rationale: ["生产异常"],
          missingInformation: [],
        },
        tasks: [
          {
            id: "task_1",
            title: "问题事实确认",
            objective: "确认事实",
            collaborators: [],
            inputMaterials: ["生产记录"],
            actions: ["确认事实"],
            deliverables: ["事实确认记录"],
            completionCriteria: ["范围清楚"],
            timeNode: { checkpoints: ["T+0.5"], dueAt: "T+1" },
            feedbackFrequency: "每日",
            risksAndOpenQuestions: [],
            dependencyTaskIds: [],
          },
        ],
        gate: { passed: true, missingByTask: [] },
        openQuestions: [],
      },
      { audience: "diagnostic" }
    );

    expect(markdown).toContain("## 场景分类");
    expect(markdown).toContain("## 派发门禁");
    expect(markdown).toContain("状态：通过");
  });

  it("renders task dependencies in markdown", () => {
    const markdown = renderPlanDraftMarkdown({
      summary: "研发验证任务。",
      classification: {
        domain: "RD",
        subtype: "VERIFICATION_AND_VALIDATION",
        confidence: "HIGH",
        rationale: ["验证确认"],
        missingInformation: [],
      },
      tasks: [
        {
          id: "task_2",
          title: "验证方法与样本设计",
          objective: "形成可执行验证方案",
          collaborators: [],
          inputMaterials: ["需求清单"],
          actions: ["定义方法"],
          deliverables: ["验证方法说明"],
          completionCriteria: ["方法可执行"],
          timeNode: { checkpoints: ["T+1"], dueAt: "T+2" },
          feedbackFrequency: "节点反馈",
          risksAndOpenQuestions: [],
          dependencyTaskIds: ["task_1"],
        },
      ],
      gate: { passed: true, missingByTask: [] },
      openQuestions: [],
    });

    expect(markdown).toContain("| task_2 | 验证方法与样本设计 |");
    expect(markdown).toContain("task_1");
  });
});
