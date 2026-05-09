import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCallWithTools = vi.fn();
vi.mock("../../src/agent/demo/qwen-compatible-client", () => ({
  QwenCompatibleClient: vi.fn(function(this: Record<string, unknown>) {
    this.callWithTools = mockCallWithTools;
  }),
  QwenCompatibleClientConfig: {} as never,
}));

describe("runOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message for simple end_turn response", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "你好，我是任务规划助手。", stopReason: "end_turn" },
      rawContent: JSON.stringify({ message: "你好，我是任务规划助手。", stopReason: "end_turn" }),
      trace: { requestId: "t1", model: "qwen3-plus", tokenUsage: { totalTokens: 50 }, latencyMs: 100 },
      toolCallsExecuted: 0,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("你好", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3-plus", timeoutMs: 1000, maxRetries: 0, temperature: 0, maxTokens: 100 },
      employeeRepo: { list: () => [] },
    });

    expect(result.messages).toContain("你好，我是任务规划助手。");
    expect(result.turns).toBe(1);
    expect(result.toolCallsTotal).toBe(0);
  });

  it("stops at max 6 turns", async () => {
    mockCallWithTools.mockResolvedValue({
      payload: { message: "", stopReason: "tool_use" },
      rawContent: JSON.stringify({ message: "", stopReason: "tool_use" }),
      trace: { requestId: "t", model: "qwen3-plus", tokenUsage: { totalTokens: 10 }, latencyMs: 10 },
      toolCallsExecuted: 0,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("test", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3-plus", timeoutMs: 1000, maxRetries: 0, temperature: 0, maxTokens: 100 },
      employeeRepo: { list: () => [] },
    });

    expect(result.turns).toBe(6);
  });
});
