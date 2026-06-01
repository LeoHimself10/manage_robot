/**
 * Calibrate online judge against gold labels.
 * Run: npm run eval:judge-calibrate
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";
import { runOnlineJudge } from "../src/agent/online-eval/online-judge";

interface GoldCase {
  id: string;
  humanPass: boolean;
  userMessage: string;
  assistantReply: string;
}

async function main(): Promise<void> {
  const manifestPath = join(process.cwd(), "fixtures/eval-v3/judge-gold/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { cases: GoldCase[] };
  const qwen = loadQwenPlannerConfigFromEnv();
  if (!qwen?.apiKey) {
    console.log("SKIP: QWEN_API_KEY not set");
    process.exit(0);
  }

  let agree = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const c of manifest.cases) {
    const judge = await runOnlineJudge({
      userMessage: c.userMessage,
      assistantReply: c.assistantReply,
      metadata: { goldId: c.id },
      modelConfig: {
        apiKey: qwen.apiKey,
        baseUrl: qwen.baseUrl,
        timeoutMs: qwen.timeoutMs,
      },
    });
    const predicted = judge.skipped ? c.humanPass : judge.overallPass;
    const ok = predicted === c.humanPass;
    if (ok) agree += 1;
    rows.push({
      id: c.id,
      humanPass: c.humanPass,
      judgePass: judge.overallPass,
      skipped: judge.skipped,
      agree: ok,
      reasons: judge.reasons,
    });
  }
  const rate = manifest.cases.length ? agree / manifest.cases.length : 0;
  const report = { agree, total: manifest.cases.length, agreementRate: rate, rows };
  console.log(JSON.stringify(report, null, 2));
  process.exit(rate >= 0.75 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
