/**
 * Promote eval candidate → fixture skeleton under fixtures/eval-v3/promoted/
 * Run: npx tsx scripts/promote-eval-candidate.ts --traceId=UUID
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentMetricsStore } from "../src/infra/agent-metrics-store";

const traceId = process.argv.find((a) => a.startsWith("--traceId="))?.split("=")[1]?.trim();
if (!traceId) {
  console.error("Usage: promote-eval-candidate.ts --traceId=<traceId>");
  process.exit(1);
}

const planDir = process.env.PLAN_STORE_DIR?.trim() || join(process.cwd(), "data/plans");
const planPath = join(planDir, `${traceId}.json`);
const outDir = join(process.cwd(), "fixtures/eval-v3/promoted");
mkdirSync(outDir, { recursive: true });

const store = getAgentMetricsStore();
const candidates = store.listEvalCandidates("pending", 200);
const candidate = candidates.find((c) => c.traceId === traceId);

const userMessage =
  candidate?.userMessageRedacted?.trim()
  || "TODO: paste redacted user message";

const skeleton = {
  id: `promoted_${traceId.slice(0, 8)}`,
  sourceTraceId: traceId,
  promotedAt: new Date().toISOString(),
  planSnapshot: existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) : null,
  failReasons: candidate?.failReasons ?? [],
  userMessageRedacted: candidate?.userMessageRedacted ?? "",
  assistantMessageRedacted: candidate?.assistantMessageRedacted ?? "",
  contextJson: candidate?.contextJson ?? [],
  ruleScores: candidate?.ruleScoresJson ?? null,
  judgeScores: candidate?.judgeScoresJson ?? null,
  turns: [
    {
      id: "T1",
      userMessage,
      expectAssistantQuality: true,
    },
  ],
};

const outPath = join(outDir, `${skeleton.id}.json`);
writeFileSync(outPath, JSON.stringify(skeleton, null, 2), "utf8");
if (candidate) {
  store.updateEvalCandidateStatus(candidate.id, "promoted");
}
console.log(`Wrote ${outPath}`);
