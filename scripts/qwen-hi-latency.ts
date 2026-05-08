/**
 * 最短链路延迟摸底：background="hi"，打印 wallClockMs 与 pipeline planner 段耗时。
 * 用法：
 *   $env:QWEN_STREAM="0"; npx tsx scripts/qwen-hi-latency.ts
 *   npx tsx scripts/qwen-hi-latency.ts --compare   # 同一进程内先关流式再开流式各跑一次（需 Key）
 */
import "dotenv/config";

import { createTaskPlanningDemo } from "../src/agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "../src/agent/demo/qwen-planner";
import { readDemoLlmCorrectionEnabled } from "../src/infra/demo-runtime-env";

async function runHi(stream: boolean, label: string) {
  const base = loadQwenPlannerConfigFromEnv();
  if (!base) {
    console.error("缺少 QWEN_API_KEY（.env 或环境变量）");
    process.exit(1);
  }
  const cfg = { ...base, stream };
  const t0 = Date.now();
  const result = await createTaskPlanningDemo(
    { background: "hi", domainHint: "QUALITY" },
    {
      llmPlanner: (req) => runQwenPlanner(req, cfg),
      enableLlmCorrection: readDemoLlmCorrectionEnabled(),
    }
  );
  const wallMs = Date.now() - t0;
  const plannerMs =
    result.status === "DRAFT_READY" ? result.generation.timings?.plannerMs : undefined;
  console.log(
    JSON.stringify(
      {
        label,
        stream,
        status: result.status,
        wallClockMs: wallMs,
        plannerMs,
      },
      null,
      2
    )
  );
}

async function main() {
  const compare = process.argv.includes("--compare");
  if (compare) {
    await runHi(false, "stream_off");
    await runHi(true, "stream_on");
    return;
  }
  const cfg = loadQwenPlannerConfigFromEnv();
  const stream = cfg?.stream ?? true;
  await runHi(stream, "single_run");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
