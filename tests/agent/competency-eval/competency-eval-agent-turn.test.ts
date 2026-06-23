import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveUploadedRubric } from "../../../src/agent/competency-eval/rubric-store";
import {
  buildCompetencyEvalContextPrefix,
  runCompetencyEvalTurn,
} from "../../../src/agent/competency-eval/competency-eval-agent-turn";
import type { QwenPlannerConfig } from "../../../src/agent/demo/qwen-planner";
import { createEmployeeProfileRepo } from "../../../src/integrations/repos/employee-profile-repo";

const sampleMd = `# 测试标准

## 1）维度一

说明

## 2）维度二

说明
`;

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

  it("buildCompetencyEvalContextPrefix includes activeRubricId and title when rubric exists", async () => {
    const saved = await saveUploadedRubric({
      userId: "actor1",
      filename: "standard.md",
      buffer: Buffer.from(sampleMd, "utf8"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const prefix = buildCompetencyEvalContextPrefix({
      actorUserId: "actor1",
      activeRubricId: saved.rubric.rubricId,
    });

    expect(prefix).toContain(`activeRubricId=${saved.rubric.rubricId}`);
    expect(prefix).toContain("title=测试标准");
  });

  it("buildCompetencyEvalContextPrefix without activeRubricId guides upload or list_rubrics", () => {
    const prefix = buildCompetencyEvalContextPrefix({
      actorUserId: "actor1",
      activeRubricId: "",
    });

    expect(prefix).toContain("activeRubricId=");
    expect(prefix).toContain("list_rubrics");
    expect(prefix).toContain("上传");
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
      activeRubricId: "rubric-abc",
    });

    expect(result.message).toBe("评估完成");
    expect(runOrchestrator).toHaveBeenCalledTimes(1);

    const [userMessage, config] = vi.mocked(runOrchestrator).mock.calls[0]!;
    expect(userMessage).toContain("activeRubricId=rubric-abc");
    expect(config.toolProfile).toBe("competency_eval");
    expect(config.promptProfile).toBe("competency_eval");
    expect(config.competencyEvalActorUserId).toBe("actor1");
    expect(config.maxToolIterations).toBe(6);
  });
});
