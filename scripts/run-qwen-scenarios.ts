import "dotenv/config";

import { createTaskPlanningDemo } from "../src/agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "../src/agent/demo/qwen-planner";

interface Scenario {
  id: string;
  domainHint: "QUALITY" | "RD";
  background: string;
}

const scenarios: Scenario[] = [
  {
    id: "S1-质量-产线异常",
    domainHint: "QUALITY",
    background:
      "产线测试发现 A 产品 2026-05-03 批次开机自检失败率升高至 18%，影响 35 台，已有测试日志和不良照片，要求 48 小时内给出初步分析与遏制建议。",
  },
  {
    id: "S2-质量-客诉现场",
    domainHint: "QUALITY",
    background:
      "客户反馈已交付设备现场运行 2 周后频繁重启，涉及 3 家医院共 12 台设备，已有现场视频和日志，需要评估影响范围及是否建议 CAPA。",
  },
  {
    id: "S3-研发-VV规划",
    domainHint: "RD",
    background:
      "研发任务：制定 B 设备 V&V 验证方案，覆盖需求追溯、样本量、测试方法、通过准则与风险项，计划本周五完成评审包。",
  },
  {
    id: "S4-研发-设计变更",
    domainHint: "RD",
    background:
      "研发任务：针对 ECN 变更后主板电源模块，完成影响评估、回归验证与文档更新，需明确依赖关系和跨团队协作输入。",
  },
];

async function main(): Promise<void> {
  const config = loadQwenPlannerConfigFromEnv();
  if (!config) {
    throw new Error("missing Qwen config from env");
  }

  for (const scenario of scenarios) {
    const result = await createTaskPlanningDemo(
      {
        domainHint: scenario.domainHint,
        background: scenario.background,
      },
      {
        llmPlanner: (request) => runQwenPlanner(request, config),
      }
    );

    if (result.status === "NEEDS_MORE_INFO") {
      console.log(
        JSON.stringify(
          {
            id: scenario.id,
            status: result.status,
            missingFields: result.missingFields,
            questions: result.questions,
          },
          null,
          2
        )
      );
      continue;
    }

    if (result.status === "GENERATION_FAILED") {
      console.log(
        JSON.stringify(
          {
            id: scenario.id,
            status: result.status,
            reason: result.reason,
            recoverySuggestions: result.recoverySuggestions,
          },
          null,
          2
        )
      );
      continue;
    }

    console.log(
      JSON.stringify(
        {
          id: scenario.id,
          status: result.status,
          domain: result.classification.domain,
          subtype: result.classification.subtype,
          confidence: result.classification.confidence,
          traceRequestId: result.generation.trace?.requestId ?? null,
          gatePassed: result.gate.passed,
          taskCount: result.tasks.length,
          firstTaskTitles: result.tasks.slice(0, 3).map((task) => task.title),
          openQuestionCount: result.questions.length,
          capaAdvisory: result.capaAdvisory?.advisory ?? null,
          tokens: result.generation.trace?.tokenUsage.totalTokens ?? 0,
          latencyMs: result.generation.trace?.latencyMs ?? 0,
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
