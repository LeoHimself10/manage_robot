import "dotenv/config";

import { createTaskPlanningDemo } from "./agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "./agent/demo/qwen-planner";

async function main(): Promise<void> {
  const qwenConfig = loadQwenPlannerConfigFromEnv();
  if (!qwenConfig) {
    console.error(
      "未检测到 QWEN_API_KEY。请在环境变量或项目根目录 .env 中配置，切勿提交密钥到仓库。"
    );
    process.exitCode = 1;
    return;
  }

  const result = await createTaskPlanningDemo(
    {
      domainHint: "QUALITY",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
    },
    {
      llmPlanner: (request) => runQwenPlanner(request, qwenConfig),
    }
  );

  if (result.status === "NEEDS_MORE_INFO") {
    console.log("需要补充以下信息：");
    for (const question of result.questions) console.log(`- ${question}`);
    return;
  }

  if (result.status === "GENERATION_FAILED") {
    console.error("模型生成失败：");
    console.error(result.reason);
    console.log("\n建议：");
    for (const line of result.recoverySuggestions) console.log(`- ${line}`);
    if (result.trace?.errorCode) {
      console.log(`\ntrace errorCode=${result.trace.errorCode}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(result.markdown);
  console.log("\n---\n");
  if (result.generation.trace) {
    const trace = result.generation.trace;
    console.log(
      `trace requestId=${trace.requestId}, model=${trace.model}, tokens=${trace.tokenUsage.totalTokens}, latencyMs=${trace.latencyMs}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
