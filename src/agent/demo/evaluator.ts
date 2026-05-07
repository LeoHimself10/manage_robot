import { PlanDomain } from "../harness/types";
import { TaskPlanningDemoRequest, TaskPlanningDemoResult } from "./pipeline";

export interface DemoEvalCase {
  id: string;
  background: string;
  domainHint?: PlanDomain;
}

export interface DemoEvalSummary {
  totalCases: number;
  draftReadyCases: number;
  needsMoreInfoCases: number;
  generationFailedCases: number;
  avgTotalTokens: number;
  p95LatencyMs: number;
}

type DemoEvalRunner = (
  request: TaskPlanningDemoRequest,
  index: number
) => Promise<TaskPlanningDemoResult>;

export async function evaluateDemoCases(
  cases: DemoEvalCase[],
  runCase: DemoEvalRunner
): Promise<DemoEvalSummary> {
  const results = await Promise.all(
    cases.map((item, index) =>
      runCase(
        {
          background: item.background,
          domainHint: item.domainHint,
        },
        index
      )
    )
  );

  const totalCases = cases.length;
  const draftReadyResults = results.filter(
    (result): result is Extract<TaskPlanningDemoResult, { status: "DRAFT_READY" }> =>
      result.status === "DRAFT_READY"
  );
  const draftReadyCases = draftReadyResults.length;
  const needsMoreInfoCases = results.filter((r) => r.status === "NEEDS_MORE_INFO").length;
  const generationFailedCases = results.filter(
    (r) => r.status === "GENERATION_FAILED"
  ).length;

  const totalTokens = draftReadyResults
    .map((result) => result.generation.trace?.tokenUsage.totalTokens ?? 0)
    .reduce((sum, value) => sum + value, 0);

  const latencies = draftReadyResults
    .map((result) => result.generation.trace?.latencyMs ?? 0)
    .sort((a, b) => a - b);

  return {
    totalCases,
    draftReadyCases,
    needsMoreInfoCases,
    generationFailedCases,
    avgTotalTokens: draftReadyCases === 0 ? 0 : totalTokens / draftReadyCases,
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

function percentile(numbers: number[], p: number): number {
  if (numbers.length === 0) return 0;
  const index = Math.min(
    numbers.length - 1,
    Math.ceil(numbers.length * p) - 1
  );
  return numbers[index];
}
