import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignmentDraft } from "../../../src/agent/assignment/types";
import type { EmployeeProfileRecord } from "../../../src/integrations/repos/employee-profile-repo";
import { runAssignmentRecommendation } from "../../../src/agent/assignment/run-assignment-recommendation";
import { ASSIGNMENT_RECOMMENDER_PROMPT_VERSION } from "../../../src/agent/assignment/assignment-prompt";

function makeProfile(overrides: Partial<EmployeeProfileRecord> & { userId: string }): EmployeeProfileRecord {
  return {
    displayName: "Test User",
    department: "质量部",
    role: "Engineer",
    selfProfile: {
      skillTags: ["8D", "FMEA"],
      strengths: ["root cause analysis"],
      boundaries: [],
      cases: [{ taskType: "quality", contribution: "lead", deliverable: "report", outcome: "closed" }],
      tools: ["Excel"],
      availability: { capacityHint: "80%", emergencyOk: true, rejectedTaskTypes: [] },
    },
    ...overrides,
  };
}

const MOCK_EMPLOYEES: EmployeeProfileRecord[] = [
  makeProfile({ userId: "emp_qa_001", department: "质量部" }),
  makeProfile({
    userId: "emp_qa_002",
    department: "测试部",
    selfProfile: { skillTags: ["QC 7 tools"], strengths: ["inspection"], boundaries: [], cases: [], tools: [], availability: {} },
  }),
];

const VALID_DRAFT: AssignmentDraft = {
  planId: "plan_test",
  traceId: "trace_test",
  generatedAt: new Date().toISOString(),
  promptVersion: ASSIGNMENT_RECOMMENDER_PROMPT_VERSION,
  modelName: "qwen-plus",
  assignments: [
    {
      taskId: "task_1",
      primary: {
        userId: "emp_qa_001",
        displayName: "Test User",
        rationale: "Has 8D experience",
        evidenceRefs: ["cases[0].outcome=closed"],
      },
      alternates: [
        {
          userId: "emp_qa_002",
          displayName: "Test User",
          rationale: "Has QC tools",
        },
      ],
      confidence: "HIGH",
      confidenceReason: "Best match",
    },
  ],
  globalRisks: [],
};

/**
 * Build a mock chat-completions fetch response.
 */
function mockFetchResponse(data: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}) {
  const message: Record<string, unknown> = {};
  if (data.content !== undefined) {
    message.content = data.content;
  }
  if (data.toolCalls) {
    message.content = null;
    message.tool_calls = data.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }));
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "req_test",
      model: "qwen-plus",
      choices: [{ finish_reason: "stop", message }],
      usage: data.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

