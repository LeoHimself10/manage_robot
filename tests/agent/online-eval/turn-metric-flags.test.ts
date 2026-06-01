import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildTurnMetricFlags } from "../../../src/agent/online-eval/turn-metric-flags";
import type { OrchestratorResult } from "../../../src/agent/orchestrator";

describe("turn-metric-flags", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges orchestrator observability flags", () => {
    const orch: OrchestratorResult = {
      messages: ["ok"],
      traceId: "t1",
      toolCallsTotal: 0,
      observabilityFlags: ["orchestrator_max_turns_exceeded"],
    };
    const flags = buildTurnMetricFlags({
      userMessage: "发布",
      orchResult: orch,
      outboundMarkdown: "已收到",
      channel: "dingtalk",
    });
    expect(flags).toContain("orchestrator_max_turns_exceeded");
  });

  it("detects tool name leak via hygiene", () => {
    const orch: OrchestratorResult = {
      messages: ["use publish_task"],
      traceId: "t2",
      toolCallsTotal: 0,
    };
    const flags = buildTurnMetricFlags({
      userMessage: "hello",
      orchResult: orch,
      outboundMarkdown: "请先调用 publish_task",
      channel: "workbench",
    });
    expect(flags).toContain("dingtalk_tool_name_leak");
  });
});
