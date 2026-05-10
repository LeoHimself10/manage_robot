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

  it("returns message from model", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "你好，我是任务规划助手。请问有什么需要规划的任务？" },
      rawContent: "{}",
      trace: { requestId: "t1", model: "qwen3.6-plus", tokenUsage: { totalTokens: 50 }, latencyMs: 100 },
      toolCallsExecuted: 0,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("hi", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
    });

    expect(result.messages[0]).toContain("你好，我是任务规划助手");
  });

  it("returns draft when model produces valid draft", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: {
        message: "已生成草案",
        draft: {
          classification: { domain: "QUALITY", subtype: "PRODUCTION_PROCESS_ABNORMALITY", confidence: "HIGH", rationale: ["test"], missingInformation: [] },
          capaAdvisory: { advisory: "UNCERTAIN", rationale: ["x"], disclaimer: "免责声明", promptingQuestions: [] },
          tasks: [{ id: "t1", title: "task", objective: "do", collaborators: [], inputMaterials: [], actions: [], deliverables: ["d"], completionCriteria: ["c"], timeNode: { checkpoints: [], dueAt: "T+1" }, feedbackFrequency: "daily", risksAndOpenQuestions: [], dependencyTaskIds: [] }],
          openQuestions: [],
        },
      },
      rawContent: "{}",
      trace: { requestId: "t2", model: "qwen3.6-plus", tokenUsage: { totalTokens: 100 }, latencyMs: 200 },
      toolCallsExecuted: 2,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("test", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
    });

    expect(result.draft).toBeDefined();
    expect(result.toolCallsTotal).toBe(2);
  });
});
