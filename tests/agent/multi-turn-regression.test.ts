import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallWithTools = vi.fn();
vi.mock("../../src/agent/demo/qwen-compatible-client", () => ({
  QwenCompatibleClient: vi.fn(function(this: Record<string, unknown>) {
    this.callWithTools = mockCallWithTools;
  }),
}));

describe("multi-turn regression scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turn-1 no explicit search: planner tools exclude search_web", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "收到，先给你草案" },
      toolCallsExecuted: 0,
      rawContent: "{}",
      trace: { requestId: "m1", model: "qwen", tokenUsage: { totalTokens: 10 }, latencyMs: 10 },
    });
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    await runOrchestrator("帮我拆解产线问题", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 1000 },
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      promptProfile: "planner",
      allowSearchWeb: false,
      sessionContext: {
        conversationHistory: [],
        planId: "p-reg-1",
      },
    });
    const req = mockCallWithTools.mock.calls[0]?.[0] as { tools: Array<{ function: { name: string } }> };
    const toolNames = req.tools.map((t) => t.function.name);
    expect(toolNames).toContain("search_employees");
    expect(toolNames).not.toContain("search_web");
  });

  it("turn-2 explicit search + memory context: includes search_web and prior summaries", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "已结合外部资料更新", draft: { tasks: [{ id: "task_1", title: "排查", objective: "定位" }] } },
      toolCallsExecuted: 1,
      rawContent: "{}",
      trace: { requestId: "m2", model: "qwen", tokenUsage: { totalTokens: 20 }, latencyMs: 10 },
    });
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    await runOrchestrator("请联网搜索同类案例后再更新", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 1000 },
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      promptProfile: "planner",
      allowSearchWeb: true,
      sessionContext: {
        conversationHistory: [
          { role: "user", content: "上次你给了初稿" },
          { role: "assistant", content: "好的，已生成初稿" },
        ],
        planId: "p-reg-2",
        latestDraft: { tasks: [{ id: "task_11", title: "旧任务", objective: "旧目标" }] },
        latestAssignment: { assignments: [{ taskId: "task_11", primary: { userId: "u1" } }] },
        memorySummary: "这是同一计划的第2轮修订",
        memoryFacts: ["负责人偏好质量部"],
      },
    });
    const req = mockCallWithTools.mock.calls[0]?.[0] as {
      tools: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content?: string }>;
    };
    const toolNames = req.tools.map((t) => t.function.name);
    expect(toolNames).toContain("search_web");
    const memory = req.messages.find((m) => m.role === "assistant" && String(m.content ?? "").includes("[memory_context]"));
    expect(memory?.content).toContain("latestDraft (");
    expect(memory?.content).toContain("旧任务");
    expect(memory?.content).not.toContain("latestDraftSummary");
    expect(memory?.content).toContain("latestAssignmentSummary");
    expect(memory?.content).toContain("topFacts");
  });
});
