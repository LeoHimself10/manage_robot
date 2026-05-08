import "dotenv/config";

import { coerceLlmPlanPayload } from "../src/agent/demo/llm-schema";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "../src/agent/demo/qwen-planner";

async function main(): Promise<void> {
  const cfg = loadQwenPlannerConfigFromEnv();
  if (!cfg) {
    throw new Error("missing Qwen config from env");
  }

  try {
    const result = await runQwenPlanner(
      {
        domainHint: "QUALITY",
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      },
      cfg
    );
    const coerced = coerceLlmPlanPayload(result.rawJson);
    console.log("ok", {
      model: result.trace?.model,
      taskCount: coerced.tasks.length,
      tokenUsage: result.trace?.tokenUsage,
    });
  } catch (error) {
    console.error("err", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
