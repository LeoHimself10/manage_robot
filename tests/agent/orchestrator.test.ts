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

  it("injects persistent memory context and returns updated knownFacts", async () => {
    mockCallWithTools.mockImplementationOnce(async (req: {
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    }) => {
      await req.toolHandlers.update_known_facts?.({ facts: ["负责人偏好质量部"] });
      return {
        payload: {
          message: "已根据上一版计划完成修订",
        },
        rawContent: "{}",
        trace: { requestId: "t3", model: "qwen3.6-plus", tokenUsage: { totalTokens: 80 }, latencyMs: 120 },
        toolCallsExecuted: 1,
      };
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const existingFacts = ["系统是Linux"];
    const result = await runOrchestrator("把第二项任务拆细并重新分配", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      sessionContext: {
        knownFacts: existingFacts,
        conversationHistory: [{ role: "assistant", content: "上轮已输出任务草案" }],
        planId: "plan-123",
        latestDraft: { tasks: [{ id: "t1", title: "旧任务" }] },
        latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "u1" } }] },
        memorySummary: "当前是同一计划的二次修改",
      },
    });

    const requestArg = mockCallWithTools.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    };

    const memoryMsg = requestArg.messages.find((m) => m.role === "assistant" && m.content.includes("planId: plan-123"));
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg?.content).toContain("latestDraft");
    expect(memoryMsg?.content).toContain("latestAssignment");

    expect(result.knownFacts).toContain("负责人偏好质量部");
    expect(result.knownFacts).toContain("系统是Linux");
  });

  it("forwards maxToolIterations to callWithTools", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "ok" },
      rawContent: "{}",
      trace: { requestId: "t4", model: "qwen3.6-plus", tokenUsage: { totalTokens: 20 }, latencyMs: 80 },
      toolCallsExecuted: 0,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    await runOrchestrator("test", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      maxToolIterations: 3,
    });

    const requestArg = mockCallWithTools.mock.calls[0]?.[0] as { maxIterations?: number };
    expect(requestArg.maxIterations).toBe(3);
  });

  it("returns fallback message when tool iterations are exceeded", async () => {
    mockCallWithTools.mockRejectedValueOnce(new Error("ReAct loop exceeded max iterations (4)"));

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("复杂问题", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      maxToolIterations: 4,
    });

    expect(result.messages[0]).toContain("我先给你一个简版结论");
    expect(result.traceId).toBeDefined();
  });
});
