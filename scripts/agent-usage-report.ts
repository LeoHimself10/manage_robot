/**
 * Weekly agent usage report (Markdown + JSON).
 * Run: npx tsx scripts/agent-usage-report.ts [--week=YYYY-MM-DD]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildOpsDashboardFacts } from "../src/agent/ops-dashboard/ops-dashboard-facts";

const week = process.argv.find((a) => a.startsWith("--week="))?.split("=")[1];
const outDir = process.env.AGENT_USAGE_REPORT_DIR?.trim() || join(process.cwd(), "data/usage-reports");
mkdirSync(outDir, { recursive: true });

const facts = buildOpsDashboardFacts({ weekYmd: week, span: 1 });
const stamp = facts.week.mondayYmd;
const jsonPath = join(outDir, `usage-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(facts, null, 2), "utf8");

const k = facts.kpi;
const md = `# Agent 用量周报 (${stamp})

- DAU / WAU: ${k.dau} / ${k.wau}
- 对话轮次: ${k.turnCount}
- Token: prompt ${k.promptTokens} + completion ${k.completionTokens} = **${k.totalTokens}**
- p90 loop ms: ${Math.round(k.p90LoopMs)}
- 质量异常: ${JSON.stringify(k.incidentCount)}
- 本周发布任务: ${k.tasksPublished}
- Eval: ${k.evalHealth.lastReleaseOk ? "通过" : k.evalHealth.lastReleaseOk === false ? "失败" : "无记录"} @ ${k.evalHealth.lastReleaseAt ?? "—"}
`;

const mdPath = join(outDir, `usage-${stamp}.md`);
writeFileSync(mdPath, md, "utf8");
console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);
