import { describe, expect, it } from "vitest";
import {
  DemoEvalCase,
  evaluateDemoCases,
} from "../../../src/agent/demo/evaluator";
import { TaskPlanningDemoResult } from "../../../src/agent/demo/pipeline";

function draftResult(
  totalTokens: number,
  latencyMs: number
): TaskPlanningDemoResult {
  return {
    status: "DRAFT_READY",
    questions: [],
    missingFields: [],
    classification: {
      domain: "QUALITY",
      subtype: "PRODUCTION_PROCESS_ABNORMALITY",
      confidence: "HIGH",
      rationale: ["x"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "UNCERTAIN",
      rationale: ["x"],
      disclaimer:
        "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
      promptingQuestions: [],
    },
    tasks: [
      {
        id: "task_1",
        title: "问题事实确认",
        objective: "确认事实",
        collaborators: [],
        inputMaterials: ["记录"],
        actions: ["收集"],
        deliverables: ["记录"],
        completionCriteria: ["明确"],
        timeNode: { checkpoints: ["确认"], dueAt: "T+1" },
        feedbackFrequency: "每日反馈",
        risksAndOpenQuestions: [],
        dependencyTaskIds: [],
      },
    ],
    gate: {
      passed: true,
      missingByTask: [],
    },
    markdown: "# draft",
    generation: {
      trace: {
        requestId: "req_1",
        model: "qwen-plus",
        tokenUsage: {
          promptTokens: Math.round(totalTokens / 2),
          completionTokens: Math.round(totalTokens / 2),
          totalTokens,
        },
        latencyMs,
      },
    },
  };
}

describe("evaluateDemoCases", () => {
  it("computes structured pass, p95 latency and average tokens", async () => {
    const cases: DemoEvalCase[] = [
      { id: "c1", background: "bg1", domainHint: "QUALITY" },
      { id: "c2", background: "bg2", domainHint: "QUALITY" },
      { id: "c3", background: "bg3", domainHint: "QUALITY" },
    ];

    const summary = await evaluateDemoCases(cases, async (input, index) => {
      if (index === 0) return draftResult(200, 1000);
      if (index === 1) return draftResult(300, 2000);
      return draftResult(100, 1500);
    });

    expect(summary.totalCases).toBe(3);
    expect(summary.draftReadyCases).toBe(3);
    expect(summary.needsMoreInfoCases).toBe(0);
    expect(summary.generationFailedCases).toBe(0);
    expect(summary.avgTotalTokens).toBe(200);
    expect(summary.p95LatencyMs).toBe(2000);
  });
});
