import { describe, expect, it } from "vitest";
import { buildGetMetricsHandler } from "../../../src/agent/tools/get-metrics";

describe("get_metrics tool", () => {
  it("returns metrics payload", () => {
    const handler = buildGetMetricsHandler({
      taskStore: {
        getMetrics: () => ({ totalTasks: 1, activeTasks: 1, blockedSubtasks: 0, pendingSubtasks: 0, doneSubtasks: 0, byDepartment: [] }),
      } as any,
    });
    const result = handler({}) as any;
    expect(result.ok).toBe(true);
    expect(result.metrics.totalTasks).toBe(1);
  });
});
