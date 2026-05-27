import { describe, expect, it } from "vitest";
import { buildProjectCardProgress } from "../../src/web/workbench-project-card-progress";

describe("buildProjectCardProgress", () => {
  it("shows blocked pill and secondary tags when multiple task states", () => {
    const p = buildProjectCardProgress({
      taskCount: 3,
      attentionBucket: "blocked",
      taskBuckets: {
        blocked: 1,
        needs_manager: 1,
        waiting_employee: 0,
        employee_running: 1,
        done: 0,
        stopped: 0,
      },
    });
    expect(p.pillLabel).toContain("阻塞");
    expect(p.pillTone).toBe("blocked");
    expect(p.summary).toContain("3");
    expect(p.tags.length).toBeGreaterThan(0);
    expect(p.barSegments.length).toBeGreaterThan(0);
  });

  it("idle state when no tasks", () => {
    const p = buildProjectCardProgress({
      taskCount: 0,
      attentionBucket: "done",
      taskBuckets: {
        blocked: 0,
        needs_manager: 0,
        waiting_employee: 0,
        employee_running: 0,
        done: 0,
        stopped: 0,
      },
    });
    expect(p.pillTone).toBe("idle");
    expect(p.barSegments).toHaveLength(0);
  });
});
