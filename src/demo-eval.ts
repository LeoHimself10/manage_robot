import "dotenv/config";

import { evaluateDemoCases } from "./agent/demo/evaluator";
import { createTaskPlanningDemo } from "./agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "./agent/demo/qwen-planner";

async function main(): Promise<void> {
  const qwenConfig = loadQwenPlannerConfigFromEnv();
  if (!qwenConfig) {
    console.error(
      "未检测到 QWEN_API_KEY。请在环境变量或项目根目录 .env 中配置。"
    );
    process.exitCode = 1;
    return;
  }

  const evalCases = [
    {
      id: "quality_case_1",
      domainHint: "QUALITY" as const,
      background:
        "产线发现 A 产品批次不良率升高，已影响 15 台设备，已有测试记录与照片，请在 2 天内形成初步拆解。",
    },
    {
      id: "quality_case_2",
      domainHint: "QUALITY" as const,
      background:
        "客户反馈现场设备异常报警，涉及已出货设备，当前已有现场日志，需要确认影响范围与遏制措施。",
    },
    {
      id: "rd_case_1",
      domainHint: "RD" as const,
      background:
        "研发任务：制定 B 设备 V&V 计划，覆盖风险、样本量、测试方法和通过准则，计划本周完成评审。",
    },
  ];

  const summary = await evaluateDemoCases(evalCases, async (request) =>
    createTaskPlanningDemo(request, {
      llmPlanner: (plannerRequest) => runQwenPlanner(plannerRequest, qwenConfig),
    })
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
