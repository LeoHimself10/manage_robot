import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runCompetencyEvalTurn,
} from "../../../src/agent/competency-eval/competency-eval-agent-turn";
import type { QwenPlannerConfig } from "../../../src/agent/demo/qwen-planner";
import { createEmployeeProfileRepo } from "../../../src/integrations/repos/employee-profile-repo";

vi.mock("../../../src/agent/orchestrator", () => ({
  runOrchestrator: vi.fn(async () => ({
    messages: ["评估完成"],
    traceId: "trace-1",
    toolCallsTotal: 0,
  })),
}));

import { runOrchestrator } from "../../../src/agent/orchestrator";

describe("competency-eval agent turn", () => {
  let dataDir = "";

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "competency-eval-turn-"));
    vi.stubEnv("COMPETENCY_EVAL_DATA_DIR", dataDir);
    vi.mocked(runOrchestrator).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("runCompetencyEvalTurn passes competency_eval profile and actor to orchestrator", async () => {
    const employeeRepo = createEmployeeProfileRepo(
      mkdtempSync(join(tmpdir(), "competency-eval-emp-")),
    );

    const result = await runCompetencyEvalTurn({
      userMessage: "评估张三最近表现",
      clientConfig: { apiKey: "test-key" } as QwenPlannerConfig,
      employeeRepo,
      actorUserId: "actor1",
      activeJobReqId: "job-req-abc",
    });

    expect(result.message).toBe("评估完成");
    expect(runOrchestrator).toHaveBeenCalledTimes(1);

    const [userMessage, config] = vi.mocked(runOrchestrator).mock.calls[0]!;
    expect(userMessage).toContain("activeJobReqId=job-req-abc");
    expect(config.toolProfile).toBe("competency_eval");
    expect(config.promptProfile).toBe("competency_eval");
    expect(config.competencyEvalActorUserId).toBe("actor1");
    expect(config.maxToolIterations).toBe(6);
  });
});