describe("runAssignmentRecommendation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves draft and appends event on success", async () => {
    // callWithTools does 2 fetch calls: 1 tool + 1 JSON
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_1", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(VALID_DRAFT) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftSave = vi.fn().mockResolvedValue(undefined);
    const eventAppend = vi.fn().mockResolvedValue(undefined);

    const result = await runAssignmentRecommendation(
      {
        planId: "plan_test",
        traceId: "trace_test",
        tasks: [
          {
            id: "task_1",
            title: "分析异常",
            objective: "root cause analysis",
            deliverables: ["报告"],
            timeNode: { dueAt: "T+3" },
          },
        ],
        classificationSummary: "QUALITY: production process abnormality",
      },
      {
        employeeRepo: {
          list: () => MOCK_EMPLOYEES,
          get: (uid: string) => MOCK_EMPLOYEES.find((e) => e.userId === uid),
        },
        qwenConfig: {
          baseUrl: "https://test.api",
          apiKey: "test-key",
          model: "qwen-plus",
          timeoutMs: 10000,
          maxRetries: 0,
          temperature: 0.2,
          maxTokens: 2048,
        },
        draftRepo: { save: draftSave },
        eventRepo: { append: eventAppend },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.assignments).toHaveLength(1);
      expect(result.draft.planId).toBe("plan_test");
    }

    // Verify draftRepo.save was called
    expect(draftSave).toHaveBeenCalledTimes(1);
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan_test" }));

    // Verify eventRepo.append was called
    expect(eventAppend).toHaveBeenCalledTimes(1);
    expect(eventAppend).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "ASSIGNMENT_DRAFT_GENERATED" }),
    );
  });

  it("performs self-correction when first validation fails", async () => {
    // Build an invalid draft (empty assignments so validation fails)
    const invalidDraft = {
      ...VALID_DRAFT,
      assignments: [],
      planId: "",
      traceId: "trace_test",
      promptVersion: "",
      modelName: "",
    };

    // callWithTools #1 (2 fetch calls) -> invalid draft
    // callWithTools #2 (2 fetch calls) -> valid draft
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_1", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(invalidDraft) }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_2", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(VALID_DRAFT) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftSave = vi.fn().mockResolvedValue(undefined);
    const eventAppend = vi.fn().mockResolvedValue(undefined);

    const result = await runAssignmentRecommendation(
      {
        planId: "plan_test",
        traceId: "trace_test",
        tasks: [
          {
            id: "task_1",
            title: "分析异常",
            objective: "root cause analysis",
            deliverables: ["报告"],
            timeNode: { dueAt: "T+3" },
          },
        ],
        classificationSummary: "QUALITY",
      },
      {
        employeeRepo: {
          list: () => MOCK_EMPLOYEES,
          get: (uid: string) => MOCK_EMPLOYEES.find((e) => e.userId === uid),
        },
        qwenConfig: {
          baseUrl: "https://test.api",
          apiKey: "test-key",
          model: "qwen-plus",
          timeoutMs: 10000,
          maxRetries: 0,
          temperature: 0.2,
          maxTokens: 2048,
        },
        draftRepo: { save: draftSave },
        eventRepo: { append: eventAppend },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.assignments).toHaveLength(1);
    }

    // Should have been 4 fetch calls (2 per callWithTools invocation)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns ok:false when API call fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", fetchMock);

    const draftSave = vi.fn().mockResolvedValue(undefined);
    const eventAppend = vi.fn().mockResolvedValue(undefined);

    const result = await runAssignmentRecommendation(
      {
        planId: "plan_test",
        traceId: "trace_test",
        tasks: [
          {
            id: "task_1",
            title: "分析异常",
            objective: "root cause analysis",
            deliverables: ["报告"],
            timeNode: { dueAt: "T+3" },
          },
        ],
        classificationSummary: "QUALITY",
      },
      {
        employeeRepo: {
          list: () => MOCK_EMPLOYEES,
          get: (uid: string) => MOCK_EMPLOYEES.find((e) => e.userId === uid),
        },
        qwenConfig: {
          baseUrl: "https://test.api",
          apiKey: "test-key",
          model: "qwen-plus",
          timeoutMs: 10000,
          maxRetries: 0,
          temperature: 0.2,
          maxTokens: 2048,
        },
        draftRepo: { save: draftSave },
        eventRepo: { append: eventAppend },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
    }
    expect(draftSave).not.toHaveBeenCalled();
  });

  it("returns ok:false when self-correction still fails", async () => {
    // Invalid draft on both attempts
    const invalidDraft = {
      ...VALID_DRAFT,
      assignments: [],
      planId: "",
      traceId: "trace_test",
      promptVersion: "",
      modelName: "",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_1", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(invalidDraft) }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_2", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(invalidDraft) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftSave = vi.fn().mockResolvedValue(undefined);
    const eventAppend = vi.fn().mockResolvedValue(undefined);

    const result = await runAssignmentRecommendation(
      {
        planId: "plan_test",
        traceId: "trace_test",
        tasks: [
          {
            id: "task_1",
            title: "分析异常",
            objective: "root cause analysis",
            deliverables: ["报告"],
            timeNode: { dueAt: "T+3" },
          },
        ],
        classificationSummary: "QUALITY",
      },
      {
        employeeRepo: {
          list: () => MOCK_EMPLOYEES,
          get: (uid: string) => MOCK_EMPLOYEES.find((e) => e.userId === uid),
        },
        qwenConfig: {
          baseUrl: "https://test.api",
          apiKey: "test-key",
          model: "qwen-plus",
          timeoutMs: 10000,
          maxRetries: 0,
          temperature: 0.2,
          maxTokens: 2048,
        },
        draftRepo: { save: draftSave },
        eventRepo: { append: eventAppend },
      },
    );

    expect(result.ok).toBe(false);
    expect(draftSave).not.toHaveBeenCalled();
  });

  it("uses stable planId and carries revision context into prompt", async () => {
    const draftWithoutPlan = {
      ...VALID_DRAFT,
      planId: "",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          toolCalls: [{ id: "call_ctx_1", name: "search_employees", args: "{}" }],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ content: JSON.stringify(draftWithoutPlan) }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const draftSave = vi.fn().mockResolvedValue(undefined);
    const eventAppend = vi.fn().mockResolvedValue(undefined);

    const result = await runAssignmentRecommendation(
      {
        planId: "plan-persistent-1",
        traceId: "trace_ctx",
        tasks: [
          {
            id: "task_1",
            title: "重新分配任务",
            objective: "按用户要求调整负责人",
            deliverables: ["新版分配表"],
            timeNode: { dueAt: "T+2" },
          },
        ],
        classificationSummary: "QUALITY",
        userInstruction: "把 task_1 改给测试部负责人",
        previousAssignment: {
          assignments: [{ taskId: "task_1", primary: { userId: "emp_qa_001" } }],
        },
        knownFacts: ["测试部今天有空余产能"],
      },
      {
        employeeRepo: {
          list: () => MOCK_EMPLOYEES,
          get: (uid: string) => MOCK_EMPLOYEES.find((e) => e.userId === uid),
        },
        qwenConfig: {
          baseUrl: "https://test.api",
          apiKey: "test-key",
          model: "qwen-plus",
          timeoutMs: 10000,
          maxRetries: 0,
          temperature: 0.2,
          maxTokens: 2048,
        },
        draftRepo: { save: draftSave },
        eventRepo: { append: eventAppend },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.planId).toBe("plan-persistent-1");
    }

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const userContent = firstBody.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("用户本轮修改要求");
    expect(userContent).toContain("上一版分配草案");
    expect(userContent).toContain("knownFacts");
    expect(userContent).toContain("plan-persistent-1");
  });
});
