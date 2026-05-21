import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCallWithTools = vi.fn();
vi.mock("../../src/integrations/dingtalk/workbench-notify", () => ({
  createWorkbenchPublishNotifier: () => ({
    notifyPublishedTask: vi.fn(async () => ({
      enabled: false,
      skippedReason: "off",
      success: [],
      failed: [],
    })),
    notifyReassignedAssignee: vi.fn(async () => ({
      enabled: false,
      skippedReason: "off",
      success: [],
      failed: [],
    })),
    notifyManagerOfEmployeeAction: vi.fn(async () => ({
      enabled: false,
      skippedReason: "off",
      success: [],
      failed: [],
    })),
  }),
}));
vi.mock("../../src/integrations/repos/employee-profile-repo", () => ({
  createEmployeeProfileRepo: () => ({
    get: () => ({ department: "质量部" }),
    list: () => [],
  }),
}));
vi.mock("../../src/infra/people-directory-store", () => ({
  createPeopleDirectoryStore: () => ({
    getContact: () => ({ active: true }),
    close: () => {},
  }),
}));
vi.mock("../../src/agent/demo/qwen-compatible-client", () => {
  class MaxToolIterationsExceededError extends Error {
    public readonly maxIterations: number;
    public readonly toolCallsExecuted: number;
    public readonly iterationTimings: Array<{
      iteration: number;
      llmMs: number;
      parseMs: number;
      toolsMs: number;
      toolCalls: number;
      totalMs: number;
      tools: Array<{ toolName: string; elapsedMs: number }>;
    }>;
    public readonly lastAssistantContent: string;
    constructor(input: {
      maxIterations: number;
      toolCallsExecuted: number;
      iterationTimings: Array<{
        iteration: number;
        llmMs: number;
        parseMs: number;
        toolsMs: number;
        toolCalls: number;
        totalMs: number;
        tools: Array<{ toolName: string; elapsedMs: number }>;
      }>;
      lastAssistantContent: string;
    }) {
      super(`ReAct loop exceeded max iterations (${input.maxIterations})`);
      this.name = "MaxToolIterationsExceededError";
      this.maxIterations = input.maxIterations;
      this.toolCallsExecuted = input.toolCallsExecuted;
      this.iterationTimings = input.iterationTimings;
      this.lastAssistantContent = input.lastAssistantContent;
    }
  }
  class TokenBudgetExceededError extends Error {
    public readonly maxTotalTokens: number;
    public readonly toolCallsExecuted: number;
    public readonly iterationTimings: Array<{
      iteration: number;
      llmMs: number;
      parseMs: number;
      toolsMs: number;
      toolCalls: number;
      totalMs: number;
      tools: Array<{ toolName: string; elapsedMs: number }>;
    }>;
    public readonly lastAssistantContent: string;
    constructor(input: {
      maxTotalTokens: number;
      toolCallsExecuted: number;
      iterationTimings: Array<{
        iteration: number;
        llmMs: number;
        parseMs: number;
        toolsMs: number;
        toolCalls: number;
        totalMs: number;
        tools: Array<{ toolName: string; elapsedMs: number }>;
      }>;
      lastAssistantContent: string;
    }) {
      super(`ReAct loop exceeded token budget (${input.maxTotalTokens})`);
      this.name = "TokenBudgetExceededError";
      this.maxTotalTokens = input.maxTotalTokens;
      this.toolCallsExecuted = input.toolCallsExecuted;
      this.iterationTimings = input.iterationTimings;
      this.lastAssistantContent = input.lastAssistantContent;
    }
  }
  return {
    QwenCompatibleClient: vi.fn(function(this: Record<string, unknown>) {
      this.callWithTools = mockCallWithTools;
    }),
    QwenCompatibleClientConfig: {} as never,
    MaxToolIterationsExceededError,
    TokenBudgetExceededError,
  };
});

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

  it("returns assignment when model includes assignment payload", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: {
        message: "已生成拆解与分配建议",
        assignment: {
          assignments: [
            {
              taskId: "task_1",
              primary: { userId: "emp_qa_001", displayName: "张三", rationale: "经验匹配" },
              confidence: "HIGH",
            },
          ],
        },
      },
      rawContent: "{}",
      trace: { requestId: "t2b", model: "qwen3.6-plus", tokenUsage: { totalTokens: 90 }, latencyMs: 160 },
      toolCallsExecuted: 1,
    });

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("给我拆解并分配", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
    });

    expect(result.assignment).toBeDefined();
    expect((result.assignment as { assignments?: unknown[] })?.assignments?.length).toBe(1);
  });

  it("captures publish tool result via callback and return payload", async () => {
    mockCallWithTools.mockImplementationOnce(async (req: {
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    }) => {
      await req.toolHandlers.publish_task({ planId: "plan-123", confirmationContext: "确认发布" });
      return {
        payload: { message: "已发布" },
        rawContent: "{}",
        trace: { requestId: "t2c", model: "qwen3.6-plus", tokenUsage: { totalTokens: 60 }, latencyMs: 90 },
        toolCallsExecuted: 1,
      };
    });
    const onPublishTaskResult = vi.fn();
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("确认发布", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-123",
      currentSession: {
        chatKeyHash: "hash",
        planId: "plan-123",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        senderStaffId: "manager-1",
        knownFacts: [],
        conversationHistory: [],
        latestDraft: {
          title: "任务",
          tasks: [{ id: "task-1", title: "子任务1" }],
        },
        latestAssignment: {
          assignments: [{ taskId: "task-1", primary: { userId: "emp-1" } }],
        },
      },
      onPublishTaskResult,
    });
    expect(onPublishTaskResult).toHaveBeenCalled();
    expect(result.publishResult).toBeDefined();
  });

  it("injects persistent memory context summaries", async () => {
    mockCallWithTools.mockImplementationOnce(async (req: {
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    }) => {
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
    const result = await runOrchestrator("把第二项任务拆细并重新分配", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      sessionContext: {
        conversationHistory: [
          { role: "assistant", content: "上轮已输出任务草案" },
          { role: "employee_update", content: "[DONE] 已完成样机拆解" },
        ],
        planId: "plan-123",
        latestDraft: { tasks: [{ id: "t1", title: "旧任务" }] },
        latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "u1" } }] },
        memorySummary: "当前是同一计划的二次修改",
        memoryFacts: ["系统是Linux", "负责人偏好质量部"],
      },
    });

    const requestArg = mockCallWithTools.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    };

    const memoryMsg = requestArg.messages.find((m) => m.role === "assistant" && m.content.includes("planId: plan-123"));
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg?.content).toContain("latestDraftSummary");
    expect(memoryMsg?.content).toContain("latestAssignmentSummary");
    expect(memoryMsg?.content).not.toContain("latestDraftTasks");
    expect(memoryMsg?.content).not.toContain("taskCount");
    expect(memoryMsg?.content).not.toContain("assignmentCount");
    expect(
      requestArg.messages.some((m) => m.role === "employee_update"),
    ).toBe(false);
    expect(
      requestArg.messages.some(
        (m) => m.role === "assistant" && m.content.includes("[employee_update]"),
      ),
    ).toBe(true);
    expect(result.messages[0]).toContain("已根据上一版计划完成修订");
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

  it("accepts actorRole in orchestrator config", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: { message: "ok" },
      rawContent: "{}",
      trace: { requestId: "t4c", model: "qwen3.6-plus", tokenUsage: { totalTokens: 20 }, latencyMs: 80 },
      toolCallsExecuted: 0,
    });
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("test", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      actorRole: "admin",
      toolProfile: "admin",
    });
    expect(result.messages[0]).toBe("ok");
  });

  it("supports known facts tools when store is provided", async () => {
    let facts: string[] = ["旧事实"];
    mockCallWithTools.mockImplementationOnce(async (req: {
      toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown>;
    }) => {
      await req.toolHandlers.update_known_facts({ facts: ["新事实"] });
      return {
        payload: { message: "ok" },
        rawContent: "{}",
        trace: { requestId: "t4b", model: "qwen3.6-plus", tokenUsage: { totalTokens: 20 }, latencyMs: 80 },
        toolCallsExecuted: 1,
      };
    });
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    await runOrchestrator("记住这件事", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      currentSession: { latestDraft: { tasks: [{ id: "task_1", title: "测试" }] } } as import("../../src/infra/plan-session-store").PlanSession,
      knownFactsStore: {
        get: () => facts,
        update: (next: string[]) => {
          facts = [...new Set([...facts, ...next])];
        },
      },
    });
    expect(facts).toContain("新事实");
  });

  it("returns fallback message when tool iterations are exceeded", async () => {
    const { MaxToolIterationsExceededError } = await import(
      "../../src/agent/demo/qwen-compatible-client"
    );
    mockCallWithTools.mockRejectedValueOnce(
      new MaxToolIterationsExceededError({
        maxIterations: 4,
        toolCallsExecuted: 0,
        iterationTimings: [],
        lastAssistantContent: "",
      }),
    );

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("复杂问题", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      maxToolIterations: 4,
    });

    expect(result.messages[0]).toContain("编排工具轮次上限");
    expect(result.traceId).toBeDefined();
    expect(result.toolInvocationNames).toEqual([]);
  });

  it("salvages tool invocation names and inline content on max-iter", async () => {
    const { MaxToolIterationsExceededError } = await import(
      "../../src/agent/demo/qwen-compatible-client"
    );
    mockCallWithTools.mockRejectedValueOnce(
      new MaxToolIterationsExceededError({
        maxIterations: 3,
        toolCallsExecuted: 3,
        iterationTimings: [
          { iteration: 1, llmMs: 1, parseMs: 0, toolsMs: 0, toolCalls: 1, totalMs: 1, tools: [{ toolName: "search_similar_plans", elapsedMs: 0 }] },
          { iteration: 2, llmMs: 1, parseMs: 0, toolsMs: 0, toolCalls: 1, totalMs: 1, tools: [{ toolName: "search_employees", elapsedMs: 0 }] },
          { iteration: 3, llmMs: 1, parseMs: 0, toolsMs: 0, toolCalls: 1, totalMs: 1, tools: [{ toolName: "update_known_facts", elapsedMs: 0 }] },
        ],
        lastAssistantContent: "我先整理一份草案，正在核对人员…",
      }),
    );

    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("帮我拆 OCT 客诉", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      maxToolIterations: 3,
    });

    expect(result.messages[0]).toBe("我先整理一份草案，正在核对人员…");
    expect(result.toolInvocationNames).toEqual([
      "search_similar_plans",
      "search_employees",
      "update_known_facts",
    ]);
    expect(result.toolCallsTotal).toBe(3);
  });

  it("stabilizes draft task ids across revisions and aligns assignment ids", async () => {
    mockCallWithTools.mockResolvedValueOnce({
      payload: {
        message: "已更新",
        draft: {
          tasks: [
            { title: "任务A", objective: "目标A", deliverables: [], completionCriteria: [], timeNode: {}, feedbackFrequency: "每日" },
            { title: "任务B", objective: "目标B", deliverables: [], completionCriteria: [], timeNode: {}, feedbackFrequency: "每日" },
          ],
        },
        assignment: {
          assignments: [{ primary: { userId: "u-1" } }, { primary: { userId: "u-2" } }],
        },
      },
      rawContent: "{}",
      trace: { requestId: "t5", model: "qwen3.6-plus", tokenUsage: { totalTokens: 60 }, latencyMs: 100 },
      toolCallsExecuted: 0,
    });
    const { runOrchestrator } = await import("../../src/agent/orchestrator");
    const result = await runOrchestrator("修改", {
      clientConfig: { baseUrl: "", apiKey: "", model: "qwen3.6-plus", timeoutMs: 5000, maxRetries: 0, temperature: 0, maxTokens: 2000 },
      employeeRepo: { list: () => [] },
      sessionContext: {
        latestDraft: {
          tasks: [
            { id: "task_11", title: "任务A", objective: "目标A" },
            { id: "task_22", title: "任务B", objective: "目标B" },
          ],
        },
      },
    });
    const tasks = ((result.draft as { tasks?: Array<{ id?: string }> })?.tasks ?? []);
    expect(tasks[0]?.id).toBe("task_11");
    expect(tasks[1]?.id).toBe("task_22");
    const assignments = ((result.assignment as { assignments?: Array<{ taskId?: string }> })?.assignments ?? []);
    expect(assignments[0]?.taskId).toBe("task_11");
    expect(assignments[1]?.taskId).toBe("task_22");
  });
});
